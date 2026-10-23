// Предельные отпускные цены производителей на лекарства из жизненно необходимого перечня (ЖНВЛП) — официальный реестр Минздрава (ГРЛС, grls.rosminzdrav.ru/PriceLims.aspx).
// Для закупки лекарства это самый надёжный ориентир закупочной цены: официальная, с датой решения и регистрационным номером, без поиска по сайтам и без платной модели.
// Это потолок цены производителя без НДС (за потребительскую упаковку), а не рыночная цена: так и подписано. Чистые правила без сети: разбор страницы, разбор названия позиции, подбор строк — их проверяют тесты (npm test).

import { makeObservation, type Observation } from "@/lib/market-observations";

export const GRLS_URL = "https://grls.rosminzdrav.ru/PriceLims.aspx";

export type LimitRow = {
  inn: string;
  tradeName: string;
  /** «капсулы, 75 мг, 120 шт. - флаконы (1) - пачки картонные» */
  form: string;
  owner: string;
  atc: string;
  /** Сколько единиц в потребительской упаковке. */
  packQty: number | null;
  /** Предельная цена, ₽ без НДС. */
  price: number;
  /** Цена указана за первичную упаковку, а не за потребительскую: такую строку не берём. */
  primaryPack: boolean;
  regNumber: string;
  /** «14.10.2026 25-7-4376479-изм» — дата и номер решения о регистрации цены. */
  decision: string;
  /** Дата вступления цены в силу, ГГГГ-ММ-ДД. */
  validFrom: string | null;
};

const ENTITIES: Record<string, string> = { nbsp: " ", quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", reg: "®" };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const cellText = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/[®™]/g, "").replace(/\s+/g, " ").trim();

const isoDay = (text: string): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const num = (text: string): number | null => {
  const n = Number(text.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) && text.trim() !== "" ? n : null;
};

/** Страница результатов → строки реестра и общее число найденных записей. Столбцы находятся по названию в шапке, а не по номеру. */
export function parseLimitRows(html: string): { rows: LimitRow[]; total: number | null } {
  const total = Number(/Найдено:\s*(\d+)/.exec(html)?.[1] ?? NaN);
  const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => cellText(c[1])));
  const head = trs.find((r) => r.some((c) => c === "МНН") && r.some((c) => /Предельная цена/i.test(c)));
  if (!head) return { rows: [], total: Number.isFinite(total) ? total : null };
  const at = (re: RegExp) => head.findIndex((c) => re.test(c));
  const col = {
    inn: at(/^МНН$/),
    trade: at(/Торговое наименование/i),
    form: at(/Лек\. форма/i),
    owner: at(/Владелец/i),
    atc: at(/Код АТХ/i),
    qty: at(/Кол-во в потреб/i),
    price: at(/Предельная цена/i),
    primary: at(/за перв\.упак/i),
    reg: at(/Номер РУ/i),
    decision: at(/Дата регистрации цены/i),
    from: at(/Дата вступления/i),
  };
  const rows: LimitRow[] = [];
  for (const r of trs) {
    if (r === head || r.length !== head.length) continue;
    const price = col.price >= 0 ? num(r[col.price]) : null;
    if (price === null || price <= 0 || col.inn < 0 || !r[col.inn]) continue;
    rows.push({
      inn: r[col.inn],
      tradeName: col.trade >= 0 ? r[col.trade] : "",
      form: col.form >= 0 ? r[col.form] : "",
      owner: col.owner >= 0 ? r[col.owner] : "",
      atc: col.atc >= 0 ? r[col.atc] : "",
      packQty: col.qty >= 0 ? num(r[col.qty]) : null,
      price,
      primaryPack: col.primary >= 0 && r[col.primary] !== "" && !/^(0|нет|false)$/i.test(r[col.primary]),
      regNumber: col.reg >= 0 ? r[col.reg] : "",
      decision: col.decision >= 0 ? r[col.decision] : "",
      validFrom: col.from >= 0 ? isoDay(r[col.from]) : null,
    });
  }
  return { rows, total: Number.isFinite(total) ? total : null };
}

// ——— Название позиции закупки → что искать в реестре ———

