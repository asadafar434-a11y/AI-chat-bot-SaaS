// Шесть наборов закупок, присланных 19.10.2026 (РВК-Комсомольск, ДГК, Воздушные Ворота, Метрострой, УСГС с итогом, МИРЭА). Настоящие файлы заказчиков читает код
// продукта — npm test. Запросов к ИИ тут нет. Разборы — «РАЗБОР.md» в каждой папке «Татьяна-Примеры документов»; пробелы 55–64 — в списке «Чего продукт пока не умеет».
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { afterWinDuties, isContract } from "./after-win.ts";
import { extractText } from "./extract-text.ts";
import { fillRulesOf } from "./fill-rules.ts";
import { findUnitSum } from "./unit-sum.ts";
import { auctionStepNote, reductionCoefficientNote, vatOnTopNote } from "./price-terms.ts";
import { detectRegistryDemand } from "./registry-demand.ts";
import { findSpecification } from "./spec-table.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const RVK = "РВК-Комсомольск (маркетинговое исследование 223-ФЗ, бухучёт)";
const DGK = "ДГК (конкурс 223-ФЗ, комплектующие дымососов)";
const VV = "Воздушные Ворота СС (СМР, склад жидкости, тома проекта)";
const MET = "Метрострой СС (аукцион МСП 223-ФЗ, сетка стальная)";
const USGS = "УСГС (аукцион МСП 223-ФЗ, новогодние подарки, итог)";
const MIREA = "МИРЭА (конкурентный отбор 223-ФЗ, текущий ремонт)";

const cache = new Map<string, Promise<Awaited<ReturnType<typeof extractText>>>>();
function load(dir: string, rel: string) {
  const key = `${dir}/${rel}`;
  if (!cache.has(key)) {
    cache.set(key, extractText(new File([new Uint8Array(readFileSync(path.join(ROOT, dir, rel)))], path.basename(rel)), { ocr: false }));
  }
  return cache.get(key)!;
}
async function read(dir: string, rel: string) {
  const r = await load(dir, rel);
  assert.ok(r.ok, `${rel} не прочитан`);
  return { name: path.basename(rel), text: r.text.replace(/ /g, " "), hidden: r.hidden };
}
const flat = (s: string | null) => (s ?? "").replace(/\s+/g, " ");

test("РВК-Комсомольск: главный документ — НМЦ, запрет услуг иностранных лиц, страна по ОКСМ; скрытого шрифта нет (раньше была ложная тревога)", async () => {
  const main = await read(RVK, "Документация о закупке_услуги.docx");
  assert.match(main.text, /32 656 876 руб\. 58 коп\., кроме того НДС/);
  assert.match(main.text, /Установлен запрет закупки услуг, оказываемых иностранными лицами/);
  assert.match(main.text, /обязан указан страну его происхождения в соответствии с ОКСМ\. В случае отсутствия такой информации, участник признается иностранным лицом/);
  assert.equal(main.hidden, undefined, "пустые абзацы со скрытым знаком абзаца — не скрытый текст");
  assert.equal(reductionCoefficientNote([main], 32_656_876.58, null), null, "«одинаковые цены / коэффициенты снижения» — не смета");
});

test("РВК-Комсомольск: Форма 1 — 28 строк «драйверов», цену вписывает участник; поля страны происхождения в форме нет", async () => {
  const form = await read(RVK, "Приложение № 6 (Форма 1) - Письмо оферта+КП.xlsx");
  assert.match(form.text, /Цена за 1 ед\. драйвера, без НДС, руб\./);
  assert.match(form.text, /28 \| Оказание услуг по подготовке консолидированных справок по кредитному портфелю/);
  assert.match(form.text, /1\/2 ИПЦ \(прогноз 5,12%\)/);
  assert.doesNotMatch(form.text, /страна происхождения|ОКСМ/i);
});

