// «Сколько это может стоить по этому контракту»: оценка в рублях по условиям договора и типовым допущениям — на коротких текстах и на настоящих договорах — npm test (без ИИ).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contractRisks } from "./contract-risks.ts";
import { extractText } from "./extract-text.ts";
import { regionNote } from "./hidden-costs.ts";
import { DEFAULT_ASSUMPTIONS, estimateRisks, type Assumptions } from "./risk-estimate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Татьяна-Примеры документов");
const contract = (...lines: string[]) => [{ name: "Проект.docx", text: ["Договор поставки № 1", ...lines].join("\n") }];
const A: Assumptions = DEFAULT_ASSUMPTIONS;
const est = (lines: string[], price: number | null, type: "goods" | "works" | "services" | "it" | "food" | "general" = "services", over: Partial<Assumptions> = {}) =>
  estimateRisks({ price, risks: contractRisks(contract(...lines)), type, region: null, assumptions: { ...A, ...over } });
const byId = (r: ReturnType<typeof est>, prefix: string) => r.items.filter((i) => i.id.startsWith(prefix));
const near = (a: number | null, b: number, eps = 0.01) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("два размера пени в одном пункте (0,1 % и 0,2 %) — варианты одного события: считается больший; штраф называет причину из договора", () => {
  const r = est(
    [
      "6.1. В случае нарушения Поставщиком обязательств по поставке партии товара (нарушение срока поставки, недопоставка), Покупатель вправе потребовать уплаты Поставщиком:",
      "– неустойки в размере 0,1 (ноль целых и одна десятая) процента от цены несвоевременно поставленной партии товара за каждый день просрочки – в случае, когда нарушение не привело к изменению срока поставки другому грузополучателю;",
      "– неустойки в размере 0,2 (ноль целых и две десятых) процента от цены несвоевременно поставленной партии товара за каждый день просрочки – в случае, когда нарушение привело к изменению срока поставки другому грузополучателю.",
      "6.6. В случае поступления Товара несоответствующего сведениям о стране происхождения Товара, согласованного в договоре, Покупатель вправе взыскать с Поставщика штраф в размере 10% от стоимости поставленного Товара.",
    ],
    9_305_651.64,
    "goods",
  );
  const days = byId(r, "penalty").filter((i) => /Просрочка/.test(i.title));
  assert.equal(days.length, 1, "0,1 % и 0,2 % — не два платежа");
  assert.match(days[0].title, /0,2 % в день/);
  near(days[0].amount, (9_305_651.64 * 0.2 * A.delayDays) / 100);
  const fine = byId(r, "penalty").find((i) => /^Штраф/.test(i.title));
  assert.equal(fine?.title, "Штраф: несоответствие страны происхождения");
  near(fine?.amount ?? null, 930_565.16);
});

test("пеня за каждый день просрочки считается на допущенное число дней, штраф — один случай; крупное идёт первым", () => {
  const r = est(
    [
      "7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки.",
      "7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора.",
    ],
    1_000_000,
  );
  const pen = byId(r, "penalty");
  assert.equal(pen.length, 2);
  assert.equal(pen[0].amount, 300_000, "штраф 30 % идёт первым");
  assert.match(pen[0].scenario, /Один случай нарушения: штраф 30 % от цены/);
  assert.equal(pen[1].amount, 10_000, "0,1 % × 10 дней = 1 % цены");
  assert.match(pen[1].scenario, /Срыв срока на 10 дней по вашей вине: 0,1 % в день/);
  assert.equal(pen[1].pct, 1);
  assert.equal(pen[0].kind, "estimate");
  assert.ok(pen.every((p) => p.inTotal));
});

test("пеня 5 % в день: за 10 дней — половина цены; потолок «не более 10 %» режет до десятой доли; число дней — допущение", () => {
  const big = est(["6.4. Заказчик вправе потребовать уплаты пени в размере 5 % (Пяти процентов) от Цены ГПД за каждый день просрочки, если Подрядчик нарушил срок."], 2_000_000);
  // Это пеня на вас: «Заказчик вправе потребовать» — платите вы.
  assert.equal(byId(big, "penalty")[0].amount, 1_000_000);
  const capped = est(["6.4. Исполнитель обязан уплатить Заказчику пеню в размере 5 % от цены Договора за каждый день просрочки, но не более 10 (десяти) % цены Договора."], 2_000_000);
  assert.equal(byId(capped, "penalty")[0].amount, 200_000);
  assert.match(byId(capped, "penalty")[0].scenario, /не больше 10 %/);
  const days30 = est(["7.3. Исполнитель обязан уплатить Заказчику пеню в размере 0,1% от цены Договора за каждый день просрочки."], 1_000_000, "services", { delayDays: 30 });
  assert.equal(byId(days30, "penalty")[0].amount, 30_000);
});

