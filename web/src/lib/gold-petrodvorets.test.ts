// Эталон «ЖКС Петродворца»: аукцион в электронной форме по 223-ФЗ, ремонт 28 балконов в 10 домах. Настоящие файлы заказчика читает код продукта — npm test.
// Запросов к ИИ тут нет. Разбор — «Татьяна-Примеры документов/ЖКС Петродворца (аукцион 223-ФЗ, ремонт балконов)/РАЗБОР.md».
// Тесты с пометкой todo — известные пробелы (список «Чего продукт пока не умеет», пункты 33–41): сейчас не проходят, после исправления пометку снимают.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_CONTEXT_CHARS } from "./chat-types.ts";
import { extractText } from "./extract-text.ts";
import { ruleOf, type PlanContext } from "./fulfillment.ts";
import { forbidsHidden } from "./hidden-content.ts";
import { detectRegistryDemand } from "./registry-demand.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/ЖКС Петродворца (аукцион 223-ФЗ, ремонт балконов)");
const CTX: PlanContext = { law: "223", electronic: true, sme: false, participant: "ul", headSigns: true, points: false, parts: ["tp", "participant"] };

const cache = new Map<string, Promise<string>>();
function read(name: string): Promise<string> {
  if (!cache.has(name)) {
    cache.set(
      name,
      (async () => {
        const r = await extractText(new File([new Uint8Array(readFileSync(path.join(DIR, name)))], name), { ocr: false });
        assert.ok(r.ok, `${name} не прочитан`);
        return r.text;
      })(),
    );
  }
  return cache.get(name)!;
}

const CARD = "Аукционная документация.docx";
const TZ = "Приложение № 1 Техническое задание.docx";
const GROUNDS = "Приложение № 2 Обоснование НМЦД.xlsx";
const CALC = "Приложение № 3 Расчёт НМЦД.xls";
const CONTRACT = "Приложение № 4 Проект договора.doc";
const SCAN = "Приложение № 5 Локальная смета ЛС-272.pdf";
const TEXT_FILES = [CARD, TZ, GROUNDS, CALC, CONTRACT];

const rule = (text: string) => ruleOf({ text, quote: text }, CTX);

test("информационная карта: способ, НМЦД, обеспечения нет, подача до 16.10.2026 10:00, шаг 0,5–5 %", async () => {
  const t = await read(CARD);
  assert.match(t, /Аукцион в электронной форме/);
  assert.match(t, /3 097 718,10 \(Три миллиона девяносто семь тысяч семьсот восемнадцать\) рублей 10 копеек/);
  assert.match(t, /Размер обеспечения заявки на участие в аукционе \| Не установлено/);
  assert.match(t, /Размер обеспечения исполнения договора: \| Не установлено/);
  assert.match(t, /«16» октября 2026 года в 10:00/);
  assert.match(t, /от 0,5% до 5 % от начальной \(максимальной\) цены договора/);
  assert.match(t, /не применяются на основании пп\.м\) п \.4 Постановление Правительства РФ от 23\.12\.2024 N 1875/);
});

test("шаг аукциона от 0,5 % до 5 % НМЦД — от 15 488,59 до 154 885,91 ₽", () => {
  const nmck = 309771810;
  assert.equal(Math.round(nmck * 0.005), 1548859);
  assert.equal(Math.round(nmck * 0.05), 15488591);
});

