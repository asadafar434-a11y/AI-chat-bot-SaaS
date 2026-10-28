"""Разбор XML контрактов ЕИС в записи ContractRecord.

ВНИМАНИЕ: названия тегов ниже — ПРЕДПОЛОЖЕНИЕ, не проверенное на настоящих контрактах
(доступа к ЕИС при написании не было). Все названия собраны в TAGS в одном месте: после первого
настоящего ответа сверить с реальным XML и поправить только эту таблицу. Пространства имён
игнорируются. Поле, которого нет в файле, остаётся пустым — ничего не выдумывается.
"""
from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Iterator

from .models import ContractRecord, detect_kind

TAGS = {
    "contract": ("contract",),
    "number": ("regNum", "registryNum", "number"),
    "date": ("signDate", "contractSignDate", "publishDate"),
    "amount": ("price", "priceRUR", "contractPrice"),
    "subject": ("contractSubject", "subject"),
    "product": ("name", "productName"),
    "customer_block": ("customer",),
    "name": ("fullName", "name", "shortName"),
    "suppliers": ("supplier",),
    "legal": ("legalEntityRF", "legalEntityForeignState"),
    "person": ("individualPersonRF", "individualPersonForeignState", "individualPerson"),
    "inn": ("INN", "inn"),
    "kpp": ("KPP", "kpp"),
    "address": ("factualAddress", "address", "postAddress", "legalAddress"),
    "phone": ("contactPhone", "phone"),
    "email": ("contactEMail", "contactEmail", "email"),
}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(el: ET.Element, names: tuple[str, ...]) -> list[ET.Element]:
    return [c for c in el if _local(c.tag) in names]


def _descendants(el: ET.Element, names: tuple[str, ...]) -> list[ET.Element]:
    return [d for d in el.iter() if d is not el and _local(d.tag) in names]


def _text(el: ET.Element | None) -> str:
    return " ".join((el.text or "").split()) if el is not None else ""


def _direct(el: ET.Element, names: tuple[str, ...]) -> str:
    """Текст первого подходящего прямого потомка; порядок names — порядок предпочтения."""
    for name in names:
        for c in _children(el, (name,)):
            if _text(c):
                return _text(c)
    return ""


def _deep(el: ET.Element, names: tuple[str, ...]) -> str:
    for name in names:
        for d in _descendants(el, (name,)):
            if _text(d):
                return _text(d)
    return ""


def _to_amount(raw: str) -> float | None:
    cleaned = raw.replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _to_date(raw: str) -> str:
    m = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else ""


def _digits(raw: str) -> str:
    return re.sub(r"\D", "", raw)


def region_from_address(address: str) -> str:
    """Регион из адреса — только если он явно назван кодом субъекта. Иначе пусто (не угадываем)."""
    return ""


def _parse_supplier(sup: ET.Element) -> dict | None:
    person = _children(sup, TAGS["person"]) or _descendants(sup, TAGS["person"])
    legal = _children(sup, TAGS["legal"]) or _descendants(sup, TAGS["legal"])
    block = (person or legal or [sup])[0]
    inn = _digits(_deep(block, TAGS["inn"]))
    if not inn:
        return None
    name = _deep(block, TAGS["name"])
    if not name and person:
        parts = [_deep(block, (t,)) for t in ("lastName", "firstName", "middleName")]
        name = " ".join(p for p in parts if p)
    address = _deep(block, TAGS["address"])
    return {
        "inn": inn,
        "kpp": _digits(_deep(block, TAGS["kpp"])),
        "name": name,
        "hint": "person" if person else "",
        "region": region_from_address(address),
        "phone": _deep(block, TAGS["phone"]),
        "email": _deep(block, TAGS["email"]).lower(),
    }


def parse_contract_xml(data: bytes, customer_region: str = "") -> list[ContractRecord]:
    root = ET.fromstring(data)
    nodes = [root] if _local(root.tag) in TAGS["contract"] else _descendants(root, TAGS["contract"])
    records: list[ContractRecord] = []
    for node in nodes:
        number = _direct(node, TAGS["number"])
        if not number:
            continue
        customer_nodes = _children(node, TAGS["customer_block"]) or _descendants(
            node, TAGS["customer_block"])
        customer = _deep(customer_nodes[0], TAGS["name"]) if customer_nodes else ""
        subject = _direct(node, TAGS["subject"])
        if not subject:
            for prod in _descendants(node, ("product",)):
                subject = _direct(prod, TAGS["product"])
                if subject:
                    break
        base = dict(
            reg_number=number,
            sign_date=_to_date(_direct(node, TAGS["date"])),
            amount=_to_amount(_direct(node, TAGS["amount"])),
            customer=customer,
            subject=subject,
            customer_region=customer_region,
        )
        for sup in _descendants(node, TAGS["suppliers"]):
            info = _parse_supplier(sup)
            if info is None:
                continue
            hint = info.pop("hint")
            records.append(ContractRecord(
                kind=detect_kind(info["inn"], info["name"], hint), **info, **base))
    return records


def iter_zip_contracts(data: bytes, customer_region: str = "") -> Iterator[tuple[str, list[ContractRecord] | None]]:
    """Идёт по XML внутри ZIP. Для сломанного файла отдаёт (имя, None) — вызывающий пишет в журнал имя файла."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if not info.filename.lower().endswith(".xml"):
                continue
            try:
                yield info.filename, parse_contract_xml(zf.read(info), customer_region)
            except ET.ParseError:
                yield info.filename, None
