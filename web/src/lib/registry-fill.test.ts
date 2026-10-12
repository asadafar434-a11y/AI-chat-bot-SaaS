// Номера реестровых записей в файлах заявки: что получает сборка Word/PDF/ODT и как это проверяется — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { applyEdits } from "./product-card.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { registryCardsOf, registryNumbersFor, asOfDate, requiredRegistryOf, registryDemandOf } from "./registry-fill.ts";
import { EMPTY_REGISTRY_STATE, selectRecord } from "./registry-log.ts";
import { resolveCard } from "./registry-service.ts";
import { registryLine } from "./registry-types.ts";
import { buildTpDocx } from "./tp-docx.ts";
import { fileFromRequest } from "./tp-docx-request.ts";
import { rejectUnknownRegistryNumbers } from "../server/registry/verify.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };
const DOCS = [{ name: "ТЗ.docx", text: "Приложение 1. Поставляемый товар должен быть включён в реестр российской промышленной продукции. Кресло офисное — ОКПД2 31.01.12.160, 5 шт." }];
const GOODS = [
  { name: "Кресло офисное", characteristics: "Нагрузка [число, не меньше 120] кг", quantity: "5 шт", source: "ТЗ", quote: "Кресло офисное — ОКПД2 31.01.12.160, 5 шт." },
  { name: "Стол письменный", characteristics: "Цвет [указать]", quantity: "2 шт", source: "ТЗ", quote: "Стол письменный" },
];
const FORM = { title: "Заявка", source: "", participantFields: [], consent: "Согласие", hasPrice: false, priceNote: "", smeDeclaration: "", goodsTableHeaders: [] as string[] };

async function withChoice() {
  const purchase = { tp: { goods: GOODS }, registry: EMPTY_REGISTRY_STATE, deadline: { date: "2026-11-20" } };
  const [first] = registryCardsOf(purchase, DOCS);
  const edited = applyEdits(first, { inn: "9900000001", model: "КО-1" });
  const store = await seededStore([fixtureRecord({ registryNumber: "00005001", ...A, productName: "Кресло офисное тестовое КО-1" })]);
  const decision = await resolveCard(store, edited, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: NOW });
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card: edited, decision, registryNumber: decision.proposed!, now: NOW });
  assert.ok(picked.ok);
  const state = { ...picked.state, cards: { [first.key]: { inn: "9900000001", model: "КО-1" } } };
  return { purchase: { ...purchase, registry: state }, key: first.key };
}

test("карточки: код ОКПД2 берётся из строки ТЗ и помечен как данные заказчика, а не участника", () => {
  const [card] = registryCardsOf({ tp: { goods: GOODS } }, DOCS);
  assert.equal(card.fields.okpd2?.value, "31.01.12.160");
  assert.equal(card.fields.okpd2?.origin, "tz");
  assert.equal(card.fields.inn, undefined, "про товар участника в ТЗ ничего нет");
});

test("требование закупки определяется по документам, реестр — тот, что назван; иначе тот, что выбрал участник", () => {
  const demand = registryDemandOf({ tp: { goods: GOODS } }, DOCS);
  assert.equal(demand.status, "found");
  assert.equal(requiredRegistryOf(demand, undefined), "gisp_rpp_719");
  const unclear = { status: "unclear" as const, registry: null };
  assert.equal(requiredRegistryOf(unclear, undefined), null);
  assert.equal(requiredRegistryOf(unclear, { ...EMPTY_REGISTRY_STATE, registry: "gisp_rpp_719" }), "gisp_rpp_719");
  assert.equal(requiredRegistryOf({ status: "none", registry: null }, undefined), null, "требования нет и участник реестр не выбирал — искать нечего");
  assert.equal(requiredRegistryOf({ status: "none", registry: null }, { ...EMPTY_REGISTRY_STATE, registry: "gisp_rpp_719" }), "gisp_rpp_719", "участник сам указал реестр — его слово");
});

test("дата, на которую запись должна действовать: срок подачи, а прошедший срок — сегодня", () => {
  assert.equal(asOfDate({ date: "2026-11-20" }, NOW), "2026-11-20");
  assert.equal(asOfDate({ date: "2026-01-01" }, NOW), "2026-10-12");
  assert.equal(asOfDate({ date: "" }, NOW), "2026-10-12");
  assert.equal(asOfDate(undefined, NOW), "2026-10-12");
});

test("номера для заявки: подтверждённая позиция получает номер, остальные — нет", async () => {
  const { purchase } = await withChoice();
  const map = registryNumbersFor(purchase, DOCS, NOW);
  assert.deepEqual([...map.entries()], [[0, "00005001"]]);
});

