// Пересчёт обоснования начальной цены у заказчика: в его документах таблица «Расчёт НМЦК по методу сопоставимых рыночных цен» — цены трёх поставщиков, средняя, среднее
// квадратичное отклонение и коэффициент вариации. Код находит такие строки по арифметике (цены, за которыми стоит их среднее), пересчитывает и показывает расхождения.
// Читает текст документов без ИИ; модуль без зависимостей от браузера и сервера.
//
// Эти цены дал заказчику его поставщик, поэтому для РИЦ участника они не независимы: свои аналоги участник добавляет сам (lib/indicative-price.ts).

import { RIC_METHOD, statsOf, type Stats } from "@/lib/indicative-price";
import { cellsOf, numberOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };

export type NmckIssueKind = "cv-high" | "stdev" | "stdev-population" | "cv-printed" | "adopted";
/** warn — расчёт у заказчика не сходится или нарушает его же метод; info — на что обратить внимание. */
export type NmckIssue = { kind: NmckIssueKind; level: "warn" | "info"; text: string };

export type NmckCalc = {
  doc: string;
  /** Текстовые ячейки строки: что за позиция. */
  name: string;
  offers: number[];
  /** Средняя из документа заказчика. */
  mean: number;
  /** Наш пересчёт по ценам поставщиков. */
  stats: Stats;
  /** Что напечатано у заказчика (null — столбца нет или он пуст). */
  printed: { stdev: number | null; cv: number | null; adopted: number | null };
  issues: NmckIssue[];
};

const money = (n: number) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`.replace(/[  ]/g, " ");
const pct = (n: number) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`.replace(/[  ]/g, " ");

// Совпадение «среднего», напечатанного заказчиком, с пересчитанным: до копейки с запасом на округление в таблице.
const sameMean = (a: number, b: number) => Math.abs(a - b) <= 0.011 + 1e-9 * Math.abs(b);

type Window = { start: number; end: number; mean: number; meanAt: number };

// Цены поставщиков — подряд идущие числа, за которыми (через необязательную ячейку «количество источников») стоит их среднее.
function meanWindow(nums: (number | null)[]): Window | null {
  for (let e = 3; e < nums.length; e++) {
    const mean = nums[e];
    if (mean === null || mean <= 0) continue;
    for (const gap of [0, 1]) {
      const end = e - 1 - gap;
      if (end < 2) continue;
      let start = end;
      while (start - 1 >= 0 && nums[start - 1] !== null && end - start + 1 < 12) start--;
      for (let from = start; end - from + 1 >= 3; from++) {
        const window = nums.slice(from, end + 1) as number[];
        if (window.some((x) => x <= 0)) continue;
        if (gap === 1 && nums[e - 1] !== window.length) continue;
        const avg = window.reduce((s, x) => s + x, 0) / window.length;
        if (sameMean(avg, mean)) return { start: from, end, mean, meanAt: e };
      }
    }
  }
  return null;
}

// Заголовок таблицы — ближайшая выше строка с тем же числом ячеек, где названы столбцы вариации, отклонения или принятой цены.
type Columns = { stdev: number | null; cv: number | null; adopted: number | null };
function columnsAbove(lines: string[], at: number, width: number): Columns {
  for (let k = at - 1; k >= Math.max(0, at - 12); k--) {
    if (!lines[k].includes(" | ") && !lines[k].includes("\t")) continue;
    const head = cellsOf(lines[k]);
    if (head.length !== width) continue;
    const find = (re: RegExp) => {
      const i = head.findIndex((c) => re.test(c));
      return i < 0 ? null : i;
    };
    const cols: Columns = {
      cv: find(/коэффициент\s+вариации/i),
      stdev: find(/квадратичн/i),
      adopted: find(/принят[а-яё]*\s+к\s+расч[её]ту/i),
    };
    if (cols.cv !== null || cols.stdev !== null || cols.adopted !== null) return cols;
  }
  return { stdev: null, cv: null, adopted: null };
}

