import type { TenderDoc, TenderLaw, TenderListing } from "./tender-search.ts";

// Ростендер (rostender.info, Client API): разбор ответов и приведение карточки к закупке «Поиска закупок» (TenderListing). Модуль чистый: запросы делает сервер
// (server/rostender/), ключ живёт только там. Описание API — rostender.info/docs/api (адрес запросов rostender.info/api/tenders/get/, ключ в заголовке X-API-KEY).
//
// В карточку берём только главное: что и на какую сумму, кто заказчик и как с ним связаться, до какого числа подать заявку, где площадка, участвует ли МСП и — главное —
// документы закупки (список файлов со ссылками и архив одним файлом). Всё остальное (метки, избранное, комментарии, права доступа) отбрасывается.
// Форматы полей в описании названы словами, а не примерами, поэтому разбор терпимый: дата — число секунд или строка, цена — число или «1 200,50», регион — строка, список или
// объект с названием. Чего нет или не понято — null, а не выдумка.

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Текст из строки, числа, объекта с названием или списка таких значений. */
export function textOf(v: unknown): string | null {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(textOf).filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return textOf(o.title ?? o.name ?? o.label ?? o.text ?? o.value);
  }
  return null;
}

const moscowDate = (ms: number): string => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

/** Дата ГГГГ-ММ-ДД по Москве: число секунд или миллисекунд, «2026-11-05 12:00:00» или «05.11.2026». */
export function isoOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return moscowDate(v > 1e11 ? v : v * 1000);
  if (typeof v !== "string") return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return /^\d{9,13}$/.test(s) ? isoOf(Number(s)) : null;
}

/** Цена в рублях: число или строка «1 200 000,50 руб.»; нуль и пустое — «цена не указана». */
export function priceOf(v: unknown): number | null {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const value = o ? (o.value ?? o.sum ?? o.price) : v;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[\s ]/g, "").replace(",", ".").replace(/[^\d.\-]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const boolOf = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["да", "true", "1", "yes", "y"].includes(s)) return true;
    if (["нет", "false", "0", "no", "n"].includes(s)) return false;
  }
  return null;
};

/** Ссылка только http(s): из чужого ответа «javascript:» и подобное в ссылку не попадает. */
export function safeUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}

const SITE = "https://rostender.info";

/** Ссылка Ростендера: в списке она приходит относительной («/tender/123»), в карточке — полной. «//чужой.сайт» не принимается. */
export function rostenderUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\/(?!\/)[^\s]*$/.test(s) ? SITE + s : safeUrl(s);
}

// ——— Состояние ключа и список шаблонов ———

export type RostenderStatus = { limit: number | null; used: number | null; remaining: number | null; resetsAt: string | null };

/** info: дневной лимит и сколько осталось. Сам ключ из ответа не берётся. */
export function parseInfo(json: unknown): RostenderStatus {
  const d = obj(obj(json).data);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { limit: n(d.daily_limit), used: n(d.used_today), remaining: n(d.remaining), resetsAt: textOf(d.resets_at) };
}

export type RostenderTemplate = { id: string; title: string };

export function parseTemplates(json: unknown): RostenderTemplate[] {
  return arr(obj(json).data).flatMap((raw): RostenderTemplate[] => {
    const t = obj(raw);
    const id = textOf(t.id);
    return id ? [{ id, title: textOf(t.title ?? t.name) ?? `Шаблон ${id}` }] : [];
  });
}

// ——— Список: краткие записи ———

export type RostenderShort = { id: string; url: string | null; published: string | null; deadline: string | null; price: number | null; place: string | null; region: string | null; stage: string | null };

export type RostenderPage = { items: RostenderShort[]; page: number; pages: number; total: number };

