// Оценка качества ИИ на золотом датасете — npm test.
// Нет реальных запросов к модели: только чистые функции и мок-данные.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CASE_AUCTION_IT,
  CASE_QUOTATION_SUPPLIES,
  CASE_TENDER_MEDICAL,
  GOLD_DATASET,
  evalCase,
  evalDataset,
  evalFields,
  evalQuotes,
  evalRequirements,
  evalValidation,
  type ComputedFinding,
  type DocumentExcerpt,
  type ExtractedField,
  type ExtractedRequirement,
  type GoldCase,
  type GoldRequirement,
  type ModelOutput,
} from "./gold-dataset.ts";

// ——— evalRequirements ——————————————————————————————————————————————————————————

const goldReqs: GoldRequirement[] = [
  {
    kind: "mandatory",
    text: "Опыт: не менее двух исполненных контрактов на аналогичные работы за три года",
    article: "ст. 31 ч. 2",
    quote: "наличие не менее двух исполненных контрактов на выполнение аналогичных работ",
    mustFind: true,
  },
  {
    kind: "mandatory",
    text: "Лицензия на деятельность по техническому обслуживанию",
    article: "ст. 31 ч. 2",
    quote: "наличие лицензии на осуществление деятельности по техническому обслуживанию",
    mustFind: true,
  },
  {
    kind: "optional",
    text: "Декларация соответствия — стандартная форма",
    article: "ст. 43 ч. 6",
    quote: "декларация соответствия",
    mustFind: false,
  },
];

test("evalRequirements: идеальное совпадение → precision 1, recall 1, F1 1", () => {
  const extracted: ExtractedRequirement[] = [
    {
      kind: "mandatory",
      text: "Опыт: не менее двух исполненных контрактов на аналогичные работы за три года",
      quote: "наличие не менее двух исполненных контрактов",
    },
    {
      kind: "mandatory",
      text: "Лицензия на деятельность по техническому обслуживанию оборудования",
      quote: "наличие лицензии на осуществление деятельности по техническому обслуживанию",
    },
  ];
  const m = evalRequirements(extracted, goldReqs);
  assert.equal(m.tp, 2);
  assert.equal(m.fp, 0);
  assert.equal(m.fn, 0);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 1);
  assert.equal(m.f1, 1);
  assert.equal(m.hallucinationRate, 0);
});

test("evalRequirements: пропущено одно mustFind → recall 0.5, fn 1", () => {
  const extracted: ExtractedRequirement[] = [
    {
      kind: "mandatory",
      text: "Опыт: не менее двух исполненных контрактов на аналогичные работы за три года",
      quote: "наличие не менее двух исполненных контрактов",
    },
  ];
  const m = evalRequirements(extracted, goldReqs);
  assert.equal(m.tp, 1);
  assert.equal(m.fn, 1);
  assert.ok(m.recall < 1);
});

test("evalRequirements: лишнее требование → fp 1, hallucinationRate > 0", () => {
  const extracted: ExtractedRequirement[] = [
    {
      kind: "mandatory",
      text: "Опыт: не менее двух исполненных контрактов на аналогичные работы за три года",
      quote: "наличие не менее двух исполненных контрактов",
    },
    {
      kind: "mandatory",
      text: "Лицензия на деятельность по техническому обслуживанию оборудования",
      quote: "наличие лицензии на осуществление деятельности по техническому обслуживанию",
    },
    {
      kind: "mandatory",
      text: "Сертификат ISO 9001 международного образца — требование придумано",
      quote: "",
    },
  ];
  const m = evalRequirements(extracted, goldReqs);
  assert.equal(m.fp, 1);
  assert.ok(m.hallucinationRate > 0);
});

test("evalRequirements: нет извлечённых → precision 1, recall 0, hallucinationRate 0", () => {
  const m = evalRequirements([], goldReqs);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 0);
  assert.equal(m.hallucinationRate, 0);
  assert.equal(m.fn, 2); // 2 mustFind не найдены
});

test("evalRequirements: нет mustFind в gold → recall 1 при любом извлечении", () => {
  const onlyOptional: GoldRequirement[] = [
    { ...goldReqs[2]!, mustFind: false },
  ];
  const m = evalRequirements(
    [{ kind: "optional", text: "нечто", quote: "" }],
    onlyOptional,
  );
  assert.equal(m.recall, 1);
});

// ——— evalQuotes ———————————————————————————————————————————————————————————————

const excerpts: DocumentExcerpt[] = [
  {
    source: "Требования к участникам",
    text:
      "Участник должен соответствовать единым требованиям части 1 статьи 31. " +
      "Дополнительные требования: наличие не менее двух исполненных контрактов.",
  },
];

