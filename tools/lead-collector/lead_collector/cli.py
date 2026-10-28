"""Командная строка. Сборщик ничего не рассылает и никому не звонит."""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from pathlib import Path

from . import db
from .config import CONTACT_STATUSES, DATA_DIR, LOG_PATH, EisSettings
from .export import export_all
from .pipeline import Report, collect, default_day, parse_folder


def _setup_logging() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    for handler in (logging.FileHandler(LOG_PATH, encoding="utf-8"), logging.StreamHandler(sys.stdout)):
        handler.setFormatter(fmt)
        logging.getLogger().addHandler(handler)
    logging.getLogger().setLevel(logging.INFO)


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("дата должна быть в виде ГГГГ-ММ-ДД")


def _add_filters(p: argparse.ArgumentParser) -> None:
    p.add_argument("--from", dest="start", type=_date, default=None, help="начало периода (по умолчанию — вчера)")
    p.add_argument("--to", dest="end", type=_date, default=None, help="конец периода (по умолчанию — как --from)")
    p.add_argument("--region", default="все", help="код региона заказчика или «все»")
    p.add_argument("--min-amount", type=float, default=0.0, help="минимальная сумма контракта, ₽")


def _period(args) -> tuple[date, date]:
    start = args.start or default_day()
    return start, args.end or start


def _print_report(rep: Report) -> None:
    print(f"Контрактов просмотрено: {rep.contracts_seen}; новых: {rep.new_contracts}; "
          f"повторов: {rep.repeated_contracts}; ниже порога суммы: {rep.skipped_by_amount}; "
          f"сломанных файлов: {rep.broken_files}; поставщиков затронуто: {len(rep.suppliers_touched)}; "
          f"время: {rep.seconds:.1f} с")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="lead_collector", description="Сборщик базы поставщиков из реестра контрактов ЕИС")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="собрать данные из ЕИС (нужен токен)")
    _add_filters(c)
    c.add_argument("--no-export", action="store_true", help="не выгружать CSV/Excel после сбора")

    w = sub.add_parser("collect-web", help="собрать со страниц сайта ЕИС (без токена)")
    _add_filters(w)
    w.add_argument("--pause", type=float, default=4.0, help="пауза между страницами, с (не меньше 2)")
    w.add_argument("--max-cards", type=int, default=200, help="потолок карточек за один запуск")
    w.add_argument("--date-kind", choices=("published", "signed"), default="published",
                   help="published — по дате размещения в реестре (по умолчанию), signed — по дате заключения")
    w.add_argument("--no-export", action="store_true", help="не выгружать CSV/Excel после сбора")

    r = sub.add_parser("receive", help="приёмник страниц из Chrome (локально), для режима «VPN только в Chrome»")
    r.add_argument("--port", type=int, default=8765)

    f = sub.add_parser("parse-folder", help="разобрать скачанные ZIP-архивы и сохранённые страницы карточек из папки")
    f.add_argument("folder", type=Path)
    _add_filters(f)

    e = sub.add_parser("export", help="выгрузить базу в CSV и Excel")
    e.add_argument("--all", action="store_true", help="включая «отказ» и «не беспокоить»")
    e.add_argument("--min-contracts", type=int, default=1,
                   help="только поставщики с таким числом контрактов и больше (например, 2 — повторяющиеся)")
    e.add_argument("--kinds", default="", help="только эти типы через запятую, например ООО,ИП")

    c2 = sub.add_parser("export-contacts", help="короткий Excel: только название компании и почта")
    c2.add_argument("--kinds", default="", help="только эти типы через запятую, например ООО,ИП")

    s = sub.add_parser("status", help="сменить статус контакта по ИНН")
    s.add_argument("inn")
    s.add_argument("value", choices=CONTACT_STATUSES)

    d = sub.add_parser("delete", help="полностью удалить поставщика по ИНН")
    d.add_argument("inn")
    d.add_argument("--yes", action="store_true", help="подтвердить удаление без вопроса")

    sub.add_parser("stats", help="сводка по базе")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "receive":
        from .receiver import serve

        serve(args.port)
        return 0
    _setup_logging()
    log = logging.getLogger("lead_collector")
    conn = db.connect()

    if args.cmd in ("collect", "collect-web", "parse-folder"):
        start, end = _period(args)
        if args.cmd == "collect-web":
            from .pipeline import collect_web
            from .web import BlockedError, WebClient

            region = "" if args.region.lower() in ("все", "all") else args.region
            try:
                rep = collect_web(conn, WebClient(max(args.pause, 2.0), args.max_cards, date_kind=args.date_kind), start, end,
                                  region, args.min_amount)
            except BlockedError as exc:
                log.error("%s", exc)
                return 2
        elif args.cmd == "collect":
            from .client import EisClient, EisError

            try:
                client = EisClient(EisSettings.from_env())
                rep = collect(conn, client, start, end, args.region, args.min_amount)
            except EisError as exc:
                log.error("%s", exc)
                return 2
        else:
            rep = parse_folder(conn, args.folder, args.region if args.region != "все" else "",
                               args.min_amount, (start.isoformat(), end.isoformat()))
        log.info("Готово: период %s — %s", start, end)
        _print_report(rep)
        if args.cmd == "parse-folder" or not args.no_export:
            csv_path, xlsx_path = export_all(conn)
            print(f"Выгрузка: {csv_path}\n          {xlsx_path}")
        return 0

    if args.cmd == "export":
        kinds = tuple(k.strip() for k in args.kinds.split(",") if k.strip()) or None
        csv_path, xlsx_path = export_all(
            conn, include_all=args.all, min_contracts=args.min_contracts, kinds=kinds,
            prefix="repeat" if args.min_contracts > 1 else "leads")
        print(f"Выгрузка: {csv_path}\n          {xlsx_path}")
        return 0

    if args.cmd == "export-contacts":
        from .export import export_contacts

        kinds = tuple(k.strip() for k in args.kinds.split(",") if k.strip()) or None
        path, count = export_contacts(conn, kinds=kinds)
        print(f"Контактов с почтой: {count}\nФайл: {path}")
        return 0

    if args.cmd == "status":
        if db.set_contact_status(conn, args.inn, args.value):
            log.info("Статус контакта изменён")
            return 0
        print("Поставщик с таким ИНН не найден")
        return 1

    if args.cmd == "delete":
        if not args.yes:
            answer = input("Удалить запись и все её контракты безвозвратно? Введите «да»: ")
            if answer.strip().lower() != "да":
                print("Отменено")
                return 1
        found = db.delete_supplier(conn, args.inn)
        log.info("Команда удаления выполнена (запись %s)", "найдена и удалена" if found else "не найдена")
        print("Удалено." if found else "Записи с таким ИНН нет.")
        print("Старые файлы выгрузки CSV/Excel удалите сами или сделайте новую выгрузку: "
              "в них этот ИНН мог остаться.")
        return 0 if found else 1

    if args.cmd == "stats":
        for key, value in db.stats(conn).items():
            print(f"{key}: {value}")
        return 0
    return 0
