"""Настройки: из окружения и файла .env рядом с инструментом. Секреты в журнал не пишем."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# LEAD_DATA_DIR — отдельная папка данных (база, карточки, выгрузки, журнал) для отдельной выборки.
DATA_DIR = Path(os.environ.get("LEAD_DATA_DIR") or ROOT / "data")
DB_PATH = DATA_DIR / "leads.sqlite"
EXPORT_DIR = DATA_DIR / "export"
LOG_PATH = DATA_DIR / "collector.log"

# Статусы контакта (этап 2). Первый — значение по умолчанию.
CONTACT_STATUSES = (
    "не связывались",
    "связались",
    "согласие получено",
    "отказ",
    "не беспокоить",
)
# По умолчанию в выгрузку эти статусы не попадают.
EXCLUDED_FROM_EXPORT = ("отказ", "не беспокоить")

# Коды регионов для режима «все». НЕ ПРОВЕРЕНО по справочнику ЕИС (getNsiRequest):
# сверить перед первым боевым запуском.
REGION_CODES = (
    "01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 21 22 23 24 25 26 27 28 29 "
    "30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 "
    "58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 83 86 87 89 91 92 95 99"
).split()


def load_env_file(path: Path | None = None) -> None:
    """Читает KEY=VALUE из .env; уже заданные переменные окружения не перезаписывает."""
    path = path or ROOT / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class EisSettings:
    token: str
    endpoint: str
    subsystem: str
    document_type: str
    pause_seconds: float
    retries: int
    archive_wait_seconds: int

    @staticmethod
    def from_env() -> "EisSettings":
        load_env_file()
        return EisSettings(
            token=os.environ.get("EIS_TOKEN", ""),
            endpoint=os.environ.get(
                "EIS_ENDPOINT",
                "https://int44.zakupki.gov.ru/eis-integration/services/getDocsIP",
            ),
            # НЕ ПРОВЕРЕНО: значения подсистемы и типа документа для реестра контрактов
            # взять из схемы getDocsIP-ws-api.xsd и поправить здесь или в .env.
            subsystem=os.environ.get("EIS_SUBSYSTEM", "RC"),
            document_type=os.environ.get("EIS_DOCUMENT_TYPE", "contract"),
            pause_seconds=float(os.environ.get("EIS_PAUSE_SECONDS", "5")),
            retries=int(os.environ.get("EIS_RETRIES", "3")),
            archive_wait_seconds=int(os.environ.get("EIS_ARCHIVE_WAIT_SECONDS", "600")),
        )
