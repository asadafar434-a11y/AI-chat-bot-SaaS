// Числовые условия заказчика: поиск в тексте, сверка значения участника, подсказки для жёлтых мест — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptableValue,
  describeCondition,
  hintOf,
  hintProblem,
  mentionKey,
  mentionsOf,
  numbersIn,
  parseConditions,
  parseHint,
  satisfies,
  unitKey,
} from "./conditions.ts";

const brief = (text: string) => parseConditions(text).map((c) => [c.op, c.value, c.value2, c.unit, c.term].filter((x) => x !== undefined));

test("граница снизу и сверху: «не менее», «не более», «минимум», «не ниже»", () => {
  assert.deepEqual(brief("зал вместимостью не менее 150 мест в пределах города"), [["min", 150, "мест"]]);
  assert.deepEqual(brief("масса не более 5 кг"), [["max", 5, "кг"]]);
  assert.deepEqual(brief("Ведущий — с опытом не меньше 3 лет."), [["min", 3, "лет"]]);
  assert.deepEqual(brief("минимум 2 радиомикрофона"), [["min", 2, "радиомикрофона"]]);
  assert.deepEqual(brief("температура не выше 25 °C"), [["max", 25, "°c"]]);
  assert.deepEqual(brief("не менее чем на 5 % ниже"), [["min", 5, "%"]]);
});

test("слабые слова — «от», «до», «свыше», «менее» — условие только с единицей: «до 30» без единицы условием не считается", () => {
  assert.deepEqual(brief("от 150 мест"), [["min", 150, "мест"]]);
  assert.deepEqual(brief("до 5 лет"), [["max", 5, "лет"]]);
  assert.deepEqual(brief("свыше 3 лет опыта"), [["gt", 3, "лет"]]);
  assert.deepEqual(brief("менее 10 % от цены"), [["lt", 10, "%"]]);
  assert.deepEqual(brief("до 30 в ответе"), []);
  assert.deepEqual(brief("от 1 штуки"), [["min", 1, "штуки"]]);
});

test("даты, время, номера пунктов и годы — не условия", () => {
  assert.deepEqual(brief("Заявки принимаются до 30.09.2026 10:00 (МСК)"), []);
  assert.deepEqual(brief("с 15:00 до 19:00"), []);
  assert.deepEqual(brief("до 10:00"), []);
  assert.deepEqual(brief("с 01.10.2026 по 05.10.2026"), []);
  assert.deepEqual(brief("действует до 2026 года"), []);
  assert.deepEqual(brief("до 5 числа каждого месяца"), []);
  assert.deepEqual(brief("в соответствии с п. 2.1 и пп. 3 приложения 5"), []);
  assert.deepEqual(brief("с 10 до 12 часов"), []);
});

test("диапазон: «от 3 до 5 лет», «в диапазоне от 10 до 20 мм»", () => {
  assert.deepEqual(brief("опыт от 3 до 5 лет"), [["range", 3, 5, "лет"]]);
  assert.deepEqual(brief("толщина в диапазоне от 10 до 20 мм"), [["range", 10, 20, "мм"]]);
  assert.deepEqual(brief("продолжительность от 2 до 4 часов"), [["range", 2, 4, "часов"]]);
  // Диапазон разбирается целиком: «от 3» и «до 5» отдельными условиями не появляются.
  assert.equal(parseConditions("опыт от 3 до 5 лет").length, 1);
  assert.deepEqual(brief("с 15:00 до 19:00 часов"), []);
});

