// Сценарии решения по товарной позиции: подтверждено, несколько, мало данных, противоречие, не найдено, неактуально — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, cardsFromGoods, type CardEdits, type ProductCard } from "./product-card.ts";
import { STALE_DAYS, activityOf, statusOf } from "./registry-decision.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { resolveCard } from "./registry-service.ts";

const AS_OF = "2026-11-20";
const NOW = new Date("2026-10-12T09:00:00Z");

const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };
const B = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "БЕТА"', inn: "9900000002" };
const C = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "ГАММА"', inn: "9900000003" };

const baseCard = (edits: CardEdits = {}, okpd2 = "31.01.12.160"): ProductCard =>
  applyEdits(
    {
      key: "1:x",
      name: "Кресло офисное",
      quantity: "10 шт",
      source: "ТЗ, п. 1",
      quote: "Кресло офисное",
      offeredName: null,
      fields: okpd2 ? { okpd2: { value: okpd2, origin: "tz", source: "ТЗ" } } : {},
    },
    edits,
  );

const run = async (records: ReturnType<typeof fixtureRecord>[], card: ProductCard, opts: { asOf?: string; exportedAt?: string } = {}) =>
  resolveCard(await seededStore(records, opts.exportedAt), card, { registry: "gisp_rpp_719", asOf: opts.asOf ?? AS_OF, now: NOW });

test("1. одна запись с подтверждёнными идентификаторами — предлагается, с обоснованием", async () => {
  const records = [
    fixtureRecord({ registryNumber: "00000001", ...A, productName: "Кресло офисное тестовое КО-100", okpd2: "31.01.12.160" }),
    fixtureRecord({ registryNumber: "00000002", ...B, productName: "Кресло офисное тестовое КО-200", okpd2: "31.01.12.160" }),
  ];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-100" }));
  assert.equal(d.status, "confirmed");
  assert.equal(d.scenario, 1);
  assert.equal(d.proposed, "00000001");
  assert.match(d.reasons[0], /ИНН производителя/);
  assert.match(d.reasons[0], /модель/);
  assert.ok(d.search.dataset, "в решении сохранена выгрузка, по которой оно принято");
  assert.ok(d.assumptions.length > 0, "допущения названы явно");
});

test("2. пять записей с одним названием и разными номерами — номер не выбирается, показаны все пять", async () => {
  const records = [1, 2, 3, 4, 5].map((n) =>
    fixtureRecord({ registryNumber: `0000010${n}`, ...A, productName: "Кресло офисное тестовое", okpd2: "31.01.12.160" }),
  );
  const d = await run(records, baseCard({ inn: "9900000001" }));
  assert.equal(d.proposed, null, "первый результат не берётся");
  assert.equal(d.status, "choose");
  assert.equal(d.scenario, 2);
  assert.equal(d.candidates.length, 5);
  assert.ok(d.missing.some((m) => /модель/.test(m)), "сказано, чего не хватает");
});

test("2б. то же название, но только ТЗ и ничего о товаре участника — «недостаточно данных», номер не предлагается", async () => {
  const records = [1, 2, 3, 4, 5].map((n) =>
    fixtureRecord({ registryNumber: `0000011${n}`, ...(n % 2 ? A : B), productName: "Кресло офисное тестовое", okpd2: "31.01.12.160" }),
  );
  const d = await run(records, baseCard());
  assert.equal(d.status, "need_data");
  assert.equal(d.scenario, 3);
  assert.equal(d.proposed, null);
  assert.ok(d.candidates.length >= 5, "кандидаты для просмотра есть");
  assert.ok(d.missing.some((m) => /производитель/.test(m)));
  assert.ok(d.assumptions.some((a) => /ТЗ/.test(a)));
});

