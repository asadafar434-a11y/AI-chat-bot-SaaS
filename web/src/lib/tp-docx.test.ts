// Файлы Word заявки: техническое предложение — без реквизитов участника, анкета и цена — с ними — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import mammoth from "mammoth";
import { POST } from "../app/api/tp/docx/route.ts";
import { EMPTY_PROFILE, identityValues, type Profile } from "./profile.ts";
import { PLAIN_FORM } from "./tp.ts";
import { buildTpDocx, partsOf, type TpDocx } from "./tp-docx.ts";

const PROFILE: Profile = {
  ...EMPTY_PROFILE,
  fullName: "Общество с ограниченной ответственностью «Ромашка»",
  shortName: "ООО «Ромашка»",
  inn: "6612345676",
  kpp: "661201001",
  ogrn: "1146612000127",
  account: "40702810916540001234",
  phone: "+7 912 000-00-00",
  email: "romashka@example.ru",
  head: "Генеральный директор Иванова Анна Петровна, действует на основании Устава",
  signer: "Иванова А. П.",
  vatNote: "НДС не облагается в связи с применением УСН",
  smeCategory: "микропредприятие",
};

const DATA: TpDocx = {
  subject: "Поставка бумаги офисной",
  form: { ...PLAIN_FORM, hasPrice: true, smeDeclaration: "[наименование участника] относится к субъектам МСП: [категория]." },
  goods: [],
  items: [{ clause: "2.1", requirement: "Бумага А4, 500 листов в пачке", offer: "Бумага А4, 500 листов в пачке, белизна 146 %" }],
  cast: null,
  price: 685000,
  profile: PROFILE,
};

const textOf = async (buffer: Buffer) => (await mammoth.extractRawText({ buffer })).value;

// Ни одной приметы участника: по ним комиссия отклонит первую часть заявки.
function assertAnonymous(text: string) {
  for (const value of identityValues(PROFILE)) assert.ok(!text.includes(value), `в ТП попало «${value}»`);
  assert.doesNotMatch(text, /Участник закупки\s+_+/);
}

test("техническое предложение не берёт реквизиты, даже если их передали", async () => {
  const text = await textOf(await buildTpDocx("tp", DATA));
  assert.match(text, /Техническое предложение/);
  assert.match(text, /белизна 146 %/);
  assert.match(text, /п\. 2\.1 ТЗ/);
  assertAnonymous(text);
});

test("анкета, декларация и цена — с реквизитами; цена — цифрами и прописью", async () => {
  assert.deepEqual(partsOf(DATA.form), ["tp", "participant", "declaration", "price"]);
  assert.deepEqual(partsOf(PLAIN_FORM), ["tp", "participant"]);

  const participant = await textOf(await buildTpDocx("participant", DATA));
  for (const value of [PROFILE.fullName, PROFILE.inn, PROFILE.kpp, PROFILE.ogrn, PROFILE.account, "Иванова А. П."]) {
    assert.ok(participant.includes(value), `в анкете нет «${value}»`);
  }
  // Пустые строки анкеты — полем для заполнения, а не пустотой.
  assert.match(participant, /\[заполните\]/);

  const declaration = await textOf(await buildTpDocx("declaration", DATA));
  assert.match(declaration, /Общество с ограниченной ответственностью «Ромашка» относится к субъектам МСП: микропредприятие\./);

  const price = await textOf(await buildTpDocx("price", DATA));
  assert.match(
    price,
    /составляет 685 000,00 руб\. \(Шестьсот восемьдесят пять тысяч рублей 00 копеек\), НДС не облагается в связи с применением УСН\./
  );
  // Без цены и реквизитов — жёлтые поля, а не «0 руб.».
  const blank = await textOf(await buildTpDocx("price", { ...DATA, price: null, profile: null }));
  assert.match(blank, /\[цена договора цифрами\] руб\. \(\[цена прописью\]\)/);
});

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/tp/docx", { method: "POST", body: JSON.stringify(body) }));

test("сервер: реквизиты из запроса в ТП не попадают, а готовый «документ» для ТП не принимается", async () => {
  const request = { part: "tp", subject: DATA.subject, items: DATA.items, profile: PROFILE };
  const res = await post(request);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /filename\*=UTF-8''%D0%A2/);
  assertAnonymous(await textOf(Buffer.from(await res.arrayBuffer())));

  // Документ блоками собирается только для анкеты, декларации и цены: ТП из него не соберётся.
  const doc = { title: "Техническое предложение", basis: "", blocks: [{ type: "paragraph", text: `ИНН ${PROFILE.inn}`, rows: [] }] };
  assertAnonymous(await textOf(Buffer.from(await (await post({ ...request, doc })).arrayBuffer())));
  assert.equal((await post({ part: "tp", doc, profile: PROFILE })).status, 400);

  const anketa = await post({ ...request, part: "participant" });
  assert.match(await textOf(Buffer.from(await anketa.arrayBuffer())), new RegExp(PROFILE.inn));
});