test("предмет — 28 балконов в 10 адресах", async () => {
  const t = await read(CARD);
  const subject = /Наименование объекта закупки: \| ([^\n]+)/.exec(t)![1];
  const counts = [...subject.matchAll(/\((\d+) балкон/g)].map((m) => Number(m[1]));
  assert.equal(counts.length, 10);
  assert.equal(counts.reduce((a, b) => a + b, 0), 28);
});

test("номера пунктов карты: пункта 35 нет, пункт 37 повторяется", async () => {
  const t = await read(CARD);
  assert.ok(/^34\. \|/m.test(t) && /^36\. \|/m.test(t));
  assert.ok(!/^35\.? \|/m.test(t));
  assert.equal((t.match(/^37\.? \|/gm) ?? []).length, 2);
});

test("заявка из двух частей, формы «рекомендуемые», анкета из 13 разделов", async () => {
  const t = await read(CARD);
  assert.match(t, /первая часть заявки на участие в аукционе должна содержать/);
  assert.match(t, /вторая часть заявки на участие в аукционе должна содержать/);
  assert.match(t, /Форма 1 первой части Заявки/);
  assert.match(t, /Форма 1 второй части Заявки/);
  assert.match(t, /Форма 2 второй части Заявки/);
  assert.match(t, /ВНИМАНИЮ УЧАСТНИКОВ ЗАКУПКИ: ДОКУМЕНТ РЕКОМЕНДУЕТСЯ ВКЛЮЧАТЬ В ПЕРВУЮ ЧАСТЬ ЗАЯВКИ!/);
  const anketa = t.slice(t.indexOf("Анкета участника (рекомендуемая форма)"), t.indexOf("Главный бухгалтер\n"));
  const numbers = [...anketa.matchAll(/^(\d+) \| /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("техническое предложение — таблица из пяти столбцов, последний — страна происхождения", async () => {
  const t = await read(CARD);
  assert.match(t, /№ пп\. \| Наименование товаров \(работ, услуг\) \| Конкретные показатели[^|]+\| Ед\. изм\. \| Кол-во \| Наименование страны происхождения товара/);
});

test("срок выписки ЕГРЮЛ в карте не выбран: названы сразу месяц, три и шесть месяцев", async () => {
  const t = await read(CARD);
  assert.match(t, /не ранее чем за один месяц \(или не ранее чем за три месяца или не ранее чем за шесть месяцев\)/);
});

test("значения в заявке — «конкретные»: слова «не менее», «не более», «эквивалент», «или» запрещены", async () => {
  const t = await read(CARD);
  assert.match(t, /не должны содержать слов «не менее», «не более», «не ниже», «не выше», «от», «до», «или»/);
});

test("техническое задание: срок 30 календарных дней, гарантия не менее 12 месяцев, ОКПД 2, характеристик материалов нет", async () => {
  const t = await read(TZ);
  assert.match(t, /ОКПД 2 - 41\.20\.40\.900/);
  assert.match(t, /в течение 30 \(тридцати\) календарных дней с даты заключения договора/);
  assert.match(t, /гарантийный срок на выполненные работы – не менее 12 месяцев/);
  assert.ok(!/\d\s*мм\b/.test(t), "размеров и марок материалов в ТЗ нет — отсылка к смете");
  assert.match(t, /указания на товарный знак, не сопровождающийся словами «или эквивалент», то такие указания считать не действительными/);
});

test("обоснование НМЦД: метод проектно-сметный, расчёт — ЛС-272, дата 30.09.2026", async () => {
  const t = await read(GROUNDS);
  assert.match(t, /Используемый метод определения НМЦД с обоснованием: \| Проектно-сметный/);
  assert.match(t, /Локальный сметный расчет №ЛС-272/);
  assert.match(t, /30\.09\.2026/);
});

test("расчёт НМЦД (.xls): сумма и НДС 22 % сходятся с НМЦД, но строка на рубль меньше итога и столбец назван «тыс. руб.»", async () => {
  const t = await read(CALC);
  assert.match(t, /тыс\. руб\./);
  assert.match(t, /ЛС-2723/, "в ссылке на смету лишняя цифра");
  const line = Number(/Ремонт балконов[^|]+\| (\d+,?\d*)\s*$/m.exec(t)![1].replace(",", "."));
  const net = Number(/Итого без НДС: \|[ |]*(\d+,\d+)/.exec(t)![1].replace(",", "."));
  const vat = Number(/НДС \(22%\) \|[ |]*(\d+,\d+)/.exec(t)![1].replace(",", "."));
  const total = Number(/Стоимость с учетом НДС \|[ |]*(\d+,\d+)/.exec(t)![1].replace(",", "."));
  assert.equal(Math.round((net - line) * 100), 100, "строка 2 539 112,2 против итога 2 539 113,2");
  assert.equal(Math.round(net * 0.22 * 100) / 100, 558604.9);
  assert.equal(Math.round(total * 100), 309771810);
  assert.equal(Math.round((net + vat) * 100), 309771810);
});

test("проект договора: цена со сметы с коэффициентом снижения; оплата за 7 рабочих дней; пеня 1/300; штраф 20 %", async () => {
  const t = await read(CONTRACT);
  assert.match(t, /на основании Приложения №1 к настоящему Договору с учетом коэффициента снижения/);
  assert.match(t, /в течение 7 \(семи\) рабочих дней с момента подписания актов по форме КС-2 и КС-3/);
  assert.match(t, /одной трехсотой ставки рефинансирования/);
  assert.match(t, /штраф в размере 20% от их стоимости/);
  assert.match(t, /действует до 31 декабря 2026г\./);
});

test("договор требует много вне заявки: налоговая тайна за 10 дней, отчёт каждый вторник, списки работников", async () => {
  const t = await read(CONTRACT);
  assert.match(t, /в течение 10 календарных дней с момента заключения договора предоставить в территориальный налоговый орган/);
  assert.match(t, /каждый вторник с нарастающим итогом/);
  assert.match(t, /5\.14\. Подрядчик обязан предоставить список сотрудников/);
  assert.match(t, /00000000\.ru/, "адрес для сканов — заглушка");
});

test("смета ЛС-272 — скан без текста: без ИИ продукт честно называет причину", async () => {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(DIR, SCAN)))], SCAN), { ocr: false });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /скан/);
});

