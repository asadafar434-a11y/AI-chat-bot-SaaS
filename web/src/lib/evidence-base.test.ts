// База доказательств: сроки действия, даты в тексте документа и новый факт — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMonths,
  datesIn,
  dayOf,
  daysBetween,
  EXPIRING_DAYS,
  factText,
  findValidity,
  isoOf,
  makeFact,
  parseRuDate,
  stemShare,
  stemsOf,
  textWords,
  todayIso,
  validityAt,
  validityText,
} from "./evidence-base.ts";

test("дни считаются по календарю: правильные даты, неправильные — нет", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2026-10-05", "2026-10-01"), -4);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2, "високосный год");
  assert.equal(dayOf("2026-02-30"), null);
  assert.equal(dayOf("31.12.2026"), null, "формат — только ГГГГ-ММ-ДД");
  assert.equal(dayOf(""), null);
  assert.equal(isoOf(dayOf("2026-10-02")!), "2026-10-02");
  assert.equal(todayIso(new Date(2026, 9, 2, 1, 0)), "2026-10-02", "сегодня — по часам компьютера");
});

test("к дате прибавляются месяцы и годы: короткий месяц — последний день", () => {
  assert.equal(addMonths("2024-03-05", 60), "2029-03-05");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(addMonths("не дата", 3), null);
});

test("срок действия на дату: действует, скоро кончится, просрочен, ещё не начался, бессрочно, срока нет", () => {
  const v = { until: "2026-12-31" };
  assert.deepEqual(validityAt(v, "2026-10-01"), { state: "valid", days: 91 });
  assert.deepEqual(validityAt(v, "2026-12-31"), { state: "valid", days: 0 }, "в последний день ещё действует");
  assert.deepEqual(validityAt(v, "2027-01-02"), { state: "expired", days: -2 });
  assert.deepEqual(validityAt({ from: "2027-01-01", until: "2027-12-31" }, "2026-12-20"), { state: "not_started", days: 12 });
  assert.deepEqual(validityAt({ perpetual: true }, "2026-10-01"), { state: "perpetual" });
  assert.deepEqual(validityAt({}, "2026-10-01"), { state: "unknown" });
  assert.deepEqual(validityAt({ from: "2024-03-01" }, "2026-10-01"), { state: "unknown" }, "известно только начало — действует ли, неизвестно");
  assert.deepEqual(validityAt(v, "завтра"), { state: "unknown" });
  assert.equal(EXPIRING_DAYS, 30);
});

test("срок словами для экрана", () => {
  assert.equal(validityText({ until: "2026-12-31" }, "2026-10-01"), "действует до 31.12.2026");
  assert.equal(validityText({ until: "2026-10-13" }, "2026-10-01"), "истекает через 12 дней (13.10.2026)");
  assert.equal(validityText({ until: "2026-10-02" }, "2026-10-01"), "истекает через 1 день (02.10.2026)");
  assert.equal(validityText({ until: "2026-10-04" }, "2026-10-01"), "истекает через 3 дня (04.10.2026)");
  assert.equal(validityText({ until: "2026-09-01" }, "2026-10-01"), "просрочено: действовало до 01.09.2026");
  assert.equal(validityText({ perpetual: true }, "2026-10-01"), "бессрочно");
  assert.equal(validityText({}, "2026-10-01"), "срок не указан");
  assert.equal(validityText({ from: "2027-01-01", until: "2027-12-31" }, "2026-10-01"), "начнёт действовать 01.01.2027");
});

test("даты в тексте: точками, словами, с кавычками, год из двух цифр; несуществующие и телефоны — нет", () => {
  const found = (text: string) => datesIn(text).map((d) => d.iso);
  assert.deepEqual(found("до 31.12.2026"), ["2026-12-31"]);
  assert.deepEqual(found("до 31.12.26 г."), ["2026-12-31"]);
  assert.deepEqual(found("«05» марта 2023 года и 4 марта 2026 г."), ["2023-03-05", "2026-03-04"]);
  assert.deepEqual(found("действует до 2027-05-12"), ["2027-05-12"]);
  assert.deepEqual(found("31.02.2026"), []);
  assert.deepEqual(found("версия 1.2.3 и тел. 8 (495) 123-45-67"), []);
  assert.equal(parseRuDate("выдан 12 мая 2027 г."), "2027-05-12");
  assert.equal(parseRuDate("нет даты"), null);
  const text = "выдана 01.03.2024";
  const [d] = datesIn(text);
  assert.equal(text.slice(d.at, d.end), "01.03.2024");
});