test("evalQuotes: цитата точно в тексте → accuracy 1", () => {
  const items = [
    { quote: "наличие не менее двух исполненных контрактов" },
  ];
  const m = evalQuotes(items, excerpts);
  assert.equal(m.found, 1);
  assert.equal(m.accuracy, 1);
});

test("evalQuotes: цитата не в тексте (галлюцинация) → missing 1, accuracy 0", () => {
  const items = [
    { quote: "наличие лицензии на образовательную деятельность" },
  ];
  const m = evalQuotes(items, excerpts);
  assert.equal(m.missing, 1);
  assert.equal(m.accuracy, 0);
});

test("evalQuotes: часть цитат верна → accuracy = found/total", () => {
  const items = [
    { quote: "единым требованиям части 1 статьи 31" },
    { quote: "лицензии на медицинскую деятельность — этого нет" },
  ];
  const m = evalQuotes(items, excerpts);
  assert.equal(m.total, 2);
  assert.equal(m.found, 1);
  assert.equal(m.missing, 1);
  assert.equal(m.accuracy, 0.5);
});

test("evalQuotes: пустые цитаты не считаются", () => {
  const items = [{ quote: "" }, { quote: "  " }];
  const m = evalQuotes(items, excerpts);
  assert.equal(m.total, 0);
  assert.equal(m.accuracy, 1);
});

// ——— evalFields ───────────────────────────────────────────────────────────────

test("evalFields: все поля верны → accuracy 1", () => {
  const extracted: ExtractedField[] = [
    { key: "nmck", value: "1800000" },
    { key: "deadline", value: "2026-03-15" },
  ];
  const gold = [
    { key: "nmck", value: "1800000" },
    { key: "deadline", value: "2026-03-15" },
  ];
  const m = evalFields(extracted, gold);
  assert.equal(m.correct, 2);
  assert.equal(m.accuracy, 1);
});

test("evalFields: одно поле неверно → accuracy 0.5", () => {
  const extracted: ExtractedField[] = [
    { key: "nmck", value: "9999999" },
    { key: "deadline", value: "2026-03-15" },
  ];
  const gold = [
    { key: "nmck", value: "1800000" },
    { key: "deadline", value: "2026-03-15" },
  ];
  const m = evalFields(extracted, gold);
  assert.equal(m.correct, 1);
  assert.equal(m.accuracy, 0.5);
});

test("evalFields: поле отсутствует в извлечённых → не считается верным", () => {
  const m = evalFields([], [{ key: "nmck", value: "1800000" }]);
  assert.equal(m.correct, 0);
  assert.equal(m.accuracy, 0);
});

test("evalFields: нет золотых полей → accuracy 1", () => {
  const m = evalFields([{ key: "nmck", value: "1800000" }], []);
  assert.equal(m.accuracy, 1);
});

// ——— evalValidation ───────────────────────────────────────────────────────────

