// Критерии оценки заявок: значимость, доля в итоговых баллах, пример закупки — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupCriteria, isPrice, percentOf, pointsText, weightsAddUp, type ScoreRow } from "./criteria.ts";
import { quoteFound } from "./quotes.ts";
import { SAMPLE_CRITERIA } from "./requirements-sample.ts";
import { SAMPLE_DOCUMENTS } from "./sample-purchase.ts";

const row = (over: Partial<ScoreRow>): ScoreRow => ({
  criterion: "Квалификация участников закупки",
  criterionWeight: "30 %",
  indicator: "",
  indicatorWeight: "",
  detail: "",
  detailWeight: "",
  scoring: "",
  proof: "",
  form: "",
  source: "",
  quote: "",
  verified: true,
  ...over,
});

test("значимость — как её пишут в порядке оценки", () => {
  assert.equal(percentOf("60 %"), 60);
  assert.equal(percentOf("60%"), 60);
  assert.equal(percentOf("значимость 40 процентов"), 40);
  assert.equal(percentOf("0,6"), 60);
  assert.equal(percentOf("12,5 %"), 12.5);
  assert.equal(percentOf(""), null);
  assert.equal(percentOf("не указана"), null);
  assert.equal(percentOf("150 %"), null);
});

test("доля в итоговой сотне: критерий × показатель × детализирующий показатель", () => {
  const [group] = groupCriteria([
    row({ indicator: "Опыт", indicatorWeight: "50 %", detail: "Общая цена договоров", detailWeight: "100 %" }),
    row({ indicator: "Специалисты", indicatorWeight: "50 %", detail: "Режиссёр", detailWeight: "40 %" }),
    row({ indicator: "Специалисты", indicatorWeight: "50 %", detail: "Электромонтёр, группа IV", detailWeight: "60 %" }),
  ]);
  assert.equal(group.weight, 30);
  assert.deepEqual(group.rows.map((r) => r.share), [15, 6, 9]);
});

test("не указанная значимость: у единственного пункта — весь уровень, у нескольких — неизвестно", () => {
  // Один показатель без значимости — это весь критерий.
  const [alone] = groupCriteria([row({ criterionWeight: "20 %", indicator: "Опыт", indicatorWeight: "" })]);
  assert.equal(alone.rows[0].share, 20);
  // Два детализирующих без значимости поровну не делим: это была бы догадка.
  const [two] = groupCriteria([
    row({ indicator: "Специалисты", indicatorWeight: "100 %", detail: "Режиссёр" }),
    row({ indicator: "Специалисты", indicatorWeight: "100 %", detail: "Звукорежиссёр" }),
  ]);
  assert.deepEqual(two.rows.map((r) => r.share), [null, null]);
  // Критерий без значимости — долей нет ни у одной строки.
  const [none] = groupCriteria([row({ criterionWeight: "" })]);
  assert.equal(none.weight, null);
  assert.equal(none.rows[0].share, null);
});

test("строки собираются по критериям, значимость критерия — из первой строки, где она есть", () => {
  const groups = groupCriteria([
    row({ criterion: "Цена контракта", criterionWeight: "60 %" }),
    row({ criterionWeight: "", indicator: "Опыт" }),
    row({ criterion: "квалификация участников закупки", criterionWeight: "40 %", indicator: "Специалисты" }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.name, g.weight, g.rows.length]),
    [
      ["Цена контракта", 60, 1],
      ["Квалификация участников закупки", 40, 2],
    ]
  );
  assert.equal(weightsAddUp(groups), true);
  assert.equal(weightsAddUp(groups.slice(1)), false);
});

test("баллы — со склонением, цена отличается от остальных критериев", () => {
  assert.equal(pointsText(15), "15 баллов");
  assert.equal(pointsText(21), "21 балл");
  assert.equal(pointsText(3), "3 балла");
  assert.equal(pointsText(7.5), "7,5 балла");
  assert.equal(pointsText(14.999), "15 баллов");
  assert.equal(isPrice("Цена контракта"), true);
  assert.equal(isPrice("Цена контракта, сумма цен единиц товара, работы, услуги"), true);
  assert.equal(isPrice("Качественные характеристики объекта закупки"), false);
  assert.equal(isPrice("Квалификация участников закупки"), false);
});

test("пример закупки: цитаты есть в документах, значимости дают 100, опыт и специалисты — по 15 баллов", () => {
  const texts = SAMPLE_DOCUMENTS.map((d) => d.text);
  for (const r of SAMPLE_CRITERIA.rows) assert.ok(quoteFound(r.quote, texts), `нет цитаты: ${r.source}`);
  const groups = groupCriteria(SAMPLE_CRITERIA.rows.map((r) => ({ ...r, verified: true })));
  assert.equal(weightsAddUp(groups), true);
  assert.deepEqual(
    groups.flatMap((g) => g.rows.map((r) => r.share)),
    [60, 10, 15, 15]
  );
});
