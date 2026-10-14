// Закон и способ закупки: тексты на шагах «Цена» и «Анализ» не говорят про аукцион там, где аукциона нет — npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuction, isElectronic, lawOfKind, participantFromPlatform, platformNote, priceIntro } from "./law-kind.ts";

test("закон и способ определяются по строке из разбора документов", () => {
  assert.equal(lawOfKind("44-ФЗ · запрос котировок"), "44");
  assert.equal(lawOfKind("223-ФЗ · конкурс"), "223");
  assert.equal(lawOfKind("закупка"), null);
  assert.equal(isAuction("44-ФЗ · электронный аукцион"), true);
  assert.equal(isAuction("44-ФЗ · запрос котировок"), false);
  assert.equal(isElectronic("44-ФЗ · закрытый аукцион"), false);
});

test("«Цена»: на аукционе — про торги и статью 49 (только по 44-ФЗ); в запросе котировок и по 223-ФЗ без аукциона — цена называется в заявке", () => {
  const auction44 = priceIntro("44-ФЗ · электронный аукцион");
  assert.match(auction44, /На аукционе цену подают во время торгов \(ч\. 2 ст\. 49 44-ФЗ\)/);
  const auction223 = priceIntro("223-ФЗ · аукцион в электронной форме");
  assert.match(auction223, /На аукционе цену подают во время торгов\./);
  assert.equal(/44-ФЗ|ст\. 49/.test(auction223), false, "статья 44-ФЗ в закупке по 223-ФЗ не нужна");

  for (const kind of ["44-ФЗ · запрос котировок", "44-ФЗ · конкурс", "223-ФЗ · запрос предложений", ""]) {
    const text = priceIntro(kind);
    assert.match(text, /^Цену вы указываете в заявке\./, kind);
    assert.equal(/аукцион|торг|ст\. 49/i.test(text), false, `«${kind}»: торгов нет — и слов о них быть не должно`);
    assert.match(text, /без ИИ\.$/);
  }
});

test("«Анализ»: пояснение о сведениях участника — только для 44-ФЗ в электронной процедуре; «аукцион» — только в аукционе", () => {
  assert.match(platformNote("44-ФЗ · электронный аукцион") ?? "", /в заявку на аукцион не пишут: по ч\. 1 ст\. 49 44-ФЗ/);
  const quotation = platformNote("44-ФЗ · запрос котировок") ?? "";
  assert.match(quotation, /по п\. 2 ч\. 6 ст\. 43 44-ФЗ/);
  assert.equal(/аукцион|ст\. 49/i.test(quotation), false);
  assert.equal(platformNote("223-ФЗ · запрос котировок"), null, "по 223-ФЗ анкету подают, если требует документация");
  assert.equal(platformNote("44-ФЗ · закрытый аукцион"), null, "на бумаге участник подаёт сведения сам");
  assert.equal(participantFromPlatform("44-ФЗ · запрос котировок"), platformNote("44-ФЗ · запрос котировок") !== null);
});
