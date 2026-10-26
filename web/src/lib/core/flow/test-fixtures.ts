import type { FlowModule, Rule } from "./types.ts";

export const testRule: Rule = {
  id: "test.flag",
  law: "44-ФЗ",
  article: "ст. 43",
  condition: "Флаг подтверждён",
  requiredDocument: "Документ",
  validationLogic: "flag === true",
  riskLevel: "blocker",
  effectiveFrom: "2014-01-01",
  source: "https://www.consultant.ru/document/cons_doc_LAW_144624/",
  status: "seed",
  evaluate: (context) => {
    const value = context.input.data.flag;
    if (typeof value !== "boolean") {
      return { passed: false, detail: "Флаг не указан", missing: ["flag"] };
    }
    return { passed: value, detail: value ? "Флаг подтверждён" : "Флаг не подтверждён", missing: [] };
  },
};

export const testFlow = (): FlowModule => ({
  key: "test",
  name: "Тестовый поток",
  version: "0.1.0",
  start: "extract",
  nodes: [
    { id: "extract", type: "extract", fields: ["flag"], source: "required", label: "Извлечение" },
    { id: "check", type: "check", ruleId: "test.flag", label: "Проверка" },
    { id: "yes", type: "decision", outcome: "participate", label: "Участвовать" },
    { id: "no", type: "decision", outcome: "do_not_participate", label: "Не участвовать" },
  ],
  edges: [
    { from: "extract", to: "check", on: "always" },
    { from: "check", to: "yes", on: "yes" },
    { from: "check", to: "no", on: "no" },
  ],
  rules: [testRule],
});

export const questionFlow = (): FlowModule => ({
  key: "question",
  name: "Вопрос",
  version: "0.1.0",
  start: "question",
  nodes: [
    { id: "question", type: "question", question: "Документ есть?", answer: "boolean", field: "hasDocument", label: "Вопрос" },
    { id: "yes", type: "decision", outcome: "participate", label: "Да" },
    { id: "no", type: "decision", outcome: "do_not_participate", label: "Нет" },
  ],
  edges: [
    { from: "question", to: "yes", on: "yes" },
    { from: "question", to: "no", on: "no" },
  ],
  rules: [],
});
