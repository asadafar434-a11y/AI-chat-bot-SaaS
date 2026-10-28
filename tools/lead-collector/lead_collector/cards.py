"""Разбор HTML-карточки контракта с сайта ЕИС (раздел «Контракты и договоры», реестр контрактов 44-ФЗ).

Что проверено на настоящих карточках (20.10.2026, 10 контрактов): блок «Информация о поставщиках» —
таблица с колонками «Организация», «Страна, код», «Адрес места нахождения», «Почтовый адрес» (бывает не всегда),
«Телефон, электронная почта», «Статус» (бывает не всегда). В ячейке организации: наименование, «ИНН: …», у ООО/АО ещё «КПП: …»;
у ИП — «ФИО» и слово «Индивидуальный предприниматель», ИНН из 12 цифр, КПП нет. ОГРН в карточке НЕТ.
Телефон пишется по-разному («7 9017903210», «+7 (495) 789-30-40»), приводим к «+7…».
Регион отдельным полем не указан — выделяем из адреса.
Не проверены: имена CSS-классов (опираемся на текст и заголовки таблицы, а не на классы).
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .models import ContractRecord, detect_kind

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ENTREPRENEUR = re.compile(r"\s*индивидуальный\s+предприниматель\s*$", re.I)

_CITY_REGION = re.compile(r"^(?:Г\.?\s*)?(МОСКВА|САНКТ-ПЕТЕРБУРГ|СЕВАСТОПОЛЬ|БАЙКОНУР)$", re.I)


def region_from_address(address: str) -> str:
    """Регион из адреса: часть адреса со словами «область», «край», «республика», «автономный округ» или «г. Москва» и т. п."""
    for part in (p.strip() for p in address.split(",")):
        if not part:
            continue
        m = _CITY_REGION.match(part)
        if m:
            return m.group(1).upper()
        if len(part) < 60 and re.search(r"ОБЛАСТЬ|КРАЙ|РЕСПУБЛИКА|АВТОНОМНЫЙ\s+ОКРУГ", part, re.I) \
                and not re.search(r"\b(Р-Н|РАЙОН|Г\.|УЛ|Д\.)", part, re.I):
            return _tidy_region(part)
    return ""


def _tidy_region(part: str) -> str:
    """«АРХАНГЕЛЬСКАЯ ОБЛАСТЬ 29» → «АРХАНГЕЛЬСКАЯ ОБЛАСТЬ»; «ТЕСТ ОБЛАСТЬ ВЕЛЬСКИЙ» → «ТЕСТ ОБЛАСТЬ»."""
    up = " ".join(part.upper().split())
    m = re.match(r"^(.*?\b(?:ОБЛАСТЬ|КРАЙ))\b", up)
    if m:
        return m.group(1)
    return re.sub(r"\s+\d+$", "", up)


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits[0] in "78":
        return "+7" + digits[1:]
    if len(digits) == 10:
        return "+7" + digits
    return raw.strip()


def _lines(soup: BeautifulSoup) -> list[str]:
    return [ln for ln in soup.get_text("\n", strip=True).split("\n") if ln]


def _after(lines: list[str], label: str, start: int = 0) -> str:
    for i in range(start, len(lines) - 1):
        if lines[i] == label:
            return lines[i + 1]
    return ""


def _amount(raw: str) -> float | None:
    cleaned = re.sub(r"[^\d,.\-]", "", raw.replace("\xa0", "")).replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _date(raw: str) -> str:
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", raw.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def parse_card(html: str, reestr_number: str = "", customer_region: str = "") -> list[ContractRecord]:
    soup = BeautifulSoup(html, "html.parser")
    lines = _lines(soup)
    number = _after(lines, "Номер контракта") or reestr_number
    reg = reestr_number or re.sub(r"\D", "", _after(lines, "Реестровый номер контракта"))
    price_raw = _after(lines, "Цена контракта") or _after(lines, "Максимальное значение цены контракта")
    base = dict(
        reg_number=reg or number,
        sign_date=_date(_after(lines, "Дата заключения контракта")),
        amount=_amount(price_raw),
        customer=_after(lines, "Полное наименование заказчика"),
        subject=_after(lines, "Предмет контракта"),
        customer_region=customer_region,
    )
    heading = next((h for h in soup.find_all(["h2", "h3"]) if "Информация о поставщиках" in h.get_text()), None)
    table = None
    if heading is not None:
        table = heading.find_next("table")
    if table is None:
        return []
    headers = [th.get_text(" ", strip=True).lower() for th in table.find_all("th")]
    col = lambda word: next((i for i, h in enumerate(headers) if word in h), None)  # noqa: E731
    i_addr, i_contact = col("адрес места"), col("телефон")
    records: list[ContractRecord] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        org = cells[0].get_text(" ", strip=True)
        m_inn = re.search(r"ИНН:\s*(\d{12}|\d{10})(?!\d)", org)
        if not m_inn:
            continue  # иностранный поставщик без ИНН
        inn = m_inn.group(1)
        m_kpp = re.search(r"КПП:\s*(\d{9})", org)
        name = org.split("ИНН:")[0].strip()
        is_ip = bool(_ENTREPRENEUR.search(name))
        name = _ENTREPRENEUR.sub("", name).strip()
        address = cells[i_addr].get_text(" ", strip=True) if i_addr is not None and i_addr < len(cells) else ""
        contact = cells[i_contact].get_text(" ", strip=True) if i_contact is not None and i_contact < len(cells) else ""
        m_mail = _EMAIL.search(contact)
        email = m_mail.group(0).lower() if m_mail else ""
        phone_raw = contact.replace(m_mail.group(0), "").strip() if m_mail else contact
        phone = normalize_phone(phone_raw) if re.search(r"\d", phone_raw) else ""
        records.append(ContractRecord(
            inn=inn, kpp=m_kpp.group(1) if m_kpp else "", name=name,
            kind=detect_kind(inn, name, "person" if is_ip else ""),
            region=region_from_address(address), phone=phone, email=email, **base))
    return records


def parse_list_page(html: str) -> list[str]:
    """Реестровые номера контрактов (19 цифр) со страницы результатов поиска."""
    found = re.findall(r"reestrNumber=(\d{19})", html)
    return list(dict.fromkeys(found))
