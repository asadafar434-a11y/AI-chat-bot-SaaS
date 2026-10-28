from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ContractRecord:
    """Один поставщик в одном контракте (в контракте их может быть несколько)."""

    reg_number: str
    sign_date: str  # ГГГГ-ММ-ДД
    amount: float | None
    customer: str
    subject: str
    inn: str
    kpp: str
    name: str
    kind: str  # «ООО» | «ИП» | «Юрлицо»
    region: str  # регион поставщика, если удалось определить; иначе пусто
    phone: str
    email: str
    customer_region: str = ""


_LEGAL_FORMS = (
    (re.compile(r"\bООО\b|общество\s+с\s+ограниченной\s+ответственностью", re.I), "ООО"),
    (re.compile(r"\bИП\b|индивидуальный\s+предприниматель", re.I), "ИП"),
)


def detect_kind(inn: str, name: str, hint: str = "") -> str:
    """Тип поставщика. Подсказка из разметки (физлицо/ИП) главнее; потом ИНН из 12 цифр; потом название."""
    if hint == "person":
        return "ИП"
    if len(inn) == 12:
        return "ИП"
    for pattern, kind in _LEGAL_FORMS:
        if pattern.search(name or ""):
            return kind
    return "Юрлицо"


def is_personal_data(kind: str) -> bool:
    """Контакты ИП — персональные данные физлица (152-ФЗ)."""
    return kind == "ИП"
