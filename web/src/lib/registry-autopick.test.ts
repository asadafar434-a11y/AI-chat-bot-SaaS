// Автоматический подбор номера: несколько вариантов или неполное совпадение → лучший номер подставляется сам и помечается «ПРОВЕРЬТЕ»;
// участник выбирает верный из списка или подтверждает — npm test. Решение владельца 13.10.2026. Данные выдуманные.
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { completeness, fieldsOf } from "./fields.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import { applyEdits, cardHash, type ProductCard } from "./product-card.ts";
import { registryCardsOf, registryFillFor, registryNumbersFor, registryUnverifiedFor, registryView } from "./registry-fill.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { goodsWithRegistry } from "./registry-lines.ts";
import { EMPTY_REGISTRY_STATE, autoPick, autofillCheck, cancelChoice, optionsOf, selectRecord, type RegistryState } from "./registry-log.ts";
import { resolveCard } from "./registry-service.ts";
import { registryLine, registryLineUnverified, registryUnverifiedField } from "./registry-types.ts";
import { fileFromRequest } from "./tp-docx-request.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM } from "./tp.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const AS_OF = "2026-11-20";
const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };

const good = (name: string, characteristics: string, quantity: string) => ({ name, characteristics, quantity, source: "ТЗ", quote: name, verified: true });
const ORIGIN = "Страна происхождения товара: Россия\nНомер реестровой записи из реестра российской промышленной продукции: [номер реестровой записи — если товар относится к позициям приложений № 2, № 3 к постановлению Правительства РФ № 1875]";
const GOODS = [good("Куртка мужская", "Размер: [указать]\nОКПД2: 14.13.11.110", "10 штук"), good("Страна происхождения – Россия", ORIGIN, "")];
const DOCS = [{ name: "Извещение.docx", text: "Товар должен быть включён в реестр российской промышленной продукции, номер реестровой записи указывается в заявке." }];

const purchaseOf = (registry: RegistryState) => ({
  id: "p1",
  createdAt: "2026-10-01T00:00:00.000Z",
  short: "Куртки",
  subject: "Поставка курток",
  kind: "223-ФЗ · запрос котировок",
  customer: "Заказчик",
  price: "100 000 ₽",
  files: [] as string[],
  unreadable: [] as never[],
  requirements: { who: [], submit: [], scope: [], terms: [] },
  tp: { form: { ...PLAIN_FORM, goodsTableHeaders: [] as string[] }, goods: GOODS, items: [], antiDumping: NO_ANTI_DUMPING },
  tpDraft: { form: { ...PLAIN_FORM, goodsTableHeaders: [] as string[] }, goods: GOODS, items: [], antiDumping: NO_ANTI_DUMPING },
  registry,
  deadline: { date: AS_OF },
});

