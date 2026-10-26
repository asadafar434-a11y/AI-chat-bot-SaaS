import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "./engine.ts";
import type { FlowResult } from "./types.ts";
import { medicalModule } from "../modules/medical/flow.ts";
import {
  medicalInput,
  validMedicalInput,
  validMedicineInput,
} from "../modules/medical/fixtures.ts";
import { buildDocumentChecklist } from "./checklist.ts";

test("чек-лист: полный комплект медизделия — все документы подтверждены", () => {
  const checklist = buildDocumentChecklist(runFlow(medicalModule, validMedicalInput));

  assert.equal(checklist.length > 0, true);
  assert.equal(checklist.every((item) => item.status === "confirmed"), true);
  assert.equal(checklist.some((item) => item.document === "Регистрационное удостоверение"), true);
  assert.equal(
    checklist.some((item) => item.document === "Запись в государственном реестре медицинских изделий"),
    true
  );
});

test("чек-лист: отсутствующий паспорт попадает в требуемые", () => {
  const checklist = buildDocumentChecklist(
    runFlow(medicalModule, medicalInput({}, { technicalPassport: null }))
  );
  const item = checklist.find((entry) => entry.document === "Технический паспорт");

  assert.equal(item?.status, "required");
  assert.equal(item?.riskLevel, "high");
});

test("чек-лист: отсутствующая запись реестра попадает в требуемые", () => {
  const checklist = buildDocumentChecklist(
    runFlow(medicalModule, medicalInput({ registryRecord: null }, { registryEntry: null }))
  );
  const item = checklist.find(
    (entry) => entry.document === "Запись в государственном реестре медицинских изделий"
  );

  assert.equal(item?.status, "required");
});

test("чек-лист: лекарство включает документы ветки лекарств", () => {
  const checklist = buildDocumentChecklist(runFlow(medicalModule, validMedicineInput));

  assert.equal(checklist.every((item) => item.status === "confirmed"), true);
  assert.equal(
    checklist.some((item) => item.document === "Регистрационное удостоверение лекарственного препарата"),
    true
  );
  assert.equal(
    checklist.some((item) => item.document === "Подтверждение условий хранения и перевозки"),
    true
  );
});

test("чек-лист: одинаковые документы склеиваются, риск берётся максимальный", () => {
  const result: FlowResult = {
    moduleKey: "test",
    moduleVersion: "1",
    outcome: "report",
    trace: [],
    findings: [
      {
        nodeId: "a",
        ruleId: "rule.low",
        status: "passed",
        riskLevel: "low",
        message: "",
        law: null,
        article: null,
        requiredDocument: "Документ",
        effectiveFrom: null,
        source: "source-a",
        ruleStatus: "seed",
      },
      {
        nodeId: "b",
        ruleId: "rule.high",
        status: "failed",
        riskLevel: "high",
        message: "",
        law: null,
        article: null,
        requiredDocument: "Документ",
        effectiveFrom: null,
        source: "source-b",
        ruleStatus: "seed",
      },
    ],
    missing: [],
    outputs: {},
    visited: [],
  };

  const checklist = buildDocumentChecklist(result);

  assert.equal(checklist.length, 1);
  assert.equal(checklist[0]?.status, "required");
  assert.equal(checklist[0]?.riskLevel, "high");
  assert.deepEqual(checklist[0]?.ruleIds, ["rule.low", "rule.high"]);
  assert.equal(checklist[0]?.source, "source-a");
});
