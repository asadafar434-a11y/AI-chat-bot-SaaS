// Отраслевые риски по найденным фактам без ИИ: числа в выдержках поиска, выбор человека, рубли «затраты × рост» с источником — npm test (без сети).
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateNumbers, EMPTY_FACT, FACT_HYPOTHESES, factFromHit, normalizeRiskFacts, riskFactAmount, riskFactItems } from "./risk-facts.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks } from "./risk-estimate.ts";

// В суммах пробелы неразрывные; в проверках сравниваем с обычным пробелом.
const flat = (x: string) => x.replace(/\s/g, " ");

const SNIPPET = "Цены на строительные материалы с начала 2026 года выросли на 12,5 %, а арматура подорожала до 62 500 руб. за тонну; за год индекс составил 9 процентов.";

test("числа в выдержке: проценты роста подсвечены как «о росте», суммы в рублях найдены, порядок как в тексте", () => {
  const found = candidateNumbers(SNIPPET);
  assert.deepEqual(found.map((c) => [c.kind, c.text, c.growth]), [
    ["percent", "12,5", true],
    ["rub", "62 500", false],
    ["percent", "9", true],
  ]);
  assert.equal(found[0].value, 12.5);
  assert.equal(found[1].value, 62500);
  assert.match(found[0].context, /выросли на 12,5 %/);
});

test("числа в выдержке: процент без слов о росте не считается ростом; абсурдные проценты и числа без «%» и «руб.» пропускаются; не больше шести", () => {
  const plain = candidateNumbers("Налог составляет 6 % от выручки.");
  assert.equal(plain[0].growth, false);
  assert.deepEqual(candidateNumbers("Рост 1200 % за год и 5 штук, версия 2026"), []);
  const many = candidateNumbers(Array.from({ length: 9 }, (_, i) => `рост на ${i + 1} %`).join(", "));
  assert.equal(many.length, 6);
  assert.deepEqual(candidateNumbers(""), []);
  assert.equal(candidateNumbers("Подорожание на +8 %")[0].text, "8");
});

test("выбранное число из выдержки → запись факта: процент, сайт, ссылка и дословная выдержка; затраты вписывает участник", () => {
  const hit = { title: "Цены на материалы", url: "https://example.ru/stroy", domain: "example.ru", snippet: SNIPPET };
  const fact = factFromHit(candidateNumbers(SNIPPET)[0], hit, "3 000 000");
  assert.equal(fact.pct, "12,5");
  assert.equal(fact.source, "example.ru");
  assert.equal(fact.url, "https://example.ru/stroy");
  assert.match(fact.quote, /выросли на 12,5 %/);
  assert.equal(fact.base, "3 000 000");
});

test("рубли: затраты × процент роста; без затрат, без процента или с нелепым процентом — суммы нет", () => {
  assert.deepEqual(riskFactAmount({ ...EMPTY_FACT, base: "3 000 000", pct: "12,5" }), { base: 3_000_000, pct: 12.5, amount: 375_000 });
  assert.deepEqual(riskFactAmount({ ...EMPTY_FACT, base: "1 000 000,50", pct: "10" }), { base: 1_000_000.5, pct: 10, amount: 100_000.05 });
  assert.equal(riskFactAmount({ ...EMPTY_FACT, base: "", pct: "12" }), null);
  assert.equal(riskFactAmount({ ...EMPTY_FACT, base: "100", pct: "" }), null);
  assert.equal(riskFactAmount({ ...EMPTY_FACT, base: "100", pct: "900" }), null);
  assert.equal(riskFactAmount({ ...EMPTY_FACT, base: "-5", pct: "10" }), null);
});

test("строки для «Сколько это может стоить»: источник и выдержка названы, сумма входит в итог; не хватает данных — «не определено» и что вписать", () => {
  const titles = { materials: "Материалы и их цена", payroll: "Зарплаты и замена персонала" };
  const [full, partial] = riskFactItems(
    {
      materials: { base: "3 000 000", pct: "12,5", source: "example.ru", url: "https://example.ru/stroy", quote: "выросли на 12,5 %" },
      payroll: { base: "", pct: "8", source: "", url: "", quote: "" },
    },
    titles,
  );
  assert.equal(full.id, "fact-materials");
  assert.equal(full.title, "Материалы и их цена: рост цен на 12,5 %");
  assert.equal(full.amount, 375_000);
  assert.equal(full.inTotal, true);
  assert.equal(full.kind, "estimate");
  assert.match(flat(full.scenario), /3 000 000 ₽ × 12,5 % — «выросли на 12,5 %»/);
  assert.match(full.basis, /Источник: example\.ru \(https:\/\/example\.ru\/stroy\)/);
  assert.equal(partial.amount, null);
  assert.equal(partial.kind, "unknown");
  assert.match(partial.ask!, /Впишите: Фонд оплаты труда по контракту/);
  assert.match(partial.basis, /Процент вписан вами/);
});

