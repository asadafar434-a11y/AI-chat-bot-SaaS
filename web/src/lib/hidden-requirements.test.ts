// Детектор скрытых требований: схема ответа, важность, фильтры, места цитат, устаревание и итог — npm test (без ИИ).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CRITICALITY_TEXT,
  HiddenRequirementsSchema,
  KIND_TEXT,
  filterHiddenFindings,
  hiddenRequirementsCounts,
  hiddenRequirementsKey,
  hiddenRequirementsStale,
  hiddenRequirementsSummary,
  sortHiddenFindings,
  withPlaces,
  type HiddenFinding,
  type HiddenRequirementsResult,
} from "./hidden-requirements.ts";

const finding = (over: Partial<HiddenFinding> = {}): HiddenFinding => ({
  kind: "ambiguity",
  criticality: "high",
  title: "Аренда спецтехники",
  what: "Требование о наличии техники не уточняет, нужна ли собственность",
  quote: "Участник должен иметь специальную технику",
  source: "ТЗ, п. 5.2",
  why: "Неясно, можно ли подтвердить технику договором аренды",
  interpretations: "Собственная техника или аренда — от этого зависит допуск",
  risk: "Потенциально: заявку отклонят, если аренда не устроит комиссию",
  check: "Полный текст ТЗ и требования к участникам",
  action: "Подготовить договор аренды и задать вопрос заказчику",
  ask: "Просим уточнить, допускается ли подтверждение права пользования арендованной техникой",
  verified: true,
  ...over,
});

const result = (findings: HiddenFinding[]): HiddenRequirementsResult => ({
  findings,
  docsKey: "k",
  checkedAt: "2026-10-28T10:00:00.000Z",
});

test("схема ответа модели: все поля нужны, неизвестный вид и критичность отклоняются, пустой список — «ничего не найдено»", () => {
  const ok = { ...finding() };
  assert.equal(HiddenRequirementsSchema.safeParse({ findings: [ok] }).success, true);
  assert.equal(HiddenRequirementsSchema.safeParse({ findings: [] }).success, true);
  assert.equal(HiddenRequirementsSchema.safeParse({ findings: [{ ...ok, kind: "other" }] }).success, false);
  assert.equal(HiddenRequirementsSchema.safeParse({ findings: [{ ...ok, criticality: "urgent" }] }).success, false);
  assert.equal(HiddenRequirementsSchema.safeParse({ findings: [{ kind: "ambiguity", title: "x" }] }).success, false);
});

test("итог одной строкой: склонение, критические и высокие отдельно, пусто — «не найдено»", () => {
  assert.equal(hiddenRequirementsSummary(result([])), "Скрытых требований и неоднозначностей не найдено");
  assert.equal(hiddenRequirementsSummary(result([finding()])), "Найдено: 1 момент, из них высоких — 1");
  assert.equal(
    hiddenRequirementsSummary(result([finding({ criticality: "critical" }), finding(), finding({ criticality: "low" })])),
    "Найдено: 3 момента, из них критических — 1, высоких — 1",
  );
  assert.equal(
    hiddenRequirementsSummary(result(Array.from({ length: 5 }, () => finding({ criticality: "medium" })))),
    "Найдено: 5 моментов",
  );
});

test("подсчёт: важность, вопросы заказчику и подписи видов", () => {
  const counts = hiddenRequirementsCounts(result([finding({ criticality: "critical" }), finding({ criticality: "high", ask: "" })]));
  assert.deepEqual(counts, { total: 2, critical: 1, high: 1, medium: 0, low: 0, withQuestion: 1 });
  assert.equal(KIND_TEXT.ambiguity, "Неоднозначность");
  assert.equal(CRITICALITY_TEXT.critical, "Критический");
});

test("сортировка: критическое раньше высокого, внутри одной важности порядок модели сохраняется", () => {
  const input = [
    finding({ title: "Низкое", criticality: "low" }),
    finding({ title: "Высокое 1", criticality: "high" }),
    finding({ title: "Критическое", criticality: "critical" }),
    finding({ title: "Высокое 2", criticality: "high" }),
    finding({ title: "Среднее", criticality: "medium" }),
  ];
  assert.deepEqual(
    sortHiddenFindings(input).map((f) => f.title),
    ["Критическое", "Высокое 1", "Высокое 2", "Среднее", "Низкое"],
  );
});

test("фильтры по важности и типу: «all» не сужает, оба условия работают вместе", () => {
  const findings = [
    finding({ title: "A", kind: "ambiguity", criticality: "critical" }),
    finding({ title: "B", kind: "financial", criticality: "critical" }),
    finding({ title: "C", kind: "ambiguity", criticality: "low" }),
  ];
  assert.deepEqual(filterHiddenFindings(findings, { criticality: "all", kind: "all" }).map((f) => f.title), ["A", "B", "C"]);
  assert.deepEqual(filterHiddenFindings(findings, { criticality: "critical", kind: "all" }).map((f) => f.title), ["A", "B"]);
  assert.deepEqual(filterHiddenFindings(findings, { criticality: "critical", kind: "ambiguity" }).map((f) => f.title), ["A"]);
});

test("результат устаревает, когда документы заменили или добавили; порядок документов не важен", () => {
  const docs = [
    { name: "ТЗ.docx", text: "Требования к работам" },
    { name: "Договор.docx", text: "Проект договора" },
  ];
  const saved = { ...result([]), docsKey: hiddenRequirementsKey(docs) };
  assert.equal(hiddenRequirementsStale(saved, docs), false);
  assert.equal(hiddenRequirementsStale(saved, [...docs].reverse()), false);
  assert.equal(hiddenRequirementsStale(saved, [docs[0], { name: "Договор.docx", text: "Новый договор" }]), true);
  assert.equal(hiddenRequirementsStale(saved, [...docs, { name: "Приложение.docx", text: "Приложение" }]), true);
});

test("место цитаты: пункт в документе находится, выдуманная цитата места не получает", () => {
  const name = "ТЗ.docx";
  const text = "5.2. Участник должен иметь специальную технику для выполнения работ.\n5.3. Срок поставки — 30 дней.";
  const placed = withPlaces(
    {
      findings: [
        finding(),
        finding({ title: "Выдумка", quote: "Такого требования в документе нет" }),
        finding({ title: "Пустая цитата", quote: "" }),
      ],
    },
    [{ name, text }],
  );
  assert.match(placed.findings[0].at ?? "", /5\.2/);
  assert.equal(placed.findings[1].at, undefined);
  assert.equal(placed.findings[2].at, undefined);
  assert.equal(placed.findings[0].verified, true, "проверку цитат делает маршрут, withPlaces её не меняет");
});
