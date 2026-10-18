// Торг по сумме цен единиц: когда объём заранее не известен, заказчик называет цены за единицу (у детских садов — 173 и 200 ₽ за день на ребёнка),
// а на торгах участники снижают их сумму (373 ₽), не начальную цену договора (17 млн ₽). Читает код по тексту документов, без ИИ;
// модуль без зависимостей от браузера и сервера. Нет слов «сумма цен единиц» в документах — режима нет, ничего не придумываем.
import { rubText, toKop } from "@/lib/price-split";
import { cellsOf, numberOf } from "@/lib/spec-table";

type Doc = { name: string; text: string };
export type UnitSum = { doc: string; parts: number[]; sum: number };

const MODE = /сумм[а-яё]*\s+цен\s+единиц/i;
const HEADER = /начальн[а-яё]*\s+сумм[а-яё]*\s+цен|общая\s+нмцк/i;
// Числа в ячейках строки, кроме номеров столбцов и строк (1, 2, 3…): цены и суммы — от 10.
const numbersIn = (line: string) => cellsOf(line).map(numberOf).filter((n): n is number => n !== null && n >= 10);
const near = (a: number, b: number) => Math.abs(a - b) <= 0.005;

// Подряд идущие числа, за которыми стоит их сумма: «173,00 | 200,00 | 373,00».
function partsThenSum(nums: number[]): { parts: number[]; sum: number } | null {
  for (let start = 0; start < nums.length; start++) {
    let acc = 0;
    for (let end = start; end < nums.length - 1 && end < start + 5; end++) {
      acc += nums[end];
      if (end > start && near(acc, nums[end + 1])) return { parts: nums.slice(start, end + 1), sum: nums[end + 1] };
    }
  }
  return null;
}

export function findUnitSum(documents: Doc[]): UnitSum | null {
  if (!documents.some((d) => MODE.test(d.text))) return null;
  for (const doc of documents) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!HEADER.test(lines[i])) continue;
      // Таблица с ценами единиц и суммой в одной строке под шапкой.
      for (let j = i + 1; j < Math.min(lines.length, i + 13); j++) {
        const hit = partsThenSum(numbersIn(lines[j]));
        if (hit) return { doc: doc.name, ...hit };
      }
      // Сумма в строке самой шапки («Начальная сумма цен услуги … 373»), а цены единиц — в последних столбцах строк выше.
      const own = numbersIn(lines[i]);
      if (own.length === 1) {
        const above = lines
          .slice(Math.max(0, i - 6), i)
          .map((l) => numbersIn(l).at(-1))
          .filter((n): n is number => n !== undefined);
        for (let take = 2; take <= Math.min(5, above.length); take++) {
          const parts = above.slice(-take);
          if (near(parts.reduce((a, b) => a + b, 0), own[0])) return { doc: doc.name, parts, sum: own[0] };
        }
      }
    }
  }
  return null;
}

// Что заказчик пишет про снижение на 25 % и более: обеспечение в полтора раза больше, не меньше десяти процентов (так в проекте договора).
const ANTI_DUMPING_RULE = /двадцать\s+пять\s+и\s+более\s+процент[а-яё]*[\s\S]{0,400}?в\s+полтора\s+раза[\s\S]{0,200}?десят[а-яё]*\s+процент/i;

export function unitSumNotes(documents: Doc[]): string[] {
  const unit = findUnitSum(documents);
  if (!unit) return [];
  const parts = unit.parts.map((p) => rubText(toKop(p))).join(" + ");
  const notes = [
    `Торг идёт по сумме цен единиц: начальная сумма ${rubText(toKop(unit.sum))} (${parts}), а не по начальной цене договора; цена на шкале выше — при полном объёме`,
  ];
  if (documents.some((d) => ANTI_DUMPING_RULE.test(d.text))) {
    notes.push(
      `Снижение на 25 % и более — это сумма ниже ${rubText(Math.round(toKop(unit.sum) * 0.75))}: по проекту договора обеспечение исполнения тогда в 1,5 раза больше обычного и не меньше 10 % цены договора`
    );
  }
  return notes;
}
