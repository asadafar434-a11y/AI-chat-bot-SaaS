import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findServiceVolume } from "./service-volume.ts";

// Таблица из технического задания на организацию питания в школе (Южно-Сахалинск, 23.10.2026).
const TZ = [
  "4. Объем оказываемых услуг:",
  "",
  "Категория | Количество детей | Количество учебных дней",
  "Обучающиеся 1-4 классов: | 324 | 89",
  "Обучающиеся 5-11 классов: | 94 | 89",
  "Обучающиеся c ОВЗ 1-4 классов: | 12 | 89",
  "Обучающиеся c ОВЗ 5-11 классов: | 8 | 89",
  "Обучающиеся, законные представители которых являются участниками СВО, 5-11 классов: | 12 | 89",
  "Обучающиеся дети-инвалиды 1-4 классов: | 2 | 89",
  "Обучающиеся дети-инвалиды 5-11 классов | 3 | 89",
  "Дети, посещающие ГПД на общих основаниях: | 129 | 89",
  "Дети, чьи законные представители; являются участниками СВО,; посещающие ГПД: | 16 | 89",
  "Дети с ОВЗ, дети-инвалиды посещающие ГПД: | 8 | 89",
].join("\n");

test("объём услуги питания из ТЗ: десять категорий, 608 детей, 89 дней — 54 112 детодней", () => {
  const v = findServiceVolume([{ name: "Приложение № 2 Техническое задание.docx", text: TZ }]);
  assert.ok(v);
  assert.equal(v.rows.length, 10);
  assert.equal(v.people, 608);
  assert.equal(v.total, 54112);
  assert.equal(v.unit, "детодень");
  assert.equal(v.unitsLabel, "детодней");
  assert.equal(v.rows[0].category, "Обучающиеся 1-4 классов");
  assert.deepEqual([v.rows[0].people, v.rows[0].period, v.rows[0].units], [324, 89, 28836]);
  assert.equal(v.one, "одного");
  assert.equal(v.unitOf, "детодня");
});

test("не только питание: люди × часы — человеко-часы (охрана, уборка, обслуживание)", () => {
  const v = findServiceVolume([{ name: "ТЗ", text: "Пост | Численность работников | Количество часов\nПост № 1 | 2 | 720\nПост № 2 | 1 | 360" }]);
  assert.ok(v);
  assert.equal(v.unit, "человеко-час");
  assert.equal(v.unitsLabel, "человеко-часов");
  assert.equal(v.total, 1800, "2×720 + 1×360");
  assert.equal(v.people, 3);
  const months = findServiceVolume([{ name: "ТЗ", text: "Должность | Количество сотрудников | Количество месяцев\nУборщик | 4 | 12" }]);
  assert.equal(months?.unit, "человеко-месяц");
  assert.equal(months?.total, 48);
});

test("не только люди: количество и единица измерения — м², пог. м, смены, рейсы; одна единица во всех строках", () => {
  const area = findServiceVolume([
    { name: "Ведомость.docx", text: "№ | Наименование работ | Ед. изм. | Количество\n1 | Уборка помещений первого этажа | кв. м | 1 200,5\n2 | Уборка помещений второго этажа | м2 | 800\nИтого | | м2 | 2000,5" },
  ]);
  assert.ok(area);
  assert.equal(area.unit, "м²");
  assert.equal(area.one, "одного");
  assert.equal(area.people, null);
  assert.equal(area.rows.length, 2, "строка «Итого» не входит");
  assert.equal(area.rows[0].category, "Уборка помещений первого этажа", "название берётся не из столбца с номером");
  assert.equal(area.total, 2000.5);
  const shifts = findServiceVolume([{ name: "ТЗ", text: "Наименование услуги | Единица измерения | Объём\nОхрана объекта | смена | 365" }]);
  assert.equal(shifts?.unit, "смена");
  assert.equal(shifts?.one, "одной");
  assert.equal(shifts?.total, 365);
  const trips = findServiceVolume([{ name: "ТЗ", text: "Маршрут | Ед. изм. | Кол-во\nГород — аэропорт | рейс | 40\nГород — вокзал | рейс | 60" }]);
  assert.equal(trips?.unit, "рейс");
  assert.equal(trips?.total, 100);
});

test("не объём: товары в штуках и разные единицы в одной таблице не складываются", () => {
  assert.equal(findServiceVolume([{ name: "a", text: "№ | Наименование | Ед. изм. | Количество\n1 | Стол | шт | 5\n2 | Стул | шт | 10" }]), null, "штуки — это товары");
  assert.equal(findServiceVolume([{ name: "a", text: "Наименование | Ед. изм. | Количество\nШтукатурка | м2 | 120\nБетон | м3 | 15" }]), null, "м² и м³ не складываются");
  assert.equal(findServiceVolume([{ name: "a", text: "Наименование | Ед. изм. | Количество\nШтукатурка | м2 | 120\nСтол | шт | 3" }]), null, "примесь штук — таблица смешанная");
});

test("не объём: таблица без двух числовых столбцов, итоговые строки и пояснения не считаются; у разных дней — сумма по строкам", () => {
  assert.equal(findServiceVolume([{ name: "a", text: "Категория | Количество детей\nОбучающиеся | 324" }]), null, "нет столбца дней");
  assert.equal(findServiceVolume([{ name: "a", text: "№ | Наименование | Количество\n1 | Стол | 5" }]), null);
  const v = findServiceVolume([{ name: "a", text: "Категория | Количество человек | Количество дней\nСотрудники | 10 | 20\nГости | 5 | 4\nИтого | 15 | 24\nПримечание текстом" }]);
  assert.ok(v);
  assert.equal(v.total, 220, "10×20 + 5×4; итоговая строка не входит");
  assert.equal(v.unit, "человеко-день");
});

test("настоящий файл ТЗ, прочитанный загрузкой, даёт тот же объём (если лежит рядом)", () => {
  let text = "";
  try {
    text = readFileSync("C:/Users/Win-11/AppData/Local/Temp/claude/C--Users-Win-11-Desktop-Ai-chat/ff03f48b-a779-41d7-984b-686b0167cb54/scratchpad/tz.txt", "utf8");
  } catch {
    return;
  }
  assert.equal(findServiceVolume([{ name: "ТЗ", text }])?.total, 54112);
});
