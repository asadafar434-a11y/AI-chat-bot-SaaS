// Второй реестр — выгрузка радиоэлектронной продукции (РЭП, ПП 878): другие названия колонок, лишние колонки, свои номера и подпись
// строки, проверка номера в своём реестре, а не в чужом — npm test. Данные выдуманные: настоящих записей в тестах нет.
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { applyEdits, cardsFromGoods } from "./product-card.ts";
import { isHeaderRow, parseRow, resolveHeader, type Cell } from "./registry-format.ts";
import { PREFACE, asRows, fixtureRecord, seededStore, serial } from "./registry-fixtures.ts";
import { importRegistry } from "./registry-import.ts";
import { goodsWithRegistry } from "./registry-lines.ts";
import { EMPTY_REGISTRY_STATE, autofillCheck, selectRecord } from "./registry-log.ts";
import { createMemoryRegistryStore } from "./registry-store.ts";
import { resolveCard } from "./registry-service.ts";
import { gispUrl, registryLine } from "./registry-types.ts";
import { fileFromRequest } from "./tp-docx-request.ts";
import { rejectUnknownRegistryNumbers } from "../server/registry/verify.ts";
import { fixtureRow } from "./registry-fixtures.ts";

const NOW = new Date("2026-10-12T09:00:00Z");
const AS_OF = "2026-11-20";

// Заголовок выгрузки радиоэлектронной продукции — как в настоящем файле.
const REP_HEADER = [
  "№ п/п", "Наименование предприятия", "ИНН", "ОГРН", "Фактический адрес производителя", "Адрес производственных помещений",
  "Первичный регистрационный номер реестровой записи", "Реестровый номер", "Номер цифрового паспорта", "Дата внесения в реестр", "Срок действия",
  "Фактическая дата прекращения действия реестровой записи", "Наименование продукции", "ОКПД 2", "ТН ВЭД", "Изготовлена по", "Баллы",
  "Процентный показатель", "О соответствии", "Искусственный интеллект", "Высокотехнологичное оборудование", "Доверенный ПАК",
  "Уровень радиоэлектронной продукции", "Основание: Наименование", "Основание: Дата", "Основание: Номер", "Основание: Срок действия",
  "Заключение: Департамент", "Заключение: Номер заключения", "Заключение: Документ", "Ссылка на выписку из реестра", "Ссылка на каталог продукции",
];

const GISP_EXTRACT = "https://gisp.gov.ru/pp719v2/app/000001/product/00000001/writeout/zip_sd";

function repRow(over: Record<string, Cell> & { "Реестровый номер": string }): Cell[] {
  const base: Record<string, Cell> = {
    "№ п/п": 1,
    "Наименование предприятия": 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"',
    "ИНН": "9900000077",
    "ОГРН": "9990000000077",
    "Дата внесения в реестр": serial("2026-09-01"),
    "Срок действия": serial("2029-09-01"),
    "Наименование продукции": "Тестовый коммутатор КМ-1",
    "ОКПД 2": "26.30.11.110",
    "ТН ВЭД": "8517 62 000 0",
    "Изготовлена по": "ТЕСТ.000000.001 ТУ",
    "Искусственный интеллект": false,
    "Высокотехнологичное оборудование": false,
    "Доверенный ПАК": false,
    "Уровень радиоэлектронной продукции": "Уровень 2",
    "Основание: Наименование": "СТ-1",
    "Основание: Дата": serial("2026-09-01"),
    "Основание: Номер": "ТЕСТ-РЭП-1",
    "Заключение: Департамент": "Тестовый департамент",
    "Ссылка на выписку из реестра": GISP_EXTRACT,
    "Ссылка на каталог продукции": "https://gisp.gov.ru/goods/#/product/1",
    ...over,
  };
  return REP_HEADER.map((name) => base[name]);
}

test("выгрузка РЭП: «Наименование предприятия» и «ОКПД 2» узнаются, лишние колонки известны — загрузка не останавливается", () => {
  assert.equal(isHeaderRow(REP_HEADER), true);
  const header = resolveHeader(REP_HEADER);
  assert.deepEqual(header.missing, []);
  assert.deepEqual(header.unknown, [], "ни одна колонка не потеряна молча");
  for (const key of ["enterprise", "okpd2", "radioLevel", "extractUrl", "catalogUrl"] as const) assert.notEqual(header.columns[key], undefined, key);
});

