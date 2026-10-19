// Правила заполнения заявки из документов заказчика («без слова «эквивалент»», «без «не менее» и «или»») — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { checkFillRules, fillRulesOf, type OfferedValue } from "./fill-rules.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import type { Purchase } from "./purchase.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";
import { validate } from "./validation-engine.ts";

const KB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
async function read(dir: string, name: string) {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(KB, dir, name)))], name), { ocr: false });
  assert.ok(r.ok, `${name} не прочитан`);
  return { name, text: r.text };
}
const COAL = "МУП Тепло Корсаков (аукцион 223-ФЗ, уголь)";
const BALCONY = "ЖКС Петродворца (аукцион 223-ФЗ, ремонт балконов)";

const good = (where: string, text: string): OfferedValue => ({ where, text, kind: "good" });
const item = (where: string, text: string): OfferedValue => ({ where, text, kind: "item" });

test("Инструкция по заполнению заявки (уголь): правила «эквивалент», «конкретные значения» и «или» находятся с цитатой", async () => {
  const rules = fillRulesOf([await read(COAL, "Инструкция по заполнению заявки.docx")]);
  assert.deepEqual(rules.map((r) => r.id), ["no_equivalent", "concrete_values"]);
  const [equivalent, concrete] = rules;
  assert.match(equivalent.quote, /не должно сопровождаться словом «эквивалент»/);
  assert.match(concrete.quote, /Не допускается наличие неопределенности в значениях или множественность значений/);
  assert.equal(concrete.forbidOr, true, "«или» разобран в Инструкции отдельным предложением");
  assert.ok(!concrete.forbidFromTo);
  assert.equal(equivalent.doc, "Инструкция по заполнению заявки.docx");
});

test("информационная карта (балконы): «не должны сопровождаться словами «эквивалент», «аналог»» и «не должны содержать слов «не менее», «от», «до», «или»»", async () => {
  const rules = fillRulesOf([await read(BALCONY, "Аукционная документация.docx")]);
  assert.deepEqual(rules.map((r) => r.id), ["no_equivalent", "concrete_values"]);
  assert.equal(rules[1].forbidOr, true);
  assert.equal(rules[1].forbidFromTo, true);
});

test("в документах без таких фраз правил нет", async () => {
  assert.deepEqual(fillRulesOf([await read(COAL, "Договор поставки угля.docx"), { name: "ТЗ.docx", text: "Поставить 10 штук." }]), []);
});

test("слова «эквивалент», «не менее», «или», «от … до» в значениях участника находятся; пропуски в скобках и обычные слова — нет", async () => {
  const rules = fillRulesOf([await read(COAL, "Инструкция по заполнению заявки.docx"), await read(BALCONY, "Аукционная документация.docx")]);
  const found = checkFillRules(rules, [
    good("Уголь", "Зольность: не менее 18\nЦвет: чёрный или серый\nМарка: Дон-5 или эквивалент"),
    good("Кабель", "Диаметр: от 2 до 4 мм\nДлина: 100 м"),
    good("Труба", "Диаметр: [число, не меньше 150]\nМатериал: сталь"),
    item("п. 2.1 ТЗ", "Обеспечим не менее 3 специалистов в смене, с 9 до 18 часов или по согласованию."),
    item("п. 2.2 ТЗ", "Окажем услугу в срок."),
  ]);
  const byWhere = (where: string) => found.filter((v) => v.where === where).flatMap((v) => v.found);
  assert.deepEqual(byWhere("Уголь").sort(), ["не менее", "или", "эквивалент"].sort());
  // «от 2 до 4» ловится как запрещённое «от … до» только по правилу из карты балконов.
  const fromTo = found.filter((v) => v.where === "Кабель");
  assert.equal(fromTo.length, 1);
  assert.match(fromTo[0].found.join(" "), /от 2 до/);
  assert.deepEqual(byWhere("Труба"), [], "жёлтый пропуск «[число, не меньше 150]» — подсказка, не значение участника");
  // В рассказе об услугах «или» и «с 9 до 18» обычны; а «не менее» заказчик не допускает и там.
  assert.deepEqual(byWhere("п. 2.1 ТЗ"), ["не менее"]);
  assert.deepEqual(byWhere("п. 2.2 ТЗ"), []);
});

