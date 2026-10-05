# EIS Collector v1

Изолированный сборщик RAW/SILVER датасета реальных закупок ЕИС (`zakupki.gov.ru`)
для последующего AI-анализа. AI на этом этапе НЕ подключается.

- Не трогает production UI, IndexedDB и существующую tender/application-логику.
- Код живёт в `web/src/server/eis/` (в корневой постановке — `src/server/eis/`),
  CLI — `web/scripts/eis-collect.ts` (`npm run eis:collect` из каталога `web/`).
- Секреты — только через ENV, никогда в git/логах/JSON dataset.

## 1. Что подтверждено документацией (проверено 2026-10-03)

| Факт | Источник |
|---|---|
| Исторический анонимный FTP (`ftp://ftp.zakupki.gov.ru`) закрыт с 01.07.2024, машиночитаемая выдача переведена на СОИ | Новость ЕИС `newsId=34208`; Infoculture finguide (карточки ЕИС/выгрузок) |
| Актуальный канал — Сервисы Отдачи Информации (СОИ), SOAP/XML, по «Инструкции по использованию сервисов отдачи информации ЕИС для ЮЛ и ФЛ» и форматам информационного взаимодействия | Раздел «Документы» ЕИС (`sectionId=432` — 44-ФЗ, `sectionId=386` — 223-ФЗ) |
| Токен потребителя машиночитаемых данных (физлицо) выдаётся через `https://zakupki.gov.ru/pmd/auth/welcome` (авторизация через Госуслуги) | Официальная инструкция СОИ; порядок получения описан в стороннем разборе ниже |
| 44-ФЗ и 223-ФЗ — разные правовые контуры и разные потоки данных, их нельзя смешивать | Infoculture finguide, структура разделов ЕИС |

Прямые URL портала ЕИС на момент проверки не открывались программно
(транспортная защита/WAF), поэтому детали протокола сверены со сторонним
техническим разбором и помечены UNCONFIRMED (см. раздел 2).

## 2. UNCONFIRMED-допущения (источник — сторонний разбор SOAP СОИ, Habr 12.2024)

Перед production-запуском сверить с актуальной официальной XSD
(`.../getDocsIP?xsd=getDocsIP-ws-api.xsd`) и «Инструкцией…». Результат сверки
зафиксировать здесь и снять пометки TODO в коде.

| Допущение | Где в коде | TODO |
|---|---|---|
| `EIS_BASE_URL` по умолчанию `https://int44.zakupki.gov.ru/eis-integration/services/getDocsIP` | `config.ts` (`DEFAULT_EIS_BASE_URL`) | сверить endpoint физлиц |
| Методы `getDocsByOrgRegionRequest` / `getDocsByReestrNumberRequest` (+ `getDocSignaturesByUrlRequest`, `getNsiRequest`) | `discovery.ts` | сверить имена и обязательные поля |
| Порядок `selectionParams`: `orgRegion, subsystemType, documentType44, periodInfo` и `subsystemType, reestrNumber` | `discovery.ts` (`build*Envelope`) | порядок важен для валидации ЕИС |
| `subsystemType=PRIZ` по умолчанию | `discovery.ts` | взять перечень из XSD |
| `periodInfo/exactDate`, `documentType44` (напр. `epNotificationEF2020`), `orgRegion` | `discovery.ts`, `documents.ts` | сверить имена/значения |
| Заголовок скачивания архива `individualPerson_token` | `client.ts` (`authHeaders`) | сверить с инструкцией |
| Теги ответа `archiveUrl`, `reestrNumber`, `purchaseNumber`, структура `attachment` | `documents.ts` | сверить с XSD типов |
| Официальной схемы `EIS_USERNAME/EIS_PASSWORD` или `EIS_CLIENT_ID/EIS_CLIENT_SECRET` для discovery НЕТ | `config.ts` (отказ без `EIS_AUTH_TOKEN`) | подтвердить/опровергнуть |
| Диапазон дат: реализован по-дневными запросами `exactDate` (параметр диапазона не подтверждён), лимит 31 день | `discovery.ts` (`enumerateDays`) | заменить параметром диапазона, когда будет схема |
| Отдельный контур/endpoint СОИ 223-ФЗ | `discovery.ts` (`Eis223Adapter`) | подтвердить и реализовать |

Проверка допущений автоматизирована: `EIS_LIVE_TEST=1 npm test -- live`
сверяет имена методов/токена с живой XSD (см. `tests/live.test.ts`).

Что НЕ делаем (запрещено постановкой): обход CAPTCHA/WAF, скрапинг HTML-витрины
в обход защиты, чужие credentials, массовые выгрузки 10k/50k.

## 3. Настройка ЕИС (для оператора)

1. Получить токен потребителя машиночитаемых данных:
   `https://zakupki.gov.ru/pmd/auth/welcome` → авторизация через Госуслуги →
   «Регистрация нового потребителя машиночитаемых данных» → «Физическое лицо» →
   сохранить токен.
2. Скопировать `web/.env.example` в `web/.env`, задать `EIS_AUTH_TOKEN` (секрет
   только в ENV/Docker secrets, никогда в git).
3. Сверить endpoint и XSD (раздел 2), при расхождении задать `EIS_BASE_URL`
   и/или обновить конверты.
4. Начать с dry-run (раздел 4), затем малый live (`--max-tenders=10`), затем до 1000.

## 4. Запуск

```bash
cd web
# dry-run: план без скачивания файлов
npm run eis:collect -- --law=44fz --date-from=2026-09-01 --date-to=2026-09-02 --max-tenders=10 --dry-run
# реальный сбор (файлы качаются)
npm run eis:collect -- --law=44fz --date-from=2026-09-01 --date-to=2026-09-01 --max-tenders=10 --live
```