test("срок действия в документе: «до», «с … по», «бессрочно», «сроком на 5 лет» от даты выдачи", () => {
  assert.deepEqual(findValidity("Лицензия действительна до 31.12.2026.").map(({ until, quote }) => [until, quote]), [["2026-12-31", "действительна до 31.12.2026"]]);
  assert.deepEqual(
    findValidity("Срок действия сертификата с 05.03.2023 по 04.03.2026 включительно").map(({ from, until }) => [from, until]),
    [["2023-03-05", "2026-03-04"]]
  );
  assert.deepEqual(findValidity("Срок действия: до 12 мая 2027 г.").map((v) => v.until), ["2027-05-12"]);
  assert.deepEqual(findValidity("Лицензия предоставлена бессрочно").map((v) => v.perpetual), [true]);
  assert.deepEqual(findValidity("Срок действия лицензии — без ограничения срока действия").map((v) => v.perpetual), [true]);
  const computed = findValidity("Свидетельство выдано 10.01.2024 сроком на 5 лет.");
  assert.deepEqual(computed.map(({ from, until, computed: c }) => [from, until, c]), [["2024-01-10", "2029-01-10", true]]);
  assert.equal(findValidity("Удостоверение выдано сроком на пять лет, дата выдачи 01.06.2025")[0].until, "2030-06-01");
  // Дата без слов о сроке — не срок: «выдан 01.03.2024», «договор от 10.06.2026».
  assert.deepEqual(findValidity("Договор № 5 от 10.06.2026. Акт от 25.06.2026. Выдан 01.03.2024."), []);
});

test("новый факт: вписанный человеком подтверждён, найденный ИИ — нет; пробелы и пустое убираются", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const human = makeFact({ kind: "license", title: "  Лицензия на образовательную деятельность ", fields: { number: " Л035 ", issuer: "  " } }, now, "f1");
  assert.deepEqual(
    [human.id, human.title, human.fields, human.origin, human.confirmed, human.source, human.createdAt],
    ["f1", "Лицензия на образовательную деятельность", { number: "Л035" }, "human", true, { type: "manual" }, "2026-10-02T10:00:00.000Z"]
  );
  const ai = makeFact(
    {
      kind: "equipment",
      title: "Актовый зал",
      origin: "ai",
      measures: [{ what: " вместимость ", value: 200, unit: " мест " }, { what: "", value: 1, unit: "" }, { what: "мощность", value: NaN, unit: "кВт" }],
      source: { type: "document", docId: "d1", docName: "Справка.pdf", quote: "зал на 200 мест" },
    },
    now
  );
  assert.equal(ai.confirmed, false);
  assert.deepEqual(ai.measures, [{ what: "вместимость", value: 200, unit: "мест" }]);
  assert.ok(ai.id.length > 8, "номер выдаётся сам");
});

test("слова для поиска: формы одного слова совпадают по началу, общие слова требований не в счёт", () => {
  const need = stemsOf("Копия лицензии на образовательную деятельность, подтверждающая наличие права");
  assert.deepEqual(need, ["лицен", "образ"]);
  assert.equal(stemShare(need, textWords("Лицензия на образовательной деятельности № Л035")), 1);
  assert.equal(stemShare(need, textWords("Лицензия на медицинскую деятельность")), 0.5);
  assert.equal(stemShare(["устав"], textWords("Устав ООО «Праздник» в новой редакции")), 1);
  assert.equal(stemShare(["iso", "9001"], textWords("Сертификат ISO 9001:2015")), 1);
  assert.equal(stemShare([], textWords("что угодно")), 1, "искать нечего — подходит любой");
  assert.deepEqual(stemsOf("и в на 5 10 ISO 9001"), ["iso", "9001"], "короткие числа и предлоги отбрасываются");
});

test("текст факта для поиска: название, поля и названия чисел", () => {
  assert.equal(
    factText({ title: "Зал «Галерея»", fields: { model: "стационарный" }, measures: [{ what: "вместимость", value: 120, unit: "мест" }] }),
    "Зал «Галерея» стационарный вместимость"
  );
});
