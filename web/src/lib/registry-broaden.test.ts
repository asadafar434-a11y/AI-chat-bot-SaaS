// Точного названия в реестре нет — ищем по общему («куртки для самбо» → «куртки», «ботинки для самбо» → «ботинки») — npm test.
// Решение владельца 14.10.2026. Данные выдуманные.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsFromGoods } from "./product-card.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { autoPick, EMPTY_REGISTRY_STATE } from "./registry-log.ts";
import { resolveCard } from "./registry-service.ts";
import { nameBroadenings, nameWords } from "./registry-text.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const AS_OF = "2026-11-20";
const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };
const B = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "БЕТА"', inn: "9900000002" };

const cardOf = (name: string, quote = name) => cardsFromGoods([{ name, quantity: "5 шт", source: "ТЗ", quote }], [], {})[0];

// В реестре есть куртки и ботинки, но «для самбо» — нет.
const RECORDS = [
  fixtureRecord({ registryNumber: "00008001", ...A, productName: "Куртка мужская зимняя", okpd2: "14.13.11.110" }),
  fixtureRecord({ registryNumber: "00008002", ...B, productName: "Куртка рабочая утеплённая", okpd2: "14.13.11.120" }),
  fixtureRecord({ registryNumber: "00008003", ...A, productName: "Ботинки рабочие кожаные", okpd2: "15.20.13.110" }),
  fixtureRecord({ registryNumber: "00008004", ...B, productName: "Ботинки зимние мужские", okpd2: "15.20.13.120" }),
  fixtureRecord({ registryNumber: "00008005", ...B, productName: "Кресло офисное тестовое", okpd2: "31.01.12.160" }),
];

test("от точного названия к общему: уточняющие слова отбрасываются с конца, главное слово остаётся последним", () => {
  assert.deepEqual(nameBroadenings(nameWords("Куртки для самбо")), [["куртки", "самбо"], ["куртки"]]);
  assert.deepEqual(nameBroadenings(nameWords("Ботинки для самбо")), [["ботинки", "самбо"], ["ботинки"]]);
  assert.deepEqual(nameBroadenings(["куртка", "мужская", "зимняя", "самбо"]), [["куртка", "мужская", "зимняя", "самбо"], ["куртка", "мужская", "зимняя"], ["куртка", "мужская"], ["куртка"]]);
  assert.deepEqual(nameBroadenings(["мужская", "куртка", "зимняя"]), [["мужская", "куртка", "зимняя"], ["мужская", "куртка"], ["куртка"]], "прилагательное главным словом не становится");
  assert.deepEqual(nameBroadenings(["куртка"]), [["куртка"]]);
  assert.deepEqual(nameBroadenings([]), []);
});

test("«куртки для самбо» в реестре нет — найдены просто куртки, и об этом сказано словами", async () => {
  const store = await seededStore(RECORDS);
  const d = await resolveCard(store, cardOf("Куртки для самбо"), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  const numbers = d.candidates.map((c) => c.registryNumber).sort();
  assert.deepEqual(numbers, ["00008001", "00008002"], "только куртки, без ботинок и кресел");
  assert.ok(d.reasons.some((r) => /Точного названия «куртки самбо» в реестре нет — показаны записи по общему названию «куртки»/.test(r)));
  assert.ok(d.search.filters.some((f) => /точного названия в реестре нет, взято общее/.test(f)));
  assert.equal(d.proposed, null, "по общему названию товар не доказан: решает человек");
  assert.ok(["need_data", "choose"].includes(d.status), d.status);
});

test("«ботинки для самбо» — все ботинки из реестра", async () => {
  const store = await seededStore(RECORDS);
  const d = await resolveCard(store, cardOf("Ботинки для самбо"), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.deepEqual(d.candidates.map((c) => c.registryNumber).sort(), ["00008003", "00008004"]);
  assert.ok(d.reasons.some((r) => /по общему названию «ботинки»/.test(r)));
});

test("точное название есть — широкого поиска и пометки об общем названии нет", async () => {
  const store = await seededStore(RECORDS);
  const d = await resolveCard(store, cardOf("Куртка мужская зимняя"), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.ok(d.candidates.some((c) => c.registryNumber === "00008001"));
  assert.equal(d.reasons.some((r) => /общему названию/.test(r)), false);
  assert.equal(d.search.filters.some((f) => /взято общее/.test(f)), false);
});

test("уточнение отбрасывается постепенно: «куртка мужская зимняя для самбо» → «куртка мужская зимняя», а не сразу «куртка»", async () => {
  const store = await seededStore(RECORDS);
  const d = await resolveCard(store, cardOf("Куртка мужская зимняя для самбо"), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.deepEqual(d.candidates.map((c) => c.registryNumber), ["00008001"], "нашлась запись с тремя общими словами, остальные куртки не нужны");
  assert.ok(d.reasons.some((r) => /по общему названию «куртка мужская зимняя»/.test(r)));
});

test("совсем нет такого товара — не найдено, чужие товары не подсовываются", async () => {
  const store = await seededStore(RECORDS);
  const d = await resolveCard(store, cardOf("Телескоп любительский для самбо"), { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.equal(d.candidates.length, 0);
  assert.equal(d.status, "not_found");
});

test("производитель назван и у него ничего нет — широкий поиск по названию по-прежнему не запускается", async () => {
  const store = await seededStore(RECORDS);
  const base = cardOf("Куртки для самбо");
  const card = { ...base, fields: { ...base.fields, inn: { value: "9900000099", origin: "user" as const, source: "участник" } } };
  const d = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  assert.equal(d.candidates.length, 0, "чужие куртки — не товар этого производителя");
  assert.equal(d.reasons.some((r) => /общему названию/.test(r)), false);
});

test("найденные по общему названию варианты идут в автоподбор: лучший подставляется с пометкой «проверьте»", async () => {
  const store = await seededStore(RECORDS);
  const card = cardOf("Ботинки для самбо");
  const d = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  const state = autoPick(EMPTY_REGISTRY_STATE, { card, decision: d, now: NOW });
  const choice = state.choices[card.key];
  assert.ok(choice, "номер подставлен");
  assert.equal(choice.basis, "auto_picked");
  assert.equal(choice.confirmedAt, "", "ждёт проверки человеком");
  assert.equal(choice.options, 2);
});