// Куртка мужская: у разных производителей много записей, у участника известна только категория — «неполное совпадение».
const JACKETS = [
  fixtureRecord({ registryNumber: "00009001", ...A, productName: "Куртка мужская зимняя Север", okpd2: "14.13.11.110" }),
  fixtureRecord({ registryNumber: "00009002", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "БЕТА"', inn: "9900000002", productName: "Куртка мужская демисезонная", okpd2: "14.13.11.110" }),
  fixtureRecord({ registryNumber: "00009003", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "ГАММА"', inn: "9900000003", productName: "Куртка мужская рабочая", okpd2: "14.13.11.110" }),
];

async function searched(edits: Parameters<typeof applyEdits>[1] = {}, records = JACKETS) {
  const [first] = registryCardsOf(purchaseOf(EMPTY_REGISTRY_STATE), DOCS);
  const card: ProductCard = applyEdits(first, edits);
  const store = await seededStore(records);
  const decision = await resolveCard(store, card, { registry: "gisp_rpp_719", asOf: AS_OF, now: NOW });
  return { card, decision, first };
}

test("несколько вариантов и неполное совпадение: лучший номер подставляется сам, помечается «проверьте» и ждёт подтверждения", async () => {
  const { card, decision } = await searched();
  assert.notEqual(decision.status, "confirmed", "по одному названию товар не доказан");
  assert.ok(optionsOf(decision).length >= 3, "вариантов несколько");
  const state = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const choice = state.choices[card.key];
  assert.ok(choice, "номер подставлен");
  assert.equal(choice.basis, "auto_picked");
  assert.equal(choice.confirmedAt, "", "человек его ещё не подтвердил");
  assert.equal(choice.options, optionsOf(decision).length);
  assert.equal(choice.registryNumber, optionsOf(decision)[0].registryNumber, "лучший по совпадению");
  assert.equal(state.log.at(-1)?.event, "autopick");
  assert.match(state.log.at(-1)!.text, /подобран автоматически.*ждёт проверки/);
});

test("если система доказала одну запись, подбирается именно она, даже когда она не первая в списке", async () => {
  const { card, decision } = await searched({ inn: "9900000003", model: "рабочая" });
  assert.ok(decision.proposed || decision.candidates.length > 0);
  const state = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const choice = state.choices[card.key];
  assert.ok(choice);
  if (decision.proposed) assert.equal(choice.registryNumber, decision.proposed);
  assert.equal(choice.basis, "auto_picked", "и она тоже ждёт проверки человека");
});

test("повторный подбор по тем же данным ничего не меняет и не множит записи в журнале", async () => {
  const { card, decision } = await searched();
  const once = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const twice = autoPick(once, { card, decision, now: NOW });
  assert.equal(twice, once, "то же состояние, тот же объект");
  assert.equal(twice.log.length, 1);
});

test("выбор человека автоподбор не трогает, пока сведения о товаре те же; если данные о товаре изменились — подбор заново", async () => {
  const { card, decision } = await searched();
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: "00009002", now: NOW });
  assert.ok(picked.ok);
  assert.equal(autoPick(picked.state, { card, decision, now: NOW }), picked.state, "выбор участника остаётся");
  const edited = applyEdits(card, { model: "Север" });
  assert.notEqual(cardHash(edited), cardHash(card));
  const again = autoPick(picked.state, { card: edited, decision, now: NOW });
  assert.equal(again.choices[card.key].basis, "auto_picked", "старое подтверждение относилось к другим данным");
});

test("подходящих записей нет — номер не подставляется; ранее подобранный, которого больше нет среди вариантов, убирается", async () => {
  const { card, decision } = await searched();
  const state = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const none = { ...decision, candidates: decision.candidates.map((c) => ({ ...c, blocked: true })), proposed: null };
  assert.equal(autoPick(EMPTY_REGISTRY_STATE, { card, decision: none, now: NOW }), EMPTY_REGISTRY_STATE);
  const cleared = autoPick(state, { card, decision: none, now: NOW });
  assert.equal(cleared.choices[card.key], undefined);
  assert.equal(cleared.log.at(-1)?.event, "skip");
});

test("в заявку идёт номер в скобках со словом «ПРОВЕРЬТЕ»; чужой реестр, устаревшая выгрузка и изменённые данные по-прежнему не пускают", async () => {
  const { card, decision } = await searched();
  const state = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const choice = state.choices[card.key];
  const ok = autofillCheck({ choice, card, requiredRegistry: "gisp_rpp_719", asOf: AS_OF });
  assert.ok(ok.ok && ok.unverified === true);
  assert.equal(ok.ok && ok.line, registryLineUnverified(choice.registryNumber, "gisp_rpp_719", choice.options));
  assert.match(ok.ok ? ok.line : "", /\[ПРОВЕРЬТЕ номер реестровой записи: \d{8} — подобран автоматически, вариантов: 3\]$/);
  assert.equal(autofillCheck({ choice, card, requiredRegistry: "gisp_rep_878", asOf: AS_OF }).ok, false);
  assert.equal(autofillCheck({ choice: { ...choice, datasetAgeDays: 99 }, card, requiredRegistry: "gisp_rpp_719", asOf: AS_OF }).ok, false);
  assert.equal(autofillCheck({ choice, card: applyEdits(card, { model: "X" }), requiredRegistry: "gisp_rpp_719", asOf: AS_OF }).ok, false);
  // Выбор без подтверждения и без пометки «подобран автоматически» по-прежнему не пускают.
  assert.equal(autofillCheck({ choice: { ...choice, basis: "user_selected" }, card, requiredRegistry: "gisp_rpp_719", asOf: AS_OF }).ok, false);
});

test("подтверждение или выбор другого номера из списка снимают пометку: номер без скобок и без «ПРОВЕРЬТЕ»", async () => {
  const { card, decision } = await searched();
  const auto = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const other = optionsOf(decision).find((v) => v.registryNumber !== auto.choices[card.key].registryNumber)!;
  const chosen = selectRecord(auto, { card, decision, registryNumber: other.registryNumber, now: NOW });
  assert.ok(chosen.ok);
  assert.equal(chosen.choice.registryNumber, other.registryNumber);
  assert.ok(chosen.choice.confirmedAt);
  const check = autofillCheck({ choice: chosen.choice, card, requiredRegistry: "gisp_rpp_719", asOf: AS_OF });
  assert.ok(check.ok && !check.unverified);
  assert.equal(check.ok && check.line, registryLine(other.registryNumber, "gisp_rpp_719"));
  // «Всё верно» — выбор того же самого номера.
  const same = selectRecord(auto, { card, decision, registryNumber: auto.choices[card.key].registryNumber, now: NOW });
  assert.ok(same.ok && same.choice.confirmedAt !== "");
});

test("в документе: номер на месте ОКПД, в скобках с «ПРОВЕРЬТЕ»; в строке про страну происхождения — тоже; в черновике ИИ — прежнее поле", async () => {
  const { card, decision, first } = await searched();
  const state = { ...autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW }), cards: {} };
  void first;
  const purchase = purchaseOf(state);
  const fill = registryFillFor(purchase, DOCS, NOW);
  assert.equal(fill.length, 1);
  assert.equal(fill[0].unverified, true);
  assert.deepEqual([...registryUnverifiedFor(purchase, DOCS, NOW).entries()], [[0, fill[0].options ?? 0]]);
  assert.equal(registryNumbersFor(purchase, DOCS, NOW).get(0), fill[0].number, "номер учтён в заявке");

  const view = registryView(purchase, DOCS, NOW)!;
  const field = registryUnverifiedField(fill[0].number, fill[0].options);
  assert.ok(view.tp.goods[0].characteristics.endsWith(`${registryLineUnverified(fill[0].number, "gisp_rpp_719", fill[0].options)}`));
  assert.equal(view.tp.goods[0].characteristics.includes("ОКПД"), false);
  assert.ok(view.tp.goods[1].characteristics.includes(`Куртка мужская зимняя — ${field}`) || view.tp.goods[1].characteristics.includes(`Куртка мужская — ${field}`), "в строке про страну происхождения — с пометкой");
  assert.ok(view.tpDraft!.goods[0].characteristics.includes("[номер реестровой записи"), "в черновике ИИ на месте номера — поле");
  for (const g of view.tp.goods) assert.equal("registryUnverified" in g, false, "служебные поля наружу не идут");
});