export function parseShortPage(json: unknown): RostenderPage {
  const body = obj(json);
  const meta = obj(body._meta);
  const items = arr(body.data).flatMap((raw): RostenderShort[] => {
    const t = obj(raw);
    const id = textOf(t.id);
    if (!id) return [];
    return [{ id, url: rostenderUrl(t.url), published: isoOf(t.dts), deadline: isoOf(t.dte), price: priceOf(t.price), place: textOf(t.place), region: textOf(t.regions), stage: textOf(t.stage) }];
  });
  const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return { items, page: n(meta.currentPage, 1), pages: n(meta.pageCount, 1), total: n(meta.totalCount, items.length) };
}

// ——— Полная карточка ———

const lawOf = (type: string | null, eisNumber: string | null, hay: string): TenderLaw | null => {
  // Ростендер называет закон в поле type: «44», «223» (остальное — коммерческие и прочее).
  const t = (type ?? "").trim().toLowerCase();
  if (/^44(?!\d)/.test(t)) return "44-ФЗ";
  if (/^223(?!\d)/.test(t)) return "223-ФЗ";
  const text = hay.toLowerCase();
  if (/223[\s-]?фз|zakupki\.gov\.ru\/223|fz223/.test(text)) return "223-ФЗ";
  if (/44[\s-]?фз|zakupki\.gov\.ru\/epz|fz44/.test(text)) return "44-ФЗ";
  // Номер извещения: у 44-ФЗ девятнадцать цифр, у 223-ФЗ — одиннадцать.
  if (eisNumber && /^\d{19}$/.test(eisNumber)) return "44-ФЗ";
  if (eisNumber && /^3\d{10}$/.test(eisNumber)) return "223-ФЗ";
  return null;
};

const docOf = (raw: unknown): TenderDoc | null => {
  const f = obj(raw);
  const link = safeUrl(f.link ?? f.url);
  if (!link) return null;
  const fromLink = decodeURIComponent(link.split("?")[0].split("/").pop() ?? "");
  const size = typeof f.size === "number" && Number.isFinite(f.size) ? f.size : typeof f.size === "string" && /^\d+$/.test(f.size) ? Number(f.size) : null;
  return { title: textOf(f.title) ?? (fromLink || "Документ"), link, ext: textOf(f.extension)?.replace(/^\./, "").toLowerCase() ?? null, size };
};

/** Номер ЕИС — только настоящий: 19 цифр у 44-ФЗ, 11 у 223-ФЗ. У малых закупок в этом поле лежит номер самого Ростендера — его за номер ЕИС не берём. */
const realEis = (v: string | null): string | null => (v && (/^\d{19}$/.test(v) || /^3\d{10}$/.test(v)) ? v : null);

/** Площадки и ссылка в ЕИС из `links`: объект «номер → {title, url}» или список таких записей. */
function linksOf(raw: unknown): { platforms: string[]; eisUrl: string | null } {
  const items = Array.isArray(raw) ? raw : Object.values(obj(raw));
  const platforms: string[] = [];
  let eisUrl: string | null = null;
  for (const item of items) {
    const l = obj(item);
    // «44-ФЗ ЕИС» и «223-ФЗ ЕИС» — одна площадка «ЕИС»: закон у закупки и так показан отдельно.
    const title = textOf(l.title)?.replace(/^(?:44|223)[\s-]?ФЗ\s+ЕИС$/i, "ЕИС") ?? null;
    const url = safeUrl(l.url);
    if (title && !platforms.includes(title)) platforms.push(title);
    if (url && !eisUrl && /zakupki\.gov\.ru/i.test(url)) eisUrl = url;
  }
  return { platforms, eisUrl };
}

const firstOf = (v: unknown): string | null => (Array.isArray(v) ? textOf(v[0]) : textOf(v));

const MAX_TITLE = 300;

/** Версия набора полей карточки: поднимается, когда в карточку добавляются поля, — сервер со временем перезагружает старые карточки. */
export const CARD_REV = 2;

/** «2026-11-06 15:30:00» → «15:30»; полночь («00:00») временем не считается — сервис ставит её, когда времени нет. */
const timeOf = (v: unknown): string | null => {
  const m = /(?:^|\s|T)(\d{2}):(\d{2})(?::\d{2})?$/.exec(textOf(v) ?? "");
  return m && `${m[1]}:${m[2]}` !== "00:00" ? `${m[1]}:${m[2]}` : null;
};
const MAX_DOCS = 60;

