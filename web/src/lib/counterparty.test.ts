import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReport,
  innProblem,
  latestBoReport,
  manualLinks,
  normalizeInn,
  notFound,
  parseBoDetails,
  parseBoSearch,
  parseEgrul,
  parseFedresurs,
  statusTone,
  thousandsText,
  type Parts,
  type SourceId,
  type SourceState,
} from "./counterparty.ts";

// Ответы настоящих реестров по АО «ДГК» (ИНН 1434031363) на 25.10.2026 — урезаны до нужных полей; «Возрождение Петербурга» — организация, признанная банкротом (Федресурс).
const EGRUL = {
  rows: [
    {
      c: 'АО "ДГК"',
      g: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР: Иртов Сергей Викторович",
      cnt: "1",
      i: "1434031363",
      k: "ul",
      n: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ДАЛЬНЕВОСТОЧНАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ"',
      o: "1051401746769",
      p: "272101001",
      r: "19.12.2005",
      t: "TOKEN",
      pg: "1",
      tot: "1",
      rn: "Хабаровский край",
    },
  ],
};
const FEDRESURS = { pageData: [{ guid: "10cb58c0-8909-48ba-bb27-985e275180f1", ogrn: "1051401746769", inn: "1434031363", name: 'АО "ДГК"', egrulAddress: "680000, ХАБАРОВСКИЙ КРАЙ, Г. ХАБАРОВСК, УЛ. ФРУНЗЕ, Д. 49", status: "Действующее", isActive: true }], found: 1 };
const FEDRESURS_BANKRUPT = {
  pageData: [{ guid: "500e35b2-1148-4023-9d77-aec6d3a81312", ogrn: "1037832008191", inn: "7814123727", name: 'ООО "ВОЗРОЖДЕНИЕ ПЕТЕРБУРГА"', egrulAddress: "195277, Г.САНКТ-ПЕТЕРБУРГ", status: "Юридическое лицо признано несостоятельным (банкротом) и в отношении него открыто конкурсное производство", isActive: true }],
  found: 1,
};
const BO_SEARCH = { content: [{ id: 1449769, inn: "<strong>1434031363</strong>", shortName: 'АО "ДГК"', index: "680000", region: "ХАБАРОВСКИЙ", city: "ХАБАРОВСК", street: "ФРУНЗЕ", house: "49", statusCode: "ACTIVE", statusDate: "2022-07-25" }] };
const BO_REPORTS = [
  { id: 20698571, period: "2023", actualBfoDate: "2024-03-13", actualCorrectionDate: "2024-03-13", gainSum: 115960800, actives: 145317541 },
  { id: 27055447, period: "2025", actualBfoDate: "2026-03-18", actualCorrectionDate: "2026-03-18", gainSum: 140930138, actives: 161324221 },
  { id: 17598878, period: "2022", actualBfoDate: "2023-03-14", actualCorrectionDate: "2023-03-14", gainSum: 87732482, actives: 125586182 },
  { id: 24535060, period: "2024", actualBfoDate: "2025-06-18", actualCorrectionDate: "2025-06-18", gainSum: 120394401, actives: 145863094 },
];
// Детали отчёта за 2023 год: выручка 2110, чистая прибыль 2400, валюта баланса 1600, капитал 1300 (тысячи рублей).
const BO_DETAILS_2023 = [
  {
    balance: { current1600: 145317541, previous1600: 125586182, beforePrevious1600: 84999316, current1300: 4570355, previous1300: 12984735, beforePrevious1300: 13146316 },
    financialResult: { current2110: 115960800, previous2110: 87732482, current2400: -8414380, previous2400: -33826041 },
  },
];

const OK: SourceState = { ok: true };
const sources = (over: Partial<Record<SourceId, SourceState>> = {}): Parts["sources"] => ({ egrul: OK, fedresurs: OK, bo: OK, ...over });
const NOW = new Date("2026-10-25T09:00:00Z");

test("ИНН: 10 цифр организации и 12 цифр ИП, контрольные цифры; пробелы и дефисы не мешают; ошибка названа словами", () => {
  assert.equal(normalizeInn(" 1434 031-363 "), "1434031363");
  assert.equal(innProblem("1434031363"), null, "АО «ДГК»");
  assert.equal(innProblem("7814123727"), null, "ООО «Возрождение Петербурга»");
  assert.equal(innProblem("500100732259"), null, "12 цифр, образец ФНС");
  assert.match(innProblem("") ?? "", /Впишите ИНН/);
  assert.match(innProblem("12345") ?? "", /10 цифр у организации или 12 у ИП, а у вас 5/);
  assert.match(innProblem("1434031364") ?? "", /Контрольная цифра/);
  assert.match(innProblem("500100732258") ?? "", /Контрольная цифра/);
});