test("в общий итог рисков суммы по фактам входят и растёт доля цены; без цены контракта их нет", () => {
  const facts = riskFactItems({ materials: { base: "3 000 000", pct: "12,5", source: "example.ru", url: "", quote: "" } }, { materials: "Материалы" });
  const base = estimateRisks({ price: 5_000_000, risks: [], type: "works", region: null, assumptions: DEFAULT_ASSUMPTIONS });
  const withFacts = estimateRisks({ price: 5_000_000, risks: [], type: "works", region: null, assumptions: DEFAULT_ASSUMPTIONS, facts });
  assert.equal(Math.round((withFacts.total - base.total) * 100) / 100, 375_000);
  assert.ok(withFacts.totalPct! > base.totalPct!);
  assert.equal(estimateRisks({ price: null, risks: [], type: "works", region: null, assumptions: DEFAULT_ASSUMPTIONS, facts }).items.length, 0);
});

test("данные из хранилища: чужие гипотезы, ссылки не http и пустые записи отбрасываются; поля обрезаются", () => {
  const n = normalizeRiskFacts({
    materials: { base: "1", pct: "2", source: "x".repeat(500), url: "javascript:alert(1)", quote: "q" },
    unknown: { base: "1", pct: "2" },
    payroll: { base: "", pct: "" },
    products: { base: "5", pct: "", url: "https://ok.ru/a" },
  });
  assert.deepEqual(Object.keys(n).sort(), ["materials", "products"]);
  assert.equal(n.materials.url, "");
  assert.equal(n.materials.source.length, 120);
  assert.equal(n.products.url, "https://ok.ru/a");
  assert.deepEqual(normalizeRiskFacts(null), {});
  assert.deepEqual(Object.keys(FACT_HYPOTHESES).sort(), ["licenses", "materials", "payroll", "products", "site", "trips"]);
});

test("выдержка вокруг числа не рвёт слова: начало и конец — по границам слов", () => {
  const text = "Аналитики отмечают, что цены на строительные материалы с начала 2026 года выросли на 12,5 %, а арматура подорожала до 62 500 руб. за тонну.";
  const [percent] = candidateNumbers(text);
  assert.match(percent.context, /^[А-Яа-яЁё0-9]/);
  assert.match(percent.context, /(?:[А-Яа-яёЁ.,%0-9])$/);
  assert.ok(text.includes(percent.context), "выдержка — дословный кусок текста");
  assert.ok(!/^\S*[а-я]{1,3}\s/.test(percent.context) || percent.context.split(" ")[0].length > 3, "первое слово целое");
});

test("число с пробелами внутри выдержки («62 500») не режется посередине", () => {
  const [percent] = candidateNumbers("Цены на материалы выросли на 12,5 %, а арматура подорожала до 62 500 руб. за тонну.");
  assert.match(percent.context, /до 62 500( руб\.)?$/);
});

test("вилка «от 5 до 20 %» и «1,5−3 %»: берётся верхняя граница как худший случай, нижняя запоминается; «вырасти» и «подорожать» — слова о росте", () => {
  const range = candidateNumbers("Расходы в 2026 году покажут рост от 5 до 20%, а минвата уже подорожала на 6% к декабрю.");
  assert.deepEqual(range.map((c) => [c.text, c.from, c.growth]), [["20", "5", true], ["6", null, true]]);
  const dash = candidateNumbers("Базовый сценарий — рост средней розничной стоимости на 1,5−3% к июлю.");
  assert.deepEqual(dash.map((c) => [c.text, c.from]), [["3", "1,5"]]);
  assert.equal(candidateNumbers("Цены на материалы могут вырасти до 15% в 2026 году")[0].growth, true);
  assert.equal(candidateNumbers("Ставка 6% годовых")[0].from, null);
});
