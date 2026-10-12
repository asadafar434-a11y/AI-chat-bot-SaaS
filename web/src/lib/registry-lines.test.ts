// Реестровый номер вместо кода ОКПД в товарах ТП: на экране, в проверке полей и в файлах — npm test.
// Строки взяты из настоящего ТП, которое ИИ составил по извещению запроса котировок (шапки, перчатки, бейсболки).
import assert from "node:assert/strict";
import { test } from "node:test";
import { completeness, fieldsOf } from "./fields.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import { applyEdits } from "./product-card.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { REGISTRY_CHECK, REGISTRY_NEEDED, characteristicsWithRegistry, goodsWithRegistry, isOriginRow } from "./registry-lines.ts";
import { EMPTY_REGISTRY_STATE, selectRecord } from "./registry-log.ts";
import { registryCardsOf, registryView } from "./registry-fill.ts";
import { resolveCard } from "./registry-service.ts";
import { registryLine, scoreText } from "./registry-types.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM } from "./tp.ts";

const HAT = "Пол: мужская\nСостав материала: Шерсть [число, не меньше 30] %\nМатериал подкладки: флис\nСезон: зима\nразмер 58 - 50 штук\nразмер 60 - [число, не меньше 30] штук\nцветовая гамма: темных оттенков\nОКПД: 14.19.42.140";
const GLOVES = "Сезон: Зима\nВязаные, утепленные, двуслойные, манжета на резинке\nМатериал подкладки: искусственный мех\nЦвет: Черный, серый\nРазмер: универсальный\nОКПД2: 14.19.23.140";
const CAP = "Пол: мужской\nСостав материала: шерсть, полиэстер\nСезон: зима\nМатериал подкладки: флис\nразмер 56-60\nЦвет товара: темные оттенки\nДекоративные элементы: ушки\nОКПД: 14.19.42.141";
const ORIGIN = "Страна происхождения товара: Россия\nНомер реестровой записи из реестра российской промышленной продукции: [номер реестровой записи — если товар относится к позициям приложений № 2, № 3 к постановлению Правительства РФ № 1875]";

const good = (name: string, characteristics: string, quantity: string, extra: Record<string, unknown> = {}) => ({ name, characteristics, quantity, source: "ТЗ", quote: name, verified: true, ...extra });
const GOODS = [good("Шапка мужская зимняя", HAT, "80 штук"), good("Перчатки мужские зимние", GLOVES, "80 пар"), good("Бейсболка теплая с ушками", CAP, "15 штук"), good("Страна происхождения – Россия", ORIGIN, "")];

test("строка ОКПД заменяется номером на том же месте; остальные характеристики не тронуты", () => {
  const out = characteristicsWithRegistry({ name: "Шапка", characteristics: HAT, quantity: "80", registryNumber: "10548914" });
  const lines = out.split("\n");
  assert.equal(lines.at(-1), registryLine("10548914"));
  assert.equal(lines.length, HAT.split("\n").length, "одна строка заменена другой");
  assert.equal(out.includes("ОКПД"), false);
  assert.ok(out.includes("Состав материала: Шерсть [число, не меньше 30] %"));
  assert.ok(out.includes("размер 60 - [число, не меньше 30] штук"));
});

test("«ОКПД2:», «ОКПД 2 –» и «ОКПД:» узнаются; лишние строки с кодом убираются", () => {
  for (const line of ["ОКПД2: 14.19.23.140", "ОКПД 2 – 14.19.23.140", "ОКПД: 14.19.23.140", "окпд2 14.19.23"]) {
    const out = characteristicsWithRegistry({ name: "x", characteristics: `Цвет: чёрный\n${line}\nРазмер: 56`, quantity: "1", registryNumber: "10658237" });
    assert.equal(out, `Цвет: чёрный\n${registryLine("10658237")}\nРазмер: 56`, line);
  }
  const twice = characteristicsWithRegistry({ name: "x", characteristics: "ОКПД: 14.19.42.140\nЦвет: чёрный\nОКПД2: 14.19.42.140", quantity: "1", registryNumber: "10658237" });
  assert.equal(twice, `${registryLine("10658237")}\nЦвет: чёрный`);
});

test("ОКПД не нужен совсем: без номера строка убирается, а если реестр требуется — на её месте жёлтое поле «впишите номер»", () => {
  const plain = characteristicsWithRegistry({ name: "x", characteristics: GLOVES, quantity: "1" });
  assert.equal(plain.includes("ОКПД"), false);
  assert.equal(plain.includes(REGISTRY_NEEDED), false, "реестр не требуется — поля нет");
  const needed = characteristicsWithRegistry({ name: "x", characteristics: GLOVES, quantity: "1", registryNeeded: true });
  assert.equal(needed.split("\n").at(-1), REGISTRY_NEEDED);
  assert.equal(needed.includes("ОКПД"), false);
});