test("строка РЭП: уровень и выписка сохраняются, ссылка на чужой сайт — нет", () => {
  const header = resolveHeader(REP_HEADER);
  const ok = parseRow(header, { rowNumber: 4, cells: repRow({ "Реестровый номер": "00007001" }) });
  assert.ok(ok.ok);
  assert.equal(ok.row.enterpriseName, 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"');
  assert.equal(ok.row.okpd2, "26.30.11.110");
  assert.equal(ok.row.flags.radioLevel, "Уровень 2");
  assert.equal(ok.row.flags.extractUrl, GISP_EXTRACT);

  const hostile = parseRow(header, {
    rowNumber: 5,
    cells: repRow({ "Реестровый номер": "00007002", "Ссылка на выписку из реестра": "https://gisp.gov.ru.evil.example/x", "Ссылка на каталог продукции": "javascript:alert(1)" }),
  });
  assert.ok(hostile.ok);
  assert.equal(hostile.row.flags.extractUrl, undefined);
  assert.equal(hostile.row.flags.catalogUrl, undefined);
  assert.deepEqual(hostile.row.warnings.filter((w) => w.startsWith("ссылка")).sort(), ["ссылка:выписка", "ссылка:каталог"]);
});

test("адрес выписки: только https на gisp.gov.ru", () => {
  assert.equal(gispUrl(GISP_EXTRACT), GISP_EXTRACT);
  for (const bad of ["http://gisp.gov.ru/x", "https://evilgisp.gov.ru/x", "https://gisp.gov.ru.evil.example/x", "javascript:alert(1)", "", null, 7]) assert.equal(gispUrl(bad), null, String(bad));
});

test("записи первого реестра не получают лишних ключей: их отпечаток при повторной загрузке не меняется", () => {
  const parsed = parseRow(resolveHeader(["Предприятие", "ИНН", "Реестровый номер", "Наименование продукции", "ОКПД2", "Дата внесения в реестр", "Срок действия"]), {
    rowNumber: 4,
    cells: ["ТЕСТОВОЕ ПРЕДПРИЯТИЕ", "9900000001", "00000001", "Тестовое кресло", "31.01.12.160", serial("2026-09-01"), serial("2029-09-01")],
  });
  assert.ok(parsed.ok);
  assert.deepEqual(Object.keys(parsed.row.flags).sort(), ["ai", "highTech", "trustedPak"]);
});

test("два реестра в одном хранилище не мешают друг другу: тот же номер — две разные записи, загрузка РЭП не гасит РПП", async () => {
  const store = createMemoryRegistryStore();
  const common = { fileName: "f.xlsx", now: new Date("2026-10-12T00:00:00Z") };
  const rpp = await importRegistry(store, {
    ...common, registryKind: "gisp_rpp_719", fileSha256: "rpp-1",
    rows: asRows(PREFACE, [fixtureRow({ number: "00007001" }), fixtureRow({ number: "00007003", name: "Тестовый стол" }), fixtureRow({ number: "00007004", name: "Тестовый шкаф" })]),
  });
  assert.equal(rpp.report.recordsAdded, 3);

  const rep = await importRegistry(store, {
    ...common, registryKind: "gisp_rep_878", fileSha256: "rep-1",
    rows: asRows(PREFACE, [repRow({ "Реестровый номер": "00007001" })], REP_HEADER),
  });
  assert.equal(rep.report.recordsAdded, 1);
  assert.equal(rep.report.recordsAbsent, 0);
  assert.equal(rep.report.unknownColumns.length, 0);
  assert.equal(await store.countActive("gisp_rpp_719"), 3, "записи РПП остались действующими");
  assert.equal(await store.countActive("gisp_rep_878"), 1);

  const inRpp = await store.getByNumber("gisp_rpp_719", "00007001");
  const inRep = await store.getByNumber("gisp_rep_878", "00007001");
  assert.equal(inRpp?.productName, "Тестовое кресло офисное");
  assert.equal(inRep?.productName, "Тестовый коммутатор КМ-1");
  assert.equal(inRep?.flags.radioLevel, "Уровень 2");
  assert.equal((await store.latestDataset("gisp_rep_878"))?.registryKind, "gisp_rep_878");
  assert.equal(await store.getByNumber("gisp_rep_878", "00007003"), null, "номер, которого нет в РЭП, там не появляется");
});

test("строка в заявке подписана тем реестром, из которого номер: РЭП — радиоэлектронной продукции, без вида — РПП", () => {
  assert.equal(registryLine("00007001", "gisp_rep_878"), "Номер реестровой записи в реестре российской радиоэлектронной продукции: 00007001");
  assert.equal(registryLine("00007001", "gisp_rpp_719"), "Номер реестровой записи в реестре российской промышленной продукции: 00007001");
  assert.equal(registryLine("00007001"), registryLine("00007001", "gisp_rpp_719"));
  const [good] = goodsWithRegistry([{ name: "Коммутатор", characteristics: "Портов: [число, не меньше 24]", quantity: "2", registryNumber: "00007001", registryKind: "gisp_rep_878" as const }]);
  assert.ok(good.characteristics.endsWith("в реестре российской радиоэлектронной продукции: 00007001"));
});

const GOODS = [{ name: "Коммутатор", quantity: "2 шт", source: "ТЗ", quote: "Коммутатор, 2 шт" }];

async function chooseFrom(kind: "gisp_rpp_719" | "gisp_rep_878") {
  const [card0] = cardsFromGoods(GOODS, [], {});
  const card = applyEdits(card0, { inn: "9900000077", model: "КМ-1" });
  const record = fixtureRecord({
    registryKind: kind,
    registryNumber: "00007001",
    enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"',
    inn: "9900000077",
    productName: "Тестовый коммутатор КМ-1",
    okpd2: "26.30.11.110",
    flags: { ai: false, highTech: false, trustedPak: false, radioLevel: "Уровень 2", extractUrl: GISP_EXTRACT },
  });
  const store = await seededStore([record], undefined, kind);
  const decision = await resolveCard(store, card, { registry: kind, asOf: AS_OF, now: NOW });
  return { card, decision, store };
}

test("поиск в РЭП: кандидат несёт уровень и выписку; выбор подтверждается, строка — «радиоэлектронной продукции»", async () => {
  const { card, decision } = await chooseFrom("gisp_rep_878");
  assert.equal(decision.status, "confirmed");
  assert.equal(decision.proposed, "00007001");
  const view = decision.candidates[0];
  assert.equal(view.radioLevel, "Уровень 2");
  assert.equal(view.extractUrl, GISP_EXTRACT);

  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: "00007001", now: NOW });
  assert.ok(picked.ok);
  const check = autofillCheck({ choice: picked.state.choices[card.key], card, requiredRegistry: "gisp_rep_878", asOf: AS_OF });
  assert.ok(check.ok);
  assert.equal(check.line, registryLine("00007001", "gisp_rep_878"));
  // Закупка требует РПП, а запись выбрана в РЭП (или наоборот) — номер не подставляется.
  const wrong = autofillCheck({ choice: picked.state.choices[card.key], card, requiredRegistry: "gisp_rpp_719", asOf: AS_OF });
  assert.equal(wrong.ok, false);
  assert.match(wrong.ok ? "" : wrong.reason, /другого реестра/);
});

