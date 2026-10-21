// «Сколько это может стоить по этому контракту»: оценка в рублях по условиям договора и типовым допущениям. Считает код, без ИИ и интернета; допущения видны и меняются.
// Три вида чисел (решение владельца 21.10.2026: программа сама считает, а не просит участника разбирать список):
//  — из договора: пеня 5 % в день, срок оплаты, обеспечение 30 % — берутся из текста (lib/contract-risks.ts), метка «Оценка»: сценарий (например, просрочка на 10 дней) задан допущением;
//  — типовые допущения: стоимость денег (ключевая ставка), банковская гарантия, гарантийный резерв, рост затрат — значения по умолчанию в DEFAULT_ASSUMPTIONS, участник их меняет;
//  — отраслевые (поломка, ремонт, тариф перевозчика): без данных не выдумываются — «сумма не определена» и что запросить; их будет считать ИИ с российским поиском.
// Все суммы — от цены контракта; без цены оценок нет.

import type { ContractRisk } from "@/lib/contract-risks";
import type { PurchaseType, RegionNote } from "@/lib/hidden-costs";

export type Assumptions = {
  /** Стоимость денег, % годовых. По умолчанию — ключевая ставка Банка России на 21.10.2026; кредит бывает дороже. */
  financeRatePct: number;
  /** Банковская гарантия, % годовых от её суммы: рынок — примерно 1–5 %, зависит от банка и компании. */
  guaranteeRatePct: number;
  /** Просрочка по вашей вине, дней: на столько считается пеня. */
  delayDays: number;
  /** Доля затрат в цене, %: остальное — ваша прибыль. */
  costSharePct: number;
  /** Рост затрат за срок исполнения, %: для контракта с твёрдой ценой. */
  growthPct: number;
  /** Гарантийный ремонт и замена брака, % цены. */
  warrantyPct: number;
  /** Ключевая ставка, % годовых — для пени «1/300 ключевой ставки». */
  keyRatePct: number;
  /** Целевая маржа, % цены: от неё считается целевая цена заявки (lib/economics.ts). */
  targetMarginPct: number;
  /** Оптимистичный сценарий: затраты ниже на столько процентов. */
  optimisticPct: number;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  financeRatePct: 14,
  guaranteeRatePct: 3,
  delayDays: 10,
  costSharePct: 85,
  growthPct: 10,
  warrantyPct: 2,
  keyRatePct: 14,
  targetMarginPct: 10,
  optimisticPct: 5,
};

/** Откуда число: calc — условие из договора и арифметика; estimate — зависит от допущений; unknown — суммы нет, нужны данные. */
export type EstimateKind = "estimate" | "unknown";

export type Estimate = {
  id: string;
  title: string;
  /** Что считается: сценарий и формула словами. */
  scenario: string;
  amount: number | null;
  /** Доля от цены контракта, %. */
  pct: number | null;
  /** Пункт договора или допущение, на котором держится число. */
  basis: string;
  kind: EstimateKind;
  /** Входит ли в общий итог «если сработают все». Изменение объёма — не потеря, в итог не идёт. */
  inTotal: boolean;
  /** Для «не определено»: что запросить. */
  ask?: string;
};

export type EstimateInput = {
  price: number | null;
  risks: ContractRisk[];
  type: PurchaseType;
  region: RegionNote | null;
  assumptions: Assumptions;
};

export type EstimateResult = {
  items: Estimate[];
  /** Сумма оценок, входящих в итог. */
  total: number;
  totalPct: number | null;
  /** Сколько рисков не удалось оценить без данных. */
  unknown: number;
  /** Цена, от которой считались суммы; суммы пропорциональны ей — на этом строится экономика участия (lib/economics.ts). */
  priceUsed: number | null;
  /** Договор допускает индексацию цены: рост затрат не целиком на вас. */
  indexed: boolean;
};

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const pctOf = (amount: number, price: number) => (amount / price) * 100;
const ru = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

const MAX_PENALTIES = 4;

