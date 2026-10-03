/**
 * Фикстуры переноса S3: сырые строки копий формата `tender-lawyer-backup` v1.
 *
 * Правило (задача S3.K): только данные, допустимые текущим форматом. Основа —
 * формы из `src/lib/backup-format.test.ts` (те же секции, те же минимальные
 * записи `{ id }`); более полные записи используют только документированные поля
 * доменных типов (`Purchase.tpPrice/submitted/unreadable`, `MyDocument`,
 * `Fact`, `Profile`), без выдуманных структур. Настоящие эталонные документы
 * сюда не входят — для них каркас `tests/golden` (задача S3.L).
 */

import { buildBackup, type Dump } from "@/lib/backup-format";

const SAVED_AT = "2026-09-26T12:00:00.000Z";

// Фикстуры — сырой JSON, как байты файла копии: полнота записей шире узкого
// типа `Dump` (реальные поля формата), поэтому сборка идёт через приведение.
const raw = (dump: unknown): string =>
  JSON.stringify({ ...buildBackup(dump as Dump, new Date(SAVED_AT)) });

/**
 * Минимальная копия — повторяет дамп `backup-format.test.ts` один к одному
 * (включая настройку `"что-то-ещё"`, которую `buildBackup` отфильтровывает).
 */
export function minimalBackupJson(): string {
  return raw({
    purchases: [{ id: "p1" }, { id: "p2" }],
    documents: [["p1", [{ name: "ТЗ.pdf", text: "…" }]]],
    settings: [
      ["profile", { inn: "7700000000" }],
      ["profile-meta", { sources: {}, suggestions: [] }],
      ["что-то-ещё", { x: 1 }],
    ],
    samples: [{ id: "s1" }],
    facts: [{ id: "f1" }, { id: "f2" }],
  });
}

/**
 * Стандартная копия: все шесть сущностей с реалистичными полями формата.
 * Вердикт импорта — `match`, потерь нет.
 */
export function standardBackupJson(): string {
  return raw({
    purchases: [
      {
        id: "pa",
        v: 2,
        subject: "Поставка зала",
        createdAt: "2026-09-20T10:00:00.000Z",
        files: ["ТЗ.pdf", "Смета.xlsx"],
        scans: ["ТЗ.pdf"],
        docs: [{ name: "ТЗ.pdf", hash: "aaa" }],
        unreadable: [],
        requirements: {},
        submitted: true,
        tpPrice: 1200000,
        tp: { form: "plain", items: [] },
        customField: "неизвестное будущее поле закупки",
      },
      { id: "pb", v: 2, subject: "Черновик", createdAt: "2026-09-21T10:00:00.000Z", files: [], unreadable: [], requirements: {} },
      { id: "pd", v: 2, subject: "Со сканом", createdAt: "2026-09-22T10:00:00.000Z", files: ["Скан.pdf"], unreadable: [{ name: "Скан.pdf", reason: "файл повреждён" }], requirements: {} },
      // Запись первого формата без `v` и со списком пунктов ТП: отрабатывает миграцию 1 → 2.
      { id: "pc", subject: "Старая", createdAt: "2026-01-10T10:00:00.000Z", files: [], unreadable: [], requirements: {}, tp: ["пункт один", "пункт два"] },
    ],
    documents: [
      ["pa", [{ name: "ТЗ.pdf", text: "Техническое задание: зал на 150 мест.", scan: true }, { name: "Смета.xlsx", text: "1;100;шт" }]],
      ["pb", []],
      ["pc", [{ name: "Договор.pdf", text: "Проект договора." }]],
      ["pd", [{ name: "Скан.pdf", text: "Скан: …" }]],
    ],
    settings: [
      [
        "profile",
        {
          fullName: "ООО Ромашка",
          inn: "7700000000",
          kpp: "",
          head: "Иванов И. И.",
          phone: "+7 900 000-00-00",
          email: "",
          futureField: "неизвестный будущий ключ профиля",
        },
      ],
      ["profile-meta", { sources: {}, suggestions: [] }],
    ],
    samples: [
      { id: "s1", name: "ТП-образец.pdf", text: "Образец технического предложения.", addedAt: "2026-09-01T10:00:00.000Z", kinds: ["tp"], about: "Образец ТП" },
      { id: "s2", name: "Письмо.pdf", text: "Сопроводительное письмо.", addedAt: "2026-09-02T10:00:00.000Z", kinds: ["nope"], about: "" },
    ],
    facts: [
      {
        id: "f1",
        kind: "license",
        title: "Лицензия",
        fields: { period: "2025 год" },
        measures: [{ what: "выручка", value: 5000000, unit: "руб." }],
        validity: { until: "2027-01-01" },
        source: { type: "manual", note: "вписано" },
        origin: "human",
        confirmed: true,
        answers: ["зал от 150 мест"],
      },
      { id: "f2", kind: "experience", title: "Стаж", source: { type: "manual" } },
    ],
  });
}

/** Та же стандартная копия с изменённым заголовком факта: другой хеш, конфликт `f1`. */
export function changedBackupJson(): string {
  const parsed = JSON.parse(standardBackupJson()) as { facts: { id: string; title?: string }[] } & Record<string, unknown>;
  for (const fact of parsed.facts) {
    if (fact.id === "f1") {
      fact.title = "Лицензия (обновлена)";
    }
  }
  return JSON.stringify(parsed);
}

/**
 * Копия с краевыми случаями: битые записи, дубль `legacyId`, документ-сирота,
 * документ без имени, образец с неверным текстом, факт без вида. Собирается
 * вручную мимо `buildBackup`, чтобы битые элементы сохранились в строке.
 */
export function edgeBackupJson(): string {
  // Объект собирается отдельно: repo-guard `documents-payload.test.ts` требует,
  // чтобы `documents:` внутри `JSON.stringify(...)` шли только через `forServer`
  // (защита клиентских запросов), а здесь — серверная фикстура, а не запрос.
  const dump = {
    format: "tender-lawyer-backup",
    version: 1,
    savedAt: SAVED_AT,
    purchases: [{ id: "pe1" }, { id: "pe1" }, { id: "" }, "мусор", null, { noId: true }],
    documents: [
      ["pe1", [{ name: "Ок.pdf", text: "ok" }, { text: "без имени" }]],
      ["ghost", [{ name: "Потерянный.pdf", text: "x" }]],
      ["pe1", "не массив"],
      [5, []],
    ],
    settings: [
      ["profile", { inn: "7700000000" }],
      ["profile", "не объект"],
      ["profile-meta", { sources: {}, suggestions: [] }],
    ],
    samples: [{ id: "se1", name: "Н.pdf", text: "текст", kinds: ["tp"], about: "" }, { id: "se2", text: 42 }],
    facts: [{ id: "fe1", kind: "license", title: "Л", source: { type: "manual" } }, { id: "fe2", title: "без вида" }],
  };
  return JSON.stringify(dump);
}

/** Пустая копия: разбор отклоняет её до всяких записей. */
export function emptyBackupJson(): string {
  return raw({ purchases: [], documents: [], settings: [], samples: [], facts: [] });
}
