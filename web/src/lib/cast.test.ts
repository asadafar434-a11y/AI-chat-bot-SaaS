// Проверка состава исполнителей: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { castCheck, castFromDraft, castHints, castLeaks, castNote, castTodo, needLine, parseCast, rankOf, rowsOf, spreadCast, titleHints, type CastDraft, type TpCast } from "./cast.ts";

// Как в примере «Педагог года»: вокалист со званием и ансамбль из четырёх музыкантов.
const DRAFT: CastDraft = {
  clause: "3.5",
  requirement: "вокалист со званием не ниже «Заслуженный артист РФ» и ансамбль не менее 4 музыкантов",
  quote: "В заявке указываются фамилия, имя, отчество и почётное звание (при наличии) каждого исполнителя.",
  groups: [
    { title: "Вокалист", one: "Вокалист", acc: "вокалиста", count: 1, rank: "honored", match: ["вокал", "певиц"] },
    { title: "Инструментальный ансамбль", one: "Музыкант ансамбля", acc: "музыканта", count: 4, rank: "none", match: ["скрип", "фортеп", "виолонч", "флейт"] },
  ],
  replace: { rule: "Заменить исполнителя можно только по согласованию с заказчиком.", source: "Проект контракта, п. 4.5", quote: "Замена исполнителей допускается только по согласованию" },
};

const draft = () => castFromDraft(DRAFT, (q) => q.startsWith("В заявке"))!;
const named = (cast: TpCast, names: [string, string, string][]) => ({
  ...cast,
  rows: names.map(([group, name, title], i) => ({ id: `r${i}`, group, name, title })),
});

test("заготовка — пустые строки по числу людей из ТЗ", () => {
  const cast = draft();
  assert.equal(cast.rows.length, 5);
  assert.deepEqual(rowsOf(cast, "g0").map((r) => r.id), ["g0-0"]);
  assert.equal(rowsOf(cast, "g1").length, 4);
  assert.equal(cast.verified, true);
  assert.equal(cast.replace.verified, false);
  assert.equal(needLine(cast.groups[0]), "1 человек · звание не ниже «Заслуженный артист Российской Федерации»");
  assert.equal(needLine(cast.groups[1]), "не менее 4 человек");
  assert.equal(castFromDraft({ ...DRAFT, groups: [] }, () => true), undefined);
});

test("звание: народный выше заслуженного, другие не засчитываются", () => {
  assert.equal(rankOf("Заслуженная артистка России"), 1);
  assert.equal(rankOf("народный артист РФ"), 2);
  assert.equal(rankOf("Лауреат международного конкурса"), 0);
  assert.equal(rankOf(""), 0);
});

test("сверка с ТЗ по позициям", () => {
  const empty = draft();
  assert.deepEqual(castCheck(empty).map((c) => c.text), [
    "Вокалист со званием не ниже заслуженного артиста — не указан",
    "Инструментальный ансамбль — по ТЗ не менее 4 человек",
  ]);
  assert.equal(castTodo(empty), 2);

  const full = named(empty, [
    ["g0", "Соколова Мария Андреевна", "Заслуженная артистка России"],
    ["g1", "Лебедев Игорь Викторович", ""],
    ["g1", "Орлова Дарья Игоревна", ""],
    ["g1", "Ким Артём Олегович", ""],
    ["g1", "Белова Нина Петровна", ""],
  ]);
  assert.deepEqual(castCheck(full).map((c) => [c.ok, c.text]), [
    [true, "Вокалист со званием не ниже заслуженного артиста — есть"],
    [true, "Инструментальный ансамбль — 4 человека, по ТЗ не менее 4"],
  ]);
  assert.equal(castTodo(full), 0);

  const partial = named(empty, [
    ["g0", "Соколова Мария Андреевна", ""],
    ["g1", "Лебедев Игорь Викторович", ""],
    ["g1", "Орлова Дарья Игоревна", ""],
  ]);
  const [vocal, band] = castCheck(partial);
  assert.equal(vocal.text, "Вокалист со званием не ниже заслуженного артиста — впишите звание");
  assert.equal(vocal.rankFail, true);
  assert.equal(band.text, "Инструментальный ансамбль — вписано 2, по ТЗ не менее 4");
  assert.equal(castNote(partial.groups[0], partial.rows[0], vocal.rankFail), "Впишите звание: по ТЗ — не ниже «Заслуженный артист Российской Федерации»");

  const wrong = named(empty, [["g0", "Соколова Мария Андреевна", "Лауреат международного конкурса"]]);
  assert.equal(castCheck(wrong)[0].text, "Вокалист со званием не ниже заслуженного артиста — у вписанного нет такого звания");
  assert.match(castNote(wrong.groups[0], wrong.rows[0], true), /^Не вижу нужного звания/);
});

