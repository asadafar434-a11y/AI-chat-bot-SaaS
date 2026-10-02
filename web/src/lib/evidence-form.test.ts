// Форма факта: введённое человеком → запись базы — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFact } from "./evidence-base.ts";
import { confirmed, draftOf, emptyDraft, factFromDraft, numberOf } from "./evidence-form.ts";

const NOW = new Date("2026-10-02T10:00:00Z");
const docs = [{ id: "d1", name: "Лицензия.pdf" }];
const ok = (result: ReturnType<typeof factFromDraft>) => {
  assert.ok("fact" in result, "error" in result ? result.error : "");
  return result.fact;
};

test("новая лицензия: название, поля, срок и документ-подтверждение собираются в факт; вписанное человеком подтверждено", () => {
  const fact = ok(
    factFromDraft(
      emptyDraft("license", { title: " Лицензия на образовательную деятельность ", fields: { number: "Л035", issuedAt: "2022-05-12", issuer: "" }, until: "2027-05-12", docId: "d1", quote: "действительна до 12.05.2027" }),
      docs,
      undefined,
      NOW
    )
  );
  assert.deepEqual(
    [fact.kind, fact.title, fact.fields, fact.validity, fact.source, fact.origin, fact.confirmed],
    [
      "license", "Лицензия на образовательную деятельность", { number: "Л035", issuedAt: "2022-05-12" }, { until: "2027-05-12" },
      { type: "document", docId: "d1", docName: "Лицензия.pdf", quote: "действительна до 12.05.2027" }, "human", true,
    ]
  );
});

test("без документа факт — слова человека («вписано вручную»); «бессрочно» не совмещается с датами", () => {
  const manual = ok(factFromDraft(emptyDraft("equipment", { title: "Актовый зал", note: "со слов директора", from: "2020-01-01", until: "2030-01-01", perpetual: true }), docs, undefined, NOW));
  assert.deepEqual([manual.source, manual.validity], [{ type: "manual", note: "со слов директора" }, { perpetual: true }]);
  assert.deepEqual(ok(factFromDraft(emptyDraft("equipment", { title: "Зал" }), docs, undefined, NOW)).source, { type: "manual" });
  // Документ, которого уже нет среди образцов, не подставляется выдуманным.
  assert.deepEqual(ok(factFromDraft(emptyDraft("license", { title: "Л", docId: "нет-такого" }), docs, undefined, NOW)).source, { type: "manual" });
});

test("числа: «1 200 000» и «2,5» читаются, пустые строки пропускаются, недописанное — понятная ошибка", () => {
  assert.equal(numberOf("1 200 000"), 1200000);
  assert.equal(numberOf("2,5"), 2.5);
  const fact = ok(
    factFromDraft(
      emptyDraft("equipment", { title: "Актовый зал", measures: [{ what: "вместимость", value: "200", unit: "мест" }, { what: "", value: "", unit: "" }] }),
      docs,
      undefined,
      NOW
    )
  );
  assert.deepEqual(fact.measures, [{ what: "вместимость", value: 200, unit: "мест" }]);
  const bad = factFromDraft(emptyDraft("equipment", { title: "Зал", measures: [{ what: "вместимость", value: "много", unit: "мест" }] }), docs, undefined, NOW);
  assert.deepEqual(bad, { error: "Число: впишите и название, и значение цифрами." });
});

test("ошибки ввода: нет названия, недописанная дата, начало срока позже конца", () => {
  assert.match((factFromDraft(emptyDraft("license"), docs) as { error: string }).error, /Впишите название/);
  assert.match((factFromDraft(emptyDraft("license", { title: "Л", fields: { issuedAt: "2022-05-" } }), docs) as { error: string }).error, /«Дата выдачи»: введите дату целиком/);
  assert.match((factFromDraft(emptyDraft("license", { title: "Л", until: "2027-13-40" }), docs) as { error: string }).error, /Срок действия: введите дату целиком/);
  assert.match((factFromDraft(emptyDraft("license", { title: "Л", from: "2027-01-01", until: "2026-01-01" }), docs) as { error: string }).error, /начало позже конца/);
});

test("правка найденного ИИ: факт остаётся «найденным ИИ», но подтверждён; номер, дата создания и место в файле сохраняются", () => {
  const ai = makeFact(
    { kind: "license", title: "Лицензия", origin: "ai", fields: { number: "Л035" }, source: { type: "document", docId: "d1", docName: "Лицензия.pdf", quote: "ЛИЦЕНЗИЯ № Л035", where: "стр. 1" } },
    new Date("2026-10-01T10:00:00Z"),
    "f1"
  );
  assert.equal(ai.confirmed, false);
  const edited = ok(factFromDraft({ ...draftOf(ai), until: "2027-05-12" }, docs, ai, NOW));
  assert.deepEqual([edited.id, edited.origin, edited.confirmed, edited.createdAt, edited.updatedAt], ["f1", "ai", true, ai.createdAt, NOW.toISOString()]);
  assert.deepEqual([edited.validity, (edited.source as { where?: string }).where], [{ until: "2027-05-12" }, "стр. 1"]);
  // Цитату поменяли — прежнее место в файле уже не её.
  const moved = ok(factFromDraft({ ...draftOf(ai), quote: "другая фраза" }, docs, ai, NOW));
  assert.equal((moved.source as { where?: string }).where, undefined);
});

test("место цитаты в файле: фразу вписали — страница находится по тексту документа; фразы нет или её нет в тексте — места нет", () => {
  const text = "Лицензия № Л035\n\n-- 1 of 2 --\n\nЛицензия действительна до 12.05.2027\n\n-- 2 of 2 --\n\n";
  const withText: { id: string; name: string; text?: string }[] = [{ id: "d1", name: "Лицензия.pdf", text }];
  const where = (quote: string, list = withText) =>
    (ok(factFromDraft(emptyDraft("license", { title: "Л", docId: "d1", quote }), list, undefined, NOW)).source as { where?: string }).where;
  assert.equal(where("Лицензия действительна до 12.05.2027"), "стр. 2");
  assert.equal(where("Лицензия № Л035"), "стр. 1");
  assert.equal(where(""), undefined);
  assert.equal(where("такого в документе нет"), undefined);
  assert.equal(where("Лицензия действительна до 12.05.2027", docs), undefined, "текста документа нет — места не называем");
});

test("факт в черновик и обратно — то же самое", () => {
  const f = makeFact(
    { kind: "equipment", title: "Зал", fields: { model: "стационарный" }, measures: [{ what: "вместимость", value: 2.5, unit: "тыс. мест" }], validity: { from: "2020-01-01", until: "2030-01-01" } },
    NOW,
    "f2"
  );
  const back = ok(factFromDraft(draftOf(f), docs, f, NOW));
  assert.deepEqual([back.title, back.fields, back.measures, back.validity], [f.title, f.fields, f.measures, f.validity]);
});

test("подтвердить найденное: факт больше не ждёт человека", () => {
  const ai = makeFact({ kind: "equipment", title: "Зал", origin: "ai" }, NOW, "f3");
  assert.equal(confirmed(ai, NOW).confirmed, true);
  assert.equal(confirmed(ai, NOW).updatedAt, NOW.toISOString());
});
