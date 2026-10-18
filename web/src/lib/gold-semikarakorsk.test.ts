// Эталон «Детские сады Семикаракорска»: электронный аукцион по 44-ФЗ на организацию питания, 9 заказчиков.
// Настоящие файлы читает код продукта — npm test. Запросов к ИИ тут нет.
// Разбор — «Татьяна-Примеры документов/Детские сады Семикаракорска (аукцион, питание)/РАЗБОР.md».
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_CONTEXT_CHARS } from "./chat-types.ts";
import { conditionsOf, describeCondition } from "./conditions.ts";
import { fitDocuments, trimWarning } from "./doc-trim.ts";
import { extractText } from "./extract-text.ts";
import { ruleOf, type PlanContext } from "./fulfillment.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/Детские сады Семикаракорска (аукцион, питание)");
const NAMES = readdirSync(DIR).filter((n) => !n.endsWith(".md"));

const cache = new Map<string, Promise<string>>();
function read(name: string): Promise<string> {
  if (!cache.has(name)) {
    cache.set(
      name,
      extractText(new File([new Uint8Array(readFileSync(path.join(DIR, name)))], name), { ocr: false }).then((r) => {
        assert.ok(r.ok, `${name} не прочитан`);
        return r.text;
      })
    );
  }
  return cache.get(name)!;
}
const find = (part: string) => NAMES.find((n) => n.includes(part))!;

test("все семь файлов читаются: старый .doc, .docx и Excel с несколькими листами", async () => {
  assert.equal(NAMES.length, 7);
  for (const n of NAMES) assert.ok((await read(n)).length > 1000, n);
});

test("требования к составу заявки: опыт 20 % от НМЦК, характеристики и страна не требуются, согласие — сама подача", async () => {
  const t = await read(find("Требования"));
  assert.match(t, /не менее 20 процентов начальной \(максимальной\) цены контракта/);
  assert.match(t, /статьей 236 Уголовного кодекса/);
  assert.match(t, /характеристики предлагаемого участником закупки товара[^\n]*не требуются/);
  assert.match(t, /Подача заявки означает, что Вы согласились оказать услуги/);
});

test("продукт видит в требовании об опыте «не менее 20 процентов»", async () => {
  const t = await read(find("Требования"));
  const line = t.split("\n").find((l) => l.includes("наличие опыта исполнения"))!;
  assert.deepEqual(conditionsOf(line).map(describeCondition), ["не менее 20 процентов"]);
});

test("девять максимумов цены в обосновании дают 17 000 000 ₽", async () => {
  const t = await read(find("Обоснование"));
  const max = [...t.matchAll(/\| 373,00 \| (\d+),00\s*$/gm)].map((m) => Number(m[1]));
  assert.equal(max.length, 9);
  assert.equal(max.reduce((a, b) => a + b, 0), 17_000_000);
});

test("ОНМЦК: торг по сумме цен единиц 173 + 200 = 373 ₽; число детей и дней в расчёте не указано", async () => {
  const t = await read(find("ОНМЦК"));
  assert.match(t, /Начальная сумма цен услуги[^\n]*373/);
  const row = t.split("\n").find((l) => l.includes("от 1,5 до 3-х лет |"))!;
  assert.match(row, /\| 170 \| 173 \| 176 \| 173 \|/);
  const header = t.split("\n").find((l) => l.startsWith("№ п/п"))!;
  assert.match(header, /Кол-во детей, чел\.\d? \| Кол-во дней/);
  assert.match(row, /лет \|\s*\|\s*\| 170 /, "под «Кол-во детей» и «Кол-во дней» пусто");
});

test("договор: обеспечение 1 %, цена — «условная единица»", async () => {
  const t = await read(find("Проект контракта"));
  assert.match(t, /в размере 1 % \(один процент\) от цены заключаемого договора/);
  assert.match(t, /Условная единица/);
  assert.match(t, /Максимальное значение цены Договора составляет/);
});

