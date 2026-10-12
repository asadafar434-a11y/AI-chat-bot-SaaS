// Выбор записи участником, журнал и проверки перед подстановкой номера в заявку — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, cardHash, type CardEdits, type ProductCard } from "./product-card.ts";
import { fixtureRecord, seededStore } from "./registry-fixtures.ts";
import { EMPTY_REGISTRY_STATE, REGISTRY_LINE_LABEL, appendLog, autofillCheck, autofillSummary, cancelChoice, selectRecord } from "./registry-log.ts";
import { resolveCard } from "./registry-service.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const A = { enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "АЛЬФА"', inn: "9900000001" };

const card = (edits: CardEdits = {}, key = "1:k"): ProductCard =>
  applyEdits({ key, name: "Кресло офисное", quantity: "10 шт", source: "ТЗ", quote: "Кресло офисное", offeredName: null, fields: { okpd2: { value: "31.01.12.160", origin: "tz", source: "ТЗ" } } }, edits);

const decide = async (c: ProductCard, extra: ReturnType<typeof fixtureRecord>[] = []) => {
  const store = await seededStore([
    fixtureRecord({ registryNumber: "00002001", ...A, productName: "Кресло офисное тестовое КО-1" }),
    fixtureRecord({ registryNumber: "00002002", ...A, productName: "Кресло офисное тестовое КО-2" }),
    ...extra,
  ]);
  return resolveCard(store, c, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: NOW });
};

test("подтверждённая системой запись выбирается как auto_proven; в выборе сохранены выгрузка, рассмотренные кандидаты и основания", async () => {
  const c = card({ inn: "9900000001", model: "КО-1" });
  const d = await decide(c);
  const result = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "00002001", now: NOW });
  assert.ok(result.ok);
  const choice = result.choice;
  assert.equal(choice.basis, "auto_proven");
  assert.equal(choice.record.registryNumber, "00002001");
  assert.equal(choice.cardHash, cardHash(c));
  assert.ok(choice.dataset?.fileSha256, "известно, по какой выгрузке принято решение");
  assert.ok(choice.considered.length >= 1);
  assert.ok(choice.reasons.length > 0 && choice.assumptions.length > 0);
  assert.equal(result.state.log.at(-1)?.event, "select");
  assert.match(result.state.log.at(-1)!.text, /система доказала/);
});

test("выбор вручную среди нескольких отмечен как решение участника, а не как доказанное совпадение", async () => {
  const c = card({ inn: "9900000001" });
  const d = await decide(c);
  assert.equal(d.status, "choose");
  const result = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "00002002", note: "наша модель КО-2", now: NOW });
  assert.ok(result.ok);
  assert.equal(result.choice.basis, "user_selected");
  assert.equal(result.choice.note, "наша модель КО-2");
  assert.match(result.state.log.at(-1)!.text, /выбрал запись 00002002 сам/);
});

test("нельзя выбрать запись не из списка, неактуальную или противоречащую данным о товаре", async () => {
  const c = card({ inn: "9900000001", model: "КО-1" });
  const extra = [
    fixtureRecord({ registryNumber: "00002003", ...A, productName: "Кресло офисное тестовое КО-1", validUntil: "2026-01-01", validUntilMin: "2026-01-01" }),
    fixtureRecord({ registryNumber: "00002004", ...A, productName: "Кресло офисное тестовое КО-9", madeBy: "ТУ 11.11-111-11111111-2011" }),
  ];
  const d = await decide(c, extra);
  const stranger = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "99999999", now: NOW });
  assert.ok(!stranger.ok && /нет среди найденных/.test(stranger.reason));
  const expired = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "00002003", now: NOW });
  assert.ok(!expired.ok && /неактуальна/.test(expired.reason));
  const contradicting = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "00002002", now: NOW });
  assert.ok(!contradicting.ok, "запись с другой моделью выбрать нельзя");
});

const chosen = async (edits: CardEdits = { inn: "9900000001", model: "КО-1" }) => {
  const c = card(edits);
  const d = await decide(c);
  const r = selectRecord(EMPTY_REGISTRY_STATE, { card: c, decision: d, registryNumber: "00002001", now: NOW });
  assert.ok(r.ok);
  return { c, state: r.state, choice: r.choice };
};