По умолчанию dry-run включён (`EIS_DRY_RUN=1`): без `--live` файлы не качаются.
`--live` явно переключает в боевой режим. Лимиты: default `maxTenders=100`,
жёсткий потолок v1 — 1000 (больше — отказ с объяснением).
Точность термина: dry-run выполняет SOAP-запросы метаданных и разбирает архивы
в памяти (чтобы посчитать «сколько документов ожидается»), но НЕ пишет RAW-файлы,
manifest, normalized и прогресс на диск.

## 5. Pipeline и layout

```text
EIS (СОИ SOAP) -> Discovery -> registry numbers -> document metadata ->
downloader -> RAW storage -> SHA-256 dedup -> normalized metadata -> dataset
```

```text
data/
  raw/{44fz|223fz}/YYYY/MM/{registry}/  оригиналы + manifest.json + tender.json
  normalized/{44fz|223fz}/YYYY/MM/{registry}/tender.json   SILVER (только объективные метаданные, без LLM)
  .hash-index.json   sha256 -> канонический путь (дедуп между закупками)
  progress.json      успешно обработанные registry (идемпотентный рестарт)
```

`data/` игнорируется git (`web/.gitignore`).

## 6. Надёжность

- timeout (`EIS_TIMEOUT_MS`), retry с exponential backoff, обработка 429
  (с `Retry-After`) и временных 5xx (`client.ts`);
- пауза между закупками (`EIS_REQUEST_DELAY_MS`);
- одна битая закупка не роняет запуск (ошибка — в `failures` статистики, exit code 2 при `--live`);
- повторный запуск пропускает готовые (`progress.json`) и переиспользует байты (`reused`);
- JSON-логи без секретов (токен вычищается дословно + эвристики, см. `errors.ts`);
- валидация dataset на закупку: registry, hash у каждого документа, файлы на диске,
  отсутствие дубликатов `documentId`, размер > 0, наличие `manifest.json`/`tender.json`.

## 7. Тесты

```bash
cd web
npm test -- eis          # все тесты коллектора (mock, без сети)
EIS_LIVE_TEST=1 npm test -- live   # optional live smoke (вне CI)
npx tsc --noEmit         # typecheck
npx eslint src/server/eis scripts/eis-collect.ts  # lint
```

Покрыто: config, секреты/редакция, парсинг/registry/ZIP/вложения, retry/429/
timeout/SOAP-fault, хранилище/dedup/manifest/прогресс/валидация, конверты/
адаптеры (44-ФЗ + заглушка 223-ФЗ), collector dry-run/live/идемпотентность/
изоляция ошибок, end-to-end через mock HTTP + CLI dry-run в дочернем процессе.

## 8. Document Intelligence (этап 2)

Превращает RAW-документы в структурированный корпус для Requirement Engine и AI:
`RAW → detect format → extract → pages/blocks/tables с source → normalized JSON`.
Без AI: никакого requirement extraction, RAG, embeddings, скоринга и генерации заявок.

```bash
cd web
npm run eis:extract -- --tender=0373100130926000001   # одна закупка, статистика documents/pages/tables/ocrRequired/failed
npm run eis:extract -- --tender=0373100130926000001 --force   # переработать всё
```

- Форматы: PDF (текстовый слой + таблицы по линиям сетки через `pdf-parse`),
  DOCX (paragraphs/headings/lists/tables/footnotes/headers/footers в порядке документа),
  XLSX (лист/строка/колонка/адрес, displayed value, формула, числовой формат, merged),
  XML (xpath/текст/атрибуты/namespace + полный исходник), ZIP (рекурсия, лимит глубины 3,
  вложений 100), изображения/сканы (через OCR-провайдер), текст.
- Каждый блок имеет точный источник: PDF — `page`, DOCX — `paragraph`,
  XLSX — `sheet/row/column/cell`, XML — `xpath`, ZIP — `entry`.
- Скан без текстового слоя: `textStatus="ocr_required"`, OCR-текст обычным не считается.
  OCR — абстракция `OcrProvider` (`extract/ocr.ts`); по умолчанию провайдера нет →
  `OCR_NOT_CONFIGURED`. Opt-in: `EIS_OCR_PROVIDER=anthropic` (переиспользует
  существующее распознавание `@/lib/ocr`, отдельный адаптер `ocr-anthropic.ts`).
- Хранение: `data/normalized/documents/<registry>/<documentId>.json`
  (`schemaVersion: 1`, `extraction: {method, status}`, `sourceSha256`,
  `extractorVersion`). RAW не изменяется. Один documentId — один файл (текущая версия).
- Идемпотентность: совпали `sourceSha256` + `extractorVersion` → `skipped` без
  переработки; hash изменился → новая версия; `--force` перерабатывает всё.
- Честные ограничения: у DOCX нет реальных страниц (все блоки на `pageNumber: 1`,
  адрес — `paragraph`); номера списков Word не вычисляются (только `listId/level`);
  `vMerge`-продолжения помечаются `mergedFrom: "above"` без разрешения диапазона;
  таблицы PDF находятся только при рисованной сетке; лимит 20000 блоков/документ.

## 9. Тесты Document Intelligence

Фикстуры — программные, бинарных blob'ов в репозитории нет:
`@/lib/pdf-fixtures` (текст/скан-PDF), `@/lib/docx-fixtures` (heading/list/table/
footnote/header), `exceljs` (мультилистовый XLSX с формулой и merge), инлайн-XML,
`makeZip` — плюс повреждённые файлы каждого формата и лимит вложенности ZIP.
Проверяются: текст, структура, source references, таблицы (адреса/формулы/merge),
хеши, идемпотентность (skipped без перезаписи, новая версия при смене hash),
изоляция ошибок, CLI-статистика. Live ЕИС не используется.