test("3. одинаковые название и ОКПД2, разные производители — выбирается запись назвавшего ИНН производителя", async () => {
  const records = [
    fixtureRecord({ registryNumber: "00000201", ...A, productName: "Кресло офисное тестовое КО-1" }),
    fixtureRecord({ registryNumber: "00000202", ...B, productName: "Кресло офисное тестовое КО-1" }),
    fixtureRecord({ registryNumber: "00000203", ...C, productName: "Кресло офисное тестовое КО-1" }),
  ];
  const d = await run(records, baseCard({ inn: "9900000002", model: "КО-1" }));
  assert.equal(d.proposed, "00000202");
  assert.deepEqual(d.candidates.map((c) => c.registryNumber), ["00000202"], "записи других производителей не кандидаты");
});

test("4. производитель совпал, модель нет — выбор заблокирован, противоречие названо", async () => {
  const records = [fixtureRecord({ registryNumber: "00000301", ...A, productName: "Кресло офисное тестовое КО-100" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "ЗЕТ-999" }));
  assert.equal(d.proposed, null);
  assert.equal(d.status, "contradiction");
  assert.equal(d.scenario, 4);
  assert.match(d.reasons.join(" "), /Модель в записи отличается/);
});

test("5. название то же, а параметр иной — это противоречие", async () => {
  const records = [fixtureRecord({ registryNumber: "00000401", ...A, productName: "Ресивер для сжатого воздуха тестовый объемом 80 л", okpd2: "25.29.12" })];
  const card = baseCard({ inn: "9900000001", offeredName: "Ресивер для сжатого воздуха объемом 100 л" }, "25.29.12");
  const d = await run(records, { ...card, name: "Ресивер для сжатого воздуха" });
  assert.equal(d.status, "contradiction");
  assert.equal(d.proposed, null);
  assert.match(d.reasons.join(" "), /Параметр отличается/);
});

test("6. недостаточно данных о товаре поставщика — список для просмотра, но не выбор", async () => {
  const records = [fixtureRecord({ registryNumber: "00000501", ...A, productName: "Кресло офисное тестовое" })];
  const d = await run(records, baseCard());
  assert.equal(d.status, "need_data");
  assert.equal(d.proposed, null);
  assert.ok(d.missing.length >= 2);
});

test("7. несколько кандидатов без возможности выбрать один — выбор отдан человеку, различия показаны", async () => {
  const records = [
    fixtureRecord({ registryNumber: "00000601", ...A, productName: "Кресло офисное тестовое КО-1", okpd2: "31.01.12.160" }),
    fixtureRecord({ registryNumber: "00000602", ...A, productName: "Кресло офисное тестовое КО-2", okpd2: "31.01.12.170" }),
  ];
  const d = await run(records, baseCard({ inn: "9900000001" }));
  assert.equal(d.status, "choose");
  assert.equal(d.proposed, null);
  assert.ok(d.differences.includes("наименование и модель"));
  assert.ok(d.differences.includes("код ОКПД2"));
});

test("8. записи нет — поиск выполнен, указано, где и по чему искали; номер не придумывается", async () => {
  const records = [fixtureRecord({ registryNumber: "00000701", ...B, productName: "Кресло офисное тестовое КО-1" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }));
  assert.equal(d.status, "not_found");
  assert.equal(d.scenario, 5);
  assert.equal(d.proposed, null);
  assert.equal(d.candidates.length, 0, "запись другого производителя не подсовывается");
  assert.match(d.search.filters.join(" | "), /ИНН производителя 9900000001/);
  assert.match(d.search.filters[0], /РПП/);
  assert.match(d.reasons.join(" "), /Номер не подставляется/);
  assert.equal(d.similarElsewhere, 1, "справка: у другого производителя название такое же");
});

test("9. срок действия истёк — запись неактуальна; похожую действующую вместо неё не берём", async () => {
  const records = [
    fixtureRecord({ registryNumber: "00000801", ...A, productName: "Кресло офисное тестовое КО-1", validUntil: "2026-11-01", validUntilMin: "2026-11-01" }),
    fixtureRecord({ registryNumber: "00000802", ...A, productName: "Кресло офисное тестовое КО-1М", validUntil: "2029-01-01", validUntilMin: "2029-01-01" }),
  ];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }), { asOf: "2026-12-01" });
  assert.equal(d.status, "inactive");
  assert.equal(d.scenario, 6);
  assert.equal(d.proposed, null);
  assert.match(d.reasons[0], /срок действия истёк 2026-11-01/);
});