test("РВК-Комсомольск: несостыковки внутри документов заказчика — перечень банков и референц-лист названы под чужими номерами, К10 с пересекающимися датами", async () => {
  const main = await read(RVK, "Документация о закупке_услуги.docx");
  assert.match(main.text, /предпочтительно предоставление гарантии банка из перечня Приложения № 7/);
  assert.match((await read(RVK, "Приложение № 8 - Перечень банков.docx")).text, /Перечень банков, от которых предпочтительно предоставление независимой гарантии/);
  const criteria = await read(RVK, "Приложение № 4 - Критерии соответствия.xlsx");
  assert.match(criteria.text, /Заполненный референц-лист в соответствии с Приложением № 6 \(форма 3\)/);
  assert.match((await read(RVK, "Приложение № 6 (Форма 4) - Референц-лист.xlsx")).text, /Приложение № 6 \(Форма 3\) документации о закупке/);
  assert.match(criteria.text, /с 01 декабря 2026 по 31 января 2027 года - 5 баллов/);
  assert.match(criteria.text, /с 01 ноября 2026 по 31 января 2027 - 10 баллов/);
  assert.match(criteria.text, /ИО = 0,6хНЦ \+ 0,4хЦ/);
});

test("РВК-Комсомольск: проект договора — стороны «ОЦО» и «Клиент», начало услуг с 10.11.2026; «после победы» пусто: продукт не знает этих названий сторон (пункт 61)", async () => {
  const contract = await read(RVK, "2 Договор/Договор ОЦО и ЕКЦ.docx");
  assert.match(contract.text, /начало оказания Услуг ОЦО \(пп\. 1\.1\.1 Договора\) с «10» ноября 2026 г\./);
  assert.match(contract.text, /не позднее 3 \(трех\) рабочих дней/);
  assert.equal(afterWinDuties([contract]), null, "когда пункт 61 будет сделан, этот тест надо поменять на ожидание обязанностей");
});

test("ДГК: карта конкурса — предельные цены, обеспечение, режим преимущества; в формах названы РПП, РЭП и ПО — поиск идёт сразу во всех, участника выбирать не просят", async () => {
  const main = await read(DGK, "Документация о закупке 12016025.docx");
  assert.match(main.text, /59 103 088,52 руб\., без учета НДС/);
  assert.match(main.text, /Размер обеспечения заявок 768 785,33/);
  assert.match(main.text, /Национальный режим не предоставляется\. Установлен режим преимущества Российской продукции/);
  const demand = detectRegistryDemand([main]);
  assert.equal(demand.status, "unclear");
  assert.equal(demand.registry, null);
  assert.match(demand.notes.join(" "), /несколько реестров — номер ищется сразу во всех/);
  assert.doesNotMatch(demand.notes.join(" "), /выберите/);
});

test("ДГК: «коэффициент снижения» в ТТ — про объём заказа, а не про цену; заметки на шаге «Цена» нет", async () => {
  const tt = await read(DGK, "Технические требования.docx");
  assert.match(tt.text, /коэффициент снижения служит только для оценки и сопоставления предложений/);
  assert.equal(reductionCoefficientNote([tt], 59_103_088.52, null), null);
});