test("пеня «1/300 ключевой ставки» на вас: ставка из допущений делится на 300", () => {
  const r = est(["6.2. Исполнитель обязан уплатить Заказчику неустойку в размере 1/300 ключевой ставки Банка России от цены Договора за каждый день просрочки."], 1_000_000);
  near(byId(r, "penalty")[0].amount, (1_000_000 * (14 / 300) * 10) / 100);
  assert.match(byId(r, "penalty")[0].title, /1\/300 ключевой ставки/);
});

test("срок оплаты: проценты за замороженные деньги по ставке из допущений; нет аванса — написано в названии", () => {
  const r = est(["2.2. Авансирование по Договору не предусмотрено.", "3.7. Оплата производится Заказчиком в течение 30 рабочих дней с момента получения заключения эксперта."], 1_000_000);
  const fin = r.items.find((i) => i.id === "finance")!;
  near(fin.amount, (1_000_000 * 14 * 42) / 100 / 365); // 30 рабочих ≈ 42 календарных дня
  assert.match(fin.title, /Деньги заморожены 42 дней до оплаты, аванса нет/);
  assert.match(fin.basis, /ставка 14 % годовых/);
  const higher = est(["3.7. Оплата производится Заказчиком в течение 30 дней с даты акта."], 1_000_000, "services", { financeRatePct: 20 });
  near(higher.items.find((i) => i.id === "finance")!.amount, (1_000_000 * 20 * 30) / 100 / 365);
});

test("обеспечение 30 % — банковская гарантия: стоимость за год от её суммы; обеспечения нет — расчёта нет", () => {
  const r = est(["10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 30 % (тридцати процентов) от начальной цены."], 1_000_000);
  const g = r.items.find((i) => i.id === "guarantee")!;
  assert.equal(g.amount, 9_000, "300 000 × 3 %");
  assert.match(g.scenario, /Гарантия на 300 000 ₽ под 3 % годовых/);
  assert.equal(est(["10.1. Обеспечение исполнения Договора не установлено."], 1_000_000).items.some((i) => i.id === "guarantee"), false);
});

test("твёрдая цена: рост затрат ложится на вас (доля затрат × рост); договор допускает индексацию — риск не считается", () => {
  const firm = est(["2.1. Цена Договора является твёрдой и определяется на весь срок исполнения Договора."], 1_000_000);
  assert.equal(firm.items.find((i) => i.id === "growth")!.amount, 85_000, "85 % цены × 10 %");
  const both = est(["2.1. Цена Договора является твёрдой.", "5.6. Поставщик вправе не реже одного раза в 6 месяцев осуществлять индексацию цены Товара в соответствии с индексами потребительских цен."], 1_000_000);
  assert.equal(both.items.some((i) => i.id === "growth"), false);
});

test("гарантийный резерв — для поставки, работ и ИТ; для услуг и питания нет", () => {
  const some = (type: Parameters<typeof est>[2]) => est(["2.1. Цена Договора является твёрдой."], 1_000_000, type).items.some((i) => i.id === "warranty");
  assert.equal(some("goods"), true);
  assert.equal(some("works"), true);
  assert.equal(some("it"), true);
  assert.equal(some("services"), false);
  assert.equal(some("food"), false);
  assert.equal(est([], 1_000_000, "goods").items.find((i) => i.id === "warranty")!.amount, 20_000);
});

