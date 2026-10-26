import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { medicalModule } from "./flow.ts";
import { ev, medicalInput, noAdditionalCosts, validMedicalInput } from "./fixtures.ts";

test("медицинский модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(medicalModule), []);
});

test("полный комплект проходит все этапы и готовит заявку", () => {
  const result = runFlow(medicalModule, validMedicalInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
  assert.equal(result.visited.includes("check.law"), true);
  assert.equal(result.visited.includes("check.product_kind"), true);
  assert.equal(result.visited.includes("check.deadline"), true);
  assert.equal(result.visited.includes("check.registration"), true);
  assert.equal(result.visited.includes("check.device_registry"), true);
  assert.equal(result.visited.includes("calc.price"), true);
  assert.equal(result.visited.includes("score.risk"), true);
  assert.equal(result.visited.includes("generate.application"), true);
  assert.equal(result.trace.every((step) => step.status === "ok"), true);
  assert.equal(
    result.findings.every((finding) => Boolean(finding.law && finding.article && finding.effectiveFrom && finding.source && finding.ruleStatus)),
    true
  );
});

test("без подтверждённого РУ поток просит ввод", () => {
  const result = runFlow(medicalModule, medicalInput({}, { registrationCertificate: null }));
  const finding = result.findings.find((item) => item.ruleId === "medical.registration.required");

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing.some((item) => item.field === "registrationCertificate"), true);
  assert.equal(finding?.status, "unknown");
});

test("несовпадение РУ и модели блокирует участие", () => {
  const result = runFlow(
    medicalModule,
    medicalInput(
      { registryRecord: null },
      { registrationCoversModel: ev(false, "РУ № ФСЗ 2026/12345", "Модель не совпадает") }
    )
  );
  const finding = result.findings.find((item) => item.ruleId === "medical.registration.matches");

  assert.equal(result.outcome, "do_not_participate");
  assert.equal(finding?.status, "failed");
  assert.equal(finding?.riskLevel, "blocker");
});

test("неподтверждённое происхождение уводит в отчёт о рисках", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({}, { originConfirmed: ev(false, "Сертификат происхождения", "Происхождение не подтверждено") })
  );
  const finding = result.findings.find((item) => item.ruleId === "medical.national_regime");

  assert.equal(result.outcome, "report");
  assert.equal(finding?.status, "failed");
  assert.equal(finding?.riskLevel, "high");
});

test("цена ниже порога антидемпинга требует обеспечение или обоснование", () => {
  const result = runFlow(medicalModule, medicalInput({ offerPrice: 700_000, ...noAdditionalCosts }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing.some((item) => item.field === "antidumpingConsequence"), true);
});

test("цена ниже порога с обеспечением проходит", () => {
  const result = runFlow(
    medicalModule,
    medicalInput(
      { offerPrice: 700_000, ...noAdditionalCosts },
      { antidumpingSecurityProvided: ev(true, "Банковская гарантия", "Обеспечение x1.5") }
    )
  );

  assert.equal(result.outcome, "prepare_application");
});

test("пустой вход возвращает needs_input и список недостающих полей", () => {
  const result = runFlow(medicalModule, { data: {} });

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing.some((item) => item.field === "law"), true);
  assert.equal(result.missing.some((item) => item.field === "submissionDeadline"), true);
});

test("223-ФЗ не поддерживается в этом модуле", () => {
  const result = runFlow(medicalModule, medicalInput({ law: "223-ФЗ" }));
  const finding = result.findings.find((item) => item.ruleId === "internal.law_44fz");

  assert.equal(result.outcome, "report");
  assert.equal(finding?.status, "failed");
});

test("неизвестный тип объекта не проходит модуль", () => {
  const result = runFlow(medicalModule, medicalInput({ productKind: "other", isMedicalDevice: false }));
  const finding = result.findings.find((item) => item.ruleId === "internal.product_kind_known");

  assert.equal(result.outcome, "report");
  assert.equal(finding?.status, "failed");
});

test("без записи в реестре поток просит ввод", () => {
  const result = runFlow(medicalModule, medicalInput({ registryRecord: null }, { registryEntry: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing.some((item) => item.field === "registryEntry"), true);
});

test("без технического паспорта поток просит ввод", () => {
  const result = runFlow(medicalModule, medicalInput({}, { technicalPassport: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(result.missing.some((item) => item.field === "technicalPassport"), true);
});

test("истёкший срок подачи блокирует участие", () => {
  const result = runFlow(medicalModule, medicalInput({ submissionDeadline: "2026-10-01", now: "2026-10-26" }));
  const finding = result.findings.find((item) => item.ruleId === "internal.deadline");

  assert.equal(result.outcome, "do_not_participate");
  assert.equal(finding?.status, "failed");
});
