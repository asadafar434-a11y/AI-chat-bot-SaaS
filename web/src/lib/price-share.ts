// Требование в процентах от начальной цены («опыт не менее 20 % начальной (максимальной) цены контракта»): сколько это в рублях.
// Проценты остаются как в документе, рубли — подсказка рядом: участник сразу видит, какой договор ему нужен. Считает код по начальной цене закупки.
import { unitKey, type Condition } from "@/lib/conditions";
import { formatRubles } from "@/lib/rub-words";

// На что указывает процент: слова об (начальной) цене контракта или договора идут сразу за числом.
const PRICE_BASE = /начальн[а-яё]*\s*\(?\s*максимальн[а-яё]*\)?\s*цен|НМЦ[КД]?(?![а-яё])|цен[ауые]\s+(?:контракт|договор)/i;
const AFTER = 90;

const money = (x: number) => `${formatRubles(Math.round(x * 100) / 100).replace(",00", "")} ₽`;

// «≈ 3 400 000 ₽ от начальной цены» или null, если условие не про процент от цены или начальная цена не известна.
// contracts — максимумы цены по договорам, когда заказчиков несколько: процент можно считать и от цены одного договора.
export function priceShare(c: Condition, quote: string, nmck: number | null, contracts: number[] = []): string | null {
  if (!nmck || c.term || unitKey(c.unit) !== "%") return null;
  const at = quote.indexOf(c.raw);
  if (at < 0 || !PRICE_BASE.test(quote.slice(at + c.raw.length, at + c.raw.length + AFTER))) return null;
  const of = (percent: number) => (nmck * percent) / 100;
  const sum = c.op === "range" ? `от ${money(of(c.value))} до ${money(of(c.value2 ?? c.value))}` : money(of(c.value));
  const own = contracts.length > 1 && c.op !== "range" ? `; от цены одного договора — от ${money((Math.min(...contracts) * c.value) / 100)} до ${money((Math.max(...contracts) * c.value) / 100)}` : "";
  return `≈ ${sum} от начальной цены${own}`;
}