test("изменение объёма — не потеря: показано, но в итог не входит; расходы за ваш счёт без суммы и другой регион — «не определено» с тем, что запросить", () => {
  const r = estimateRisks({
    price: 1_000_000,
    risks: contractRisks(
      contract(
        "1.3. В процессе исполнения Договора количество Товара может быть изменено по инициативе Покупателя в сторону увеличения (не более 10%).",
        "5.12. Расходы на экспертизу несёт Исполнитель, за исключением случаев, когда экспертизой установлено отсутствие нарушений.",
      ),
    ),
    type: "goods",
    region: regionNote({ text: "Место поставки: г. Севастополь", region: { name: "Севастополь", hard: true } }, "г. Екатеринбург"),
    assumptions: A,
  });
  const vol = r.items.find((i) => i.id === "volume")!;
  assert.equal(vol.amount, 100_000);
  assert.equal(vol.inTotal, false);
  const unknown = r.items.filter((i) => i.kind === "unknown");
  assert.equal(unknown.length, 2);
  assert.ok(unknown.every((u) => u.amount === null && u.pct === null && !u.inTotal && u.ask));
  assert.match(unknown[0].title, /За ваш счёт: экспертиза/);
  assert.match(unknown[1].title, /Севастополь вместо Свердловская область/);
  assert.equal(r.unknown, 2);
  assert.equal(r.total, 20_000, "в итоге только гарантийный резерв: объём и «не определено» не считаются");
});

test("итог — сумма оценок из итога и её доля цены; нет цены — оценок нет", () => {
  const r = est(
    ["7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора.", "10.1. Договор заключается после предоставления Исполнителем обеспечения исполнения Договора в размере 30 % от начальной цены."],
    1_000_000,
    "goods",
  );
  assert.equal(r.total, 300_000 + 9_000 + 20_000);
  near(r.totalPct, 32.9);
  assert.deepEqual(est(["7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."], null).items, []);
  assert.equal(est(["7.4. Исполнитель уплачивает Заказчику штраф в размере 30% от цены Договора."], 0).total, 0);
});

test("настоящий договор ГПД («Комфортная среда»), цена 10 457 437,86 ₽: пеня 5 % в день, гарантия 30 % и деньги за 10 дней", async () => {
  const file = path.join(ROOT, "Комфортная среда (конкурентный отбор 223-ФЗ, обследование и ПИР)/Проект ГПД на обследование+ПИР.docx");
  const r0 = await extractText(new File([new Uint8Array(readFileSync(file))], path.basename(file)), { ocr: false });
  assert.ok(r0.ok);
  const price = 10_457_437.86;
  const res = estimateRisks({ price, risks: contractRisks([{ name: "ГПД", text: r0.text }]), type: "works", region: null, assumptions: A });
  const penalty = res.items.find((i) => /5 % в день/.test(i.title))!;
  near(penalty.amount, price * 0.5, 0.01);
  assert.ok(penalty.pct! > 49.9 && penalty.pct! < 50.1, "половина цены за 10 дней просрочки");
  const g = res.items.find((i) => i.id === "guarantee")!;
  near(g.amount, price * 0.3 * 0.03, 0.01);
  const fin = res.items.find((i) => i.id === "finance")!;
  near(fin.amount, (price * 14 * 10) / 100 / 365, 0.01);
  assert.ok(res.items.some((i) => i.id === "growth"), "цена твёрдая — рост затрат считается");
  assert.ok(res.items.some((i) => i.id === "warranty"), "работы — гарантийный резерв");
  assert.ok(res.items.some((i) => i.kind === "unknown" && /экспертиза/.test(i.title)));
  assert.ok(res.total > price * 0.5, "итог больше половины цены — это и есть вывод");
});

test("настоящий договор СМР («Воздушные Ворота»), цена 100 млн: штраф 20 % = 20 млн, оплата за 42 дня, экспертиза без суммы", async () => {
  const file = path.join(ROOT, "Воздушные Ворота СС (СМР, склад жидкости, тома проекта)/Приложение___4_к_Документации_о_закупке__Договор_.docx");
  const r0 = await extractText(new File([new Uint8Array(readFileSync(file))], path.basename(file)), { ocr: false });
  assert.ok(r0.ok);
  const res = estimateRisks({ price: 100_000_000, risks: contractRisks([{ name: "СМР", text: r0.text }]), type: "works", region: null, assumptions: A });
  assert.ok(res.items.some((i) => i.id.startsWith("penalty") && i.amount === 20_000_000));
  const fin = res.items.find((i) => i.id === "finance")!;
  assert.match(fin.title, /42 дней/);
  assert.ok(res.items.some((i) => i.kind === "unknown" && /экспертиза/.test(i.title)));
});
