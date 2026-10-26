import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { medicalModule } from "./flow.ts";
import { ev, medicalInput, noAdditionalCosts, validMedicalInput, validRegistryRecord } from "./fixtures.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("golden: полный комплект медизделия 44-ФЗ готовит заявку", () => {
  const result = runFlow(medicalModule, validMedicalInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
});

test("golden: без записи в реестре не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ registryRecord: null }, { registryEntry: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "registryEntry"), true);
});

test("golden: без руководства на русском не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { manualRussian: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "manualRussian"), true);
});

test("golden: несоответствие комплектности блокирует участие", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({}, { completenessConfirmed: ev(false, "Спецификация", "Комплектность не соответствует") })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: нужна декларация соответствия, её нет", () => {
  const result = runFlow(medicalModule, medicalInput({ conformityRequired: true }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "conformityDocument"), true);
});

test("golden: нужна поверка, её нет", () => {
  const result = runFlow(medicalModule, medicalInput({ verificationRequired: true }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "verificationDocument"), true);
});

test("golden: монтаж нужен, но не включён", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ installationRequired: true }, { installationIncluded: ev(false, "КП", "Монтаж не включён") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: гарантия нужна, но не подтверждена", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ warrantyRequired: true }, { warrantyIncluded: ev(false, "КП", "Гарантия не включена") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: нужны дилерские полномочия, их нет", () => {
  const result = runFlow(medicalModule, medicalInput({ dealerAuthorizationRequired: true }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "dealerAuthorization"), true);
});

test("golden: нужен сертификат СМК, его нет", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ qualityCertificateRequired: true }, { qualityCertificate: ev(false, "СМК", "Сертификат не подтверждён") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: дополнительные затраты уменьшают маржу", () => {
  const result = runFlow(medicalModule, validMedicalInput);

  assert.equal(result.outputs.totalCost, 770_000);
  assert.equal(result.outputs.margin, 130_000);
  assert.equal(result.outcome, "prepare_application");
});

test("golden: дополнительные затраты уводят маржу в минус — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ otherCost: 250_000 }));

  assert.equal(result.outcome, "report");
});

test("golden: некорректная дополнительная затрата — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ logisticsCost: "abc" }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "logisticsCost"), true);
});

test("golden: антидемпинг без обеспечения и обоснования не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ offerPrice: 700_000, ...noAdditionalCosts }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "antidumpingConsequence"), true);
});

test("golden: антидемпинг с обоснованием цены проходит", () => {
  const result = runFlow(
    medicalModule,
    medicalInput(
      { offerPrice: 700_000, ...noAdditionalCosts },
      { priceJustificationProvided: ev(true, "Обоснование цены", "Себестоимость и логистика подтверждены") }
    )
  );

  assert.equal(result.outcome, "prepare_application");
});

test("golden: поставка позже требуемой даты — отчёт", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ deliveryRequiredDate: "2026-12-01", deliveryOfferedDate: "2026-12-15" })
  );

  assert.equal(result.outcome, "report");
});

test("golden: срок поставки в днях больше допустимого — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ maxDeliveryDays: 30, deliveryDays: 45 }));

  assert.equal(result.outcome, "report");
});

test("golden: нет предлагаемой даты поставки — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ deliveryRequiredDate: "2026-12-01" }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "deliveryOfferedDate"), true);
});

test("golden: нет срока поставки в днях — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ maxDeliveryDays: 30 }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "deliveryDays"), true);
});

test("golden: поставка в срок проходит", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ deliveryRequiredDate: "2026-12-01", deliveryOfferedDate: "2026-11-01" })
  );

  assert.equal(result.outcome, "prepare_application");
});

test("golden: истёкший срок подачи блокирует участие", () => {
  const result = runFlow(medicalModule, medicalInput({ submissionDeadline: "2026-10-01", now: "2026-10-26" }));

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: 223-ФЗ не проходит модуль 44-ФЗ", () => {
  const result = runFlow(medicalModule, medicalInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("golden: пустой вход не готовит заявку", () => {
  const result = runFlow(medicalModule, { data: {} });

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "law"), true);
});

test("golden: без паспорта не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { technicalPassport: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "technicalPassport"), true);
});

test("golden: без декларации участника не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { participantDeclaration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantDeclaration"), true);
});

test("golden: без подтверждения регистрации участника не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("golden: без полномочий подписанта не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { signatoryAuthority: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "signatoryAuthority"), true);
});

test("golden: ограничения участника не подтверждены — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({}, { restrictionsClear: ev(false, "Декларация участника", "Ограничение действует") })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: без реквизитов счёта не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({}, { bankDetails: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "bankDetails"), true);
});

test("golden: требуется одобрение крупной сделки, его нет", () => {
  const result = runFlow(medicalModule, medicalInput({ majorTransactionRequired: true }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "majorTransactionApproved"), true);
});

test("golden: требуется опыт, он не подтверждён", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ experienceRequired: true }, { experienceConfirmed: ev(false, "Опыт", "Опыт не подтверждён") })
  );

  assert.equal(result.outcome, "report");
});

test("golden: требуется статус СМП, его нет", () => {
  const result = runFlow(medicalModule, medicalInput({ smpStatusRequired: true }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "smpStatusConfirmed"), true);
});

test("golden: характеристики товара не совпали — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({
      productCharacteristics: [
        { name: "Масса", value: 12, unit: "кг" },
        { name: "Режим работы", value: "непрерывный" },
      ],
    })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: обеспечение заявки меньше требуемого — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ applicationSecurityAmount: 5_000 }));

  assert.equal(result.outcome, "report");
});

test("golden: обеспечение контракта меньше требуемого — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ contractSecurityAmount: 40_000 }));

  assert.equal(result.outcome, "report");
});

test("golden: не указана требуемая сумма обеспечения заявки — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ applicationSecurityRequiredAmount: undefined }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "applicationSecurityRequiredAmount"), true);
});

test("golden: не указана сумма обеспечения контракта — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ contractSecurityAmount: undefined }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "contractSecurityAmount"), true);
});

test("golden: форма обеспечения заявки не совпадает — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ applicationSecurityForm: "денежные средства" }));

  assert.equal(result.outcome, "report");
});

test("golden: срок обеспечения заявки короче требуемого — отчёт", () => {
  const result = runFlow(medicalModule, medicalInput({ applicationSecurityValidUntil: "2026-12-01" }));

  assert.equal(result.outcome, "report");
});

test("golden: не указана форма обеспечения контракта — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ contractSecurityForm: undefined }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "contractSecurityForm"), true);
});

test("golden: не указан срок обеспечения контракта — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ contractSecurityValidUntil: undefined }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "contractSecurityValidUntil"), true);
});

test("golden: нет таблицы характеристик товара — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ productCharacteristics: [] }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "productCharacteristics"), true);
});

test("golden: реестр не нашёл РУ — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ registryRecord: { ...validRegistryRecord, status: "not_found" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: запись в реестре просрочена — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ registryRecord: { ...validRegistryRecord, status: "expired" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: реестр не подтверждает модель — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ registryRecord: { ...validRegistryRecord, model: "Другая модель" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: реестр не подтверждает номер РУ — не участвовать", () => {
  const result = runFlow(
    medicalModule,
    medicalInput({ registryRecord: { ...validRegistryRecord, registrationNumber: "РУ № ФСЗ 2025/00001" } })
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("golden: битая запись реестра — не готовит заявку", () => {
  const result = runFlow(medicalModule, medicalInput({ registryRecord: {} }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "registryRecord"), true);
});