test("«не менее A и не более B» — одно условие-диапазон: значение должно лежать между границами", () => {
  assert.deepEqual(brief("плотность: не менее 1020 г/м2 и не более 1100 г/м2"), [["range", 1020, 1100, "г/м2"]]);
  assert.deepEqual(brief("ширина: не менее 37 см и не более 40 см, длина ручек: не менее 32 см и не более 35 см"), [
    ["range", 37, 40, "см"],
    ["range", 32, 35, "см"],
  ]);
  // Единица стоит один раз — после второй границы.
  assert.deepEqual(brief("емкость аккумулятора: не менее 1000 не более 1500 ма/ч"), [["range", 1000, 1500, "ма/ч"]]);
  assert.deepEqual(brief("не более 40% и не менее 30%"), [["range", 30, 40, "%"]]);
  // Границы в разных ячейках таблицы или с чужим текстом между ними — разные условия.
  assert.deepEqual(brief("масса не менее 5 кг | высота не более 10 см"), [["min", 5, "кг"], ["max", 10, "см"]]);
  assert.deepEqual(brief("не менее 5 кг, а длина не более 10 кг"), [["min", 5, "кг"], ["max", 10, "кг"]]);
  const [c] = parseConditions("плотность: не менее 1020 г/м2 и не более 1100 г/м2.");
  assert.equal(c.raw, "не менее 1020 г/м2 и не более 1100 г/м2");
});

test("диапазон размеров «не менее 125×65×15 и не более 130×70×20 мм»: стороны сравниваются от большей к меньшей", () => {
  const [c] = parseConditions("Размер: не менее 125х65х15 мм и не более 130х70х20 мм.");
  assert.deepEqual([c.op, c.parts, c.parts2, c.unit], ["range", [125, 65, 15], [130, 70, 20], "мм"]);
  assert.equal(hintOf(c), "[размер, от 125×65×15 до 130×70×20]");
  assert.equal(describeCondition(c), "от 125×65×15 до 130×70×20 мм");
  assert.equal(satisfies(c, [128, 68, 18]), true);
  assert.equal(satisfies(c, [68, 128, 18]), true, "порядок сторон не важен");
  assert.equal(satisfies(c, [131, 68, 18]), false);
  assert.equal(satisfies(c, [128, 64, 18]), false);
  assert.deepEqual(parseHint("[размер, от 125×65×15 до 130×70×20]"), { op: "range", value: 125, value2: 130, parts: [125, 65, 15], parts2: [130, 70, 20] });
  assert.equal(hintProblem(parseHint("[размер, от 125×65×15 до 130×70×20]")!, "140×70×20"), "140×70×20 — по ТЗ от 125×65×15 до 130×70×20");
  // Размеры и одно число — не пара: границы не склеиваются.
  assert.deepEqual(brief("не менее 3×2 м и не более 10 м"), [["min", 3, "м"], ["max", 10, "м"]]);
});

test("одна единица в разной записи: «м» и «метра», «г/м²» и «гр./кв.м», но не «г/м²» и «м²»", () => {
  assert.deepEqual(brief("ширина – не менее 0,80 м и не более 1 метра"), [["range", 0.8, 1, "м"]]);
  assert.deepEqual(brief("баннерная ткань не менее 550 гр./кв.м и не более 600 гр./кв.м."), [["range", 550, 600, "гр./кв.м"]]);
  assert.equal(unitKey("г/м²"), unitKey("гр./кв.м"));
  assert.equal(unitKey("г/м2"), unitKey("г/м²"));
  assert.notEqual(unitKey("г/м²"), unitKey("м²"));
  assert.equal(unitKey("квадратных метров"), unitKey("м²"));
  assert.equal(unitKey("сантиметров"), unitKey("см"));
  assert.deepEqual(brief("не менее 25 см и не боле 26 см"), [["range", 25, 26, "см"]], "опечатка «не боле» не мешает");
  assert.deepEqual(brief("установка по периметру не менее чем через 300 мм и не более 350 мм"), [["range", 300, 350, "мм"]]);
  assert.deepEqual(brief("не менее 440 гр. и не более 550 гр."), [["range", 440, 550, "гр"]]);
});