export function estimateRisks({ price, risks, type, region, assumptions: a }: EstimateInput): EstimateResult {
  const items: Estimate[] = [];
  const indexed = risks.some((r) => r.kind === "price" && r.party === "none" && /индексаци/i.test(r.title));
  if (price === null || price <= 0) return { items, total: 0, totalPct: null, unknown: 0, priceUsed: null, indexed };
  const where = (r: ContractRisk) => `${r.clause ? `п. ${r.clause}` : "договор"}`;
  const push = (e: Omit<Estimate, "pct"> & { amount: number | null }) =>
    items.push({ ...e, amount: e.amount === null ? null : round2(e.amount), pct: e.amount === null ? null : pctOf(e.amount, price) });

  // Неустойка на вас: пеня за каждый день просрочки — на допущенное число дней; штраф — один случай.
  const mine = risks
    .filter((r) => r.kind === "penalty" && r.party === "you" && r.n)
    .map((r) => {
      const n = r.n!;
      let amount = 0;
      let scenario = "";
      if (n.perDay) {
        const perDay = n.frac ? (a.keyRatePct / n.frac) : (n.percent ?? 0);
        amount = (price * perDay * a.delayDays) / 100;
        if (n.cap !== undefined) amount = Math.min(amount, (price * n.cap) / 100);
        scenario = `Срыв срока на ${a.delayDays} дней по вашей вине: ${n.frac ? `1/${n.frac} ключевой ставки (${ru(perDay)} % в день)` : `${ru(perDay)} % в день`} от цены${n.cap !== undefined ? `, не больше ${ru(n.cap)} %` : ""}`;
      } else if (n.percent !== undefined) {
        amount = (price * n.percent) / 100;
        scenario = `Один случай нарушения: штраф ${ru(n.percent)} % от цены`;
      } else if (n.rub !== undefined) {
        amount = n.rub;
        scenario = `Один случай нарушения: штраф ${ru(n.rub)} ₽`;
      } else return null;
      return { r, amount, scenario };
    })
    .filter((x): x is { r: ContractRisk; amount: number; scenario: string } => x !== null)
    .sort((x, y) => y.amount - x.amount)
    .slice(0, MAX_PENALTIES);
  for (const m of mine) {
    push({
      id: `penalty-${items.length}`,
      title: m.r.n!.perDay ? `Просрочка: пеня ${m.r.n!.frac ? `1/${m.r.n!.frac} ключевой ставки` : `${ru(m.r.n!.percent ?? 0)} % в день`}` : "Штраф за нарушение условий",
      scenario: m.scenario,
      amount: m.amount,
      basis: `${where(m.r)}; цена контракта ${ru(price)} ₽`,
      kind: "estimate",
      inTotal: true,
    });
  }

  // Деньги заморожены, пока заказчик не заплатит: проценты за срок оплаты (нет аванса — это ещё и весь контракт за свои деньги).
  const pay = risks.find((r) => r.kind === "payment" && r.n?.days);
  if (pay) {
    const days = pay.n!.days!;
    const noAdvance = risks.some((r) => r.kind === "advance" && /нет/i.test(r.title));
    push({
      id: "finance",
      title: `Деньги заморожены ${days} дней до оплаты${noAdvance ? ", аванса нет" : ""}`,
      scenario: `Цена ${ru(price)} ₽ под ${ru(a.financeRatePct)} % годовых на ${days} дней — проценты, если исполнять на заёмные деньги`,
      amount: (price * a.financeRatePct * days) / 100 / 365,
      basis: `${where(pay)}; допущение: ставка ${ru(a.financeRatePct)} % годовых`,
      kind: "estimate",
      inTotal: true,
    });
  }

  // Обеспечение исполнения: банковская гарантия стоит процент в год от суммы.
  const sec = risks.find((r) => r.kind === "security" && r.party === "you" && r.n?.percent);
  if (sec) {
    const sum = (price * sec.n!.percent!) / 100;
    push({
      id: "guarantee",
      title: `Банковская гарантия ${ru(sec.n!.percent!)} % цены`,
      scenario: `Гарантия на ${ru(sum)} ₽ под ${ru(a.guaranteeRatePct)} % годовых — стоимость за год (за срок договора больше)`,
      amount: (sum * a.guaranteeRatePct) / 100,
      basis: `${where(sec)}; допущение: ${ru(a.guaranteeRatePct)} % годовых (рынок 1–5 %, уточните в банке)`,
      kind: "estimate",
      inTotal: true,
    });
  }

  // Твёрдая цена: рост затрат ложится на вас. Договор допускает индексацию — риск меньше, и мы его не считаем.
  const firm = risks.find((r) => r.kind === "price" && r.party === "you");
  if (firm && !indexed) {
    push({
      id: "growth",
      title: `Рост затрат на ${ru(a.growthPct)} % при твёрдой цене`,
      scenario: `Затраты — ${ru(a.costSharePct)} % цены; вырастут на ${ru(a.growthPct)} %: материалы, топливо, зарплаты`,
      amount: (price * a.costSharePct * a.growthPct) / 10_000,
      basis: `${where(firm)}; допущения: доля затрат ${ru(a.costSharePct)} %, рост ${ru(a.growthPct)} %`,
      kind: "estimate",
      inTotal: true,
    });
  }

  // Гарантия качества: ремонт и замена брака. Типовой резерв — доля цены; настоящую сумму знает только производитель или ваш опыт.
  if (type === "goods" || type === "works" || type === "it") {
    push({
      id: "warranty",
      title: "Гарантийный ремонт и замена брака",
      scenario: `Резерв ${ru(a.warrantyPct)} % цены на поломки и замену в гарантийный срок`,
      amount: (price * a.warrantyPct) / 100,
      basis: `допущение: ${ru(a.warrantyPct)} % цены; поменяйте под свой опыт`,
      kind: "estimate",
      inTotal: true,
    });
  }

  // Заказчик может изменить объём: выручка или объём работ меняется на этот процент. Это не потеря, в итог не идёт.
  const vol = risks.find((r) => r.kind === "volume" && r.n?.percent);
  if (vol) {
    push({
      id: "volume",
      title: `Объём может измениться до ${ru(vol.n!.percent!)} %`,
      scenario: `Заказчик меняет объём: до ${ru((price * vol.n!.percent!) / 100)} ₽ работ или поставки сверх или меньше плана`,
      amount: (price * vol.n!.percent!) / 100,
      basis: where(vol),
      kind: "estimate",
      inTotal: false,
    });
  }

  // Расходы, которые договор кладёт на вас, но сумму не называет, и дорогая логистика: числа без данных не выдумываем.
  for (const c of risks.filter((r) => r.kind === "cost")) {
    push({
      id: `cost-${items.length}`,
      title: c.title.replace(/^Расходы за ваш счёт:\s*/, "За ваш счёт: "),
      scenario: "Договор возлагает расход на вас, а сумму не называет",
      amount: null,
      basis: where(c),
      kind: "unknown",
      inTotal: false,
      ask: "Запросите цену у исполнителя (эксперта, банка, перевозчика) и добавьте в расчёт",
    });
  }
  if (region?.kind === "other") {
    push({
      id: "logistics",
      title: `Доставка или выезд: ${region.place.name} вместо ${region.company!.name}`,
      scenario: `Другой регион${region.place.hard ? ", особые условия перевозки" : ""}: стоимость зависит от расстояния и тарифа`,
      amount: null,
      basis: "место поставки из документов и адрес в профиле",
      kind: "unknown",
      inTotal: false,
      ask: "Запросите расчёт у перевозчика на ваш груз и маршрут",
    });
  }

  const counted = items.filter((i) => i.inTotal && i.amount !== null);
  const total = round2(counted.reduce((s, i) => s + i.amount!, 0));
  return { items, total, totalPct: counted.length > 0 ? pctOf(total, price) : null, unknown: items.filter((i) => i.kind === "unknown").length, priceUsed: price, indexed };
}