test("загружен только РПП, а закупка требует РЭП — ищем в том, что есть, но номер из РПП в заявку по требованию РЭП не идёт", async () => {
  const { card, store } = await chooseFrom("gisp_rpp_719");
  const decision = await resolveCard(store, card, { registry: "gisp_rep_878", asOf: AS_OF, now: NOW });
  assert.equal(decision.status, "confirmed");
  assert.deepEqual(decision.search.searched, ["gisp_rpp_719"]);
  const view = decision.candidates[0];
  assert.equal(view.registryKind, "gisp_rpp_719");
  const picked = selectRecord(EMPTY_REGISTRY_STATE, { card, decision, registryNumber: view.registryNumber, now: NOW });
  assert.ok(picked.ok);
  const check = autofillCheck({ choice: picked.state.choices[card.key], card, requiredRegistry: "gisp_rep_878", asOf: AS_OF });
  assert.equal(check.ok, false);
  assert.match(check.ok ? "" : check.reason, /другого реестра/);
});

test("ни одной выгрузки — поиска нет, номер не придумывается", async () => {
  const [card] = cardsFromGoods(GOODS, [], {});
  const decision = await resolveCard(createMemoryRegistryStore(), card, { asOf: AS_OF, now: NOW });
  assert.equal(decision.status, "no_dataset");
  assert.equal(decision.proposed, null);
  assert.deepEqual(decision.search.searched, []);
});