test("граница ячейки таблицы: настоящая единица из соседней ячейки берётся, чужое слово — нет", () => {
  assert.deepEqual(brief("количество каналов: не менее 16 | функция «нажми и говори»"), [["min", 16, ""]]);
  assert.deepEqual(brief("опыт работы не менее 3 | Внешний вид одежды"), [["min", 3, ""]]);
  assert.deepEqual(brief("Мощность | не менее 40 | кВт | 1 шт."), [["min", 40, "квт"]]);
  assert.deepEqual(brief("Вес | не менее 300 | г | Рабочая температура"), [["min", 300, "г"]]);
  assert.deepEqual(brief("Масса | не более 5 | в наличии"), [["max", 5, ""]], "«в» в начале чужого слова — не вольт");
  assert.deepEqual(brief("Плотность | не менее 80 | г/м2 | бумага"), [["min", 80, "г/м2"]]);
});

test("отрицательные числа, двоеточие после границы, «3-х», метки страниц PDF", () => {
  assert.deepEqual(brief("рабочая температура: от -20 до 40 °C"), [["range", -20, 40, "°c"]]);
  assert.deepEqual(brief("размер не менее: 7000х4000 мм."), [["min", 7000, "мм"]]);
  assert.equal(parseConditions("размер не менее: 7000х4000 мм.")[0].parts?.join("x"), "7000x4000");
  assert.deepEqual(brief("праздничные концерты (не менее 3-х концертов)"), [["min", 3, "концертов"]]);
  assert.deepEqual(brief("не менее 5-ти человек"), [["min", 5, "человек"]]);
  assert.deepEqual(brief("мощностью не менее 900 Вт - 4 шт. 27 -- 27 of 92 -- - активный сабвуфер"), [["min", 900, "вт"]]);
});

test("как пишут в извещениях: числа словами, «25 и более процентов», «не может составлять менее», «2х вариантов»", () => {
  assert.deepEqual(brief("составляет не более чем двадцать пять процентов"), [["max", 25, "процентов"]]);
  assert.deepEqual(brief("цена снижена на 25 и более процентов от начальной"), [["min", 25, "процентов"]]);
  assert.deepEqual(brief("срок действия не может составлять менее одного месяца"), [["min", 1, "месяца"]]);
  assert.deepEqual(brief("размер не должен превышать 10 минут"), [["max", 10, "минут"]]);
  assert.deepEqual(brief("не должно быть более 3 человек"), [["max", 3, "человек"]]);
  assert.deepEqual(brief("не менее чем на один месяц"), [["min", 1, "месяц"]]);
  assert.deepEqual(brief("эскиз не менее 2х вариантов"), [["min", 2, "вариантов"]]);
  assert.deepEqual(brief("не менее чем за пять рабочих дней до даты"), [["min", 5, "рабочих дней", true]]);
});

test("несколько прилагательных подряд входят в единицу вместе с существительным", () => {
  assert.deepEqual(brief("не менее 5 тематических сувенирных продуктов"), [["min", 5, "тематических сувенирных продуктов"]]);
  assert.deepEqual(brief("от 2 (двух) до 3 (трёх) ведущих на каждый день"), [["range", 2, 3, "ведущих"]]);
});

test("«и более», «или менее» после числа", () => {
  assert.deepEqual(brief("150 мест и более"), [["min", 150, "мест"]]);
  assert.deepEqual(brief("5 лет или менее"), [["max", 5, "лет"]]);
});

test("числа: с пробелами и запятой, словами, со скобками", () => {
  assert.deepEqual(brief("цена не более 685 000,00 руб."), [["max", 685000, "руб"]]);
  assert.deepEqual(brief("не менее 3 000 000 руб."), [["min", 3000000, "руб"]]);
  assert.deepEqual(brief("высота не менее 2,5 м"), [["min", 2.5, "м"]]);
  assert.deepEqual(brief("опыт не менее трёх лет"), [["min", 3, "лет"]]);
  assert.deepEqual(brief("опыт не менее 3 (трёх) лет"), [["min", 3, "лет"]]);
  assert.deepEqual(brief("не менее двух человек"), [["min", 2, "человек"]]);
});

test("размеры «3×2»: все числа сохраняются, в том числе с латинским и русским «х»", () => {
  for (const text of ["светодиодный экран размером не менее 3×2 м", "экран не менее 3 x 2 м", "экран не менее 3х2 м"]) {
    const [c] = parseConditions(text);
    assert.deepEqual([c.op, c.parts, c.unit], ["min", [3, 2], "м"], text);
  }
  assert.equal(hintOf(parseConditions("не менее 3×2 м")[0]), "[размер, не меньше 3×2]");
});