test("ДГК: Структура НМЦ — по каждой позиции режим, страна, реестр и номер записи; чертёж-скан без текста честно не читается", async () => {
  const kp = await read(DGK, "Форма Коммерческого предложения и Структуры НМЦ.xlsx");
  assert.match(kp.text, /Наименование реестра и номер реестровой записи \(указывается обязательно при "запрете или ограничении"/);
  assert.match(kp.text, /Крыльчатка к дымососу Д18 \| Национальный режим не предоставляется – преимущество/);
  assert.match(kp.text, /3201700,55/);
  const drawing = await load(DGK, "Приложение 8 - чертеж 03.8210.098 СБ.pdf");
  assert.equal(drawing.ok, false);
  assert.match(drawing.ok ? "" : drawing.reason, /скан/);
});

test("Воздушные Ворота: таблицы PDF, на которых библиотека падает, всё равно размечаются (раньше — ни одной), «1875.93» — не постановление", async () => {
  const volume = await read(VV, "Приложение___8_к_Документации_о_закупке__Том_3_Технологические_коммуникации_.pdf");
  const tableRows = volume.text.split("\n").filter((l) => / \| /.test(l)).length;
  assert.ok(tableRows >= 10, `строк таблиц: ${tableRows}`);
  assert.equal(detectRegistryDemand([volume]).status, "none");
  assert.equal(detectRegistryDemand([{ name: "Том 2.pdf", text: "Средняя плотность - 1875.93, кг/куб.м" }]).mentions.length, 0);
});

test("Воздушные Ворота: договор подряда — две обязанности подрядчика со сроком; ведомость объёмов — цены работ и материалов вписывает участник", async () => {
  const contract = await read(VV, "Приложение___4_к_Документации_о_закупке__Договор_.docx");
  const found = afterWinDuties([contract]);
  assert.equal(found?.duties.length, 2);
  assert.match(found?.duties[0].text ?? "", /копию приказа о назначении ответственных лиц за пожарную безопасность/);
  assert.match(found?.duties[1].term ?? "", /в течение 5 \(пяти\) дней со дня оплаты Подрядчиком/);
  const vor = await read(VV, "Приложение___5_к_Документации_о_закупке__Разбивка_стоимости_.xlsx");
  assert.match(vor.text, /Цена за ед\. изм\., руб\. \| Сумма, руб\. \| Ед\. изм\. \| Кол-во \| Цена за ед\. изм\., руб\./);
  assert.match(vor.text, /Вынос металлических контейнеров из пятна застройки \| шт \| 3 \|/);
  assert.match(vor.text, /работы выполняются силами Заказчика/);
});

test("Метрострой: национальный режим ПРЕДОСТАВЛЯЕТСЯ — ограничений нет; шаг аукциона 0,5 %; правило «без слов „или эквивалент“» из инструкции под Формой 1", async () => {
  const main = await read(MET, "Документация_2026-23821_редакция от 02.10.2026.docx");
  const form = await read(MET, "ЧАСТЬ III. Форма №1_Предложение участника закупки.xls");
  const demand = detectRegistryDemand([main, form]);
  assert.equal(demand.status, "none");
  assert.match(demand.notes.join(" "), /не применяются/);
  assert.match(demand.notes.join(" "), /страну происхождения/);
  assert.match(flat(auctionStepNote([main], 25_699_839.23)), /0,5 %.*128 499,20/);
  const rule = fillRulesOf([form]).find((r) => r.id === "no_equivalent");
  assert.ok(rule, "правило должно быть найдено");
  assert.match(rule.quote, /без указания слов «или эквивалент»/);
});

test("Метрострой: спецификация найдена; числа сходятся (карты × размер = м²); Изменения № 1 дают срок подачи 07.10.2026 12:00 и отменяют прежнюю редакцию Приложения № 1", async () => {
  const spec = await read(MET, "Приложение №1 к ТЗ_Спецификация_редакция от 02.10.2026.xlsx");
  assert.ok(findSpecification([spec]));
  assert.equal(Math.round(3720 * 1.75 * 4.3), 27993);
  assert.equal(Math.round(3 * 2.38 * 4.35 * 100) / 100, 31.06);
  assert.equal(Math.round(9 * 1.1 * 4.85 * 100) / 100, 48.02);
  assert.match(spec.text, /Сетка стальная 5Вр-1 150х150 4С 110х485 .* Габариты карты, мм: 1100х4850/);
  const changes = await read(MET, "Изменения № 1 от 02.10.2026.pdf");
  assert.match(flat(changes.text), /«07» октября 2026 года, в 12:00 ч/);
  assert.match(flat(changes.text), /редакцию Приложения №1 к Техническому заданию документации о закупке от 28\.09\.2026 считать недействительной/);
  const rnmcd = await read(MET, "РНМЦД.xlsx");
  assert.match(rnmcd.text, /25 699 839,23 руб\./);
});

test("УСГС: протокол — подана одна заявка, закупка несостоявшаяся; уведомление № 538 переносит срок подачи на 05.10.2026; в наборе две редакции документации", async () => {
  const protocol = await read(USGS, "Протокол ЗК № 1 (0047-КС ПИР СМР-2026-УСГС).pdf");
  assert.match(flat(protocol.text), /КОЛИЧЕСТВО ПОДАННЫХ ЗАЯВОК НА УЧАСТИЕ В ЗАКУПКЕ: 1 \(одна\) заявка/);
  assert.match(flat(protocol.text), /Признать закупку несостоявшейся на основании п\. 4\.19\.1 «а»/);
  assert.match(flat(protocol.text), /КОЛИЧЕСТВО ОТКЛОНЕННЫХ ЗАЯВОК: 1 \(ОДНА\)/);
  assert.match(flat(protocol.text), /Признать первую часть заявки следующего Участника.*соответствующей/);
  const notice = await read(USGS, "Уведомление о внесении изменений  от 28.09.26.doc");
  assert.match(flat(notice.text), /№ 538/);
  assert.match(flat(notice.text), /«05» октября 2026 г\. в 09 ч\. 00 мин/);
  const older = await read(USGS, "ДоЗ Аукцион МСП (0047-КС ПИР СМР-2026-УСГС).docx");
  const newer = await read(USGS, "ДоЗ Аукцион МСП (0047-КС ПИР СМР-2026-УСГС) ред.   от 28.09.26.docx");
  assert.match(flat(older.text), /Дата и время окончания срока подачи заявок: «28» сентября 2026г\./);
  assert.match(flat(newer.text), /Дата и время окончания срока подачи заявок: «05» октября 2026 г\. в 09 ч\. 00 мин/);
  const contract = await read(USGS, "Приложение № 2 к ДоЗ_ПД  (0047-КС ПИР СМР-2026-УСГС).docx");
  assert.equal(isContract(contract), true, "файл назван «ПД», но начинается словами «Договор поставки №»");
});

test("МИРЭА: в карте запрет, ограничение и преимущество «НЕ УСТАНОВЛЕНО» — реестровых ограничений нет; заметка про коэффициент снижения сметы верна", async () => {
  const main = await read(MIREA, "Документация КО.docx");
  assert.match(main.text, /Запрет закупок товаров.*\| НЕ УСТАНОВЛЕНО/);
  assert.match(main.text, /Преимущество в отношении товаров российского происхождения.*\| НЕ УСТАНОВЛЕНО/);
  const demand = detectRegistryDemand([main]);
  assert.equal(demand.status, "none");
  assert.match(demand.notes.join(" "), /не применяются/);
  assert.match(reductionCoefficientNote([main], 56_144_399.6, null) ?? "", /Выберите цену/);
  assert.equal(vatOnTopNote([main]), null);
});

test("МИРЭА: бумажная заявка в запечатанном конверте, вскрытие 09.10.2026 12:00, обеспечение 2 % и 5 %, критерии 30/10/60", async () => {
  const main = await read(MIREA, "Документация КО.docx");
  const t = flat(main.text);
  assert.match(t, /в письменной форме в запечатанном конверте/);
  assert.match(t, /«09» октября 2026 года в 12:00 \(время московское\)/);
  assert.match(t, /в размере 2% от начальной \(максимальной\) цены договора, что составляет: 1 122 887/);
  assert.match(t, /в размере 5% от начальной \(максимальной\) цены договора, что составляет: 2 807 219/);
  assert.match(t, /Критерий оценки заявок: «Цена договора» Значимость критерия оценки заявок: 30%/);
  assert.match(t, /«Качество работ» Значимость критерия оценки заявок: 10%/);
  assert.match(t, /Значимость критерия оценки заявок: 60%/);
});

const ROS = "Россети Сибирь (закупка в электронном магазине, мебель)";
const CTO = "ГАУ ЦТО Москва (аукцион МСП 223-ФЗ, стенды для СПО)";

test("Россети Сибирь: закупка в электронном магазине — 9 позиций мебели, по всем «ограничение» по ПП № 1875; одна обязанность подрядчика со сроком в договоре", async () => {
  const list = await read(ROS, "Приложение 1 к ТЗ Перечень и объемы поставки.xlsx");
  assert.equal((list.text.match(/\| ограничение \|/g) ?? []).length, 9);
  assert.match(list.text, /Итого планируемая \(предельная\) цена закупки: .*1467920,29/);
  const notice = await read(ROS, "69ПКД-КуЭ_Извещение закупка в ЭМ.docx");
  assert.match(notice.text, /Начальная \(максимальная\) цена договора без учета НДС составляет 1 467 920,29/);
  assert.match(flat(notice.text), /2\.8\. Наименования файлов в составе заявки участника должно соответствовать наименованиям форм и документов/);
  assert.match(notice.text, /Обеспечение заявок на участие в закупке[\s\S]{0,200}Не требуется/);
  const contract = await read(ROS, "2026.08.21 1001759664 договор.docx");
  assert.equal(afterWinDuties([contract])?.duties.length, 1);
  assert.match(afterWinDuties([contract])?.duties[0].term ?? "", /в течение 20 \(двадцати\) рабочих дней/);
  const demand = detectRegistryDemand([notice, list]);
  assert.equal(demand.status, "unclear");
  assert.match(demand.notes.join(" "), /номер ищется сразу во всех/);
});

test("ГАУ ЦТО: национальный режим предоставляется, «Не установлено» — ограничений нет; «сумма цен единиц» в расчёте НМЦД не находится (это НДС); шаг от 0,5 до 5 %", async () => {
  const main = await read(CTO, "v2_Аукционная документация СПО-КР2027-36.docx");
  const calc = await read(CTO, "Расчет НМЦД СПО-КР2027-36.xlsx");
  const demand = detectRegistryDemand([main]);
  assert.equal(demand.status, "none");
  assert.match(demand.notes.join(" "), /не применяются/);
  assert.equal(findUnitSum([main, calc]), null, "11 456 803,28 + 2 520 496,72 = 13 977 300 — это цена без НДС плюс налог");
  assert.match(flat(auctionStepNote([main], 13_977_300)), /от 0,5 % до 5 % начальной цены: от 69 886,50 ₽ до 698 865,00 ₽ за один шаг/);
  assert.match(calc.text, /13977300/);
});

test("ГАУ ЦТО: «Информационное письмо» — инструкция участникам в виде письма; заказчик сам снизил НМЦ с 14 520 266,67 до 13 977 300", async () => {
  const letter = await read(CTO, "Информационное письмо.docx");
  assert.match(flat(letter.text), /Выписка из сервиса оценки юридических лиц или индивидуальных предпринимателей по форме, установленной ФНС России, сформированную в срок не ранее, чем за 30 календарных дней/);
  assert.match(flat(letter.text), /не являющихся участниками процедур закупки, участниками которой могут быть только субъекты малого и среднего предпринимательства/);
  const why = await read(CTO, "Обоснование определения МЗЦД.pdf");
  assert.match(flat(why.text), /14 520 266 .*рублей 67 копеек/);
  assert.match(flat(why.text), /начальная \(максимальная\) цена договора, была снижена и составила: 13 977 300/);
});

const KS = "Комфортная среда (конкурентный отбор 223-ФЗ, обследование и ПИР)";

test("Комфортная среда: «номера реестровых записей» про договоры в реестре ЕИС — не реестр продукции; национальный режим предоставляется; бумажная заявка, обеспечение 5 % и 30 %, критерии 30/70", async () => {
  const main = await read(KS, "Документация_на_КО_обследование+ПИР.docx");
  assert.match(main.text, /Информацию о номерах реестровых записей рекомендуется предоставлять в структурированном виде/);
  const demand = detectRegistryDemand([main]);
  assert.equal(demand.status, "none");
  assert.match(demand.notes.join(" "), /не применяются/);
  const t = flat(main.text);
  assert.match(t, /10 457 437,86 руб\., в том числе НДС 22 % – 1 885 767,48 руб\./);
  assert.match(t, /в размере 5 % от начальной \(максимальной\) цены договора, что составляет: 522 871,89 руб\./);
  assert.match(t, /в размере 30 % от начальной \(максимальной\) цены договора, что составляет: 3 137 231,36 руб\./);
  assert.match(t, /«13» октября 2026 года в 11:00 \(время московское\)/);
  assert.match(t, /Значимость критерия оценки заявок: 30%/);
  assert.match(t, /Значимость критерия оценки заявок: 70%/);
  const calc = await read(KS, "Расчет НМЦК (по рынку) на Обсл-е и ПСД  на ККР, Екб, Мостовая-57(v1).xlsx");
  assert.match(calc.text, /Всего \| 10457437,86/);
});

const KRMO = "КРМО (конкурс МСП 223-ФЗ, охрана индустриального парка Есипово)";
const VTE = "ВТЕ Юго-Восток (аукцион 223-ФЗ, техническая соль)";

test("КРМО: «реестровый номер контракта» — это опыт, а не реестр продукции; в карте приоритет по ПП № 1875, обеспечение заявки 2 %, цена 50 %", async () => {
  const main = await read(KRMO, "КД_охрана Есипово_смп.docx");
  const forms = await read(KRMO, "Образцы форм.docx");
  const criteria0 = await read(KRMO, "Критерии оценки.docx");
  assert.match(flat(forms.text), /сведения о реестровом номере контракта \(договора\)/i);
  const demand = detectRegistryDemand([main, forms, criteria0]);
  assert.equal(demand.mentions.some((m) => m.kind === "registry_number"), false);
  assert.equal(demand.status, "unclear", "остаётся «Приоритет … ПП № 1875» (п. 16): реестр не назван");
  const t = flat(main.text);
  assert.match(t, /12 900 000,00 \(Двенадцать миллионов девятьсот тысяч\) рублей 00 копеек, включая НДС/);
  assert.match(t, /Предусмотрено в следующем размере: 2,0 % от начальной \(максимальной\) цены договора, НДС не облагается/);
  const criteria = await read(KRMO, "Критерии оценки.docx");
  assert.match(criteria.text, /Значимость критерия: 50 %/);
});

test("ВТЕ Юго-Восток: соль 12 950 000 кг, НМЦ = 9,09 ₽/кг после «коэффициента оптимизации»; обоснование НМЦД — скан без текста", async () => {
  const notice = await read(VTE, "Извещение о проведении аукциона.docx");
  assert.match(flat(notice.text), /117 715 500,00 \(Сто семнадцать миллионов семьсот пятнадцать тысяч пятьсот\) рублей 00 копеек, в том числе НДС 22 %/);
  assert.match(flat(notice.text), /Дата и время окончания срока подачи заявок 12\.10\.2026 в 10\.00 московского времени/);
  assert.equal(Math.round(9.09 * 12_950_000), 117_715_500);
  const calc = await read(VTE, "Расчет НМЦД.xlsx");
  assert.match(calc.text, /Итого цена с коэф\. оптимизации заказчика/);
  assert.match(calc.text, /Соль для промышленных целей \| 9,81 \| 10,5 \| 10,32 \| 10,21 \| 9,09 \| 12950000 \| 117715500/);
  const scan = await load(VTE, "Обоснование НМЦД.pdf");
  assert.equal(scan.ok, false);
  assert.equal(detectRegistryDemand([notice, calc]).status, "none");
});