test("17. без выбора ни одной позиции номеров нет, даже если требование есть", () => {
  const map = registryNumbersFor({ tp: { goods: GOODS }, registry: EMPTY_REGISTRY_STATE }, DOCS, NOW);
  assert.equal(map.size, 0);
  assert.equal(registryNumbersFor({ tp: { goods: GOODS } }, DOCS, NOW).size, 0);
});

test("реестр закупки не определён — выбранный номер не подставляется", async () => {
  const { purchase } = await withChoice();
  const map = registryNumbersFor(purchase, [{ name: "ТЗ.docx", text: "Кресло офисное — 5 шт." }], NOW);
  assert.equal(map.size, 0, "документы не требуют реестр — не вписываем");
});

test("сведения о товаре изменились после выбора — номер не подставляется", async () => {
  const { purchase, key } = await withChoice();
  const changed = { ...purchase, registry: { ...purchase.registry, cards: { [key]: { inn: "9900000001", model: "КО-2" } } } };
  assert.equal(registryNumbersFor(changed, DOCS, NOW).size, 0);
});

// Читаем текст из готового файла Word.
async function textOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const docx = (goods: { name: string; characteristics: string; quantity: string; registryNumber?: string; registryRejected?: boolean }[], headers: string[] = []) =>
  buildTpDocx("tp", { subject: "Тест", form: { ...FORM, goodsTableHeaders: headers }, goods, items: [], cast: null, price: null, profile: null });

test("в файле номер стоит отдельной строкой в характеристиках; название, количество и характеристики не изменены", async () => {
  const text = await textOf(await docx([{ name: "Кресло офисное", characteristics: "Нагрузка [число, не меньше 120] кг", quantity: "5 шт", registryNumber: "00005001" }, { name: "Стол письменный", characteristics: "Цвет [указать]", quantity: "2 шт" }]));
  assert.ok(text.includes(registryLine("00005001")));
  assert.ok(text.includes("Кресло офисное") && text.includes("5 шт") && text.includes("Нагрузка [число, не меньше 120] кг"));
  assert.equal(text.split(registryLine("")).length - 1, 1, "строка — только у позиции с номером");
  assert.ok(text.includes("Стол письменный"));
});

test("в форме заказчика есть столбец «Номер реестровой записи» — номер идёт в него, а характеристики остаются как были", async () => {
  const headers = ["№ п/п", "Наименование товара", "Предложение участника", "Номер реестровой записи"];
  const text = await textOf(await docx([{ name: "Кресло офисное", characteristics: "Нагрузка 120 кг", quantity: "5", registryNumber: "00005001" }], headers));
  assert.ok(text.includes("00005001"));
  assert.equal(text.includes(registryLine("00005001")), false, "в характеристики строка не дублируется");
  assert.ok(text.includes("Нагрузка 120 кг"));
});

test("20. без номера документ такой же, как раньше: ни строки, ни пометки", async () => {
  const text = await textOf(await docx([{ name: "Кресло офисное", characteristics: "Нагрузка 120 кг", quantity: "5" }]));
  assert.equal(text.includes("реестровой записи"), false);
});

test("номер, которого уже нет среди действующих, в файл не попадает: вместо него пометка «проверьте»", async () => {
  const goods: { name: string; characteristics: string; quantity: string; registryNumber?: string; registryRejected?: boolean }[] = [
    { name: "Кресло", characteristics: "x", quantity: "1", registryNumber: "00005001" },
    { name: "Стол", characteristics: "y", quantity: "1", registryNumber: "00005002" },
  ];
  await rejectUnknownRegistryNumbers(goods, async () => new Set(["00005002"]));
  assert.equal(goods[0].registryNumber, undefined);
  assert.equal(goods[0].registryRejected, true);
  assert.equal(goods[1].registryNumber, "00005002");
  const text = await textOf(await docx(goods));
  assert.ok(text.includes("проверьте — записи нет среди действующих"));
  assert.ok(text.includes(registryLine("00005002")));
  assert.equal(text.includes("00005001"), false, "снятый номер в файле не остался");
});

test("проверить нельзя (нет базы) — номер не трогаем: решает проверка на стороне браузера", async () => {
  const goods = [{ name: "Кресло", characteristics: "x", quantity: "1", registryNumber: "00005001" }];
  await rejectUnknownRegistryNumbers(goods, async () => null);
  assert.equal(goods[0].registryNumber, "00005001");
});

test("запрос на файл: небезопасный номер отбрасывается, безопасный проходит", async () => {
  const bad = await fileFromRequest({ part: "tp", subject: "Т", form: FORM, goods: [{ name: "Кресло", characteristics: "x", quantity: "1", registryNumber: "<script>1" }] });
  assert.ok(bad.ok);
  const badText = await textOf(bad.buffer);
  assert.equal(badText.includes("script"), false);
  assert.equal(badText.includes("реестровой записи"), false);
});