test("evalValidation: все находки совпали → accuracy 1", () => {
  const computed: ComputedFinding[] = [
    { category: "required_documents", status: "FAIL" },
    { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" },
  ];
  const gold = [
    { category: "required_documents", status: "FAIL" as const },
    { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" as const },
  ];
  const { accuracy } = evalValidation(computed, gold);
  assert.equal(accuracy, 1);
});

test("evalValidation: статус не тот → не совпадение", () => {
  const computed: ComputedFinding[] = [
    { category: "required_documents", status: "PASS" }, // должен быть FAIL
  ];
  const gold = [{ category: "required_documents", status: "FAIL" as const }];
  const { accuracy } = evalValidation(computed, gold);
  assert.equal(accuracy, 0);
});

// ——— evalCase (интеграция) ────────────────────────────────────────────────────

test("evalCase: идеальный вывод по кейсу аукциона → все метрики 1", () => {
  const output: ModelOutput = {
    caseId: "ea-001",
    requirements: [
      {
        kind: "mandatory",
        text: "Соответствие единым требованиям части 1 статьи 31 Федерального закона 44-ФЗ",
        quote:
          "Участник закупки должен соответствовать единым требованиям, установленным частью 1 статьи 31 " +
          "Федерального закона № 44-ФЗ.",
      },
      {
        kind: "mandatory",
        text: "Опыт: не менее двух исполненных контрактов на выполнение аналогичных работ за три года",
        quote:
          "наличие не менее двух исполненных контрактов (договоров) " +
          "на выполнение аналогичных работ за последние три года до даты подачи заявки.",
      },
      {
        kind: "mandatory",
        text: "Совокупная стоимость контрактов опыта не менее 20 процентов начальной цены",
        quote:
          "Совокупная стоимость таких контрактов должна составлять не менее 20 процентов " +
          "начальной (максимальной) цены контракта",
      },
    ],
    fields: [
      { key: "nmck", value: "1800000" },
      { key: "security_deposit", value: "9000" },
      { key: "deadline", value: "2026-03-15" },
    ],
    findings: [
      { category: "required_documents", status: "FAIL" },
      { category: "required_fields", status: "NEEDS_HUMAN_REVIEW" },
    ],
  };

  const metrics = evalCase(output, CASE_AUCTION_IT);
  assert.equal(metrics.requirements.f1, 1);
  assert.equal(metrics.requirements.hallucinationRate, 0);
  assert.equal(metrics.quotes.accuracy, 1);
  assert.equal(metrics.fields.accuracy, 1);
  assert.equal(metrics.validation.accuracy, 1);
});

// ——— evalDataset (агрегация) ─────────────────────────────────────────────────

test("evalDataset: идеальный вывод по всем трём кейсам → все агрегаты 1", () => {
  // Строим идеальный вывод по каждому кейсу
  function perfectOutput(c: GoldCase): ModelOutput {
    return {
      caseId: c.id,
      requirements: c.goldRequirements
        .filter((r) => r.mustFind)
        .map((r) => ({ kind: r.kind, text: r.text, quote: r.quote })),
      fields: c.goldFields.map((f) => ({ key: f.key, value: f.value })),
      findings: c.goldFindings.map((f) => ({ category: f.category, status: f.status })),
    };
  }

  const outputs = GOLD_DATASET.map(perfectOutput);
  const report = evalDataset(outputs, GOLD_DATASET);

  assert.equal(report.aggregate.requirementF1, 1);
  assert.equal(report.aggregate.hallucinationRate, 0);
  assert.equal(report.aggregate.quoteAccuracy, 1);
  assert.equal(report.aggregate.fieldAccuracy, 1);
  assert.equal(report.aggregate.validationAccuracy, 1);
});

test("evalDataset: кейс без пары в outputs игнорируется", () => {
  const report = evalDataset([], GOLD_DATASET);
  assert.equal(report.cases.length, 0);
  assert.equal(report.aggregate.requirementF1, 0);
});

// ——— целостность самих золотых кейсов ──────────────────────────────────────

test("CASE_AUCTION_IT: все gold-цитаты найдены в excerpts", () => {
  for (const req of CASE_AUCTION_IT.goldRequirements) {
    if (!req.quote) continue;
    const allText = CASE_AUCTION_IT.excerpts.map((e) => e.text).join(" ").toLowerCase();
    // Берём первые 40 символов цитаты — они должны быть в тексте
    const fragment = req.quote.slice(0, 40).toLowerCase();
    assert.ok(
      allText.includes(fragment),
      `Цитата не найдена в тексте кейса ea-001: «${fragment}»`,
    );
  }
});

test("CASE_TENDER_MEDICAL: все gold-цитаты найдены в excerpts", () => {
  for (const req of CASE_TENDER_MEDICAL.goldRequirements) {
    if (!req.quote) continue;
    const allText = CASE_TENDER_MEDICAL.excerpts.map((e) => e.text).join(" ").toLowerCase();
    const fragment = req.quote.slice(0, 40).toLowerCase();
    assert.ok(
      allText.includes(fragment),
      `Цитата не найдена в тексте кейса tender-002: «${fragment}»`,
    );
  }
});

test("CASE_QUOTATION_SUPPLIES: gold-цитаты найдены в excerpts", () => {
  for (const req of CASE_QUOTATION_SUPPLIES.goldRequirements) {
    if (!req.quote) continue;
    const allText = CASE_QUOTATION_SUPPLIES.excerpts.map((e) => e.text).join(" ").toLowerCase();
    const fragment = req.quote.slice(0, 40).toLowerCase();
    assert.ok(
      allText.includes(fragment),
      `Цитата не найдена в тексте кейса quotation-003: «${fragment}»`,
    );
  }
});

test("GOLD_DATASET: 3 кейса, каждый с id, nmck > 0 и хотя бы одним требованием", () => {
  assert.equal(GOLD_DATASET.length, 3);
  for (const c of GOLD_DATASET) {
    assert.ok(c.id, "нет id");
    assert.ok(c.nmck > 0, "nmck = 0");
    assert.ok(c.goldRequirements.length > 0, "нет требований");
    assert.ok(c.excerpts.length > 0, "нет фрагментов");
  }
});
