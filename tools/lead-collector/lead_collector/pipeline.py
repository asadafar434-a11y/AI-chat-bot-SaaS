"""Сборка: архивы → записи → фильтры → база. В журнал идут только числа и номера контрактов."""
from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .client import EisClient
from .config import REGION_CODES
from . import db
from .models import ContractRecord
from .parser import iter_zip_contracts

log = logging.getLogger("lead_collector.pipeline")


@dataclass
class Report:
    contracts_seen: int = 0
    skipped_by_amount: int = 0
    new_contracts: int = 0
    repeated_contracts: int = 0
    broken_files: int = 0
    seconds: float = 0.0
    suppliers_touched: set = field(default_factory=set)

    def merge(self, other: "Report") -> None:
        for name in ("contracts_seen", "skipped_by_amount", "new_contracts", "repeated_contracts", "broken_files"):
            setattr(self, name, getattr(self, name) + getattr(other, name))
        self.suppliers_touched |= other.suppliers_touched


def day_range(start: date, end: date) -> list[str]:
    if end < start:
        raise ValueError("Конец периода раньше начала")
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def default_day() -> date:
    return date.today() - timedelta(days=1)


def regions(value: str) -> list[str]:
    if value.strip().lower() in ("все", "all"):
        return list(REGION_CODES)
    return [value.strip()]


def store_records(conn: sqlite3.Connection, records: list[ContractRecord], min_amount: float,
                  period: tuple[str, str] | None = None) -> Report:
    rep = Report()
    for rec in records:
        rep.contracts_seen += 1
        if period and rec.sign_date and not (period[0] <= rec.sign_date <= period[1]):
            continue
        if min_amount and (rec.amount is None or rec.amount < min_amount):
            rep.skipped_by_amount += 1
            continue
        if db.upsert_contract(conn, rec):
            rep.new_contracts += 1
        else:
            rep.repeated_contracts += 1
        rep.suppliers_touched.add(rec.inn)
    return rep


def process_archive(conn: sqlite3.Connection, data: bytes, region: str, min_amount: float,
                    period: tuple[str, str] | None = None) -> Report:
    total = Report()
    for filename, records in iter_zip_contracts(data, region):
        if records is None:
            total.broken_files += 1
            log.warning("Не удалось разобрать файл %s", filename)
            continue
        total.merge(store_records(conn, records, min_amount, period))
    return total


def collect(conn: sqlite3.Connection, client: EisClient, start: date, end: date, region: str,
            min_amount: float) -> Report:
    import time

    started = time.monotonic()
    total = Report()
    period = (start.isoformat(), end.isoformat())
    for day in day_range(start, end):
        for code in regions(region):
            urls = client.archive_urls(code, day)
            day_rep = Report()
            for url in urls:
                day_rep.merge(process_archive(conn, client.download(url), code, min_amount, period))
            log.info("Регион %s, %s: архивов %d, контрактов %d, новых %d, повторов %d",
                     code, day, len(urls), day_rep.contracts_seen, day_rep.new_contracts,
                     day_rep.repeated_contracts)
            total.merge(day_rep)
    total.seconds = time.monotonic() - started
    return total


def collect_web(conn: sqlite3.Connection, web, start: date, end: date, region_code: str,
                min_amount: float) -> Report:
    """Сбор с сайта ЕИС. Уже сохранённые контракты не запрашиваем (повторный запуск дешёвый и безопасный)."""
    import time

    started = time.monotonic()
    total = Report()
    for day in day_range(start, end):
        numbers = web.day_numbers(date.fromisoformat(day), min_amount, region_code)
        todo = [n for n in numbers
                if conn.execute("SELECT 1 FROM contracts WHERE reg_number=?", (n,)).fetchone() is None]
        log.info("%s: в списке %d контрактов, новых для карточек %d", day, len(numbers), len(todo))
        for number in todo:
            if web.cards_fetched >= web.max_cards:
                log.warning("Достигнут потолок карточек за запуск (%d). Запустите команду ещё раз: продолжит с места остановки.",
                            web.max_cards)
                total.seconds = time.monotonic() - started
                return total
            records = web.card(number, region_code)
            total.merge(store_records(conn, records, min_amount))
    total.seconds = time.monotonic() - started
    return total


def parse_folder(conn: sqlite3.Connection, folder: Path, region: str, min_amount: float,
                 period: tuple[str, str] | None = None) -> Report:
    """Разбор уже скачанных ZIP-архивов и сохранённых страниц карточек (.html) из папки, без обращения к ЕИС."""
    from .cards import parse_card

    total = Report()
    for path in sorted(folder.glob("*.zip")):
        total.merge(process_archive(conn, path.read_bytes(), region, min_amount, period))
    for path in sorted(folder.glob("*.htm*")):
        number = path.stem if re.fullmatch(r"\d{19}", path.stem) else ""
        if number and conn.execute("SELECT 1 FROM contracts WHERE reg_number=? LIMIT 1", (number,)).fetchone():
            total.contracts_seen += 1
            total.repeated_contracts += 1  # уже в базе: файл не разбираем заново
            continue
        html = path.read_text(encoding="utf-8", errors="replace")
        # Страницы собраны по дате размещения, поэтому период по дате заключения к ним не применяем.
        total.merge(store_records(conn, parse_card(html, number, region), min_amount))
    return total