test("пять текстовых файлов читаются, весь текст — далеко до предела запроса к ИИ", async () => {
  const lengths = await Promise.all(TEXT_FILES.map(async (n) => (await read(n)).length));
  assert.ok(lengths.every((n) => n > 0));
  assert.ok(lengths.reduce((a, b) => a + b, 0) < MAX_CONTEXT_CHARS / 3);
  assert.ok(!readdirSync(DIR).some((n) => /инструкци/i.test(n)), "инструкции участникам в наборе нет");
});

test("скрытого содержимого заказчик не запрещает", async () => {
  const docs = await Promise.all(TEXT_FILES.map(async (n) => ({ name: n, text: await read(n) })));
  assert.equal(forbidsHidden(docs), false);
});

// Фразы из п. 23 карты — как их выпишет разбор. Что продукт делает с ними сейчас.
test("пункты второй части: ЕГРЮЛ, полномочия, декларация, устав, крупная сделка, анкета, коллективный участник", () => {
  const cases: [string, string, string][] = [
    ["Выписка из ЕГРЮЛ, полученная не ранее чем за один месяц до даты размещения извещения", "extract", "upload"],
    ["Документ, подтверждающий полномочия лица на осуществление действий от имени участника закупки (решение или приказ о назначении руководителя; доверенность)", "authority", "upload"],
    ["Декларация о соответствии участника требованиям, установленным в п. 22 документации", "declaration", "confirm"],
    ["Копии учредительных документов: Устав (все страницы), свидетельство о государственной регистрации, свидетельство о постановке на налоговый учёт", "charter", "upload"],
    ["Решение о согласии на совершение крупной сделки либо справка за подписью руководителя и главного бухгалтера, что сделка не является крупной", "bigdeal", "confirm"],
    ["Анкета участника (рекомендуемая форма)", "participant", "compose"],
    ["Соглашение между лицами, выступающими на стороне одного участника (коллективный участник)", "consortium", "not_required"],
    ["Эскиз, рисунок, чертёж, фотография, иное изображение товара", "images", "upload"],
  ];
  for (const [text, id, mode] of cases) {
    const found = rule(text);
    assert.deepEqual([found.rule, found.plan.mode], [id, mode], text);
  }
});

// ——— Известные пробелы ———

test("справка об отсутствии задолженности в свободной форме распознаётся своим правилом", { todo: "пункт 33 списка: правила нет, пункт идёт как «приложить»" }, () => {
  const found = rule("Справка в свободной форме об отсутствии задолженности по налогам, сборам за прошедший календарный год, превышающей 25 % балансовой стоимости активов");
  assert.ok(found.rule !== null);
});

test("согласие на обработку персональных данных «для физических лиц» организации не нужно", { todo: "пункт 34 списка: организации предлагают приложить" }, () => {
  const found = rule("Письменное согласие на обработку персональных данных (для физических лиц)");
  assert.equal(found.plan.mode, "not_required");
});

test("«конкретные показатели, соответствующие значениям документации» ведут в техническое предложение", { todo: "пункт 35 списка: идёт как «приложить»" }, () => {
  const found = rule("Конкретные показатели, соответствующие значениям, установленным документацией");
  assert.equal(found.plan.part, "tp");
});

test("«документы о добросовестности участника (Положение, п. 4.2)» не придумываются, а отмечаются как ссылка на Положение, которого нет", { todo: "пункт 36 списка: идёт как «приложить» без пояснения" }, () => {
  const found = rule("Документы, подтверждающие добросовестность участника (п. 4.2 раздела 4 главы 5 Положения)");
  assert.ok(found.rule !== null);
});

test("заказчик пишет «меры национального режима не применяются» — блок реестра молчит", { todo: "пункт 37 списка: блок пишет «реестр не назван — уточните»" }, async () => {
  const docs = await Promise.all(TEXT_FILES.map(async (n) => ({ name: n, text: await read(n) })));
  const demand = detectRegistryDemand(docs);
  assert.equal(demand.status, "none");
});