test("запись снята с реестра — вместо номера пометка «проверьте»; номер не остаётся", () => {
  const out = characteristicsWithRegistry({ name: "x", characteristics: CAP, quantity: "1", registryRejected: true });
  assert.equal(out.split("\n").at(-1), REGISTRY_CHECK);
  assert.equal(out.includes("10816620"), false);
});

test("нет строки ОКПД — номер дописывается; упоминание ОКПД внутри другой фразы не трогается", () => {
  const out = characteristicsWithRegistry({ name: "x", characteristics: "Цвет: чёрный\nКод ОКПД2 указан в приложении к ТЗ", quantity: "1", registryNumber: "10658237" });
  assert.equal(out, `Цвет: чёрный\nКод ОКПД2 указан в приложении к ТЗ\n${registryLine("10658237")}`);
});

test("строка «Страна происхождения» — не товар", () => {
  assert.equal(isOriginRow({ name: "Страна происхождения – Россия", quantity: "" }), true);
  assert.equal(isOriginRow({ name: "Страна происхождения – Россия", quantity: "5 шт" }), false);
  assert.equal(isOriginRow({ name: "Шапка мужская", quantity: "" }), false);
  assert.equal(registryCardsOf({ tp: { goods: GOODS } }, []).length, 3, "карточки только у трёх товаров, ключи — по месту в ТП");
});

test("поле под номер в строке про происхождение заполняется номерами по позициям; не все выбраны — остальное остаётся жёлтым", () => {
  const all = goodsWithRegistry(GOODS.map((g, i) => ({ ...g, ...(i < 3 && { registryNumber: ["10548914", "10658237", "10816620"][i] }) })));
  const origin = all[3].characteristics;
  assert.ok(origin.includes("Шапка мужская зимняя — 10548914; Перчатки мужские зимние — 10658237; Бейсболка теплая с ушками — 10816620"));
  assert.equal(origin.includes("[номер реестровой записи"), false, "жёлтого поля не осталось");
  assert.ok(origin.startsWith("Страна происхождения товара: Россия"));

  const some = goodsWithRegistry(GOODS.map((g, i) => ({ ...g, ...(i === 0 && { registryNumber: "10548914" }) })))[3].characteristics;
  assert.ok(some.includes("Шапка мужская зимняя — 10548914"));
  assert.ok(some.includes("[номер реестровой записи — ещё для: Перчатки мужские зимние, Бейсболка теплая с ушками]"));

  const none = goodsWithRegistry(GOODS)[3].characteristics;
  assert.equal(none, ORIGIN, "номеров нет — строка как была");
});

const purchaseOf = (registry: unknown) => ({
  id: "p1",
  createdAt: "2026-10-01T00:00:00.000Z",
  short: "Шапки",
  subject: "Поставка шапок",
  kind: "223-ФЗ · запрос котировок",
  customer: "Заказчик",
  price: "100 000 ₽",
  files: [] as string[],
  unreadable: [] as never[],
  requirements: { who: [], submit: [], scope: [], terms: [] },
  tp: { form: { ...PLAIN_FORM, goodsTableHeaders: [] as string[] }, goods: GOODS, items: [], antiDumping: NO_ANTI_DUMPING },
  tpDraft: { form: { ...PLAIN_FORM, goodsTableHeaders: [] as string[] }, goods: GOODS, items: [], antiDumping: NO_ANTI_DUMPING },
  registry: registry as never,
  deadline: { date: "2026-11-20" },
});
const DOCS = [{ name: "Извещение.docx", text: "Товар должен быть включён в реестр российской промышленной продукции, номер реестровой записи указывается в заявке." }];

test("вид для экрана: товары без ОКПД, у выбранных — номер; черновик ИИ — с полем на месте номера", async () => {
  const base = purchaseOf(EMPTY_REGISTRY_STATE);
  const [first] = registryCardsOf(base, DOCS);
  const card = applyEdits(first, { inn: "9900000001", model: "КО-1" });
  const store = await seededStore([fixtureRecord({ registryNumber: "00006001", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001", productName: "Шапка мужская зимняя КО-1", okpd2: "14.19.42.140" })]);
  const decision = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: new Date("2026-10-12T09:00:00Z") });
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: decision.proposed!, now: new Date("2026-10-12T09:00:00Z") });
  assert.ok(picked.ok);
  const purchase = purchaseOf({ ...picked.state, cards: { [first.key]: { inn: "9900000001", model: "КО-1" } } });
  const view = registryView(purchase, DOCS, new Date("2026-10-12T09:00:00Z"))!;
  assert.deepEqual([...view.numbers.entries()], [[0, "00006001"]]);
  assert.equal(view.needed, true);
  assert.ok(view.tp.goods[0].characteristics.endsWith(registryLine("00006001")));
  assert.ok(view.tp.goods[1].characteristics.endsWith(REGISTRY_NEEDED), "у позиции без выбора — жёлтое поле вместо ОКПД");
  assert.ok(view.tpDraft!.goods[0].characteristics.endsWith(REGISTRY_NEEDED), "в черновике на месте номера — поле");
  for (const g of [...view.tp.goods, ...view.tpDraft!.goods]) assert.equal(g.characteristics.includes("ОКПД"), false);
  assert.equal("registryNumber" in view.tp.goods[0], false, "служебные поля наружу не идут");
  assert.equal(view.tp.goods[3].name, "Страна происхождения – Россия");
});

