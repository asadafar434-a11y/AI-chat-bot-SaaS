// Раскладка документов участника без ИИ — по названию файла и началу текста — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOC_KIND_KEYS, guessKinds, REQUISITE_KINDS } from "./my-docs.ts";

test("договоры с актами — опыт, дипломы и допуски — сотрудники", () => {
  assert.deepEqual(guessKinds("Контракт и акт — Учитель года 2025.pdf", "АКТ о приёмке оказанных услуг № 14"), ["experience"]);
  assert.deepEqual(guessKinds("Опыт.pdf", "Выписка из реестра контрактов: исполненные контракты участника"), ["experience"]);
  assert.deepEqual(guessKinds("Диплом режиссёра.pdf", "ДИПЛОМ о высшем образовании"), ["staff"]);
  assert.deepEqual(
    guessKinds("Удостоверение.pdf", "Удостоверение о проверке знаний правил работы в электроустановках, группа по электробезопасности IV"),
    ["staff"]
  );
  assert.deepEqual(guessKinds("Трудовой договор.docx", "ТРУДОВОЙ ДОГОВОР № 7 с работником"), ["staff"]);
});

test("документы заказчика и непонятное — «другое», реквизиты из договоров не берём", () => {
  assert.deepEqual(guessKinds("Проект контракта.pdf", "ПРОЕКТ КОНТРАКТА на оказание услуг"), ["other"]);
  assert.deepEqual(guessKinds("Протокол.pdf", "Протокол подведения итогов"), ["other"]);
  // В договоре рядом стоят реквизиты заказчика — из опыта реквизиты участника не заполняются.
  assert.equal(REQUISITE_KINDS.includes("experience"), false);
  assert.equal(REQUISITE_KINDS.includes("staff"), false);
  assert.deepEqual(DOC_KIND_KEYS.slice(-3), ["experience", "staff", "other"]);
});