test("9б. запись пропала из последней выгрузки — неактуальна", async () => {
  const records = [fixtureRecord({ registryNumber: "00000901", ...A, productName: "Кресло офисное тестовое КО-1", status: "absent" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }));
  assert.equal(d.status, "inactive");
  assert.match(d.reasons[0], /нет в последней загруженной выгрузке/);
});

test("активность: срок на дату подачи, ранний срок одного из оснований и скорое окончание — предупреждения, а не отказ", () => {
  const rec = fixtureRecord({ registryNumber: "00001001", validUntil: "2029-01-01", validUntilMin: "2026-11-01" });
  const a = activityOf(rec, "2026-12-01");
  assert.equal(a.active, true);
  assert.match(a.warnings[0], /несколько оснований/);
  const soon = activityOf(fixtureRecord({ registryNumber: "00001002", validUntil: "2026-12-10", validUntilMin: "2026-12-10" }), "2026-12-01");
  assert.equal(soon.active, true);
  assert.match(soon.warnings[0], /скоро истечёт/);
  const none = activityOf(fixtureRecord({ registryNumber: "00001003", validUntil: null, validUntilMin: null }), "2026-12-01");
  assert.equal(none.active, true);
  assert.match(none.warnings[0], /не указан/);
});

test("устаревшая выгрузка: доказанная запись показывается, но статус «данные требуют обновления»", async () => {
  const records = [fixtureRecord({ registryNumber: "00001101", ...A, productName: "Кресло офисное тестовое КО-1" })];
  const old = new Date(NOW.getTime() - (STALE_DAYS + 5) * 86400000).toISOString();
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }), { exportedAt: old });
  assert.equal(d.status, "needs_update");
  assert.equal(d.proposed, "00001101");
  assert.ok(d.search.datasetAgeDays! > STALE_DAYS);
});

