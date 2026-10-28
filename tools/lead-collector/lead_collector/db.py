"""SQLite-хранилище: поставщики (один на ИНН) и контракты (чтобы повторный запуск не плодил дубли)."""
from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

from .config import CONTACT_STATUSES, DB_PATH
from .models import ContractRecord

SCHEMA = """
CREATE TABLE IF NOT EXISTS suppliers (
    inn TEXT PRIMARY KEY,
    kpp TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    customer_region TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    last_contract_date TEXT NOT NULL DEFAULT '',
    last_contract_number TEXT NOT NULL DEFAULT '',
    last_amount REAL,
    customer TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    contracts_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT '',
    collected_at TEXT NOT NULL,
    contact_status TEXT NOT NULL DEFAULT 'не связывались'
);
CREATE TABLE IF NOT EXISTS contracts (
    reg_number TEXT NOT NULL,
    inn TEXT NOT NULL,
    sign_date TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (reg_number, inn)
);
CREATE INDEX IF NOT EXISTS idx_contracts_inn ON contracts(inn);
"""

SHORT_SUBJECT = 200


def connect(path: Path | str = DB_PATH) -> sqlite3.Connection:
    path = Path(path)
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_contract(conn: sqlite3.Connection, rec: ContractRecord, today: str | None = None) -> bool:
    """Добавляет контракт; возвращает True, если контракт новый.

    Повтор того же (контракт, ИНН) ничего не меняет. Для нового контракта число контрактов
    пересчитывается, а «последний контракт» обновляется только если он не старше прежнего.
    Статус контакта при обновлении не трогаем.
    """
    today = today or date.today().isoformat()
    cur = conn.execute(
        "INSERT OR IGNORE INTO contracts (reg_number, inn, sign_date) VALUES (?, ?, ?)",
        (rec.reg_number, rec.inn, rec.sign_date),
    )
    is_new = cur.rowcount == 1
    existing = conn.execute("SELECT * FROM suppliers WHERE inn = ?", (rec.inn,)).fetchone()
    subject = (rec.subject or "")[:SHORT_SUBJECT]
    if existing is None:
        conn.execute(
            """INSERT INTO suppliers (inn, kpp, name, kind, region, customer_region, phone, email,
                   last_contract_date, last_contract_number, last_amount, customer, subject,
                   contracts_count, source, collected_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (rec.inn, rec.kpp, rec.name, rec.kind, rec.region, rec.customer_region, rec.phone,
             rec.email, rec.sign_date, rec.reg_number, rec.amount, rec.customer, subject,
             1, rec.reg_number, today),
        )
        conn.commit()
        return True
    if not is_new:
        return False
    count = conn.execute("SELECT COUNT(*) FROM contracts WHERE inn = ?", (rec.inn,)).fetchone()[0]
    fresher = (rec.sign_date, rec.reg_number) >= (
        existing["last_contract_date"], existing["last_contract_number"])
    if fresher:
        conn.execute(
            """UPDATE suppliers SET kpp=?, name=?, kind=?, region=?, customer_region=?,
                   phone=?, email=?, last_contract_date=?, last_contract_number=?, last_amount=?,
                   customer=?, subject=?, contracts_count=? WHERE inn=?""",
            (rec.kpp or existing["kpp"], rec.name, rec.kind, rec.region or existing["region"],
             rec.customer_region or existing["customer_region"],
             rec.phone or existing["phone"], rec.email or existing["email"],
             rec.sign_date, rec.reg_number, rec.amount, rec.customer, subject, count, rec.inn),
        )
    else:
        conn.execute(
            "UPDATE suppliers SET contracts_count=?, phone=?, email=? WHERE inn=?",
            (count, existing["phone"] or rec.phone, existing["email"] or rec.email, rec.inn),
        )
    conn.commit()
    return True


def set_contact_status(conn: sqlite3.Connection, inn: str, status: str) -> bool:
    if status not in CONTACT_STATUSES:
        raise ValueError(f"Неизвестный статус: допустимы {', '.join(CONTACT_STATUSES)}")
    cur = conn.execute("UPDATE suppliers SET contact_status=? WHERE inn=?", (status, inn))
    conn.commit()
    return cur.rowcount > 0


def delete_supplier(conn: sqlite3.Connection, inn: str) -> bool:
    """Полное удаление: карточка поставщика и все его контракты. Затем сжатие файла базы."""
    found = conn.execute("SELECT 1 FROM suppliers WHERE inn=?", (inn,)).fetchone() is not None
    conn.execute("DELETE FROM contracts WHERE inn=?", (inn,))
    conn.execute("DELETE FROM suppliers WHERE inn=?", (inn,))
    conn.commit()
    conn.execute("VACUUM")  # затираем освобождённые страницы
    return found


def stats(conn: sqlite3.Connection) -> dict[str, int]:
    one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "всего": one("SELECT COUNT(*) FROM suppliers"),
        "ООО": one("SELECT COUNT(*) FROM suppliers WHERE kind='ООО'"),
        "ИП": one("SELECT COUNT(*) FROM suppliers WHERE kind='ИП'"),
        "другие юрлица": one("SELECT COUNT(*) FROM suppliers WHERE kind='Юрлицо'"),
        "с телефоном": one("SELECT COUNT(*) FROM suppliers WHERE phone<>''"),
        "с почтой": one("SELECT COUNT(*) FROM suppliers WHERE email<>''"),
        "с телефоном или почтой": one("SELECT COUNT(*) FROM suppliers WHERE phone<>'' OR email<>''"),
    }
