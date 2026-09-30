// Документы заявки: файлы, которые пишет приложение, и отметки готовности по «Что подать» — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveName, fileRows, submitItems, toggleReady, type FilesState } from "./application-files.ts";
import type { Purchase } from "./purchase.ts";
import type { ReqItem } from "./requirements.ts";
import { NO_ANTI_DUMPING, PLAIN_FORM, type TpResult } from "./tp.ts";

const req = (text: string): ReqItem => ({ text, source: "Извещение, п. 8", quote: text, verified: true });
const tp = (over: Partial<TpResult["form"]> = {}, offer = "Обеспечим звукорежиссёра"): TpResult => ({
  form: { ...PLAIN_FORM, ...over },
  goods: [],
  items: [{ clause: "1", topic: "Звук", requirement: "Звукорежиссёр", quote: "звукорежиссёр", offer, verified: true }],
  antiDumping: NO_ANTI_DUMPING,
});

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: "p1",
    createdAt: "2026-09-24T10:00:00.000Z",
    short: "Праздник: «День учителя»",
    subject: "",
    kind: "223-ФЗ · конкурс в электронной форме",
    customer: "Школа № 1",
    price: "",
    deadline: { date: "", time: "", zone: "" },
    files: [],
    unreadable: [],
    requirements: {
      who: [],
      submit: [req("Предложение участника в отношении объекта закупки"), req("Выписка из ЕГРЮЛ"), req("Копия лицензии")],
      scope: [],
      terms: [],
    },
    ...over,
  };
}

const STATE: FilesState = { missing: 0, evidence: { experience: 0, staff: 0 }, writing: null };
const view = (rows: ReturnType<typeof fileRows>) => rows.map((r) => [r.part, r.badge.text, r.action]);

test("без ТП — только ТП, и его надо составить", () => {
  assert.deepEqual(view(fileRows(purchase(), STATE)), [["tp", "не составлено", "compose"]]);
});

test("части заявки — по форме заказчика, со статусом: реквизиты, цена, баллы", () => {
  const p = purchase({ tp: tp({ hasPrice: true, smeDeclaration: "[категория]" }, "Обеспечим [ФИО]") });
  assert.deepEqual(view(fileRows(p, { ...STATE, missing: 3 })), [
    ["tp", "впишите 1 поле", "download"],
    ["participant", "впишите реквизиты", "download"],
    ["declaration", "впишите реквизиты", "download"],
    ["price", "впишите цену", "download"],
  ]);
  const ready = fileRows({ ...p, tp: tp({ hasPrice: true }), tpPrice: 450_000 }, STATE);
  assert.deepEqual(view(ready), [
    ["tp", "готово", "download"],
    ["participant", "готово", "download"],
    ["price", "цена вписана", "download"],
  ]);
  assert.equal(fileRows(p, { ...STATE, missing: 3 })[1].sub, "в «Реквизитах» не хватает 3 полей — в файле они жёлтые");
  // По 44-ФЗ анкеты нет: сведения об участнике передаёт площадка (п. 2 ч. 6 ст. 43).
  assert.deepEqual(view(fileRows({ ...p, kind: "44-ФЗ · открытый конкурс" }, STATE)).map(([part]) => part), ["tp", "declaration", "price"]);
});

test("опыт и специалисты — только в конкурсе с баллами за них; без документов — янтарём", () => {
  const criteria = {
    howWins: "points" as const,
    rows: [
      { criterion: "Квалификация", criterionWeight: "40 %", indicator: "Опыт участника", indicatorWeight: "50 %", detail: "", detailWeight: "", scoring: "", proof: "", form: "", source: "", quote: "", verified: true },
      { criterion: "Квалификация", criterionWeight: "40 %", indicator: "Наличие специалистов", indicatorWeight: "50 %", detail: "", detailWeight: "", scoring: "", proof: "", form: "", source: "", quote: "", verified: true },
    ],
  };
  const rows = fileRows(purchase({ tp: tp(), criteria }), { ...STATE, evidence: { experience: 4, staff: 0 }, writing: "staff" });
  assert.deepEqual(view(rows).slice(2), [
    ["experience", "за них баллы", "download"],
    ["staff", "пишу документ…", "download"],
  ]);
  assert.match(rows[2].sub, /из 4 документов/);
  const none = fileRows(purchase({ tp: tp(), criteria }), STATE);
  assert.deepEqual(none[3].badge, { tone: "warn", text: "нет документов", icon: "alert" });
});

test("что требует заказчик: отметки по тексту пункта, старые не копятся", () => {
  const p = purchase();
  assert.deepEqual(submitItems(p).map((i) => i.ready), [false, false, false]);
  const marked = toggleReady(p, "Выписка из ЕГРЮЛ");
  assert.deepEqual(marked, ["Выписка из ЕГРЮЛ"]);
  const both = toggleReady({ ...p, submitReady: [...marked, "Пункт, которого уже нет"] }, "Копия лицензии");
  assert.deepEqual(both, ["Выписка из ЕГРЮЛ", "Копия лицензии"]);
  assert.deepEqual(toggleReady({ ...p, submitReady: both }, "Выписка из ЕГРЮЛ"), ["Копия лицензии"]);
  assert.deepEqual(submitItems({ ...p, submitReady: both }).map((i) => i.ready), [false, true, true]);
});

test("имя архива — по закупке, без символов, которых не бывает в именах файлов", () => {
  assert.equal(archiveName(purchase()), "Праздник «День учителя» — заявка");
});
