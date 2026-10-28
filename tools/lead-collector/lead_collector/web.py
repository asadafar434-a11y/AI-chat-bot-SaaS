"""Сбор со страниц сайта ЕИС (реестр контрактов 44-ФЗ) — без токена, как это делает человек в браузере.

Правила (не обходим защиту): большие паузы между страницами, потолок числа карточек за запуск,
при капче/блокировке/частых отказах — остановка, а не «обход». Сайт у вас открывается через VPN: если
программа Python сайт не видит, задайте прокси (переменная HTTPS_PROXY) или запускайте на машине с доступом.

НЕ ПРОВЕРЕНО на настоящем сайте из Python: имена и формат параметров поиска (даты ДД.ММ.ГГГГ, сумма, код места
заказчика). Сами имена полей формы существуют (contractDateFrom/To, contractPriceFrom, customerPlaceCodes).
Карточка читается по адресу /epz/contract/contractCard/common-info.html?reestrNumber=… (проверено в браузере).
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from urllib.parse import urlencode

import requests

from .cards import parse_card, parse_list_page
from .models import ContractRecord

log = logging.getLogger("lead_collector.web")

BASE = os.environ.get("EIS_SITE", "https://zakupki.gov.ru")
SEARCH = "/epz/contract/search/results.html"
CARD = "/epz/contract/contractCard/common-info.html"
PER_PAGE = 50
MAX_PAGES = 100  # потолок самого сайта: дальше сотой страницы результатов не показываются


class BlockedError(RuntimeError):
    """Сайт ответил капчей/блокировкой. Останавливаемся, ничего не обходим."""


def search_params(day: date, min_amount: float, region_code: str, page: int, date_kind: str = "published") -> dict:
    """date_kind: «published» — дата размещения в реестре (по умолчанию), «signed» — дата заключения.

    Проверено в браузере 20.10.2026: дата и сумма работают вместе, если НЕ передавать фильтр стадии контракта
    (contractStageList…) — с ним результат пустой. По дате заключения за «вчера» почти ничего нет:
    контракты попадают в реестр с задержкой в несколько дней, поэтому по умолчанию ищем по дате размещения.
    """
    prefix = "contractDate" if date_kind == "signed" else "publishDate"
    params = {
        "morphology": "on", "fz44": "on",
        "sortBy": "PUBLISH_DATE", "sortDirection": "false",
        "pageNumber": str(page), "recordsPerPage": f"_{PER_PAGE}",
        f"{prefix}From": day.strftime("%d.%m.%Y"), f"{prefix}To": day.strftime("%d.%m.%Y"),
    }
    if min_amount:
        params["contractPriceFrom"] = str(int(min_amount))
    if region_code:
        params["customerPlaceCodes"] = region_code
    return params


class WebClient:
    def __init__(self, pause: float = 4.0, max_cards: int = 200, session: requests.Session | None = None,
                 sleep=time.sleep, date_kind: str = "published"):
        self.pause, self.max_cards, self.sleep, self.date_kind = pause, max_cards, sleep, date_kind
        self.http = session or requests.Session()
        self.http.headers.update({"User-Agent": "lead-collector/0.1 (ручной сбор открытых данных реестра контрактов)",
                                  "Accept-Language": "ru-RU,ru;q=0.9"})
        self.cards_fetched = 0
        self.failures = 0

    def _get(self, path: str, params: dict | None = None) -> str:
        url = BASE + path + (("?" + urlencode(params)) if params else "")
        for attempt in range(1, 4):
            self.sleep(self.pause)
            try:
                resp = self.http.get(url, timeout=60)
            except requests.RequestException as exc:
                log.warning("Сбой соединения (попытка %d из 3): %s", attempt, type(exc).__name__)
                self.failures += 1
                if self.failures >= 8:
                    raise BlockedError("Слишком много сбоев подряд: сайт недоступен или ограничивает доступ. Остановка.")
                self.sleep(self.pause * attempt * 2)
                continue
            if resp.status_code in (403, 429) or "captcha" in resp.text[:5000].lower():
                raise BlockedError(f"Сайт ответил отказом/проверкой (HTTP {resp.status_code}). Остановка, ничего не обходим.")
            if resp.status_code >= 500:
                self.sleep(self.pause * attempt * 2)
                continue
            resp.raise_for_status()
            self.failures = 0
            return resp.text
        raise BlockedError("Страница не открылась после трёх попыток")

    def day_numbers(self, day: date, min_amount: float, region_code: str) -> list[str]:
        numbers: list[str] = []
        for page in range(1, MAX_PAGES + 1):
            found = parse_list_page(self._get(SEARCH, search_params(day, min_amount, region_code, page, self.date_kind)))
            new = [n for n in found if n not in numbers]
            if not new:
                break
            numbers += new
            if len(found) < PER_PAGE:
                break
        else:
            log.warning("Дошли до потолка сайта (%d страниц) за %s: часть контрактов не увидена, сузьте запрос "
                        "(регион, сумма)", MAX_PAGES, day)
        return numbers

    def card(self, reestr_number: str, region_code: str = "") -> list[ContractRecord]:
        if self.cards_fetched >= self.max_cards:
            return []
        self.cards_fetched += 1
        html = self._get(CARD, {"reestrNumber": reestr_number})
        return parse_card(html, reestr_number, region_code)
