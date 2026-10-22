// HTML страницы поставщика → текст для чтения моделью. Скрипты, стили и разметка убираются, остаётся текст; чтобы не платить за лишнее, берётся начало страницы и места, где говорится о цене.
// Страница — чужие данные: ничего из неё не исполняется и не считается указанием (lib/price-extract.ts). Модуль без зависимостей: его проверяют тесты (npm test).

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", ndash: "–", mdash: "—", rub: "₽", deg: "°", thinsp: " " };

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);

/** Название страницы из <title>. */
export function titleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** Видимый текст страницы по строкам: блоки разделены переводами строк, пробелы схлопнуты. */
export function htmlToLines(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|br|header|footer|nav|form|dd|dt)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t  ]+/g, " ").replace(/(\|\s*)+$/, "").trim())
    .filter((l) => l.length > 0);
}

const PRICE_WORD = /(руб|₽|цен[аыуе]|стоимост|прайс|тонн|(?<![а-яёa-z])т(?![а-яёa-z])|кг|оптов|от\s+\d)/i;
const HAS_DIGIT = /\d/;

/** Текст для модели: начало страницы (название, заголовки) и строки с ценой с соседними строками; не больше `limit` знаков. Дубли строк убираются. */
export function priceExcerpt(html: string, limit = 14_000): { title: string; text: string; truncated: boolean } {
  const lines = htmlToLines(html);
  const keep = new Set<number>();
  let head = 0;
  for (let i = 0; i < lines.length && head < 1_200; i++) {
    keep.add(i);
    head += lines[i].length + 1;
  }
  lines.forEach((l, i) => {
    if (HAS_DIGIT.test(l) && PRICE_WORD.test(l)) {
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j);
    }
  });
  const seen = new Set<string>();
  const out: string[] = [];
  let size = 0;
  let truncated = false;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const line = lines[i];
    if (seen.has(line)) continue;
    seen.add(line);
    if (size + line.length + 1 > limit) {
      truncated = true;
      break;
    }
    out.push(line.slice(0, 600));
    size += line.length + 1;
  }
  return { title: titleOf(html), text: out.join("\n"), truncated };
}

/** Текст страницы, уже прочитанный в браузере (например, через Chrome владельца для сайтов, закрытых от роботов), → HTML того же вида, что и скачанная страница: дальше он идёт тем же путём и с теми же проверками. */
export function textToHtml(title: string, text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<html><head><title>${esc(title)}</title></head><body>${text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("")}</body></html>`;
}

/** Тот же текст в виде, в котором сверяются цитаты: «ё» как «е», пробелы и неразрывные пробелы — одним пробелом, регистр не важен. */
export const normalizeForQuote = (s: string) => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[\s  ]+/g, " ").trim();
