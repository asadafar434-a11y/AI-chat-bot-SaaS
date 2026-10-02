// Заказчик требует — поставщик предлагает. Граница заказчика («не менее 150 мест», «не более 5 кг», «от 3 до 5 лет») — не значение
// поставщика: какой у него зал, какая мощность у его товара и сколько фотографий он согласен передать, знает только он.
// ИИ не должен выводить это из границы заказчика, поэтому после ответа модели код проходит по предложению участника:
// число, которое повторяет границу заказчика или стоит с той же единицей, что и она, заменяется пустым местом
// «[число, не меньше 150]» — участник впишет своё (мастер на шаге «Проверка» сверит его с границей).
// Не трогаются: даты, время, номера пунктов, сроки, которые задаёт заказчик («в течение 5 рабочих дней»), точные значения
// заказчика без границы («на 120 человек») и всё, что уже стоит в квадратных скобках. Модуль без зависимостей от браузера и сервера.
import {
  conditionsOf,
  describeCondition,
  hintOf,
  mentionKey,
  mentionsOf,
  parseConditions,
  satisfies,
  unitKey,
  type Condition,
  type Mention,
} from "@/lib/conditions";

export type GuardContext = {
  // Границы заказчика из всех документов закупки (без сроков): по ним находятся значения с той же единицей.
  bounds: Condition[];
  // «Число + единица», которые заказчик называет без границы или как срок: повторить их участник вправе.
  grounded: Set<string>;
};

export function guardContext(texts: string[]): GuardContext {
  const bounds: Condition[] = [];
  const grounded = new Set<string>();
  for (const text of texts) {
    const found = parseConditions(text);
    const inside = found.filter((c) => !c.term && c.op !== "exact");
    for (const c of inside) {
      const { at, end, ...condition } = c;
      void at;
      void end;
      bounds.push(condition);
    }
    for (const m of mentionsOf(text)) {
      // Число внутри условия с границей — не точное значение заказчика.
      if (inside.some((c) => m.at >= c.at && m.at < c.end)) continue;
      grounded.add(mentionKey(m));
    }
  }
  return { bounds, grounded };
}

// Что заменено: названное значение, пустое место на его месте и граница заказчика словами (пусто — граница неоднозначна).
export type Hit = { value: string; unit: string; hint: string; bound: string };

// Единицы, у которых разные ключи — разные величины: «5 кг» не может быть значением к «не менее 5 дней».
const PHYSICAL = new Set(["м", "см", "мм", "км", "кг", "г", "т", "л", "мл", "%", "дн", "год", "мес", "час", "мин", "сек", "руб", "м2", "м3", "вт", "квт", "гц", "дб"]);

const sameSizes = (a: number[] | undefined, b: number[] | undefined) =>
  Boolean(a && b && a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]));

// Одна и та же граница: повторы в разных пунктах документа не делают её неоднозначной.
const sameDims = (a: number[] | undefined, b: number[] | undefined) => (!a && !b) || sameSizes(a, b);
const sameBound = (a: Condition, b: Condition) =>
  a.op === b.op &&
  a.value === b.value &&
  (a.value2 ?? 0) === (b.value2 ?? 0) &&
  sameDims(a.parts, b.parts) &&
  sameDims(a.parts2, b.parts2) &&
  unitKey(a.unit) === unitKey(b.unit);

// Названо то же число, что граница заказчика (любая из двух у диапазона).
const equalTo = (c: Condition, m: Mention) =>
  c.parts && c.parts.length > 1
    ? sameSizes(c.parts, m.parts) || sameSizes(c.parts2, m.parts)
    : !m.parts && (c.value === m.value || c.value2 === m.value);

const BOUND_BEFORE = /(?:не\s+менее|не\s+меньше|не\s+более|не\s+больше|не\s+ниже|не\s+выше|минимум|максимум|свыше|более|менее|больше|меньше|от|до)\s+(?:чем\s+)?$/i;

const BRACKETS = /\[[^\]]*\]/g;

// Предложение участника: числа, взятые с границы заказчика, заменены местом для его значения. own — условия самого пункта
// (из цитаты требования), ctx — границы и точные значения всей закупки.
export function guardOffer(text: string, own: Condition[], ctx: GuardContext): { text: string; hits: Hit[] } {
  const hits: Hit[] = [];
  const ownBounds = own.filter((c) => !c.term && c.op !== "exact");
  if (!ownBounds.length && !ctx.bounds.length) return { text, hits };

  // Граница, по которой написано пустое место. Несколько разных подходящих — какая из них, не знаем: пустое место без границы
  // («[число]»), а не чужая граница, по которой потом проверка ошибётся.
  const unique = (list: Condition[]): Condition | "generic" | null =>
    list.length === 0 ? null : list.every((c) => sameBound(c, list[0])) ? list[0] : "generic";

  const pick = (m: Mention): Condition | "generic" | null => {
    const key = unitKey(m.unit);
    // 1. Число равно границе этого же пункта: взято с границы. Единицы разные физические величины — это другое число.
    const equal = ownBounds.filter((c) => equalTo(c, m) && !(PHYSICAL.has(key) && PHYSICAL.has(unitKey(c.unit)) && key !== unitKey(c.unit)));
    if (equal.length) return unique(equal);
    // 2. Число названо точно в документах закупки — это условие заказчика, участник вправе его повторить.
    if (ctx.grounded.has(mentionKey(m))) return null;
    // 3. Число с той же единицей, что у границы: значение, которого заказчик не называл, — придумано. Сначала границы этого же
    //    пункта (из них — те, в которые число попадает), потом — всей закупки.
    if (!key) return null;
    const own = ownBounds.filter((c) => unitKey(c.unit) === key);
    if (own.length) {
      const fitting = own.filter((c) => satisfies(c, m.parts ?? [m.value]));
      return unique(fitting.length ? fitting : own);
    }
    return unique(ctx.bounds.filter((c) => unitKey(c.unit) === key));
  };

  // Кусок вне скобок: внутри «[…]» участник уже должен вписывать сам.
  let out = "";
  let last = 0;
  for (const bracket of [...text.matchAll(BRACKETS), null]) {
    const end = bracket ? bracket.index : text.length;
    let part = text.slice(last, end);
    const mentions = mentionsOf(part);
    for (let i = mentions.length - 1; i >= 0; i--) {
      const m = mentions[i];
      const bound = pick(m);
      const hint = bound === "generic" ? (m.parts ? "[размер]" : "[число]") : bound && hintOf(bound);
      if (!bound || !hint) continue;
      // «не менее 150 мест» в предложении — слова заказчика: границу заменяем целиком вместе с числом.
      const before = BOUND_BEFORE.exec(part.slice(0, m.at));
      const from = before ? m.at - before[0].length : m.at;
      hits.push({ value: part.slice(m.at, m.numberEnd), unit: m.unit, hint, bound: bound === "generic" ? "" : describeCondition(bound) });
      part = part.slice(0, from) + hint + part.slice(m.numberEnd);
    }
    out += part + (bracket ? bracket[0] : "");
    last = bracket ? bracket.index + bracket[0].length : text.length;
  }
  return { text: out, hits: hits.reverse() };
}

// Условия пункта для охраны: из цитаты требования и из его пересказа.
export const ownConditions = (...texts: string[]): Condition[] => conditionsOf(texts.filter(Boolean).join(" "));
