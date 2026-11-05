import type { TenderDoc, TenderListing } from "./tender-search.ts";

// Проверка карточки закупки перед хранением: в браузере (tender-store.ts) и на сервере (server/rostender/store.ts) одно и то же. Испорченное поле заменяется пустым,
// чужая ссылка (не http/https) отбрасывается, а закупка без номера не берётся. У закупок из ЕИС полей Ростендера нет вовсе.

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const http = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\/[^\s]+$/i.test(s.trim()) ? s.trim() : null;
};

const docs = (raw: unknown): TenderDoc[] =>
  Array.isArray(raw)
    ? raw.flatMap((d): TenderDoc[] => {
        const link = http(d?.link);
        return link ? [{ title: str(d.title) ?? link, link, ext: str(d.ext), size: num(d.size) }] : [];
      })
    : [];

/** Поля Ростендера у закупки: берём только то, что есть и похоже на правду. */
function rostenderFields(l: TenderListing): Partial<TenderListing> {
  if (l.source !== "rostender") return {};
  const contact = l.contact ? { person: str(l.contact.person), phone: str(l.contact.phone), email: str(l.contact.email) } : null;
  return {
    source: "rostender",
    rostenderId: str(l.rostenderId) ?? undefined,
    platform: str(l.platform),
    stage: str(l.stage),
    smp: typeof l.smp === "boolean" ? l.smp : null,
    customerInn: str(l.customerInn),
    contact: contact && (contact.person || contact.phone || contact.email) ? contact : null,
    place: str(l.place),
    positions: Array.isArray(l.positions) ? l.positions.flatMap((p) => (str(p?.name) ? [{ name: str(p.name)!, unit: str(p.unit), price: num(p.price), quantity: num(p.quantity), okpd2: str(p.okpd2), ktru: str(p.ktru) }] : [])).slice(0, 30) : [],
    positionsTotal: num(l.positionsTotal) ?? undefined,
    deadlineTime: /^\d{2}:\d{2}$/.test(l.deadlineTime ?? "") ? l.deadlineTime : null,
    city: str(l.city),
    branches: Array.isArray(l.branches) ? l.branches.flatMap((b) => (str(b) ? [str(b)!] : [])).slice(0, 5) : [],
    plan: l.plan === true ? true : undefined,
    rev: num(l.rev) ?? undefined,
    docs: docs(l.docs),
    archive: http(l.archive),
  };
}

/** Одна закупка из хранилища или от клиента → закупка нужной формы; null — без номера закупкой не считается. */
export function normalizeListing(raw: unknown): TenderListing | null {
  const l = raw as TenderListing | null | undefined;
  const id = str(l?.id);
  if (!l || !id) return null;
  return { id, law: l.law === "44-ФЗ" || l.law === "223-ФЗ" ? l.law : null, title: str(l.title) ?? id, customer: str(l.customer), price: num(l.price), publishedAt: str(l.publishedAt), deadline: str(l.deadline), region: str(l.region), method: str(l.method), url: str(l.url), ...rostenderFields(l) };
}
