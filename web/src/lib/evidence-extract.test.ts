// Факты из документов компании: что ИИ нашёл, то код проверяет по тексту документа — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FACTS_INSTRUCTIONS, FactsFoundSchema, verifyFacts, type FoundFact } from "./evidence-extract.ts";

const LICENSE = [
  "ЛИЦЕНЗИЯ № Л035-00115-77/00123456",
  "Настоящая лицензия предоставлена Обществу с ограниченной ответственностью «Праздник» на осуществление образовательной деятельности.",
  "Дата предоставления лицензии 12.05.2022. Лицензия действительна до 12.05.2027. Выдана Департаментом образования.",
].join("\n");

const CONTRACT = [
  "ДОГОВОР № 2026-0342/15 от 10.06.2026",
  "Исполнитель обязуется организовать и провести детское мероприятие «Конкурс рисунков на асфальте» для Государственной корпорации «Агентство по страхованию вкладов».",
  "Цена договора 1 200 000,00 руб. Акт приёмки оказанных услуг № 1 от 25.06.2026. Срок действия договора — бессрочно до исполнения обязательств.",
].join("\n");

const docs = [
  { id: "d1", name: "Лицензия.pdf", text: LICENSE },
  { id: "d2", name: "Договор Агентство.pdf", text: CONTRACT },
];

const found = (over: Partial<FoundFact> = {}): FoundFact => ({
  kind: "license",
  title: "Лицензия на образовательную деятельность № Л035-00115-77/00123456",
  fields: [{ key: "number", value: "Л035-00115-77/00123456" }, { key: "issuedAt", value: "2022-05-12" }, { key: "issuer", value: "Департамент образования" }],
  measures: [],
  validFrom: "",
  validUntil: "2027-05-12",
  perpetual: false,
  source: "Лицензия.pdf",
  quote: "Лицензия действительна до 12.05.2027",
  ...over,
});

test("факт из документа проходит проверку: цитата, номер, даты и срок стоят в тексте — источник запоминается с документом", () => {
  const { facts, dropped, issues } = verifyFacts([found()], docs);
  assert.deepEqual([dropped, issues], [0, []]);
  assert.deepEqual(facts[0], {
    kind: "license",
    title: "Лицензия на образовательную деятельность № Л035-00115-77/00123456",
    fields: { number: "Л035-00115-77/00123456", issuedAt: "2022-05-12", issuer: "Департамент образования" },
    measures: [],
    validity: { until: "2027-05-12" },
    source: { type: "document", docId: "d1", docName: "Лицензия.pdf", quote: "Лицензия действительна до 12.05.2027" },
  });
});

test("выдуманное не проходит: цитаты нет в документе — факт не добавляется; название не из слов документа — тоже", () => {
  const fake = verifyFacts([found({ quote: "Лицензия действительна до 12.05.2035 и распространяется на всю Россию" })], docs);
  assert.deepEqual([fake.facts.length, fake.dropped], [0, 1]);
  assert.match(fake.issues[0], /цитаты нет в документах — не добавлено/);
  const other = verifyFacts([found({ title: "Лицензия на медицинскую деятельность" })], docs);
  assert.equal(other.facts.length, 0);
  assert.match(other.issues[0], /в документе нет слов из названия/);
  assert.equal(verifyFacts([found({ title: "  ", quote: "" })], docs).facts.length, 0);
});

test("поле, которого нет в документе, пустеет, а факт остаётся: номер, дата, текстовое значение, чужое поле", () => {
  const { facts, issues } = verifyFacts(
    [
      found({
        fields: [
          { key: "number", value: "Л999-00000" },
          { key: "issuedAt", value: "2021-01-01" },
          { key: "issuer", value: "Министерство космоса" },
          { key: "scope", value: "образовательной деятельности" },
          { key: "color", value: "синий" },
        ],
      }),
    ],
    docs
  );
  assert.deepEqual(facts[0].fields, { scope: "образовательной деятельности" });
  assert.equal(issues.length, 3, "для каждого выдуманного значения — причина, чужое поле молча пропущено");
  assert.match(issues.join(" "), /номер «Л999-00000» не найден/);
  assert.match(issues.join(" "), /дата «2021-01-01» не найдена/);
});