test("15. без выбора и подтверждения номер в заявку не подставляется", async () => {
  const c = card({ inn: "9900000001", model: "КО-1" });
  const none = autofillCheck({ choice: undefined, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.deepEqual(none, { ok: false, reason: "Номер не выбран и не подтверждён участником" });
  const { choice } = await chosen();
  const unconfirmed = autofillCheck({ choice: { ...choice, confirmedAt: "" }, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(!unconfirmed.ok);
});

test("после выбора и при тех же сведениях о товаре номер подставляется строкой с названием реестра", async () => {
  const { c, choice } = await chosen();
  const ok = autofillCheck({ choice, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(ok.ok);
  assert.equal(ok.line, `${REGISTRY_LINE_LABEL}: 00002001`);
});

test("сведения о товаре изменились после выбора — номер не подставляется, нужен новый поиск", async () => {
  const { c, choice } = await chosen();
  const changed = applyEdits(c, { model: "КО-2" });
  const r = autofillCheck({ choice, card: changed, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(!r.ok && /изменились после выбора/.test(r.reason));
});

test("14. закупка требует другой реестр или реестр не определён — номер не подставляется", async () => {
  const { c, choice } = await chosen();
  assert.ok(!autofillCheck({ choice, card: c, requiredRegistry: null, asOf: "2026-11-20" }).ok);
  const other = autofillCheck({ choice: { ...choice, registryKind: "gisp_rpp_719" }, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(other.ok, "тот же реестр — подставляется");
});

test("срок записи вышел к дате подачи — номер не подставляется", async () => {
  const { c, choice } = await chosen();
  const late = autofillCheck({ choice: { ...choice, record: { ...choice.record, validUntil: "2026-11-01" } }, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(!late.ok && /Срок действия записи истёк/.test(late.reason));
});

test("выбор сделан по устаревшей выгрузке — номер не подставляется", async () => {
  const { c, choice } = await chosen();
  const stale = autofillCheck({ choice: { ...choice, datasetAgeDays: 90 }, card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" });
  assert.ok(!stale.ok && /устаревшей выгрузке/.test(stale.reason));
});

test("отмена выбора убирает его, журнал хранит и выбор, и отмену", async () => {
  const { c, state } = await chosen();
  const cancelled = cancelChoice(state, c.key, new Date("2026-10-12T10:00:00Z"));
  assert.equal(cancelled.choices[c.key], undefined);
  assert.deepEqual(cancelled.log.map((e) => e.event), ["select", "cancel"]);
  assert.ok(!autofillCheck({ choice: cancelled.choices[c.key], card: c, requiredRegistry: "gisp_rpp_719", asOf: "2026-11-20" }).ok);
});

test("17. требование есть, номер не выбран — позиция остаётся без номера и названа в списке пропущенных", async () => {
  const withChoice = await chosen();
  const second = card({}, "2:z");
  const summary = autofillSummary([withChoice.c, second], withChoice.state, "gisp_rpp_719", "2026-11-20");
  assert.equal(summary.lines.size, 1);
  assert.ok(summary.lines.has(withChoice.c.key));
  assert.equal(summary.skipped.length, 1);
  assert.equal(summary.skipped[0].key, "2:z");
  assert.match(summary.skipped[0].reason, /не выбран/);
});

test("16. два одинаковых наименования в разных строках получают каждое свой номер", async () => {
  const one = card({ inn: "9900000001", model: "КО-1" }, "1:same");
  const two = card({ inn: "9900000001", model: "КО-2" }, "2:same");
  const store = await seededStore([
    fixtureRecord({ registryNumber: "00002101", ...A, productName: "Кресло офисное тестовое КО-1" }),
    fixtureRecord({ registryNumber: "00002102", ...A, productName: "Кресло офисное тестовое КО-2" }),
  ]);
  let state = EMPTY_REGISTRY_STATE;
  for (const c of [one, two]) {
    const d = await resolveCard(store, c, { registry: "gisp_rpp_719", asOf: "2026-11-20", now: NOW });
    const r = selectRecord(state, { card: c, decision: d, registryNumber: d.proposed!, now: NOW });
    assert.ok(r.ok);
    state = r.state;
  }
  const summary = autofillSummary([one, two], state, "gisp_rpp_719", "2026-11-20");
  assert.match(summary.lines.get("1:same")!, /00002101$/);
  assert.match(summary.lines.get("2:same")!, /00002102$/);
});

test("журнал только дополняется и ограничен по длине", () => {
  let state = EMPTY_REGISTRY_STATE;
  for (let i = 0; i < 520; i++) state = appendLog(state, { at: "2026-10-12T00:00:00Z", positionKey: "k", event: "search", text: `поиск ${i}` });
  assert.equal(state.log.length, 500);
  assert.equal(state.log.at(-1)!.text, "поиск 519");
  assert.equal(EMPTY_REGISTRY_STATE.log.length, 0, "исходное состояние не изменилось");
});