// Пункт 25 списка «Чего продукт пока не умеет»: закупка длиннее предела запроса к ИИ, но справочник продуктов не нужен для требований.
test("документы закупки сами не помещаются в лимит, но после урезания справочника помещаются", async () => {
  const docs = await Promise.all(NAMES.map(async (name) => ({ name, text: await read(name) })));
  const total = docs.reduce((sum, d) => sum + d.text.length, 0);
  assert.ok(total > MAX_CONTEXT_CHARS, `${total} знаков`);
  const { documents, notes } = fitDocuments(docs);
  assert.ok(documents.reduce((sum, d) => sum + d.text.length, 0) <= MAX_CONTEXT_CHARS);
  assert.equal(notes.length, 1, "убрано только самое большое: справочник продуктов");
  assert.match(notes[0].name, /Описание объекта закупки/);
  assert.ok(notes[0].rows > 300);
  const opis = documents.find((d) => d.name.includes("Описание"))!.text;
  assert.match(opis, /\[Таблица на \d+ строк/);
  assert.match(opis, /Период \(срок\) оказания услуг: с 01\.01\.2027по 31\.08\.2027/, "требования описания на месте");
  assert.match(opis, /Приложение № 3 к Описанию объекта закупки/, "текст после справочника на месте");
  assert.match(trimWarning(docs) ?? "", /ИИ не увидел/);
});

// Пункты 26 и 27: слова «не требуются» и две бумаги по дополнительному требованию (ч. 2 ст. 31, ПП № 2571).
const CTX: PlanContext = { law: "44", electronic: true, sme: false, participant: "ul", headSigns: true, points: false, parts: ["tp"] };
const plan = (text: string, ctx: PlanContext = CTX) => ruleOf({ text, quote: text }, ctx);

test("«не требуются» в конце пункта — пункт не нужен и из списка дел уходит (дословные фразы из «Требований»)", () => {
  const phrases = [
    "Характеристики предлагаемого участником закупки товара, соответствующие показателям, установленным в описании объекта закупки, товарный знак (при наличии у товара товарного знака) - не требуются;",
    "Наименование страны происхождения товара в соответствии с общероссийским классификатором, используемым для идентификации стран мира, - не требуются;",
    "Документы, подтверждающие соответствие товара требованиям, установленным в соответствии с законодательством Российской Федерации - не требуются;",
    "Декларация о принадлежности участника закупки к организации инвалидов (если участник закупки является такой организацией) - в настоящей закупке не требуется;",
    "Документы, подтверждающие соответствие участника закупки дополнительным требованиям по части 2.1 статьи 31 – в настоящей закупке не требуются;",
  ];
  for (const text of phrases) assert.equal(plan(text).plan.mode, "not_required", text);
  assert.equal(plan(phrases[0]).rule, "proposal", "правило узнаётся, пункт при этом не нужен");
  assert.equal(plan(phrases[0]).plan.mandatory, false);
});

test("«не требуются» не прячет обязательное: слова в середине, рядом с «;» и в многострочной цитате не считаются", () => {
  const mandatory = "Декларация о соответствии участника закупки требованиям, установленным пунктами 3 - 5, 7 - 11 части 1 статьи 31 Федерального закона";
  assert.equal(plan(mandatory).plan.mode, "confirm");
  assert.notEqual(plan(`${mandatory}; характеристики товара - не требуются`).plan.mode, "not_required", "две мысли в одной цитате");
  assert.notEqual(plan(`${mandatory}\nхарактеристики товара - не требуются`).plan.mode, "not_required", "несколько строк");
  assert.notEqual(plan("Копия устава не требуется, если участник — индивидуальный предприниматель, иначе приложите копию").plan.mode, "not_required", "слова не в конце");
});

test("справка об отсутствии судимости (ст. 236 УК): в электронной закупке по 44-ФЗ её передаёт площадка из реестра, иначе прикладывают", () => {
  const text = "Справка об отсутствии у руководителя, главного бухгалтера судимости за преступления, предусмотренные статьей 236 Уголовного кодекса Российской Федерации";
  const e = plan(text);
  assert.equal(e.rule, "criminal");
  assert.equal(e.plan.mode, "confirm");
  assert.match(e.plan.todo, /площадка передаст из реестра участников/);
  assert.match(e.plan.todo, /МВД через Госуслуги или МФЦ/);
  const paper = plan(text, { ...CTX, electronic: false });
  assert.equal(paper.plan.mode, "upload");
  assert.match(paper.plan.todo, /МВД через Госуслуги или МФЦ/);
  assert.equal(plan("отсутствие судимости за преступления, предусмотренные статьей 236 Уголовного кодекса").rule, "criminal", "и само требование без слова «справка»");
});

test("судимость «в сфере экономики» из декларации о соответствии (ч. 1 ст. 31) справкой не становится", () => {
  const text = "Декларация о соответствии: отсутствие у руководителя судимости за преступления в сфере экономики";
  assert.equal(plan(text).rule, "declaration");
});

test("декларация о непривлечении к административной ответственности (КоАП): отдельная подсказка, составить пока не умеем", () => {
  const text = "Декларация участника закупки о непривлечении руководителя, главного бухгалтера к административной ответственности за правонарушения, предусмотренные статьями 6.3, 6.5 - 6.7, 14.43, 14.44 - 14.46 КоАП";
  const r = plan(text);
  assert.equal(r.rule, "administrative");
  assert.equal(r.plan.mode, "confirm");
  assert.match(r.plan.todo, /составить её приложение пока не умеет/);
  assert.equal(plan(text, { ...CTX, electronic: false }).plan.mode, "upload");
});