test("единица: прилагательное входит в неё, предлог и существительное-пояснение — нет", () => {
  assert.deepEqual(brief("не менее 100 обработанных фотографий"), [["min", 100, "обработанных фотографий"]]);
  assert.deepEqual(brief("не менее 2 наименований выпечки на человека"), [["min", 2, "наименований"]]);
  assert.deepEqual(brief("не менее 5 рабочих дней"), [["min", 5, "рабочих дней"]]);
  assert.deepEqual(brief("плотность не менее 80 г/м²"), [["min", 80, "г/м²"]]);
  assert.deepEqual(brief("не менее 20 % начальной цены"), [["min", 20, "%"]]);
  assert.deepEqual(brief("площадь не менее 10 кв. м"), [["min", 10, "кв. м"]]);
  assert.deepEqual(brief("не менее 150 в пределах города"), [["min", 150, ""]], "предлог — не единица");
});

test("срок, который задаёт заказчик: «в течение», «не позднее чем за … до» — помечен, это не выбор участника", () => {
  assert.deepEqual(brief("передача фото в течение 5 рабочих дней после мероприятия"), [["max", 5, "рабочих дней", true]]);
  assert.deepEqual(brief("согласовывается не позднее чем за 10 рабочих дней до даты проведения"), [["min", 10, "рабочих дней", true]]);
  assert.deepEqual(brief("ответ не позднее чем через 3 рабочих дня"), [["max", 3, "рабочих дня", true]]);
  assert.deepEqual(brief("согласовывается с Заказчиком не менее чем за 5 дней до проведения"), [["min", 5, "дней", true]]);
  assert.deepEqual(brief("направляет макеты не менее чем за 5 календарных дней до проведения"), [["min", 5, "календарных дней", true]]);
  // «За 3 часа после» — это в пределах трёх часов после, а не заранее.
  assert.deepEqual(brief("производит уборку не позднее чем за 3 (три) часа после окончания"), [["max", 3, "часа", true]]);
  // А «срок поставки не более 10 дней» — предложение участника, не срок заказчика.
  assert.deepEqual(brief("срок поставки не более 10 дней"), [["max", 10, "дней"]]);
  // Срок и граница в одной фразе — одно условие, срок.
  assert.equal(parseConditions("в течение не более 5 рабочих дней").length, 1);
  assert.equal(parseConditions("в течение не более 5 рабочих дней")[0].term, true);
});

test("строка таблицы: «Мощность | не менее 40 | кВт» читается, а дословный кусок берётся из исходного текста", () => {
  const text = "Мощность | не менее 40 | кВт | 1 шт.";
  const [c] = parseConditions(text);
  assert.deepEqual([c.op, c.value, c.unit], ["min", 40, "квт"]);
  assert.equal(c.raw, "не менее 40 | кВт");
  assert.equal(text.slice(c.at, c.end), c.raw);
});

test("несколько условий в одной цитате — все, по порядку", () => {
  const found = parseConditions("Кофе-брейк на 120 человек: чай, кофе, не менее 2 наименований выпечки на человека; участников не менее 120 человек.");
  assert.deepEqual(found.map((c) => [c.op, c.value, c.unit]), [["min", 2, "наименований"], ["min", 120, "человек"]]);
});

test("ключ единицы: разные формы одной единицы совпадают", () => {
  assert.equal(unitKey("дней"), unitKey("дня"));
  assert.equal(unitKey("рабочих дней"), unitKey("дни"));
  assert.equal(unitKey("лет"), unitKey("года"));
  assert.equal(unitKey("кв. м"), unitKey("м²"));
  assert.equal(unitKey("м2"), unitKey("кв.м"));
  assert.equal(unitKey("человек"), unitKey("человека"));
  assert.equal(unitKey("обработанных фотографий"), unitKey("фотографии"));
  assert.equal(unitKey("процентов"), "%");
  assert.notEqual(unitKey("мест"), unitKey("человек"));
  assert.notEqual(unitKey("м"), unitKey("м²"));
  assert.equal(unitKey(""), "");
});