function purchaseWith(tp: Partial<TpResult>): Purchase {
  return {
    id: "p1",
    createdAt: "2026-10-01T10:00:00.000Z",
    short: "Поставка угля",
    subject: "",
    kind: "223-ФЗ · электронный аукцион",
    customer: "МУП",
    price: "25 930 002,00",
    deadline: { date: "2026-11-01", time: "10:00", zone: "МСК" },
    files: [],
    unreadable: [],
    requirements: { who: [], submit: [], scope: [], terms: [] },
    tp: { form: PLAIN_FORM, goods: [], items: [], antiDumping: NO_ANTI_DUMPING, ...tp },
  };
}

test("движок проверки: «эквивалент» в строке товара — FAIL, «не менее» в строке товара — на решение человека; без документов правил нет", async () => {
  const documents = [await read(COAL, "Инструкция по заполнению заявки.docx")];
  const purchase = purchaseWith({
    goods: [{ name: "Уголь 3 БР 0-300 мм", characteristics: "Зольность Ad: не менее 18\nМарка: Дон-5 или эквивалент", quantity: "2900 т", source: "ТЗ", quote: "Уголь", verified: true }],
    items: [{ clause: "2.1", topic: "Доставка", requirement: "Доставка силами поставщика", quote: "Доставка", offer: "Доставим своими силами.", verified: true }],
  });
  const base = { purchase, profile: EMPTY_PROFILE, facts: [], fields: [], today: "2026-10-02" };
  const report = validate({ ...base, documents });
  const fill = report.findings.filter((f) => f.id.startsWith("fillrule:"));
  assert.equal(fill.length, 2);
  const equivalent = fill.find((f) => f.id.startsWith("fillrule:no_equivalent"))!;
  assert.equal(equivalent.status, "FAIL");
  assert.equal(equivalent.category, "characteristic_matching");
  assert.match(equivalent.title, /«Уголь 3 БР 0-300 мм»: «эквивалент» — заказчик такие слова не допускает/);
  assert.match(equivalent.reasons[0], /Инструкция по заполнению заявки\.docx: «не должно сопровождаться словом «эквивалент»/);
  const concrete = fill.find((f) => f.id.startsWith("fillrule:concrete_values"))!;
  assert.equal(concrete.status, "NEEDS_HUMAN_REVIEW");
  assert.match(concrete.title, /«не менее»/);
  assert.match(concrete.title, /«или»/);
  // Документов нет или правил в них нет — ничего не добавляется.
  assert.equal(validate(base).findings.filter((f) => f.id.startsWith("fillrule:")).length, 0);
  assert.equal(validate({ ...base, documents: [{ name: "ТЗ.docx", text: "Поставить уголь." }] }).findings.filter((f) => f.id.startsWith("fillrule:")).length, 0);
});

test("правило «без указания слов „или эквивалент“» из инструкции под формой предложения (Метрострой) находится; слово «эквивалент» в строке товара — нарушение", () => {
  const instruction = "В столбце 3 «Наименование товара» участником закупки указывается наименование предлагаемого к поставке товара в точном соответствии с Техническим заданием, без указания слов «или эквивалент». В столбце 4 указываются единицы измерения.";
  const rules = fillRulesOf([{ name: "Форма 1.xls", text: instruction }]);
  assert.deepEqual(rules.map((r) => r.id), ["no_equivalent"]);
  assert.match(rules[0].quote, /^без указания слов «или эквивалент»/);
  const violations = checkFillRules(rules, [{ where: "Сетка стальная", text: "Сетка стальная арматурная или эквивалент", kind: "good" }]);
  assert.equal(violations.length, 1);
  assert.equal(fillRulesOf([{ name: "Форма.xls", text: "Допускается указывать товар по ГОСТ." }]).length, 0);
});
