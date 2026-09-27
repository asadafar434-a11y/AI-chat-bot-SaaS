// Сведения об опыте и о специалистах: когда нужны, что уходит в задание, файлы Word без ИИ — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import mammoth from "mammoth";
import { POST as docx } from "../app/api/tp/docx/route.ts";
import type { Criteria, ScoreRow } from "./criteria.ts";
import { clipEvidence, EVIDENCE_HEAD, EVIDENCE_TAIL, isEvidencePart } from "./my-docs.ts";
import { evidenceOf, type MyDocument } from "./me-store.ts";
import { partInstructions } from "./part-doc.ts";
import { EMPTY_PROFILE } from "./profile.ts";
import { SAMPLE_CRITERIA } from "./requirements-sample.ts";
import { PLAIN_FORM } from "./tp.ts";
import { buildTpDocx } from "./tp-docx.ts";
import { criteriaRowsFor, partsOf } from "./tp-parts.ts";

const SAMPLE: Criteria = { howWins: "points", rows: SAMPLE_CRITERIA.rows.map((r) => ({ ...r, verified: true })) };

test("опыт и специалисты — в частях заявки, только если за них дают баллы", () => {
  assert.deepEqual(partsOf(PLAIN_FORM, SAMPLE), ["tp", "participant", "experience", "staff"]);
  assert.deepEqual(partsOf(PLAIN_FORM), ["tp", "participant"]);
  // Аукцион: побеждает цена, баллов нет — и сведений не нужно, даже если строки есть.
  assert.deepEqual(partsOf(PLAIN_FORM, { ...SAMPLE, howWins: "price" }), ["tp", "participant"]);
  // Оценивают только опыт.
  const onlyExperience: Criteria = { howWins: "points", rows: SAMPLE.rows.filter((r) => /опыт/i.test(r.indicator)) };
  assert.deepEqual(partsOf(PLAIN_FORM, onlyExperience), ["tp", "participant", "experience"]);
  assert.deepEqual(
    criteriaRowsFor(SAMPLE, "staff").map((r: ScoreRow) => r.detail),
    ["Общее количество специалистов"]
  );
  assert.equal(isEvidencePart("experience"), true);
  assert.equal(isEvidencePart("price"), false);
});

test("договоры — началом и концом, в пределах лимита", () => {
  const long = `${"н".repeat(EVIDENCE_HEAD)}середина${"к".repeat(EVIDENCE_TAIL)}`;
  const clipped = clipEvidence(long);
  assert.ok(!clipped.includes("середина"));
  assert.ok(clipped.startsWith("н") && clipped.endsWith("к"));
  assert.equal(clipEvidence("короткий акт"), "короткий акт");

  const doc = (id: string, kinds: MyDocument["kinds"], size: number): MyDocument => ({
    id, name: `${id}.pdf`, text: "т".repeat(size), addedAt: "", kinds, about: "",
  });
  const picked = evidenceOf([doc("a", ["experience"], 50_000), doc("b", ["staff"], 5_000), doc("c", ["experience"], 3_000)], "experience");
  assert.deepEqual(picked.map((d) => d.id), ["a", "c"]);
  assert.equal(picked[0].text.length, clipEvidence("т".repeat(50_000)).length);
});

test("задание: документы участника — сведения, строки — только засчитываемые, баллы по шкале из порядка оценки", () => {
  const extract = "- Квалификация участников закупки → Опыт\n  Как считают: от 3 000 000 ₽ — 100 баллов";
  const experience = partInstructions("experience", { title: "Сведения об опыте", profile: null, samples: 3, price: null, criteria: extract });
  assert.match(experience, /«Документ участника: …»/);
  assert.match(experience, /Это не образцы оформления, а сами сведения/);
  assert.match(experience, /Включай только договоры, которые засчитают/);
  assert.match(experience, /score — сколько баллов/);
  assert.ok(experience.includes(extract));

  const staff = partInstructions("staff", { title: "Сведения о специалистах", profile: null, samples: 0, price: null });
  assert.match(staff, /Документов участника для этих сведений нет/);
  assert.match(staff, /Просроченное удостоверение не засчитают/);

  const anketa = partInstructions("participant", { title: "Анкета", profile: null, samples: 1, price: null });
  assert.match(anketa, /score — пустая строка, gaps — пустой список/);
  assert.doesNotMatch(anketa, /Документ участника/);
});

test("без ИИ — таблица с полями для заполнения, участник — из реквизитов", async () => {
  const data = {
    subject: "Поставка",
    form: PLAIN_FORM,
    goods: [],
    items: [{ clause: "1", requirement: "т", offer: "п" }],
    cast: null,
    price: null,
    profile: { ...EMPTY_PROFILE, fullName: "ООО «Праздник-Энск»" },
  };
  const experience = (await mammoth.extractRawText({ buffer: await buildTpDocx("experience", data) })).value;
  assert.match(experience, /Сведения об опыте участника закупки/);
  assert.match(experience, /Участник закупки: ООО «Праздник-Энск»/);
  assert.match(experience, /Дата акта о приёмке/);
  assert.match(experience, /\[заказчик\]/);
  const staff = (await mammoth.extractRawText({ buffer: await buildTpDocx("staff", { ...data, profile: null }) })).value;
  assert.match(staff, /Документ о квалификации, срок действия/);
  assert.match(staff, /\[наименование участника\]/);
});

test("часть, составленная до оценки баллов, по-прежнему собирается в Word", async () => {
  const doc = { title: "Анкета участника", basis: "по форме заказчика", blocks: [{ type: "paragraph", text: "Сведения", rows: [] }] };
  const res = await docx(new Request("http://localhost/api/tp/docx", { method: "POST", body: JSON.stringify({ part: "participant", doc }) }));
  assert.equal(res.status, 200);
  const withScore = { ...doc, score: "≈ 15 баллов", gaps: ["договор 2019 года не засчитают"] };
  const res2 = await docx(new Request("http://localhost/api/tp/docx", { method: "POST", body: JSON.stringify({ part: "experience", doc: withScore }) }));
  assert.equal(res2.status, 200);
});
