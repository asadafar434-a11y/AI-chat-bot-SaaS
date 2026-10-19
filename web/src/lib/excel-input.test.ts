// Что из закупки идёт в Excel-бланк заказчика по каждому товару: страна, производитель и реестровый номер — только от участника — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { excelGoodsOf } from "./excel-input.ts";
import { applyEdits } from "./product-card.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { registryCardsOf } from "./registry-fill.ts";
import { EMPTY_REGISTRY_STATE, selectRecord } from "./registry-log.ts";
import { resolveCard } from "./registry-service.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const DOCS = [{ name: "ТЗ.docx", text: "Поставляемый товар должен быть включён в реестр российской промышленной продукции. Кресло офисное — ОКПД2 31.01.12.160, 5 шт." }];
const GOODS = [
  { name: "Кресло офисное", characteristics: "", quantity: "5 шт", source: "ТЗ", quote: "Кресло офисное — ОКПД2 31.01.12.160, 5 шт." },
  { name: "Страна происхождения – Россия", characteristics: "[номер реестровой записи — …]", quantity: "", source: "", quote: "" },
  { name: "Стол письменный", characteristics: "", quantity: "2 шт", source: "ТЗ", quote: "Стол письменный" },
];

async function purchaseWithChoice(confirmed: boolean) {
  const base = { tp: { goods: GOODS }, registry: EMPTY_REGISTRY_STATE, deadline: { date: "2026-11-20" } };
  const [first] = registryCardsOf(base, DOCS);
  const edited = applyEdits(first, { inn: "9900000001", model: "КО-1", country: "Россия", manufacturer: "ООО «Мебель»" });
  const store = await seededStore([fixtureRecord({ registryNumber: "00005001", enterpriseName: "ТЕСТОВОЕ ПРЕДПРИЯТИЕ", inn: "9900000001", productName: "Кресло офисное тестовое КО-1" })]);
  const decision = await resolveCard(store, edited, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: NOW });
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card: edited, decision, registryNumber: decision.proposed!, now: NOW });
  assert.ok(picked.ok);
  const choice = picked.state.choices[first.key];
  const choices = confirmed ? picked.state.choices : { [first.key]: { ...choice, basis: "auto_picked" as const, confirmedAt: "", options: 2 } };
  return { ...base, registry: { ...picked.state, choices, cards: { [first.key]: { inn: "9900000001", model: "КО-1", country: "Россия", manufacturer: "ООО «Мебель»" } } } };
}

test("страна, производитель и номер реестра — у позиции, где участник их назвал; строка «Страна происхождения» и позиции без сведений — без значений", async () => {
  const goods = excelGoodsOf(await purchaseWithChoice(true), DOCS, NOW);
  assert.deepEqual(goods.map((g) => g.name), ["Кресло офисное", "Стол письменный"], "строка про страну происхождения — не товар");
  assert.deepEqual(goods[0], { name: "Кресло офисное", country: "Россия", manufacturer: "ООО «Мебель»", registry: "РПП (ПП 719), № 00005001" });
  assert.deepEqual(goods[1], { name: "Стол письменный", country: undefined, manufacturer: undefined, registry: undefined });
});

test("номер, который подобрала программа, а участник не подтвердил, в файле помечен «ПРОВЕРЬТЕ»", async () => {
  const [first] = excelGoodsOf(await purchaseWithChoice(false), DOCS, NOW);
  assert.equal(first.registry, "РПП (ПП 719), № 00005001 [ПРОВЕРЬТЕ]");
});

test("то, что заказчик хочет в ТЗ (код ОКПД2), в бланк как значение участника не идёт", () => {
  const [card] = registryCardsOf({ tp: { goods: GOODS } }, DOCS);
  assert.equal(card.fields.okpd2?.origin, "tz");
  const [first] = excelGoodsOf({ tp: { goods: GOODS } }, DOCS, NOW);
  assert.deepEqual(first, { name: "Кресло офисное", country: undefined, manufacturer: undefined, registry: undefined });
});