const close = (printed: number, own: number) => Math.abs(printed - own) <= Math.max(0.011, Math.abs(own) * 0.005);

export function findNmckCalculations(documents: Doc[]): NmckCalc[] {
  const out: NmckCalc[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    lines.forEach((line, at) => {
      if (!line.includes(" | ") && !line.includes("\t")) return;
      const cells = cellsOf(line);
      const nums = cells.map(numberOf);
      const hit = meanWindow(nums);
      if (!hit) return;
      const texts = cells.slice(0, hit.start).filter((c) => /\p{L}{3}/u.test(c));
      if (texts.length === 0) return;
      const offers = nums.slice(hit.start, hit.end + 1) as number[];
      const stats = statsOf(offers)!;
      const name = texts.join(" · ").slice(0, 220);
      const key = `${name}|${offers.join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);

      const cols = columnsAbove(lines, at, cells.length);
      const read = (i: number | null) => (i === null || i >= nums.length ? null : nums[i]);
      const printed = { stdev: read(cols.stdev), cv: read(cols.cv), adopted: read(cols.adopted) };
      const issues: NmckIssue[] = [];

      if (stats.cv > RIC_METHOD.maxVariation) {
        issues.push({
          kind: "cv-high",
          level: "warn",
          text: `Цены неоднородны: вариация по ним ${pct(stats.cv * 100)}, предел метода — ${Math.round(RIC_METHOD.maxVariation * 100)} %. Среднее по таким ценам использовать нельзя.`,
        });
      }
      if (printed.stdev !== null) {
        const population = Math.sqrt(offers.reduce((s, x) => s + (x - stats.mean) ** 2, 0) / offers.length);
        if (!close(printed.stdev, stats.stdev)) {
          if (close(printed.stdev, population)) {
            issues.push({ kind: "stdev-population", level: "info", text: `Отклонение ${printed.stdev.toLocaleString("ru-RU")} посчитано делением на n, а по методике — на n − 1 (по ценам получается ${stats.stdev.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}).` });
          } else {
            issues.push({
              kind: "stdev",
              level: "warn",
              text: `Среднее квадратичное отклонение в расчёте ${printed.stdev.toLocaleString("ru-RU")} не сходится с ценами: по ним получается ${stats.stdev.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}.`,
            });
          }
        }
      }
      // Вариация в таблице бывает долей (0,094) или процентами (9,4): сверяем с тем и с другим, с точностью до сотых процента.
      if (printed.cv !== null && !(Math.abs(printed.cv - stats.cv) <= 0.0005 || Math.abs(printed.cv - stats.cv * 100) <= 0.05)) {
        const shown = printed.cv <= 1 ? printed.cv * 100 : printed.cv;
        issues.push({
          kind: "cv-printed",
          level: "warn",
          text: `Коэффициент вариации в расчёте ${pct(shown)} не сходится с ценами: по ним получается ${pct(stats.cv * 100)}.`,
        });
      }
      if (printed.adopted !== null && !sameMean(printed.adopted, hit.mean)) {
        const lowest = Math.min(...offers);
        const how = sameMean(printed.adopted, lowest) ? "минимальная из предложений" : sameMean(printed.adopted, Math.max(...offers)) ? "максимальная из предложений" : "не среднее";
        const diff = ((printed.adopted - hit.mean) / hit.mean) * 100;
        issues.push({
          kind: "adopted",
          level: "info",
          text: `К расчёту принята цена ${money(printed.adopted)} — ${how}; она ${diff < 0 ? "ниже" : "выше"} средней (${money(hit.mean)}) на ${pct(Math.abs(diff))}. Заказчик пишет, что решил так сам.`,
        });
      }

      out.push({ doc: doc.name, name, offers, mean: hit.mean, stats, printed, issues });
    });
  }
  return out;
}