test("подходит ли значение участника: каждая граница, строгие границы, размеры в любом порядке", () => {
  assert.equal(satisfies({ op: "min", value: 150 }, [150]), true);
  assert.equal(satisfies({ op: "min", value: 150 }, [149]), false);
  assert.equal(satisfies({ op: "max", value: 5 }, [5]), true);
  assert.equal(satisfies({ op: "max", value: 5 }, [5.1]), false);
  assert.equal(satisfies({ op: "gt", value: 3 }, [3]), false);
  assert.equal(satisfies({ op: "gt", value: 3 }, [4]), true);
  assert.equal(satisfies({ op: "lt", value: 10 }, [10]), false);
  assert.equal(satisfies({ op: "range", value: 3, value2: 5 }, [4]), true);
  assert.equal(satisfies({ op: "range", value: 3, value2: 5 }, [6]), false);
  assert.equal(satisfies({ op: "exact", value: 40 }, [40]), true);
  assert.equal(satisfies({ op: "min", value: 3, parts: [3, 2] }, [4, 2.5]), true);
  assert.equal(satisfies({ op: "min", value: 3, parts: [3, 2] }, [2.5, 4]), true, "3×2 и 2×3 — один размер");
  assert.equal(satisfies({ op: "min", value: 3, parts: [3, 2] }, [4, 1.5]), false);
  assert.equal(satisfies({ op: "min", value: 150 }, []), false);
});

test("условие словами заказчика", () => {
  const d = (text: string) => describeCondition(parseConditions(text)[0]);
  assert.equal(d("не менее 150 мест"), "не менее 150 мест");
  assert.equal(d("от 3 до 5 лет"), "от 3 до 5 лет");
  assert.equal(d("в течение 5 рабочих дней"), "срок не более 5 рабочих дней");
  assert.equal(d("не позднее чем за 10 рабочих дней до"), "срок не менее 10 рабочих дней");
  assert.equal(d("не менее 3×2 м"), "не менее 3×2 м");
});

test("большие числа — с пробелами между тысячами, дроби — с запятой; подсказка с ними читается обратно", () => {
  const [money] = parseConditions("общая цена договоров не менее 3 000 000 руб.");
  assert.equal(describeCondition(money), "не менее 3 000 000 руб.");
  assert.equal(hintOf(money), "[число, не меньше 3 000 000]");
  assert.deepEqual(parseHint("[число, не меньше 3 000 000]"), { op: "min", value: 3000000 });
  assert.equal(acceptableValue(parseHint("[число, не меньше 3 000 000]")!), "3 000 000");
  assert.equal(hintOf({ op: "max", value: 2.5 }), "[число, не больше 2,5]");
  assert.equal(describeCondition({ what: "", op: "exact", value: 685000, unit: "руб.", raw: "" }), "685 000 руб.");
  assert.equal(describeCondition({ what: "", op: "min", value: 9999, unit: "мест", raw: "" }), "не менее 9999 мест", "до десяти тысяч — без пробела");
  assert.equal(hintProblem(parseHint("[число, не меньше 3 000 000]")!, "2 500 000"), "2 500 000 — по ТЗ не меньше 3 000 000");
});

test("подсказка на месте значения участника: записывается и читается обратно, число — граница заказчика", () => {
  const hint = (text: string) => hintOf(parseConditions(text)[0]);
  assert.equal(hint("не менее 150 мест"), "[число, не меньше 150]");
  assert.equal(hint("не более 2,5 кг"), "[число, не больше 2,5]");
  assert.equal(hint("свыше 3 лет"), "[число, больше 3]");
  assert.equal(hint("от 3 до 5 лет"), "[число, от 3 до 5]");
  assert.equal(hintOf({ op: "exact", value: 40 }), null, "точное значение — не граница: подсказки нет");

  assert.deepEqual(parseHint("[число, не меньше 150]"), { op: "min", value: 150 });
  assert.deepEqual(parseHint("число, не меньше 150"), { op: "min", value: 150 }, "и без скобок: так хранится название поля");
  assert.deepEqual(parseHint("[число, не больше 2,5]"), { op: "max", value: 2.5 });
  assert.deepEqual(parseHint("[число, от 3 до 5]"), { op: "range", value: 3, value2: 5 });
  assert.deepEqual(parseHint("[размер, не меньше 3×2]"), { op: "min", value: 3, parts: [3, 2] });
  assert.equal(parseHint("[адрес зала]"), null);
  assert.equal(parseHint("[число]"), null);
});

