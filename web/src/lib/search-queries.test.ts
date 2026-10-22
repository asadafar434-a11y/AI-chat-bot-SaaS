// Темы для поиска по всем гипотезам закупки: без уже посчитанных и без тех, что интернетом не проверить — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { COVERED_HYPOTHESES, queryFor, searchTopics } from "./search-queries.ts";

const CONTEXT = { year: 2026, place: "Севастополь" };

test("темы поиска: по каждой гипотезе — её запрос с годом и регионом; уже посчитанные и непроверяемые в интернете не берутся", () => {
  const topics = searchTopics(["materials", "cashgap", "penalties", "logistics", "unknown-topic", "payroll"], CONTEXT);
  assert.deepEqual(topics.map(([id]) => id), ["materials", "logistics", "payroll"]);
  for (const [id, query] of topics) assert.equal(query, queryFor(id, CONTEXT));
  assert.match(topics.find(([id]) => id === "logistics")![1], /Севастополь 2026/);
  for (const id of COVERED_HYPOTHESES) assert.equal(searchTopics([id], CONTEXT).length, 0, id);
});

test("темы поиска: пустой список гипотез — пустой список тем", () => {
  assert.deepEqual(searchTopics([], CONTEXT), []);
});
