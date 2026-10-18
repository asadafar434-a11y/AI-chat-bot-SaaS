// Цена договора по позициям: итог, который называет участник, раскладывается на цены за единицу пропорционально начальным ценам заказчика
// (НМЦК по позициям), с точностью до копейки и так, чтобы сумма не вышла за итог. Расчёт кодом, без ИИ; модуль без зависимостей от браузера и сервера.
// Зачем: если взять начальные цены за единицу и округлить до копеек, сумма может выйти на копейку выше начальной цены договора
// (закупка школы № 196: 1 704 386,68 ₽ против НМЦД 1 704 386,67 ₽) — а предложение выше начальной цены площадка не примет.

// Деньги — в копейках, целыми числами: рубли с плавающей точкой дают копеечные ошибки.
export const toKop = (rub: number) => Math.round(rub * 100);
export const rubText = (kop: number) =>
  `${(kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ")} ₽`;

// baseKop — начальная цена за единицу у заказчика (в копейках); qty — целое число единиц.
export type SplitPosition = { name: string; qty: number; baseKop: number };
export type SplitLine = SplitPosition & { unitKop: number; sumKop: number };
// shortKop — на сколько копеек сумма по позициям меньше итога: если количества не дают набрать итог точно.
export type Split = { lines: SplitLine[]; totalKop: number; shortKop: number };

const valid = (p: SplitPosition) => Number.isInteger(p.qty) && p.qty > 0 && Number.isInteger(p.baseKop) && p.baseKop > 0;

// Сумма начальных цен за единицу, каждая из которых округлена до копейки, на количество.
export const baseTotalKop = (positions: SplitPosition[]) => positions.reduce((sum, p) => sum + p.qty * p.baseKop, 0);

// Цены за единицу пропорционально начальным, сумма — как можно ближе к итогу, но не выше него. null — позиции или итог не годятся.
export function splitPrice(positions: SplitPosition[], targetKop: number): Split | null {
  if (positions.length === 0 || !positions.every(valid) || !Number.isInteger(targetKop) || targetKop <= 0) return null;
  const big = (n: number) => BigInt(n);
  const base = big(baseTotalKop(positions));
  const target = big(targetKop);

  // Пропорционально, с округлением вниз: так сумма не выйдет за итог.
  const unit = positions.map((p) => (big(p.baseKop) * target) / base);
  const frac = positions.map((p) => (big(p.baseKop) * target) % base);
  let rem = targetKop - positions.reduce((sum, p, i) => sum + p.qty * Number(unit[i]), 0);

  // Остаток добираем копейками к цене за единицу: сначала там, где дробная часть больше. Один проход, пока что-то помещается.
  const order = positions.map((_, i) => i).sort((a, b) => (frac[b] > frac[a] ? 1 : frac[b] < frac[a] ? -1 : 0));
  const units = unit.map(Number);
  for (let changed = true; changed && rem > 0; ) {
    changed = false;
    for (const i of order) {
      if (positions[i].qty <= rem) {
        units[i] += 1;
        rem -= positions[i].qty;
        changed = true;
      }
    }
  }

  // Если осталась копейка-другая, пробуем набрать итог точно: поправить цены за единицу на несколько копеек вверх и вниз.
  if (rem > 0) {
    const fixed = exactAdjust(positions, units, rem);
    if (fixed) {
      fixed.forEach((delta, i) => (units[i] += delta));
      rem = 0;
    }
  }

  const lines = positions.map((p, i): SplitLine => ({ ...p, unitKop: units[i], sumKop: p.qty * units[i] }));
  return { lines, totalKop: targetKop - rem, shortKop: rem };
}

// Поправки цен за единицу (в копейках, от −STEP до +STEP), сумма которых по количествам равна rem, с наименьшим общим сдвигом.
const STEP = 3;
const LIMIT = 300;
function exactAdjust(positions: SplitPosition[], units: number[], rem: number): number[] | null {
  // best[s] — наименьший сдвиг, которым набирается сумма s; from[i][s] — какая поправка дала это на шаге i.
  const size = 2 * LIMIT + 1;
  let best: number[] = Array(size).fill(Infinity);
  best[LIMIT] = 0;
  const from: (number | null)[][] = [];
  for (const [i, p] of positions.entries()) {
    const next: number[] = Array(size).fill(Infinity);
    const choice: (number | null)[] = Array(size).fill(null);
    for (let s = 0; s < size; s++) {
      if (best[s] === Infinity) continue;
      for (let d = -STEP; d <= STEP; d++) {
        const t = s + d * p.qty;
        if (t < 0 || t >= size || units[i] + d <= 0) continue;
        const cost = best[s] + Math.abs(d);
        if (cost < next[t]) {
          next[t] = cost;
          choice[t] = d;
        }
      }
    }
    best = next;
    from.push(choice);
  }
  const goal = LIMIT + rem;
  if (goal >= size || best[goal] === Infinity) return null;
  const deltas: number[] = Array(positions.length).fill(0);
  let s = goal;
  for (let i = positions.length - 1; i >= 0; i--) {
    const d = from[i][s] ?? 0;
    deltas[i] = d;
    s -= d * positions[i].qty;
  }
  return deltas;
}

// НДС в цене «с НДС»: ставка в процентах, 0 — без НДС. Сумма без НДС округляется до копейки, НДС — разница, поэтому «без НДС + НДС = с НДС» сходится всегда.
export type Vat = { withoutKop: number; vatKop: number };
export function vatOf(withKop: number, ratePercent: number): Vat {
  if (!(ratePercent > 0)) return { withoutKop: withKop, vatKop: 0 };
  const without = Math.round((withKop * 100) / (100 + ratePercent));
  return { withoutKop: without, vatKop: withKop - without };
}