test("список раскладывается по позициям: по роли, по званию, по порядку", () => {
  const list = [
    "1. Лебедев Игорь Викторович, скрипка, лауреат международного конкурса",
    "Соколова Мария Андреевна — вокал — заслуженная артистка России",
    "",
    "- Орлова Дарья Игоревна, фортепиано",
    "Ким Артём Олегович",
    "Белова Нина Петровна",
    "Громов Павел Сергеевич",
  ].join("\n");
  const people = parseCast(list);
  assert.equal(people.length, 6);
  assert.deepEqual(people[0], { name: "Лебедев Игорь Викторович", title: "Лауреат международного конкурса", rest: "скрипка лауреат международного конкурса" });
  assert.equal(people[1].title, "Заслуженная артистка России");

  let n = 0;
  const { cast, added } = spreadCast(draft(), list, () => `new${++n}`);
  assert.equal(added, 6);
  assert.deepEqual(rowsOf(cast, "g0").map((r) => r.name), ["Соколова Мария Андреевна"]);
  // Лишний — новой строкой в ансамбле.
  assert.deepEqual(rowsOf(cast, "g1").map((r) => r.name), [
    "Лебедев Игорь Викторович",
    "Орлова Дарья Игоревна",
    "Ким Артём Олегович",
    "Белова Нина Петровна",
    "Громов Павел Сергеевич",
  ]);
  assert.equal(rowsOf(cast, "g1")[4].id, "new1");

  // Роль не названа: человек со званием — туда, где звание нужно.
  const byTitle = spreadCast(draft(), "Орлова Дарья Игоревна\nГромов Павел Сергеевич, народный артист России", () => "x").cast;
  assert.deepEqual(rowsOf(byTitle, "g0").map((r) => r.name), ["Громов Павел Сергеевич"]);
  assert.equal(rowsOf(byTitle, "g1")[0].name, "Орлова Дарья Игоревна");

  // Кто уже в составе, второй раз не добавляется.
  assert.equal(spreadCast(cast, "Ким Артём Олегович\nким артём олегович", () => "y").added, 0);
});

test("подсказки: по началу любого слова, без тех, кто уже в составе", () => {
  const history = [
    { name: "Соколова Мария Андреевна", title: "Заслуженная артистка России", from: "Учитель года — 2025" },
    { name: "Соловьёв Денис Андреевич", title: "", from: "Выпускной — 2025" },
    { name: "Громов Павел Сергеевич", title: "Народный артист России", from: "День города — 2024" },
    { name: "Соколова Мария Андреевна", title: "", from: "повтор" },
  ];
  const cast = draft();
  assert.deepEqual(castHints(history, cast, "Со").map((h) => h.name), ["Соколова Мария Андреевна", "Соловьёв Денис Андреевич"]);
  assert.deepEqual(castHints(history, cast, "соловьев").map((h) => h.name), ["Соловьёв Денис Андреевич"]);
  assert.deepEqual(castHints(history, cast, "павел").map((h) => h.name), ["Громов Павел Сергеевич"]);
  assert.deepEqual(castHints(history, cast, ""), []);
  const busy = named(cast, [["g0", "Соколова Мария Андреевна", ""]]);
  assert.deepEqual(castHints(history, busy, "Со").map((h) => h.name), ["Соловьёв Денис Андреевич"]);
  assert.deepEqual(titleHints("засл"), ["Заслуженный артист России", "Заслуженная артистка России"]);
  assert.equal(titleHints("").length, 6);
});

test("фамилия подписанта среди исполнителей", () => {
  const cast = named(draft(), [["g0", "Иванова Анна Петровна", ""]]);
  assert.deepEqual(castLeaks(cast, "Иванова А. П."), ["Иванова"]);
  assert.deepEqual(castLeaks(cast, "Петрова А. П."), []);
  assert.deepEqual(castLeaks(undefined, "Иванова А. П."), []);
});