test("итоговая проверка: подобранный, но не проверенный номер остаётся «не заполнено»; после подтверждения — заполнено", async () => {
  const { card, decision } = await searched();
  const auto = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const check = (state: RegistryState) => {
    const purchase = purchaseOf(state);
    const view = registryView(purchase, DOCS, NOW)!;
    const fields = fieldsOf({ purchase: { ...purchase, tp: view.tp, tpDraft: view.tpDraft } as never, profile: EMPTY_PROFILE, evidence: { experience: 0, staff: 0 } });
    return fields.filter((f) => f.status === "needs_input" && /ПРОВЕРЬТЕ/.test(f.label));
  };
  assert.ok(check(auto).length >= 1, "пометка «ПРОВЕРЬТЕ» считается незаполненным местом");
  const confirmed = selectRecord(auto, { card, decision, registryNumber: auto.choices[card.key].registryNumber, now: NOW });
  assert.ok(confirmed.ok);
  assert.equal(check(confirmed.state).length, 0, "подтвердили — пометки нет");
  void completeness;
});

test("файл: номер, подобранный автоматически, стоит в скобках с «ПРОВЕРЬТЕ»; подтверждённый — как обычно; в столбце формы заказчика — тоже", async () => {
  const FORM = { title: "Заявка", source: "", participantFields: [], consent: "Согласие", hasPrice: false, priceNote: "", smeDeclaration: "", goodsTableHeaders: [] as string[] };
  const textOf = async (buffer: Buffer) => (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const unverified = await fileFromRequest({
    part: "tp", subject: "Т", form: FORM,
    goods: [{ name: "Куртка мужская", characteristics: "Размер: 50", quantity: "10", registryNumber: "00009001", registryKind: "gisp_rpp_719", registryUnverified: true, registryOptions: 3 }],
  });
  assert.ok(unverified.ok);
  const text = await textOf(unverified.buffer);
  assert.ok(text.includes("[ПРОВЕРЬТЕ номер реестровой записи: 00009001 — подобран автоматически, вариантов: 3]"));
  const sure = await fileFromRequest({ part: "tp", subject: "Т", form: FORM, goods: [{ name: "Куртка мужская", characteristics: "Размер: 50", quantity: "10", registryNumber: "00009001", registryKind: "gisp_rpp_719" }] });
  assert.ok(sure.ok);
  const sureText = await textOf(sure.buffer);
  assert.ok(sureText.includes(registryLine("00009001")) && !sureText.includes("ПРОВЕРЬТЕ"));
  const column = await fileFromRequest({
    part: "tp", subject: "Т", form: { ...FORM, goodsTableHeaders: ["№ п/п", "Наименование товара", "Предложение участника", "Номер реестровой записи"] },
    goods: [{ name: "Куртка мужская", characteristics: "Размер: 50", quantity: "10", registryNumber: "00009001", registryUnverified: true }],
  });
  assert.ok(column.ok);
  assert.ok((await textOf(column.buffer)).includes("[ПРОВЕРЬТЕ номер реестровой записи: 00009001 — подобран автоматически]"));
  // Мусор в признаке не проходит: только настоящее true.
  const junk = await fileFromRequest({ part: "tp", subject: "Т", form: FORM, goods: [{ name: "Куртка", characteristics: "x", quantity: "1", registryNumber: "00009001", registryUnverified: "yes", registryOptions: -5 }] });
  assert.ok(junk.ok);
  assert.equal((await textOf(junk.buffer)).includes("ПРОВЕРЬТЕ"), false);
});

test("строка про страну происхождения: неподтверждённые номера в скобках, подтверждённые — как были", () => {
  const out = goodsWithRegistry([
    { name: "Куртка", characteristics: "x", quantity: "1", registryNumber: "00009001", registryUnverified: true, registryOptions: 2 },
    { name: "Брюки", characteristics: "y", quantity: "1", registryNumber: "00009002" },
    { name: "Страна происхождения – Россия", characteristics: ORIGIN, quantity: "" },
  ]);
  assert.ok(out[2].characteristics.includes("Куртка — [ПРОВЕРЬТЕ номер реестровой записи: 00009001 — подобран автоматически, вариантов: 2]; Брюки — 00009002"));
});

test("«Нет в реестре»: отказ запоминается — автоподбор не подставляет номер снова, пока данные о товаре те же; выбор в списке отказ снимает", async () => {
  const { card, decision } = await searched();
  const auto = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW });
  const declined = cancelChoice(auto, card.key, NOW);
  assert.equal(declined.choices[card.key], undefined, "номер убран");
  assert.equal(declined.skipped?.[card.key], cardHash(card), "отказ запомнен");
  // Снова пришли результаты поиска (например, при следующем заходе на шаг) — номер не возвращается.
  assert.equal(autoPick(declined, { card, decision, now: NOW }), declined);
  assert.equal(registryFillFor(purchaseOf(declined), DOCS, NOW).length, 0, "в документе номера нет");
  // Данные о товаре изменились — это уже другой товар, подбор идёт заново.
  const edited = applyEdits(card, { model: "Север" });
  assert.equal(autoPick(declined, { card: edited, decision, now: NOW }).choices[card.key]?.basis, "auto_picked");
  // Участник сам выбрал номер — отказ снят.
  const picked = selectRecord(declined, { card, decision, registryNumber: optionsOf(decision)[0].registryNumber, now: NOW });
  assert.ok(picked.ok);
  assert.equal(picked.state.skipped?.[card.key], undefined);
  assert.ok(picked.state.choices[card.key].confirmedAt);
});