test("вписанное участником значение сверяется с подсказкой; что-то не число — не ошибка", () => {
  const min = parseHint("[число, не меньше 150]")!;
  assert.equal(hintProblem(min, "180"), null);
  assert.equal(hintProblem(min, "120"), "120 — по ТЗ не меньше 150");
  assert.equal(hintProblem(min, "120 мест"), "120 — по ТЗ не меньше 150");
  assert.equal(hintProblem(min, "много"), null);
  assert.equal(hintProblem(parseHint("[число, не больше 5]")!, "6"), "6 — по ТЗ не больше 5");
  assert.equal(hintProblem(parseHint("[число, больше 3]")!, "3"), "3 — по ТЗ больше 3");
  assert.equal(hintProblem(parseHint("[число, от 3 до 5]")!, "7"), "7 — по ТЗ от 3 до 5");
  assert.equal(hintProblem(parseHint("[размер, не меньше 3×2]")!, "2×1,5"), "2×1,5 — по ТЗ не меньше 3×2");
  assert.equal(hintProblem(parseHint("[размер, не меньше 3×2]")!, "4×2,5"), null);
  assert.deepEqual(numbersIn("1 200 мест"), [1200]);
  assert.equal(numbersIn("нет"), null);
});

test("принять границу заказчика одним нажатием можно у «не меньше» и «не больше»; у строгой и у диапазона границы-значения нет", () => {
  assert.equal(acceptableValue(parseHint("[число, не меньше 150]")!), "150");
  assert.equal(acceptableValue(parseHint("[число, не больше 2,5]")!), "2,5");
  assert.equal(acceptableValue(parseHint("[число, больше 3]")!), null);
  assert.equal(acceptableValue(parseHint("[число, от 3 до 5]")!), null);
  assert.equal(acceptableValue(parseHint("[размер, не меньше 3×2]")!), "3×2");
});

test("«число и единица» в предложении участника находятся; даты, время, пункты и «А4» — нет", () => {
  const found = mentionsOf("Обеспечим зал на 180 мест, 2 радиомикрофона, 27 ноября 2026 г. с 15:00; п. 2.1; бумага А4; 3 рабочих дня");
  assert.deepEqual(
    found.map((m) => [m.value, m.unit]),
    [[180, "мест"], [2, "радиомикрофона"], [3, "рабочих дня"]]
  );
  assert.equal(mentionKey(found[0]), mentionKey({ value: 180, unit: "места" }));
  const place = mentionsOf("зал на 180 мест");
  assert.equal("зал на 180 мест".slice(place[0].at, place[0].numberEnd), "180");
  assert.equal("зал на 180 мест".slice(place[0].at, place[0].end), "180 мест");
});

test("на длинном тексте разбор идёт за доли секунды и не зависает на хитрых строках", () => {
  const long = "Исполнитель обеспечивает зал вместимостью не менее 150 мест, 1 2 3 4 5 6 7 8 9 10, не менее не менее не менее. ".repeat(2000);
  const start = Date.now();
  const found = parseConditions(long);
  mentionsOf(long);
  assert.ok(found.length >= 2000);
  assert.ok(Date.now() - start < 3000, `разбор занял ${Date.now() - start} мс`);
  const digits = ("1 111 ".repeat(20000)).trim();
  const t2 = Date.now();
  parseConditions(digits);
  mentionsOf(digits);
  assert.ok(Date.now() - t2 < 3000);
});
