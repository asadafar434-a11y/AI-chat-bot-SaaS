import { rubText, toKop } from "@/lib/price-split";

// Условия цены, которые заказчик называет в документах: шаг аукциона и «коэффициент снижения» сметной цены. Читает код, без ИИ.
// Показываем только когда они названы в документах закупки (правило владельца 18.10.2026: выводить то, что требуют документы, и аккуратно).

type Doc = { name: string; text: string };

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const PERCENT = String.raw`\s*(?:%|процент[а-яё]*)`;
const RANGE = new RegExp(String.raw`от\s+${NUMBER}${PERCENT}?\s+до\s+${NUMBER}${PERCENT}`, "i");
const SINGLE = new RegExp(String.raw`${NUMBER}${PERCENT}`, "i");

export type AuctionStep = { from: number; to: number; text: [string, string] };

const num = (s: string) => Number(s.replace(",", "."));

// «Размер шага аукциона устанавливается в размере от 0,5% до 5 % от начальной (максимальной) цены» — после слов «шаг аукциона» в пределах одной фразы.
export function findAuctionStep(documents: Doc[]): AuctionStep | null {
  for (const doc of documents) {
    for (const m of doc.text.matchAll(/шаг[а-яё]*\s+аукцион[а-яё]*/gi)) {
      const window = doc.text.slice(m.index, m.index + 200).split(/[.;](?=\s|$)/)[0] ?? "";
      const range = RANGE.exec(window);
      if (range) return { from: num(range[1]), to: num(range[2]), text: [range[1], range[2]] };
      const single = SINGLE.exec(window);
      if (single) return { from: num(single[1]), to: num(single[1]), text: [single[1], single[1]] };
    }
  }
  return null;
}

// Сумма одного шага от начальной цены: в копейках, целыми числами (процент ×10 — чтобы 0,5 % не давало плавающей ошибки).
const stepKop = (nmckKop: number, pct: number) => Math.round((nmckKop * Math.round(pct * 10)) / 1000);

export function auctionStepNote(documents: Doc[], nmck: number | null): string | null {
  const step = findAuctionStep(documents);
  if (!step) return null;
  const same = step.from === step.to;
  const pct = same ? `${step.text[0]} %` : `от ${step.text[0]} % до ${step.text[1]} %`;
  if (!nmck || nmck <= 0) return `Шаг аукциона по документам — ${pct} начальной цены`;
  const kop = toKop(nmck);
  const sums = same ? rubText(stepKop(kop, step.from)) : `от ${rubText(stepKop(kop, step.from))} до ${rubText(stepKop(kop, step.to))}`;
  return `Шаг аукциона по документам — ${pct} начальной цены: ${sums} за один шаг`;
}

// Договор считает цену по смете «с учётом коэффициента снижения». Что это за коэффициент, документы обычно не расшифровывают:
// обычно он равен цене торгов, делённой на начальную цену, — так и говорим, с оговоркой.
export const mentionsReductionCoefficient = (documents: Doc[]) => documents.some((d) => /коэффициент[а-яё]*\s+снижени/i.test(d.text));

export function reductionCoefficientText(nmck: number | null, price: number | null): string {
  const lead = "Цена договора считается по смете «с учётом коэффициента снижения» — обычно это цена торгов ÷ начальная цена";
  if (!nmck || nmck <= 0 || !price || price <= 0) return `${lead}. Выберите цену — покажу коэффициент`;
  const k = price / nmck;
  const text = k.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return `${lead}: при вашей цене коэффициент ${text}`;
}

export const reductionCoefficientNote = (documents: Doc[], nmck: number | null, price: number | null): string | null =>
  mentionsReductionCoefficient(documents) ? reductionCoefficientText(nmck, price) : null;