test("отмена выбора человека тоже запоминается: после перезагрузки страницы номер сам не возвращается", async () => {
  const { card, decision } = await searched();
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: "00009002", now: NOW });
  assert.ok(picked.ok);
  const cancelled = cancelChoice(picked.state, card.key, NOW);
  assert.equal(autoPick(cancelled, { card, decision, now: NOW }), cancelled);
});

test("закупка про номер не говорит: слабое совпадение сам не подставляется, доказанная запись — подставляется; требование есть — как раньше", async () => {
  const weak = await searched();
  assert.notEqual(weak.decision.status, "confirmed");
  assert.equal(weak.decision.proposed, null);
  assert.ok(optionsOf(weak.decision).length >= 3, "варианты остаются списком на выбор");
  // Требование есть — подставляется, как раньше.
  assert.ok(autoPick(EMPTY_REGISTRY_STATE, { card: weak.card, decision: weak.decision, now: NOW, demanded: true }).choices[weak.card.key]);
  // Требования нет — номер сам не ставится, в журнале ничего не появляется.
  const none = autoPick(EMPTY_REGISTRY_STATE, { card: weak.card, decision: weak.decision, now: NOW, demanded: false });
  assert.equal(none.choices[weak.card.key], undefined);
  assert.equal(none, EMPTY_REGISTRY_STATE);

  // Запись доказана: ИНН и известный участнику номер совпали — подставляется и без требования.
  const proven = await searched({ inn: "9900000001", registryNumber: "00009001" });
  assert.equal(proven.decision.status, "confirmed");
  const picked = autoPick(EMPTY_REGISTRY_STATE, { card: proven.card, decision: proven.decision, now: NOW, demanded: false });
  assert.equal(picked.choices[proven.card.key]?.registryNumber, "00009001");
});

test("требования нет: прежний слабый автоподбор снимается, а выбор человека остаётся", async () => {
  const { card, decision } = await searched();
  const auto = autoPick(EMPTY_REGISTRY_STATE, { card, decision, now: NOW, demanded: true });
  assert.ok(auto.choices[card.key]);
  const cleared = autoPick(auto, { card, decision, now: NOW, demanded: false });
  assert.equal(cleared.choices[card.key], undefined, "неподтверждённый номер снят");
  assert.match(cleared.log.at(-1)!.text, /закупка про номер не говорит, а совпадение не доказано/);
  // Человек выбрал номер сам — повторный поиск без требования его не трогает.
  const chosen = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: "00009002", now: NOW });
  assert.ok(chosen.ok);
  assert.equal(autoPick(chosen.state, { card, decision, now: NOW, demanded: false }), chosen.state);
});