/** Полная карточка (`{id}` или `eis/{номер}`) → закупка списка. Без номера и без любого названия закупкой не считается. */
export function cardToListing(json: unknown): TenderListing | null {
  const d = obj(obj(json).data);
  const rid = textOf(d.id);
  if (!rid) return null;
  const eis = obj(d.eis);
  const eisNumber = realEis(textOf(d.eis && typeof d.eis === "object" ? (eis.number ?? eis.id ?? eis.title) : d.eis));
  const links = linksOf(d.links);
  const placement = obj(d.placement);
  const customer = obj(d.customer);
  const contactRaw = Array.isArray(customer.contacts) ? obj(customer.contacts[0]) : obj(customer.contacts);
  const positions = arr(d.positions).flatMap((p) => {
    const o = obj(p);
    const name = textOf(o.name);
    if (!name) return [];
    const priceObj = o.price && typeof o.price === "object" ? obj(o.price) : {};
    const quantity = typeof priceObj.quantity === "number" && Number.isFinite(priceObj.quantity) && priceObj.quantity > 0 ? priceObj.quantity : null;
    const classifier = obj(o.classifier);
    return [{ name, unit: textOf(o.unit), price: priceOf(o.price), quantity, okpd2: firstOf(classifier.OKPD2), ktru: firstOf(classifier.KTRU) }];
  });
  const descr = textOf(d.descr);
  const title = (descr ?? positions[0]?.name ?? "").slice(0, MAX_TITLE).trim();
  if (!title) return null;
  const files = obj(d.files);
  const docs = arr(files.items).map(docOf).filter((x): x is TenderDoc => x !== null).slice(0, MAX_DOCS);
  // Площадка — название из links; в etp лежат только номера, их за название не считаем.
  const etp = typeof d.etp === "string" && !/^\d+$/.test(d.etp.trim()) ? textOf(d.etp) : null;
  const platform = links.platforms[0] ?? etp ?? textOf(placement.source);
  const url = rostenderUrl(d.url);
  // «Контактное лицо» у многих заказчиков — само название организации: его не повторяем.
  const personRaw = textOf(contactRaw.person);
  const contact = { person: personRaw && personRaw !== textOf(customer.name) ? personRaw : null, phone: textOf(contactRaw.phone), email: textOf(contactRaw.email) };
  const hasContact = Boolean(contact.person || contact.phone || contact.email);
  const place = firstOf(d.delivery_address) ?? textOf(d.place);
  return {
    id: eisNumber ?? `rt${rid}`,
    law: lawOf(textOf(d.type), eisNumber, [url, links.eisUrl ?? "", safeUrl(eis.url) ?? "", textOf(placement.title) ?? "", textOf(placement.source) ?? ""].join(" ")),
    title,
    customer: textOf(customer.name),
    price: priceOf(d.price),
    publishedAt: isoOf(d.dts),
    deadline: isoOf(d.dte),
    region: firstOf(d.regions) ?? firstOf(d.cities),
    method: textOf(placement.title),
    url: links.eisUrl ?? safeUrl(eis.url) ?? url,
    source: "rostender",
    rostenderId: rid,
    platform,
    stage: textOf(d.stage),
    smp: boolOf(d.smp),
    customerInn: textOf(customer.inn),
    contact: hasContact ? contact : null,
    place,
    positions: positions.slice(0, 30),
    positionsTotal: positions.length,
    deadlineTime: timeOf(d["dte-formatted"]),
    city: firstOf(d.cities),
    branches: arr(d.branches).flatMap((b) => (textOf(b) ? [textOf(b)!] : [])).slice(0, 5),
    plan: d.is_plans === true ? true : undefined,
    rev: CARD_REV,
    docs,
    archive: safeUrl(files.archive),
  };
}