test("14. реестр не загружен или не тот — поиска нет, номер не придумывается", async () => {
  const { createMemoryRegistryStore } = await import("./registry-store.ts");
  const d = await resolveCard(createMemoryRegistryStore(), baseCard({ inn: "9900000001", model: "КО-1" }), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.equal(d.status, "no_dataset");
  assert.equal(d.proposed, null);
  assert.equal(statusOf({ status: "found", registry: null, unsupported: "radio_878" }, null, null), "unsupported_registry");
  assert.equal(statusOf({ status: "unclear", registry: null, unsupported: null }, null, null), "clarify_registry");
  assert.equal(statusOf({ status: "none", registry: null, unsupported: null }, null, null), "no_requirement");
  assert.equal(statusOf({ status: "found", registry: "gisp_rpp_719", unsupported: null }, null, null), "pending");
});

test("16. одинаковые наименования в разных строках — отдельные ключи и независимые решения", async () => {
  const goods = [
    { name: "Кресло офисное", quantity: "5 шт", source: "ТЗ", quote: "Кресло офисное 5 шт" },
    { name: "Кресло офисное", quantity: "3 шт", source: "ТЗ", quote: "Кресло офисное 3 шт" },
  ];
  const cards = cardsFromGoods(goods, [], { });
  assert.notEqual(cards[0].key, cards[1].key);
  const records = [
    fixtureRecord({ registryNumber: "00001201", ...A, productName: "Кресло офисное тестовое КО-1" }),
    fixtureRecord({ registryNumber: "00001202", ...B, productName: "Кресло офисное тестовое КО-2" }),
  ];
  const store = await seededStore(records);
  const first = await resolveCard(store, applyEdits(cards[0], { inn: "9900000001", model: "КО-1" }), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  const second = await resolveCard(store, applyEdits(cards[1], { inn: "9900000002", model: "КО-2" }), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.equal(first.proposed, "00001201");
  assert.equal(second.proposed, "00001202");
});

test("ИНН в записи другой, чем у участника, а модель такая же — не совпадение", async () => {
  const records = [fixtureRecord({ registryNumber: "00001301", ...B, productName: "Кресло офисное тестовое КО-1" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }));
  assert.notEqual(d.status, "confirmed");
  assert.equal(d.proposed, null);
});

test("известный участнику номер подтверждается записью, если ИНН совпал", async () => {
  const records = [fixtureRecord({ registryNumber: "00001401", ...A, productName: "Кресло офисное тестовое КО-1" })];
  const d = await run(records, baseCard({ inn: "9900000001", registryNumber: "00001401" }));
  assert.equal(d.status, "confirmed");
  assert.equal(d.proposed, "00001401");
  const wrong = await run(records, baseCard({ inn: "9900000001", registryNumber: "00009999" }));
  assert.equal(wrong.proposed, null, "несуществующий номер не подтверждается");
  assert.equal(wrong.status, "not_found");
});

test("модель сравнивается по целым словам: «КО-1» не подтверждает «КО-1М» — это другая модификация", async () => {
  const records = [fixtureRecord({ registryNumber: "00001501", ...A, productName: "Кресло офисное тестовое КО-1М" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "КО-1" }));
  assert.notEqual(d.status, "confirmed");
  assert.equal(d.proposed, null);
  assert.match(d.candidates[0].signals.find((s) => s.field === "model")!.text, /более точное обозначение|модификац/);
});

test("модель из нескольких слов находится целиком: «КТО 05/Х» и «кто-05/х» — одно и то же", async () => {
  const records = [fixtureRecord({ registryNumber: "00001601", ...A, productName: "Контейнер тестовый КТО 05/Х" })];
  const d = await run(records, baseCard({ inn: "9900000001", model: "кто-05/х" }, "31.01.12.160"));
  assert.equal(d.candidates[0].identity.includes("model"), true);
});

test("ТУ узнаётся в обоих порядках записи: «ТУ 801-222» и «801-222 ТУ»", async () => {
  const records = [fixtureRecord({ registryNumber: "00001701", ...A, productName: "Кресло машиниста тестовое 801.222.000.000-03", madeBy: "801.222.000.000 ТУ" })];
  const a = await run(records, baseCard({ inn: "9900000001", madeBy: "ТУ 801.222.000.000" }));
  assert.equal(a.status, "confirmed", "ИНН и ТУ — устойчивые идентификаторы");
  const b = await run(records, baseCard({ inn: "9900000001", madeBy: "801.222.000.000 ТУ" }));
  assert.equal(b.status, "confirmed");
  const other = await run(records, baseCard({ inn: "9900000001", madeBy: "ТУ 25.73.40-001-19279921-2020" }));
  assert.equal(other.proposed, null, "другое ТУ — не подтверждение");
  assert.notEqual(other.status, "confirmed");
});

test("модели нет ни у кого и производитель не назван — записи «не ваши», это не противоречие и не выбор", async () => {
  const records = [
    fixtureRecord({ registryNumber: "00001801", ...B, productName: "Кресло офисное тестовое КО-7" }),
    fixtureRecord({ registryNumber: "00001802", ...C, productName: "Кресло офисное тестовое КО-8" }),
  ];
  const d = await run(records, baseCard({ model: "ZZ-123" }));
  assert.equal(d.status, "not_found");
  assert.equal(d.proposed, null);
  assert.equal(d.dismissed, 2);
  assert.match(d.reasons[0], /не ваш товар/);
});

test("разные ТУ у одного производителя при той же модели — противоречие (ТУ — устойчивый идентификатор)", async () => {
  const records = [fixtureRecord({ registryNumber: "00001901", ...A, productName: "Кресло тестовое КО-1", madeBy: "ТУ 25.73.40-001-19279921-2020" })];
  const d = await run(records, baseCard({ inn: "9900000001", madeBy: "ТУ 32.50.22.127-002-74573326-2017" }));
  assert.equal(d.status, "contradiction");
});
