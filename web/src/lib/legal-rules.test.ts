// Версионируемая база законодательства — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allRules,
  ruleApplies,
  ruleVersionAt,
  rulesAt,
  type LegalRule,
} from "./legal-rules.ts";

// ——— ruleApplies ——————————————————————————————————————————————————————————————

test("ruleApplies: дата до начала действия → false", () => {
  assert.equal(
    ruleApplies({ effectiveFrom: "2022-01-01", effectiveTo: null }, "2021-12-31"),
    false,
  );
});

test("ruleApplies: дата в день начала действия → true", () => {
  assert.equal(
    ruleApplies({ effectiveFrom: "2022-01-01", effectiveTo: null }, "2022-01-01"),
    true,
  );
});

test("ruleApplies: дата после окончания → false", () => {
  assert.equal(
    ruleApplies({ effectiveFrom: "2014-01-01", effectiveTo: "2021-12-31" }, "2022-01-01"),
    false,
  );
});

test("ruleApplies: дата в день окончания → true", () => {
  assert.equal(
    ruleApplies({ effectiveFrom: "2014-01-01", effectiveTo: "2021-12-31" }, "2021-12-31"),
    true,
  );
});

test("ruleApplies: effectiveTo = null, далёкая будущая дата → true", () => {
  assert.equal(
    ruleApplies({ effectiveFrom: "2022-01-01", effectiveTo: null }, "2035-06-15"),
    true,
  );
});

// ——— rulesAt: 44-ФЗ документы ———————————————————————————————————————————————

test("rulesAt: закупка до 2022 → редакция v1 документов участника", () => {
  const rules = rulesAt("2021-06-01", "44-ФЗ", "participant_documents");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "44-docs-v1");
  assert.equal(rules[0]!.version, 1);
});

test("rulesAt: закупка после 2022 → редакция v2 документов участника", () => {
  const rules = rulesAt("2022-06-01", "44-ФЗ", "participant_documents");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "44-docs-v2");
  assert.ok(rules[0]!.text.includes("оператором площадки автоматически"));
});

test("rulesAt: граница — 31.12.2021 → v1, 01.01.2022 → v2 (документы)", () => {
  const before = rulesAt("2021-12-31", "44-ФЗ", "participant_documents");
  const after = rulesAt("2022-01-01", "44-ФЗ", "participant_documents");
  assert.equal(before[0]!.id, "44-docs-v1");
  assert.equal(after[0]!.id, "44-docs-v2");
});

// ——— rulesAt: 44-ФЗ электронная форма ——————————————————————————————————————

test("rulesAt: электронная подача до 2022 → только аукцион (v1)", () => {
  const rules = rulesAt("2020-01-01", "44-ФЗ", "electronic_submission");
  assert.equal(rules.length, 1);
  assert.ok(rules[0]!.methods?.includes("auction"));
  assert.equal(rules[0]!.id, "44-electronic-v1");
});

test("rulesAt: электронная подача после 2022 → все способы (v2, methods undefined)", () => {
  const rules = rulesAt("2023-03-01", "44-ФЗ", "electronic_submission");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "44-electronic-v2");
  assert.equal(rules[0]!.methods, undefined);
});

// ——— rulesAt: 44-ФЗ обеспечение заявки ─────────────────────────────────────

test("rulesAt: обеспечение до 2022 → v1, банковская гарантия", () => {
  const rules = rulesAt("2019-01-01", "44-ФЗ", "security_deposit");
  assert.equal(rules.length, 1);
  assert.ok(rules[0]!.text.includes("банковской гарантией"));
});

test("rulesAt: обеспечение после 2022 → v2, спецсчёт", () => {
  const rules = rulesAt("2022-09-01", "44-ФЗ", "security_deposit");
  assert.equal(rules.length, 1);
  assert.ok(rules[0]!.text.includes("спецсчёт"));
});

// ——— rulesAt: несколько правил за период ─────────────────────────────────────

test("rulesAt: без фильтра закона — возвращает правила обоих законов", () => {
  const rules = rulesAt("2023-01-01");
  const laws = new Set(rules.map((r) => r.law));
  assert.ok(laws.has("44-ФЗ"));
  assert.ok(laws.has("223-ФЗ"));
});

test("rulesAt: исторический запрос не включает правила будущих редакций", () => {
  const rules = rulesAt("2015-01-01", "44-ФЗ");
  for (const r of rules) {
    assert.ok(r.effectiveFrom <= "2015-01-01", `правило ${r.id} не должно применяться в 2015`);
  }
});

// ——— rulesAt: 223-ФЗ электронная форма ─────────────────────────────────────

test("rulesAt: 223-ФЗ электронная подача до 2018 → v1 (по усмотрению)", () => {
  const rules = rulesAt("2016-01-01", "223-ФЗ", "electronic_submission");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "223-electronic-v1");
});

test("rulesAt: 223-ФЗ электронная подача после 2018 → v2 (МСП обязательно)", () => {
  const rules = rulesAt("2020-06-01", "223-ФЗ", "electronic_submission");
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "223-electronic-v2");
});

// ——— ruleVersionAt ───────────────────────────────────────────────────────────

test("ruleVersionAt: до 2022 → версия 1 документов", () => {
  const r = ruleVersionAt("44-docs", "2021-01-01");
  assert.ok(r !== null);
  assert.equal(r!.version, 1);
});

test("ruleVersionAt: после 2022 → версия 2 документов", () => {
  const r = ruleVersionAt("44-docs", "2022-06-01");
  assert.ok(r !== null);
  assert.equal(r!.version, 2);
  assert.equal(r!.amendment, "ФЗ-360 от 02.07.2021");
});

test("ruleVersionAt: несуществующий базовый id → null", () => {
  assert.equal(ruleVersionAt("44-nonexistent", "2022-01-01"), null);
});

test("ruleVersionAt: дата до первой редакции → null", () => {
  assert.equal(ruleVersionAt("44-docs", "2010-01-01"), null);
});

test("ruleVersionAt: антидемпинг — единственная редакция на любую дату после 2014", () => {
  const r = ruleVersionAt("44-antidump", "2024-01-01");
  assert.ok(r !== null);
  assert.equal(r!.version, 1);
  assert.equal(r!.effectiveTo, null);
});

// ——— проверка целостности базы ───────────────────────────────────────────────

test("каждое правило имеет уникальный id", () => {
  const ids = allRules().map((r) => r.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test("правила одной группы не пересекаются по датам", () => {
  const groups = ["44-docs", "44-electronic", "44-deposit", "44-rejection", "223-electronic"];
  for (const base of groups) {
    // на стыке должна быть ровно одна редакция, а не две
    const at2021 = rulesAt("2021-12-31").filter((r) => r.id.startsWith(base + "-v")).length;
    const at2022 = rulesAt("2022-01-01").filter((r) => r.id.startsWith(base + "-v")).length;
    assert.ok(at2021 <= 1, `перекрытие редакций ${base} на 2021-12-31`);
    assert.ok(at2022 <= 1, `перекрытие редакций ${base} на 2022-01-01`);
  }
});
