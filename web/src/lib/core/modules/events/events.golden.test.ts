import assert from "node:assert/strict";
import { test } from "node:test";
import { runFlow } from "../../flow/engine.ts";
import { validateFlow } from "../../flow/validate.ts";
import { ev, eventsInput, validEventsInput } from "./fixtures.ts";
import { eventsModule } from "./flow.ts";

const missing = (result: ReturnType<typeof runFlow>, field: string) =>
  result.missing.some((item) => item.field === field);

test("events: модуль проходит валидацию", () => {
  assert.deepEqual(validateFlow(eventsModule), []);
});

test("events: полный комплект готовит заявку", () => {
  const result = runFlow(eventsModule, validEventsInput);

  assert.equal(result.outcome, "prepare_application");
  assert.equal(result.missing.length, 0);
  assert.equal(result.outputs.riskScore, 0);
});

test("events: 223-ФЗ не поддерживается", () => {
  const result = runFlow(eventsModule, eventsInput({ law: "223-ФЗ" }));

  assert.equal(result.outcome, "report");
});

test("events: другая услуга не проходит модуль", () => {
  const result = runFlow(eventsModule, eventsInput({ serviceKind: "training" }));

  assert.equal(result.outcome, "report");
});

test("events: без регистрации участника нужен ввод", () => {
  const result = runFlow(eventsModule, eventsInput({}, { participantRegistration: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "participantRegistration"), true);
});

test("events: требования к услуге не совпали — не участвовать", () => {
  const result = runFlow(
    eventsModule,
    eventsInput({
      offeredServiceCharacteristics: [
        { name: "Тип мероприятия", value: "Выставка" },
        { name: "Количество участников", value: 120, unit: "чел." },
      ],
    }),
  );

  assert.equal(result.outcome, "do_not_participate");
});

test("events: площадка не подтверждена — отчёт", () => {
  const result = runFlow(
    eventsModule,
    eventsInput({}, { venueConfirmed: ev(false, "Договор площадки", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("events: без плана безопасности нужен ввод", () => {
  const result = runFlow(eventsModule, eventsInput({}, { safetyConfirmed: null }));

  assert.equal(result.outcome, "needs_input");
  assert.equal(missing(result, "safetyConfirmed"), true);
});

test("events: план безопасности не подтверждён — отчёт", () => {
  const result = runFlow(
    eventsModule,
    eventsInput({}, { safetyConfirmed: ev(false, "План безопасности", "не подтверждён") }),
  );

  assert.equal(result.outcome, "report");
});

test("events: персонал и оборудование не подтверждены — отчёт", () => {
  const result = runFlow(
    eventsModule,
    eventsInput({}, { staffConfirmed: ev(false, "Подтверждение персонала", "не подтверждены") }),
  );

  assert.equal(result.outcome, "report");
});

test("events: срок оказания услуг позже требуемого — отчёт", () => {
  const result = runFlow(eventsModule, eventsInput({ serviceOfferedDate: "2027-02-10" }));

  assert.equal(result.outcome, "report");
});

test("events: отрицательная маржа — отчёт", () => {
  const result = runFlow(eventsModule, eventsInput({ offerPrice: 520_000 }));

  assert.equal(result.outcome, "report");
});
