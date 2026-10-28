"""Клиент официального сервиса отдачи информации ЕИС (getDocsIP, SOAP).

ВНИМАНИЕ: формат запроса собран по пересказам в статьях (Хабр), официальную инструкцию прочитать
не удалось, на настоящем сервисе клиент НЕ проверялся. Порядок тегов в запросе важен. Перед
боевым запуском сверить со схемой getDocsIP-ws-api.xsd. Защиту сайта, капчи и лимиты не обходим:
между запросами пауза, при сбое повтор с нарастающей паузой, при превышении лимита — ожидание.
"""
from __future__ import annotations

import logging
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from xml.sax.saxutils import escape

import requests

from .config import EisSettings

log = logging.getLogger("lead_collector.client")

NS_WS = "http://zakupki.gov.ru/fz44/get-docs-ip/ws"
TOKEN_HEADER = "individualPerson_token"


class EisError(RuntimeError):
    pass


def build_request(region: str, day: str, subsystem: str, document_type: str, request_id: str | None = None) -> str:
    """SOAP-запрос «архивы документов по региону заказчика за день»."""
    rid = request_id or str(uuid.uuid4())
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return (
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:ws="{NS_WS}"><soapenv:Header>'
        f"<{TOKEN_HEADER}>{{token}}</{TOKEN_HEADER}>"
        "</soapenv:Header><soapenv:Body><ws:getDocsByOrgRegionRequest>"
        f"<index><id>{escape(rid)}</id><createDateTime>{created}</createDateTime><mode>PROD</mode></index>"
        "<selectionParams>"
        f"<orgRegion>{escape(region)}</orgRegion>"
        f"<subsystemType>{escape(subsystem)}</subsystemType>"
        f"<documentType44>{escape(document_type)}</documentType44>"
        f"<periodInfo><exactDate>{escape(day)}</exactDate></periodInfo>"
        "</selectionParams></ws:getDocsByOrgRegionRequest></soapenv:Body></soapenv:Envelope>"
    )


def parse_response(body: bytes) -> tuple[list[str], bool]:
    """(ссылки на архивы, признак «данных нет»). Текст ответа в журнал не пишем."""
    root = ET.fromstring(body)
    local = lambda t: t.rsplit("}", 1)[-1]  # noqa: E731
    urls = [(e.text or "").strip() for e in root.iter() if local(e.tag) == "archiveUrl" and e.text]
    no_data = any(local(e.tag) == "noData" for e in root.iter())
    fault = [e for e in root.iter() if local(e.tag) == "Fault"]
    if fault and not urls:
        raise EisError("Сервис ЕИС вернул ошибку (подробности смотрите в личном кабинете/инструкции)")
    return urls, no_data


class EisClient:
    def __init__(self, settings: EisSettings, session: requests.Session | None = None, sleep=time.sleep):
        if not settings.token:
            raise EisError(
                "Не задан токен ЕИС. Получите его в личном кабинете потребителя машиночитаемых "
                "данных и впишите в tools/lead-collector/.env строку EIS_TOKEN=..."
            )
        self.s = settings
        self.http = session or requests.Session()
        self.sleep = sleep

    def _pause(self) -> None:
        self.sleep(self.s.pause_seconds)

    def _with_retries(self, action, what: str):
        delay = max(self.s.pause_seconds, 1.0)
        for attempt in range(1, self.s.retries + 1):
            try:
                return action()
            except (requests.RequestException, EisError) as exc:
                log.warning("%s: сбой, попытка %d из %d (%s)", what, attempt, self.s.retries, type(exc).__name__)
                if attempt == self.s.retries:
                    raise EisError(f"{what}: не удалось после {self.s.retries} попыток") from exc
                self.sleep(delay)
                delay *= 2

    def archive_urls(self, region: str, day: str) -> list[str]:
        request_id = str(uuid.uuid4())
        envelope = build_request(region, day, self.s.subsystem, self.s.document_type, request_id)
        envelope = envelope.replace("{token}", escape(self.s.token))
        waited = 0
        while True:
            def call() -> bytes:
                self._pause()
                resp = self.http.post(
                    self.s.endpoint, data=envelope.encode("utf-8"),
                    headers={"Content-Type": "text/xml; charset=utf-8"}, timeout=60)
                if resp.status_code >= 500 or resp.status_code == 429:
                    raise EisError(f"HTTP {resp.status_code}")
                resp.raise_for_status()
                return resp.content

            urls, no_data = parse_response(self._with_retries(call, f"запрос региона {region}, {day}"))
            if urls or no_data:
                return urls
            # Архивы готовятся не сразу: ждём и спрашиваем тот же запрос ещё раз.
            if waited >= self.s.archive_wait_seconds:
                raise EisError(f"Архивы региона {region} за {day} не появились за {waited} с")
            step = 30
            self.sleep(step)
            waited += step

    def download(self, url: str) -> bytes:
        def call() -> bytes:
            self._pause()
            resp = self.http.get(url, headers={TOKEN_HEADER: self.s.token}, timeout=180)
            if resp.status_code >= 500 or resp.status_code == 429:
                raise EisError(f"HTTP {resp.status_code}")
            resp.raise_for_status()
            return resp.content

        return self._with_retries(call, "скачивание архива")