export type DrugQuery = { inn: string; dosage: string | null; pack: number | null; form: string | null };

const FORMS = ["капсул", "таблет", "раствор", "суспензи", "порош", "лиофилизат", "концентрат", "мазь", "гель", "крем", "сироп", "капл", "спрей", "суппозитор", "свеч", "пластыр", "эмульси", "ампул", "шприц", "драже", "гранул", "аэрозол", "настойк", "паста", "пастил"];
const DOSAGE = /(\d+(?:[.,]\d+)?)\s*(мг|мкг|г|мл|ме|ед|%)(?![а-яёa-z])/i;

/** «Дабрафениб 75 мг № 120, капсулы» → МНН, дозировка, число штук в упаковке, форма. Не лекарство (нет МНН или дозировки) — null: ничего не выдумываем. */
export function drugQueryOf(name: string): DrugQuery | null {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  const dosage = DOSAGE.exec(text);
  if (!dosage) return null;
  const head = /^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё+\- ]{3,60}?)(?=\s*[\d,(№]|$)/.exec(text)?.[1]?.trim() ?? "";
  if (head.split(" ").length > 4 || !/^[А-Яа-яЁё]/.test(head)) return null;
  const pack = /№\s*(\d+)/.exec(text)?.[1] ?? /(\d+)\s*шт/i.exec(text)?.[1];
  const lower = text.toLowerCase();
  const form = FORMS.find((f) => lower.includes(f)) ?? null;
  return { inn: head, dosage: `${dosage[1].replace(",", ".")} ${dosage[2].toLowerCase()}`, pack: pack ? Number(pack) : null, form };
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/(\d),(\d)/g, "$1.$2").replace(/\s+/g, " ");

/** Строка реестра подходит позиции: тот же МНН, та же дозировка, то же число штук в упаковке и та же форма (если позиция их называет). */
export function rowMatches(q: DrugQuery, row: LimitRow): boolean {
  if (row.primaryPack) return false;
  if (!norm(row.inn).includes(norm(q.inn).split(" ")[0])) return false;
  const form = norm(row.form);
  if (q.dosage && !form.includes(norm(q.dosage))) return false;
  if (q.pack !== null && row.packQty !== q.pack) return false;
  if (q.form && !form.includes(q.form)) return false;
  return true;
}

const dotted = (iso: string) => iso.split("-").reverse().join(".");

/** Подошедшие строки → цены с источником и датой, дешёвые первыми, не больше шести. Цена — потолок производителя без НДС, и в источнике так и сказано. */
export function observationsFromLimits(q: DrugQuery, name: string, rows: LimitRow[], day: string): Observation[] {
  // Реестр хранит несколько решений о цене одного препарата (разные даты, одна цена): оставляем самое свежее.
  const latest = new Map<string, LimitRow>();
  for (const r of rows.filter((x) => rowMatches(q, x))) {
    const key = `${r.tradeName}|${r.price}|${r.form}`;
    const seen = latest.get(key);
    if (!seen || (r.validFrom ?? "") > (seen.validFrom ?? "")) latest.set(key, r);
  }
  return [...latest.values()]
    .sort((a, b) => a.price - b.price)
    .slice(0, 6)
    .flatMap((r) => {
      const date = r.validFrom ?? day;
      // Название — как у позиции закупки, форма — как в реестре («капсулы», а не основа «капсул»).
      const formWord = r.form.split(",")[0].trim();
      const title = [q.inn, q.dosage, q.pack !== null ? `№ ${q.pack}` : "", formWord ? `, ${formWord}` : ""].join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
      const source = `grls.rosminzdrav.ru: Реестр предельных отпускных цен на ЖНВЛП (ГРЛС) — предельная цена производителя без НДС, потолок, а не рыночная; ${r.tradeName || "без торгового названия"}, ${r.form}; РУ ${r.regNumber || "—"}; решение ${r.decision || "—"}; проверено ${dotted(day)}; ${GRLS_URL}`;
      const built = makeObservation({ name: `${title} (${r.tradeName || name})`, unit: "упаковка", price: r.price, vat: "without", vatRate: 10, date, source, sourceKind: "price_list" });
      return built.ok ? [built.value] : [];
    });
}