test("срок: дата, которой нет в документе, и «бессрочно», которого там нет, не принимаются — срок остаётся не указан", () => {
  const wrong = verifyFacts([found({ validUntil: "2030-12-31" })], docs);
  assert.deepEqual(wrong.facts[0].validity, {});
  assert.match(wrong.issues[0], /дата срока «2030-12-31» не найдена в документе — срок не указан/);
  const perpetual = verifyFacts([found({ validUntil: "", perpetual: true })], docs);
  assert.deepEqual(perpetual.facts[0].validity, {});
  assert.match(perpetual.issues[0], /слова «бессрочно» в документе нет/);
  // А в договоре это слово есть.
  const real = verifyFacts(
    [found({ kind: "document", title: "Договор № 2026-0342/15", fields: [], validUntil: "", perpetual: true, source: "Договор Агентство.pdf", quote: "ДОГОВОР № 2026-0342/15 от 10.06.2026" })],
    docs
  );
  assert.deepEqual(real.facts[0].validity, { perpetual: true });
  // Даты словами и точками принимаются, если они в документе: модель вернула «12.05.2027».
  assert.deepEqual(verifyFacts([found({ validUntil: "12.05.2027" })], docs).facts[0].validity, { until: "2027-05-12" });
});

test("договор: номер, дата акта и цена проверяются по тексту; число, которого нет, — не добавляется", () => {
  const { facts, issues } = verifyFacts(
    [
      {
        kind: "experience",
        title: "Договор № 2026-0342/15 с Агентством по страхованию вкладов",
        fields: [
          { key: "customer", value: "Государственная корпорация «Агентство по страхованию вкладов»" },
          { key: "contractNo", value: "2026-0342/15" },
          { key: "contractDate", value: "2026-06-10" },
          { key: "actNo", value: "1" },
          { key: "actDate", value: "2026-06-25" },
        ],
        measures: [
          { what: "цена договора", value: 1200000, unit: "руб" },
          { what: "участников", value: 5000, unit: "чел" },
        ],
        validFrom: "",
        validUntil: "",
        perpetual: false,
        source: "Договор Агентство.pdf",
        quote: "Цена договора 1 200 000,00 руб.",
      },
    ],
    docs
  );
  assert.deepEqual(facts[0].fields, {
    customer: "Государственная корпорация «Агентство по страхованию вкладов»",
    contractNo: "2026-0342/15",
    contractDate: "2026-06-10",
    actNo: "1",
    actDate: "2026-06-25",
  });
  assert.deepEqual(facts[0].measures, [{ what: "цена договора", value: 1200000, unit: "руб" }]);
  assert.equal(facts[0].source.docId, "d2");
  assert.match(issues.join(" "), /число 5000 \(«участников»\) не найдено в документе/);
});

test("документ называется иначе, чем в ответе модели: факт всё равно находится по цитате; чужая цитата привязывается к своему документу", () => {
  const { facts } = verifyFacts([found({ source: "Скан лицензии 2022.pdf" })], docs);
  assert.deepEqual([facts[0].source.docName, facts[0].source.docId], ["Лицензия.pdf", "d1"]);
});

test("ответ модели по схеме: пропущенные поля срока и чисел принимаются как «не указано», вид — только из списка", () => {
  const minimal = { facts: [{ kind: "license", title: "Лицензия", source: "Лицензия.pdf", quote: "ЛИЦЕНЗИЯ" }] };
  const parsed = FactsFoundSchema.safeParse(minimal);
  assert.ok(parsed.success);
  if (parsed.success) assert.deepEqual([parsed.data.facts[0].fields, parsed.data.facts[0].measures, parsed.data.facts[0].validUntil, parsed.data.facts[0].perpetual], [[], [], "", false]);
  assert.equal(FactsFoundSchema.safeParse({ facts: [{ kind: "что-то", title: "Х", source: "", quote: "" }] }).success, false);
});

test("инструкция для ИИ перечисляет виды и поля и запрещает придумывать", () => {
  assert.match(FACTS_INSTRUCTIONS, /license — лицензия или допуск\. Поля: number \(номер\)/);
  assert.match(FACTS_INSTRUCTIONS, /issuedAt \(дата выдачи, ГГГГ-ММ-ДД\)/);
  assert.match(FACTS_INSTRUCTIONS, /пустое поле лучше угаданного/);
  assert.match(FACTS_INSTRUCTIONS, /Реквизиты компании.*не выписывай/);
});
