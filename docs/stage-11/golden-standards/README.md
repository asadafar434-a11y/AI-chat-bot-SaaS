# Golden-стандарты переноса S3

Каркас готов, эталонов пока нет. Реальные обезличенные пары добавим отдельно —
выдумывать «эталонные документы» запрещено: стандарт обязан происходить из
настоящего формата `tender-lawyer-backup` v1.

## Где лежат пары

`web/tests/golden/cases/`:

- `<name>.backup.json` — сырая строка копии, байт в байт как файл экспорта;
- `<name>.expected.json` — ожидаемая сверка.

Механизм — `web/src/server/import/golden.test.ts`: для каждой пары прогоняет
pipeline на чистой in-memory БД и сравнивает подмножество сверки. Нет парного
`.expected.json` — тест падает с явным сообщением. Нет пар вообще — тест
проходит с пометкой «эталонов пока нет».

## Формат `.expected.json`

```json
{
  "organizationId": "c...",
  "userId": "c...",
  "verdict": "match",
  "counts": {
    "purchases": { "source": 1, "target": 1, "created": 1, "exists": 0, "conflicts": 0, "unimportable": 0 }
  },
  "checksums": { "purchases": "sha256…" },
  "aggregates": { "tpPriceSum": 0, "purchasesWithTp": 0, "confirmedFacts": 0, "factsWithTerm": 0, "purchasesWithUnreadable": 0 }
}
```

- `organizationId` — вида `cuid()` (требование `orgScope`), любой тестовый;
- `userId` — произвольный; harness сам создаёт членство;
- `counts` / `checksums` / `aggregates` — необязательные подмножества: сверяется
  только перечисленное;
- контрольные суммы считаются каноническим JSON (`stableStringify`) — брать их
  из вывода `scripts/legacy-import.mjs --dry-run` нельзя: dry-run показывает
  план, а не хеши; хеши — из полной сверки тестового прогона.

## Правила обезличивания

- Никаких реальных ИНН, адресов, телефонов, email, названий компаний.
- Тексты документов — короткие нейтральные фрагменты в том же формате
  (`{ name, text }`), а не копии реальных файлов.
- Копия обязана читаться существующим `parseBackup` без ошибок.

## Server reads (этап S4)

Необязательная секция `expected.reads` той же пары сверяет server read services
после импорта (`web/src/server/read/golden-reads.test.ts`, только с
`TEST_DATABASE_URL`; без секции case пропускается):

```json
{
  "reads": {
    "purchases": { "count": 1, "ids": ["p1"] },
    "facts": { "count": 1 },
    "samples": { "count": 1 },
    "profile": { "fullName": "…" }
  }
}
```

Все поля необязательны и сверяются как подмножество. Документы и образцы
сверяются только метаданными: текстов в PostgreSQL нет до S6.

## Текущий статус

Эталонов: 0. Модульные фикстуры (`src/server/import/testing/fixtures.ts`)
покрывают обычные случаи; golden-пары появятся с первыми реальными выгрузками.