test("проверка полей: выбранный номер закрывает своё место, остальные позиции просят номер; числа в характеристиках по-прежнему считаются", async () => {
  const profile = EMPTY_PROFILE;
  const base = purchaseOf(EMPTY_REGISTRY_STATE);
  const before = fieldsOf({ purchase: base as never, profile, evidence: { experience: 0, staff: 0 } });
  const openBefore = before.filter((f) => f.status === "needs_input").map((f) => f.label);
  assert.ok(openBefore.some((l) => /номер реестровой записи/.test(l)), "до выбора поле про номер открыто");

  const [first] = registryCardsOf(base, DOCS);
  const card = applyEdits(first, { inn: "9900000001", model: "КО-1" });
  const store = await seededStore([fixtureRecord({ registryNumber: "00006001", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001", productName: "Шапка мужская зимняя КО-1", okpd2: "14.19.42.140" })]);
  const decision = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: new Date("2026-10-12T09:00:00Z") });
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: decision.proposed!, now: new Date("2026-10-12T09:00:00Z") });
  assert.ok(picked.ok);
  const purchase = purchaseOf({ ...picked.state, cards: { [first.key]: { inn: "9900000001", model: "КО-1" } } });
  const view = registryView(purchase, DOCS, new Date("2026-10-12T09:00:00Z"))!;
  const shown = { ...purchase, tp: view.tp, tpDraft: view.tpDraft };
  const after = fieldsOf({ purchase: shown as never, profile, evidence: { experience: 0, staff: 0 } });
  const filled = after.filter((f) => f.status === "filled" && /номер реестровой записи/.test(f.label));
  assert.ok(filled.length >= 1, "место под номер у шапки заполнено участником");
  const stillOpen = after.filter((f) => f.status === "needs_input" && /номер реестровой записи/.test(f.label));
  assert.ok(stillOpen.length >= 2, "у перчаток и бейсболки номер ещё нужно выбрать");
  assert.ok(after.some((f) => f.status === "needs_input" && /число, не меньше 30/.test(f.label)), "поля с числами из ТЗ остались — подмена их не сломала");
  void completeness;
});

test("баллы и процентный показатель: показываются, если есть в записи; процент — из доли; нет — ничего не выдумывается", async () => {
  assert.equal(scoreText(135, 0.81), "баллы: 135 · процентный показатель: 81 %");
  assert.equal(scoreText(90, null), "баллы: 90");
  assert.equal(scoreText(null, 0.8208), "процентный показатель: 82,08 %");
  assert.equal(scoreText(null, 1), "процентный показатель: 100 %");
  assert.equal(scoreText(null, null), null);
  assert.equal(scoreText(undefined, undefined), null);
  assert.equal(scoreText(0, 0), "баллы: 0 · процентный показатель: 0 %", "ноль — это значение, а не «нет данных»");

  const store = await seededStore([
    fixtureRecord({ registryNumber: "00007001", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001", productName: "Шапка мужская зимняя КО-1", points: 135, percent: 0.81, conformity: "Соответствует (тест)" }),
    fixtureRecord({ registryNumber: "00007002", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001", productName: "Шапка мужская зимняя КО-2" }),
  ]);
  const [first] = registryCardsOf(purchaseOf(EMPTY_REGISTRY_STATE), DOCS);
  const card = applyEdits(first, { inn: "9900000001" });
  const decision = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: new Date("2026-10-12T09:00:00Z") });
  const withScore = decision.candidates.find((c) => c.registryNumber === "00007001")!;
  const without = decision.candidates.find((c) => c.registryNumber === "00007002")!;
  assert.equal(withScore.points, 135);
  assert.equal(withScore.percent, 0.81);
  assert.equal(withScore.conformity, "Соответствует (тест)");
  assert.equal(without.points, null);
  assert.equal(without.percent, null);
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: "00007001", now: new Date("2026-10-12T09:00:00Z") });
  assert.ok(picked.ok);
  assert.equal(picked.choice.record.points, 135, "баллы сохранены в решении");
  assert.equal(picked.choice.record.percent, 0.81);
});