test("поиск идёт сразу в обоих реестрах: номер в обоих — одна строка с двумя реестрами; описание берётся из реестра, который назвала закупка", async () => {
  const [card0] = cardsFromGoods(GOODS, [], {});
  const card = applyEdits(card0, { inn: "9900000077", model: "КМ-1" });
  const shared = { registryNumber: "00007001", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"', inn: "9900000077", productName: "Тестовый коммутатор КМ-1", okpd2: "26.30.11.110" };
  const only = fixtureRecord({ registryKind: "gisp_rep_878", registryNumber: "00007002", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"', inn: "9900000077", productName: "Тестовый коммутатор КМ-1М", okpd2: "26.30.11.110" });
  const store = createMemoryRegistryStore();
  await seededStore([fixtureRecord({ registryKind: "gisp_rpp_719", ...shared })], undefined, "gisp_rpp_719", store);
  await seededStore([fixtureRecord({ registryKind: "gisp_rep_878", ...shared, flags: { ai: false, highTech: false, trustedPak: false, radioLevel: "Уровень 1" } }), only], undefined, "gisp_rep_878", store);

  const plain = await resolveCard(store, card, { asOf: AS_OF, now: NOW });
  assert.deepEqual(plain.search.searched, ["gisp_rpp_719", "gisp_rep_878"]);
  assert.equal(plain.candidates.filter((c) => c.registryNumber === "00007001").length, 1, "один номер — одна строка, а не две");
  const both = plain.candidates.find((c) => c.registryNumber === "00007001")!;
  assert.deepEqual(both.registries, ["gisp_rpp_719", "gisp_rep_878"]);
  assert.equal(both.registryKind, "gisp_rpp_719", "закупка реестр не назвала — первый по списку");
  assert.equal(plain.proposed, "00007001");
  assert.ok(plain.search.filters[0].startsWith("Реестры: "));

  const demanded = await resolveCard(store, card, { registry: "gisp_rep_878", asOf: AS_OF, now: NOW });
  const same = demanded.candidates.find((c) => c.registryNumber === "00007001")!;
  assert.equal(same.registryKind, "gisp_rep_878", "закупка назвала РЭП — запись описана по РЭП, подпись в заявке будет по нему");
  assert.equal(same.radioLevel, "Уровень 1");
  assert.deepEqual(same.registries, ["gisp_rep_878", "gisp_rpp_719"]);
});

test("реестры расходятся в сведениях об одном номере — строка одна, но с предупреждением", async () => {
  const [card0] = cardsFromGoods(GOODS, [], {});
  const card = applyEdits(card0, { inn: "9900000077", model: "КМ-1" });
  const base = { registryNumber: "00007003", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"', inn: "9900000077", productName: "Тестовый коммутатор КМ-1", okpd2: "26.30.11.110" };
  const store = createMemoryRegistryStore();
  await seededStore([fixtureRecord({ registryKind: "gisp_rpp_719", ...base, validUntil: "2029-09-01", validUntilMin: "2029-09-01" })], undefined, "gisp_rpp_719", store);
  await seededStore([fixtureRecord({ registryKind: "gisp_rep_878", ...base, validUntil: "2027-01-01", validUntilMin: "2027-01-01" })], undefined, "gisp_rep_878", store);
  const decision = await resolveCard(store, card, { asOf: AS_OF, now: NOW });
  const view = decision.candidates.find((c) => c.registryNumber === "00007003")!;
  assert.equal(decision.candidates.filter((c) => c.registryNumber === "00007003").length, 1);
  assert.ok(view.activity.warnings.some((w) => /реестры расходятся.*срок действия/.test(w)));
});

test("перед сборкой файла номер проверяется в своём реестре: он есть в РПП, но в РЭП его нет — в файле пометка «проверьте»", async () => {
  const asked: string[] = [];
  const lookup = async (kind: string, numbers: string[]) => {
    asked.push(`${kind}:${numbers.join(",")}`);
    return kind === "gisp_rpp_719" ? new Set(numbers) : new Set<string>();
  };
  const goods: { name: string; characteristics: string; quantity: string; registryNumber?: string; registryKind?: "gisp_rpp_719" | "gisp_rep_878"; registryRejected?: boolean }[] = [
    { name: "Кресло", characteristics: "x", quantity: "1", registryNumber: "00007001", registryKind: "gisp_rpp_719" },
    { name: "Коммутатор", characteristics: "y", quantity: "1", registryNumber: "00007001", registryKind: "gisp_rep_878" },
    { name: "Старый запрос без вида", characteristics: "z", quantity: "1", registryNumber: "00007001" },
  ];
  await rejectUnknownRegistryNumbers(goods, lookup);
  assert.deepEqual(asked.sort(), ["gisp_rep_878:00007001", "gisp_rpp_719:00007001"]);
  assert.equal(goods[0].registryNumber, "00007001");
  assert.equal(goods[1].registryNumber, undefined);
  assert.equal(goods[1].registryRejected, true);
  assert.equal(goods[2].registryNumber, "00007001", "без вида реестра — как раньше, РПП");
});

const FORM = { title: "Заявка", source: "", participantFields: [], consent: "Согласие", hasPrice: false, priceNote: "", smeDeclaration: "", goodsTableHeaders: [] as string[] };

async function textOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

test("запрос на файл: вид реестра из запроса попадает в подпись строки; неизвестный вид заменяется на РПП", async () => {
  const rep = await fileFromRequest({ part: "tp", subject: "Т", form: FORM, goods: [{ name: "Коммутатор", characteristics: "x", quantity: "2", registryNumber: "00007001", registryKind: "gisp_rep_878" }] });
  assert.ok(rep.ok);
  assert.ok((await textOf(rep.buffer)).includes("в реестре российской радиоэлектронной продукции: 00007001"));

  const unknown = await fileFromRequest({ part: "tp", subject: "Т", form: FORM, goods: [{ name: "Коммутатор", characteristics: "x", quantity: "2", registryNumber: "00007001", registryKind: "какой-то_реестр" }] });
  assert.ok(unknown.ok);
  const text = await textOf(unknown.buffer);
  assert.ok(text.includes("в реестре российской промышленной продукции: 00007001"));
  assert.equal(text.includes("радиоэлектронной"), false);
});

test("запись есть в обоих реестрах, закупка реестр не назвала — уровень и выписка из РЭП всё равно показаны", async () => {
  const [card0] = cardsFromGoods(GOODS, [], {});
  const card = applyEdits(card0, { inn: "9900000077", model: "КМ-1" });
  const base = { registryNumber: "00007004", enterpriseName: 'ТЕСТОВОЕ ПРЕДПРИЯТИЕ "РАДИО"', inn: "9900000077", productName: "Тестовый коммутатор КМ-1", okpd2: "26.30.11.110" };
  const store = createMemoryRegistryStore();
  await seededStore([fixtureRecord({ registryKind: "gisp_rpp_719", ...base })], undefined, "gisp_rpp_719", store);
  await seededStore([fixtureRecord({ registryKind: "gisp_rep_878", ...base, flags: { ai: false, highTech: false, trustedPak: false, radioLevel: "Уровень 2", extractUrl: GISP_EXTRACT } })], undefined, "gisp_rep_878", store);
  const view = (await resolveCard(store, card, { asOf: AS_OF, now: NOW })).candidates[0];
  assert.equal(view.registryKind, "gisp_rpp_719");
  assert.equal(view.radioLevel, "Уровень 2");
  assert.equal(view.extractUrl, GISP_EXTRACT);
});
