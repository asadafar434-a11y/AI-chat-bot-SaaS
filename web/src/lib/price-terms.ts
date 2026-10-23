import { rubText, toKop } from "@/lib/price-split";

// Условия цены, которые заказчик называет в документах: шаг аукциона и «коэффициент снижения» сметной цены. Читает код, без ИИ.
// Показываем только когда они названы в документах закупки (правило владельца 18.10.2026: выводить то, что требуют документы, и аккуратно).

type Doc = { name: string; text: string };

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const PERCENT = String.raw`\s*(?:%|процент[а-яё]*)`;
const RANGE = new RegExp(String.raw`от\s+${NUMBER}${PERCENT}?\s+до\s+${NUMBER}${PERCENT}`, "i");
// «0,5% – 5,0% от НМЦ» — диапазон через тире (так пишут в таблице «Шаг аукциона: | 0,5% – 5,0% от НМЦ»).
const DASH_RANGE = new RegExp(String.raw`${NUMBER}${PERCENT}\s*[–—-]\s*${NUMBER}${PERCENT}`, "i");
const SINGLE = new RegExp(String.raw`${NUMBER}${PERCENT}`, "i");

export type AuctionStep = { from: number; to: number; text: [string, string] };

const num = (s: string) => Number(s.replace(",", "."));

// «Размер шага аукциона устанавливается в размере от 0,5% до 5 % от начальной (максимальной) цены» — после слов «шаг аукциона» в пределах одной фразы.
export function findAuctionStep(documents: Doc[]): AuctionStep | null {
  for (const doc of documents) {
    for (const m of doc.text.matchAll(/шаг[а-яё]*\s+аукцион[а-яё]*/gi)) {
      const window = doc.text.slice(m.index, m.index + 200).split(/[.;](?=\s|$)/)[0] ?? "";
      const range = RANGE.exec(window) ?? DASH_RANGE.exec(window);
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
// Только когда речь о цене: «коэффициент снижения притока воды» в проекте или «коэффициент снижения» объёма заказа — это про другое.
const REDUCTION = /коэффициент[а-яё]*\s+снижени/i;
const ABOUT_PRICE = /смет|стоимост/i;
const NOT_PRICE = /приток|объ[её]м|количеств|расч[её]тн[а-яё]*\s+заказ/i;
export const mentionsReductionCoefficient = (documents: Doc[]) =>
  documents.some((d) => d.text.split(/(?<=[.!?;])\s+|\n+/u).some((s) => REDUCTION.test(s) && ABOUT_PRICE.test(s) && !NOT_PRICE.test(s)));

export function reductionCoefficientText(nmck: number | null, price: number | null): string {
  const lead = "Цена договора считается по смете «с учётом коэффициента снижения» — обычно это цена торгов ÷ начальная цена";
  if (!nmck || nmck <= 0 || !price || price <= 0) return `${lead}. Выберите цену — покажу коэффициент`;
  const k = price / nmck;
  const text = k.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return `${lead}: при вашей цене коэффициент ${text}`;
}

export const reductionCoefficientNote = (documents: Doc[], nmck: number | null, price: number | null): string | null =>
  mentionsReductionCoefficient(documents) ? reductionCoefficientText(nmck, price) : null;

// Цена в документах — без НДС, а налог покупатель платит сверху («Сумма НДС должна быть оплачена Покупателем при оплате стоимости Товара»).
// Говорим об этом, только когда названо и то и другое: одно «без НДС» в обосновании цены ещё ничего не значит для того, как участник называет цену.
const PRICE_WITHOUT_VAT = /(?:цен[а-яё]*|стоимост[а-яё]*)[^.;]{0,120}(?:без\s+учета\s+НДС|без\s+учёта\s+НДС|не\s+включая\s+НДС|без\s+НДС)/i;
const VAT_ON_TOP = /НДС[^.;]{0,80}(?:оплачен|оплачивается|уплачивается|уплачивает|платит|оплачивает)[^.;]{0,60}(?:Покупател|Заказчик)|(?:Покупател|Заказчик)[^.;]{0,60}(?:уплачивает|оплачивает|платит)[^.;]{0,40}(?:сумму\s+)?НДС/i;

export function vatOnTopNote(documents: Doc[]): string | null {
  const text = documents.map((d) => d.text).join("\n");
  return PRICE_WITHOUT_VAT.test(text) && VAT_ON_TOP.test(text)
    ? "Цена по документам — без НДС: налог покупатель платит сверху. Свою цену считайте без НДС"
    : null;
}