test("ЕГРЮЛ: наименование, ОГРН, КПП, дата регистрации, руководитель с должностью; строка с чужим ИНН не берётся; дата прекращения читается", () => {
  const id = parseEgrul(EGRUL, "1434031363")!;
  assert.deepEqual([id.shortName, id.ogrn, id.kpp, id.registered, id.terminated, id.region], ['АО "ДГК"', "1051401746769", "272101001", "2005-12-19", null, "Хабаровский край"]);
  assert.equal(id.name, 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ДАЛЬНЕВОСТОЧНАЯ ГЕНЕРИРУЮЩАЯ КОМПАНИЯ"');
  assert.deepEqual([id.headRole, id.headName], ["Генеральный директор", "Иртов Сергей Викторович"]);
  assert.equal(parseEgrul(EGRUL, "7814123727"), null);
  assert.equal(parseEgrul({ rows: [] }, "1434031363"), null);
  assert.equal(parseEgrul("не json", "1"), null);
  assert.equal(parseEgrul({ rows: [{ ...EGRUL.rows[0], e: "31.12.2020" }] }, "1434031363")?.terminated, "2020-12-31");
});

test("Федресурс: статус словами реестра; тон — банкротство и ликвидация красным, «Действующее» зелёным, остальное внимание", () => {
  const ok = parseFedresurs(FEDRESURS, "1434031363")!;
  assert.deepEqual([ok.guid, ok.status], ["10cb58c0-8909-48ba-bb27-985e275180f1", "Действующее"]);
  assert.equal(statusTone(ok.status), "good");
  const bad = parseFedresurs(FEDRESURS_BANKRUPT, "7814123727")!;
  assert.match(bad.status, /несостоятельным \(банкротом\)/);
  assert.equal(statusTone(bad.status), "danger");
  assert.equal(statusTone("Находится в процессе ликвидации"), "danger");
  assert.equal(statusTone("Юридическое лицо исключено из ЕГРЮЛ"), "danger");
  assert.equal(statusTone("Приостановлена деятельность"), "warn");
  assert.equal(parseFedresurs(FEDRESURS, "7814123727"), null);
});

test("ГИР БО: ИНН без тегов подсветки, адрес из частей; свежий отчёт — по году; из деталей — три года баланса и два года результата", () => {
  const org = parseBoSearch(BO_SEARCH, "1434031363")!;
  assert.deepEqual([org.id, org.status, org.address], [1449769, "ACTIVE", "680000, ХАБАРОВСКИЙ, ХАБАРОВСК, ФРУНЗЕ, д. 49"]);
  assert.equal(parseBoSearch(BO_SEARCH, "7814123727"), null);
  assert.deepEqual(latestBoReport(BO_REPORTS), { id: 27055447, period: 2025 });
  assert.equal(latestBoReport([]), null);
  assert.equal(latestBoReport({ нет: 1 }), null);
  const s = parseBoDetails(BO_DETAILS_2023, 2023);
  assert.deepEqual(s.map((x) => x.year), [2023, 2022, 2021]);
  assert.deepEqual([s[0].revenue, s[0].netProfit, s[0].assets, s[0].equity], [115960800, -8414380, 145317541, 4570355]);
  assert.deepEqual([s[1].revenue, s[1].netProfit, s[1].equity], [87732482, -33826041, 12984735]);
  assert.deepEqual([s[2].revenue, s[2].netProfit, s[2].assets], [null, null, 84999316], "за позапрошлый год в отчёте только баланс");
  assert.deepEqual(parseBoDetails(null, 2023), []);
});

test("суммы из тысяч рублей: млрд, млн, тыс.; минус настоящий; нет числа — тире", () => {
  const flat = (s: string) => s.replace(/ /g, " ");
  assert.equal(flat(thousandsText(140930138)), "140,9 млрд ₽");
  assert.equal(flat(thousandsText(-8414380)), "−8,4 млрд ₽");
  assert.equal(flat(thousandsText(115300)), "115,3 млн ₽");
  assert.equal(flat(thousandsText(830)), "830 тыс. ₽");
  assert.equal(thousandsText(null), "—");
});

test("отчёт по АО «ДГК»: действует, 20 лет, руководитель; отчётность за 2023 при ожидаемой за 2025 — «не найдена», убыток назван; капитал положительный — про него молчим", () => {
  const statements = parseBoDetails(BO_DETAILS_2023, 2023);
  const r = buildReport({ inn: "1434031363", egrul: parseEgrul(EGRUL, "1434031363"), fedresurs: parseFedresurs(FEDRESURS, "1434031363"), bo: parseBoSearch(BO_SEARCH, "1434031363"), statements, sources: sources() }, NOW);
  assert.equal(r.name, 'АО "ДГК"');
  assert.deepEqual(r.status, { text: "Действующее", tone: "good" });
  assert.equal(r.address, "680000, ХАБАРОВСКИЙ КРАЙ, Г. ХАБАРОВСК, УЛ. ФРУНЗЕ, Д. 49");
  const by = Object.fromEntries(r.facts.map((f) => [f.id, f]));
  assert.equal(by.age.text, "зарегистрирована 19.12.2005, 20 лет");
  assert.equal(by.age.tone, "muted");
  assert.deepEqual([by.head.label, by.head.text], ["Генеральный директор", "Иртов Сергей Викторович"]);
  assert.match(by.stale.text, /последняя в ГИР БО — за 2023 год, за 2025 не найдена/);
  assert.match(by.loss.text.replace(/ /g, " "), /убыток за 2023 год: −8,4 млрд ₽/);
  assert.equal(by.equity, undefined);
  assert.deepEqual(r.statements.map((s) => s.year), [2023, 2022, 2021]);
  assert.equal(notFound(r), false);
});

test("до апреля отчётность за прошлый год ещё не обязана быть; отрицательный капитал — красным; молодая компания — внимание", () => {
  const base = { inn: "1434031363", egrul: { ...parseEgrul(EGRUL, "1434031363")!, registered: "2026-03-01" }, fedresurs: parseFedresurs(FEDRESURS, "1434031363"), bo: null, sources: sources() };
  const statements = [{ year: 2024, revenue: 1000, netProfit: 50, assets: 500, equity: -200 }];
  const r = buildReport({ ...base, statements }, new Date("2026-02-10T00:00:00Z"));
  const by = Object.fromEntries(r.facts.map((f) => [f.id, f]));
  assert.equal(by.stale, undefined, "в феврале 2026 ждём отчётность за 2024, она есть");
  assert.equal(by.equity.tone, "danger");
  assert.match(by.equity.text.replace(/ /g, " "), /отрицательный на конец 2024 года: −200 тыс\. ₽/);
  assert.equal(by.loss, undefined, "прибыль — не убыток");
  const young = buildReport({ ...base, statements }, new Date("2026-10-25T00:00:00Z"));
  assert.equal(young.facts.find((f) => f.id === "age")?.text, "зарегистрирована 01.03.2026, меньше года");
  assert.equal(young.facts.find((f) => f.id === "age")?.tone, "warn");
});

test("банкротство и ликвидация: статус красный словами реестра; дата прекращения в ЕГРЮЛ сильнее слов Федресурса", () => {
  const bankrupt = buildReport({ inn: "7814123727", egrul: null, fedresurs: parseFedresurs(FEDRESURS_BANKRUPT, "7814123727"), bo: null, statements: [], sources: sources({ egrul: { ok: false, reason: "ЕГРЮЛ не ответил" } }) }, NOW);
  assert.equal(bankrupt.status?.tone, "danger");
  assert.match(bankrupt.status?.text ?? "", /признано несостоятельным \(банкротом\)/);
  assert.equal(bankrupt.name, 'ООО "ВОЗРОЖДЕНИЕ ПЕТЕРБУРГА"');
  const closed = buildReport({ inn: "1434031363", egrul: { ...parseEgrul(EGRUL, "1434031363")!, terminated: "2020-12-31" }, fedresurs: parseFedresurs(FEDRESURS, "1434031363"), bo: null, statements: [], sources: sources() }, NOW);
  assert.deepEqual(closed.status, { text: "Деятельность прекращена 31.12.2020 (ЕГРЮЛ)", tone: "danger" });
});

test("не нашли нигде — «не найдена», но только если реестры ответили; не ответил реестр — это не «нет такой организации»", () => {
  const empty = buildReport({ inn: "1434031363", egrul: null, fedresurs: null, bo: null, statements: [], sources: sources() }, NOW);
  assert.equal(notFound(empty), true);
  const down = buildReport({ inn: "1434031363", egrul: null, fedresurs: null, bo: null, statements: [], sources: sources({ fedresurs: { ok: false, reason: "не ответил" } }) }, NOW);
  assert.equal(notFound(down), false);
});

test("ссылки на ручную проверку: РНП с подставленным ИНН, КАД, ФССП и карточка Федресурса; чего реестры без капчи не дают, программа не выдумывает", () => {
  const links = manualLinks("1434031363", "10cb58c0-8909-48ba-bb27-985e275180f1");
  assert.deepEqual(links.map((l) => l.id), ["rnp", "kad", "fssp", "fedresurs"]);
  assert.match(links[0].url, /dishonestsupplier\/search\/results\.html\?searchString=1434031363$/);
  assert.equal(links[3].url, "https://fedresurs.ru/company/10cb58c0-8909-48ba-bb27-985e275180f1");
  assert.equal(manualLinks("1434031363", null)[3].url, "https://fedresurs.ru/search/entity");
});
