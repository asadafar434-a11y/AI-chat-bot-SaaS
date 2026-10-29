// Применимость полей по сферам: поле, которого в сфере не бывает (монтаж у канцтоваров, продуктов, лекарств; гарантия у продуктов; поверка у лекарств), на экране не показывается.
// Таблица ниже — решение по смыслу закупки (28.10.2026, после замечания владельца о «Сроке монтажа» во всех сферах); меняется осознанно, а не случайно.
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatorsBySphere } from "./registry.ts";

type Row = { sphere: string; sub: string };

// Где монтаж (установка, сборка, пусконаладка) бывает.
const WITH_INSTALLATION = new Set(["medical/device", "office-equipment/general", "furniture/general", "educational-equipment/general"]);
// Где «Гарантия» как отдельная статья затрат бывает: техника, мебель, учебное оборудование, медизделия, автомобили, стройматериалы.
const WITH_WARRANTY = new Set(["medical/device", "office-equipment/general", "furniture/general", "educational-equipment/general", "automobiles/general", "building-materials/general"]);
// Где есть отдельный блок «Доставка и монтаж» с бригадой, сроком и ставкой (у медизделий монтаж — только статья затрат и пункт «после контракта»).
const WITH_CREW_BLOCK = new Set(["office-equipment/general", "furniture/general", "educational-equipment/general"]);
// Товарные сферы (у остальных — услуги: командировочные, субподряд, персонал).
const GOODS = new Set([
  "medical/device", "medical/medicine", "office-equipment/general", "furniture/general", "stationery/general", "workwear/general",
  "automobiles/general", "building-materials/general", "educational-equipment/general", "food/general",
]);

const all: (Row & { keys: string[]; labels: string[]; id: string; postAward: string[] })[] = Object.entries(calculatorsBySphere).flatMap(([sphere, list]) =>
  list.map((c) => ({ sphere, sub: c.subSphereKey, id: `${sphere}/${c.subSphereKey}`, keys: c.inputSchema.map((f) => f.key), labels: c.inputSchema.map((f) => f.label), postAward: c.inputSchema.filter((f) => f.section === "postAward").map((f) => f.key).sort() })),
);
const has = (row: { keys: string[] }, re: RegExp) => row.keys.filter((k) => re.test(k));

test("монтаж (стоимость, бригада, срок, дневная ставка, «Требуется монтаж») — только там, где его делают", () => {
  for (const row of all) {
    const found = has(row, /^installation/);
    if (WITH_INSTALLATION.has(row.id)) assert.ok(found.length > 0, `${row.id}: монтаж должен быть`);
    else assert.deepEqual(found, [], `${row.id}: монтажа в этой сфере не бывает, а поля есть: ${found.join(", ")}`);
  }
});

test("гарантия как статья затрат — только в сферах с гарантийным обслуживанием; у продуктов, спецодежды, канцтоваров и лекарств её нет", () => {
  for (const row of all) {
    const found = has(row, /^warrantyCost$/);
    if (GOODS.has(row.id) && WITH_WARRANTY.has(row.id)) assert.equal(found.length, 1, `${row.id}: «Гарантия» должна быть`);
    else assert.deepEqual(found, [], `${row.id}: «Гарантии» тут быть не должно`);
  }
});

test("«Срок монтажа» и поля бригады не попадают ни в услуги, ни в сферы без монтажа; у доставки без монтажа раздел называется «Доставка»", () => {
  for (const row of all) {
    const crew = row.labels.filter((l) => /Срок монтажа|монтажной бригады|Дневная ставка монтажника|Прочие расходы на монтаж/i.test(l));
    if (WITH_CREW_BLOCK.has(row.id)) assert.ok(crew.length >= 3, `${row.id}: поля монтажной бригады должны быть`);
    else assert.deepEqual(crew, [], `${row.id}: ${crew.join(", ")}`);
  }
  const stationery = calculatorsBySphere.stationery[0];
  assert.ok(stationery.inputSchema.some((f) => f.key === "deliveryDistanceKm" && f.section === "delivery"), "доставка у канцтоваров осталась, раздел «delivery»");
  assert.equal(stationery.inputSchema.some((f) => f.section === "logistics"), false);
  const furniture = calculatorsBySphere.furniture[0];
  assert.ok(furniture.inputSchema.some((f) => f.key === "installationDays" && f.section === "logistics"), "у мебели «Доставка и монтаж» как раньше");
});

test("лекарства: после контракта только холодовая цепь и маркировка; поверка, ТО, монтаж и гарантия — у медизделий", () => {
  const medicine = all.find((r) => r.id === "medical/medicine")!;
  const device = all.find((r) => r.id === "medical/device")!;
  const post = (r: typeof medicine) => r.postAward;
  assert.deepEqual(post(medicine), ["coldChainRequired", "markingRequired"]);
  assert.deepEqual(post(device), ["coldChainRequired", "installationRequired", "maintenanceRequired", "markingRequired", "verificationRequired", "warrantyRequired"]);
});

test("расчёт цены без скрытых полей не падает: канцтовары, продукты, лекарства, автомобили считаются без «Монтаж» и «Гарантия»", () => {
  for (const id of ["stationery", "food", "automobiles", "workwear"]) {
    const calc = calculatorsBySphere[id][0];
    const out = calc.calculate({ cost: 80_000, offerPrice: 100_000, nmck: 120_000, otherCost: 1_000, riskScore: 0.1 });
    assert.ok(out.values.some((v) => /marginPercent$/.test(v.key) && typeof v.value === "number"), `${id}: маржа не посчитана`);
    assert.ok(!out.needsInput.some((f) => /installation|warranty/i.test(f.key)), `${id}: просит скрытое поле`);
  }
});

// Услуги: «Аренда и содержание техники» не бывает у страхования, юридических услуг и недвижимости; в остальных услугах остаётся.
const NO_EQUIPMENT = new Set(["insurance/general", "legal-services/general", "real-estate/general"]);

test("услуги: «Аренда и содержание техники» — не в страховании, юридических услугах и недвижимости; в остальных услугах есть", () => {
  for (const row of all.filter((r) => !GOODS.has(r.id))) {
    const found = row.keys.filter((k) => k === "equipmentMonthlyCost");
    if (NO_EQUIPMENT.has(row.id)) assert.deepEqual(found, [], `${row.id}: техники тут быть не должно`);
    else assert.equal(found.length, 1, `${row.id}: поле техники должно быть`);
  }
  const insurance = calculatorsBySphere.insurance[0];
  const out = insurance.calculate({ headcount: 3, avgMonthlySalary: 100_000, payrollTaxRate: 30.2, months: 12, marginPercent: 10, equipmentMonthlyCost: 999_999 });
  assert.ok(!out.values.some((v) => /totalEquipment/.test(v.key)), "строки «Техника» в результате нет");
  const total = out.values.find((v) => /totalCost$/.test(v.key));
  assert.equal(total?.value, Math.round(3 * 100_000 * 1.302 * 12 * 100) / 100, "скрытое поле на расчёт не влияет, даже если его передали");
});
