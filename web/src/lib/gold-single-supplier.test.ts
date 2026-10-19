// Эталон «ДРСУ Камчатка»: закупка дизельного топлива у единственного поставщика (заявки нет). Настоящий файл заказчика читает код продукта — npm test.
// Запросов к ИИ тут нет. Разбор — «Татьяна-Примеры документов/ДРСУ Камчатка (у единственного поставщика, дизтопливо)/РАЗБОР.md».
// Тесты с пометкой todo — известные пробелы (список «Чего продукт пока не умеет», пункты 42–45): сейчас не проходят, после исправления пометку снимают.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractText } from "./extract-text.ts";
import { ruleOf, type PlanContext } from "./fulfillment.ts";
import { lawOfKind, priceIntro } from "./law-kind.ts";
import { PLAIN_FORM } from "./tp.ts";
import { partsOf } from "./tp-parts.ts";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов/ДРСУ Камчатка (у единственного поставщика, дизтопливо)");
const NAME = "Извещение на закупку у ЕП.doc";
const KIND = "223-ФЗ · закупка у единственного поставщика";
const CTX: PlanContext = { law: "223", electronic: true, sme: false, participant: "ul", headSigns: true, points: false, parts: ["tp", "participant"] };

async function notice(): Promise<string> {
  const r = await extractText(new File([new Uint8Array(readFileSync(path.join(DIR, NAME)))], NAME), { ocr: false });
  assert.ok(r.ok, "извещение не прочитано");
  return r.text;
}

test("извещение (.doc): способ, цена, количество и срок читаются", async () => {
  const t = await notice();
  assert.match(t, /для способа закупки у единственного поставщика/);
  assert.match(t, /Заключение договора поставки с ООО «Брамс-Ойл»/);
  assert.match(t, /3 736 000 \(три миллиона семьсот тридцать шесть тысяч\) рублей 00 копеек/);
  assert.match(t, /20 тонн/);
  assert.match(t, /по 31\.12\.2026 г\./);
});

test("цена за тонну: 3 736 000 ₽ ÷ 20 т = 186 800 ₽", () => {
  assert.equal(3_736_000 / 20, 186_800);
});

test("заявки нет: место, срок, рассмотрение, требования и порядок подачи — «не устанавливается»", async () => {
  const t = await notice();
  assert.match(t, /Срок подачи заявки, дата и время окончания срока подачи заявки:\s+Не устанавливается/);
  assert.match(t, /Место и дата рассмотрения заявки\s+Не устанавливается/);
  assert.match(t, /Требования к Заявке:\s+Не устанавливается/);
  assert.match(t, /Порядок подачи Заявок:\s+Не предусмотрено/);
  assert.match(t, /Обеспечение заявки:\s+Не предусмотрено/);
});

test("от участника требуется два: нет в РНП и документ о полномочиях; закон в извещении не назван", async () => {
  const t = await notice();
  assert.match(t, /Отсутствие сведений об участниках размещения заказа в реестре недобросовестных поставщиков/);
  assert.match(t, /Документ, подтверждающий полномочия лица на осуществление действий от имени участника размещения заказа/);
  assert.match(t, /Товар должен иметь сертификаты качества/);
  assert.ok(!/(?<!\d)(44|223)-ФЗ/.test(t), "закон в извещении не назван");
});

test("в извещении остались слова из договора на строительство и срок подписания договора пуст", async () => {
  const t = await notice();
  assert.match(t, /монтажные, укрепительные, уплотнительные и прочие работы/);
  assert.match(t, /Срок подписания договора:\s*\n/);
});

test("правила «Что подать» для двух условий: полномочия — приложить, сертификаты качества — приложить", () => {
  const authority = ruleOf({ text: "Документ, подтверждающий полномочия лица на осуществление действий от имени участника размещения заказа", quote: "" }, CTX);
  assert.deepEqual([authority.rule, authority.plan.mode], ["authority", "upload"]);
  const certificates = ruleOf({ text: "Товар должен иметь сертификаты качества", quote: "" }, CTX);
  assert.deepEqual([certificates.rule, certificates.plan.mode], ["conformity", "upload"]);
});

test("закон по строке без «223-ФЗ» не определяется", () => {
  assert.equal(lawOfKind("закупка у единственного поставщика"), null);
  assert.equal(lawOfKind(KIND), "223");
});

// ——— Известные пробелы ———

test("для закупки у единственного поставщика техническое предложение и анкета не составляются", { todo: "пункт 42 списка: заявки нет, а продукт составляет оба документа" }, () => {
  assert.deepEqual(partsOf(PLAIN_FORM, undefined, KIND), []);
});

test("на шаге «Цена» для закупки у единственного поставщика не сказано «Цену вы указываете в заявке»", { todo: "пункт 43 списка: цену называет заказчик, заявки нет" }, () => {
  assert.doesNotMatch(priceIntro(KIND), /в заявке/);
});

test("«отсутствие в реестре недобросовестных поставщиков» не принимается за «Сведения об участнике»", { todo: "пункт 44 списка: правило participant совпадает по «сведений об участниках»" }, () => {
  const found = ruleOf({ text: "Отсутствие сведений об участниках размещения заказа в реестре недобросовестных поставщиков", quote: "" }, CTX);
  assert.notEqual(found.rule, "participant");
});
