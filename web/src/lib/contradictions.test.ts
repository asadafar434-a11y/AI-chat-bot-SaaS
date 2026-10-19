// Противоречия внутри документов заказчика: разбор ответа, места цитат, устаревание, итог одной строкой — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contradictionsKey, contradictionsStale, contradictionsSummary, ContradictionsSchema, withPlaces, type ContradictionFinding, type ContradictionsResult } from "./contradictions.ts";
import { extractText } from "./extract-text.ts";

const COAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/МУП Тепло Корсаков (аукцион 223-ФЗ, уголь)");

const finding = (over: Partial<ContradictionFinding> = {}): ContradictionFinding => ({
  kind: "conflict",
  what: "п. 10.2 запрещает передачу прав, п. 10.12 разрешает",
  firstQuote: "Права и обязанности по настоящему Договору не могут быть переданы третьим лицам",
  firstSource: "Договор, п. 10.2",
  secondQuote: "Поставщик в любое время вправе без согласия Покупателя уступить права и обязанности",
  secondSource: "Договор, п. 10.12",
  ask: "Просим уточнить, вправе ли поставщик уступить права по договору",
  firstVerified: true,
  secondVerified: true,
  ...over,
});
const result = (findings: ContradictionFinding[]): ContradictionsResult => ({ findings, docsKey: "k", checkedAt: "2026-10-19T10:00:00.000Z" });

test("схема ответа модели: все поля нужны, неизвестный вид отклоняется, пустой список — «ничего не найдено»", () => {
  const ok = { kind: "unclear", what: "Срок договора без даты", firstQuote: "действует до года", firstSource: "Договор, п. 10.1", secondQuote: "", secondSource: "", ask: "Укажите дату" };
  assert.equal(ContradictionsSchema.safeParse({ findings: [ok] }).success, true);
  assert.equal(ContradictionsSchema.safeParse({ findings: [] }).success, true);
  assert.equal(ContradictionsSchema.safeParse({ findings: [{ ...ok, kind: "error" }] }).success, false);
  assert.equal(ContradictionsSchema.safeParse({ findings: [{ kind: "conflict", what: "x" }] }).success, false);
});

test("итог одной строкой: склонение, прямые противоречия и неясности отдельно, пусто — «не найдено»", () => {
  assert.equal(contradictionsSummary(result([])), "Противоречий не найдено");
  assert.equal(contradictionsSummary(result([finding()])), "Найдено: 1 противоречие");
  assert.equal(contradictionsSummary(result([finding(), finding(), finding({ kind: "unclear" })])), "Найдено: 2 противоречия, 1 неясность");
  assert.equal(contradictionsSummary(result(Array.from({ length: 5 }, () => finding({ kind: "unclear" })))), "Найдено: 5 неясностей");
});

test("результат устаревает, когда документы заменили или добавили; порядок документов не важен", () => {
  const docs = [{ name: "Договор.docx", text: "Текст договора" }, { name: "ТЗ.docx", text: "Текст ТЗ" }];
  const saved = { ...result([]), docsKey: contradictionsKey(docs) };
  assert.equal(contradictionsStale(saved, docs), false);
  assert.equal(contradictionsStale(saved, [...docs].reverse()), false);
  assert.equal(contradictionsStale(saved, [docs[0], { name: "ТЗ.docx", text: "Новый текст ТЗ" }]), true);
  assert.equal(contradictionsStale(saved, [...docs, { name: "Извещение.docx", text: "Извещение" }]), true);
});

test("места цитат находятся по настоящему договору (угольный набор): пункт 10.2 и пункт 10.12; выдуманная цитата места не получает", async () => {
  const name = "Договор поставки угля.docx";
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(COAL, name)))], name), { ocr: false });
  assert.ok(r.ok);
  const placed = withPlaces({ findings: [finding(), finding({ firstQuote: "Такого пункта в договоре нет", secondQuote: "" })] }, [{ name, text: r.text }]);
  assert.match(placed.findings[0].firstAt ?? "", /10\.2/);
  assert.match(placed.findings[0].secondAt ?? "", /10\.12/);
  assert.equal(placed.findings[1].firstAt, undefined);
  assert.equal(placed.findings[1].secondAt, undefined, "пустая вторая цитата — места нет");
});
