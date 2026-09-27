import "server-only";
import { buildPartDocx, buildTpDocx, type CastLine } from "@/lib/tp-docx";
import { PART_TITLES, type TpPart } from "@/lib/tp-parts";
import { PartDocFileSchema, type PartDoc } from "@/lib/part-doc";
import { EMPTY_PROFILE, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { PLAIN_FORM, type TpForm } from "@/lib/tp";

// Файл Word части заявки — из того, что прислал браузер. Одинаково для одного файла (api/tp/docx)
// и для архива со всеми (api/tp/zip).

type Loose<T> = { [K in keyof T]?: unknown };
export type DocxRequest = {
  part?: unknown;
  subject?: unknown;
  form?: Loose<TpForm>;
  goods?: Loose<{ name: string; characteristics: string; quantity: string }>[];
  items?: Loose<{ clause: string; requirement: string; offer: string }>[];
  cast?: { clause?: unknown; rows?: Loose<CastLine>[] };
  price?: unknown;
  profile?: Record<string, unknown>;
  // Анкета, декларация или цена, которые ИИ написал по образцам, — уже готовым документом.
  doc?: unknown;
};

export type DocxResult = { ok: true; part: TpPart; buffer: Buffer } | { ok: false; status: number; message: string };

const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? value.slice(0, 1000) : []);

const cleanPartDoc = (doc: PartDoc): PartDoc => ({
  title: doc.title.slice(0, 300),
  basis: doc.basis.slice(0, 500),
  blocks: doc.blocks.slice(0, 400).map((b) => ({
    type: b.type,
    text: b.text.slice(0, 8000),
    rows: b.rows.slice(0, 300).map((r) => r.slice(0, 20).map((c) => c.slice(0, 4000))),
  })),
});

export const partOf = (value: unknown): TpPart => (typeof value === "string" && value in PART_TITLES ? (value as TpPart) : "tp");

// Документ собирается из того, что прислал браузер, поэтому всё приводим к ожидаемому виду и длине.
export async function docxFromRequest(body: DocxRequest): Promise<DocxResult> {
  const part = partOf(body.part);

  // Техническое предложение так не собирается никогда: в нём не должно быть ничего об участнике.
  if (body.doc !== undefined && part !== "tp") {
    const parsed = PartDocFileSchema.safeParse(body.doc);
    if (!parsed.success) return { ok: false, status: 400, message: "Документ повреждён — составьте его заново." };
    return { ok: true, part, buffer: await buildPartDocx(cleanPartDoc(parsed.data)) };
  }

  const form = body.form ?? {};
  const goods = list<NonNullable<DocxRequest["goods"]>[number]>(body.goods);
  const items = list<NonNullable<DocxRequest["items"]>[number]>(body.items);
  if (goods.length === 0 && items.length === 0) {
    return { ok: false, status: 400, message: "В черновике нет пунктов для документа." };
  }
  const castRows = list<Loose<CastLine>>(body.cast?.rows).slice(0, 200);
  const price = Number(body.price);
  // Техническое предложение подают анонимно, поэтому реквизиты в него не попадают, даже если их прислали.
  const profile: Profile | null =
    part === "tp" || !body.profile
      ? null
      : { ...EMPTY_PROFILE, ...Object.fromEntries(PROFILE_KEYS.map((key) => [key, text(body.profile?.[key], 500)])) };

  const buffer = await buildTpDocx(part, {
    subject: text(body.subject, 500),
    form: {
      title: text(form.title, 300) || PLAIN_FORM.title,
      source: text(form.source, 300),
      participantFields: list<unknown>(form.participantFields).slice(0, 50).map((f) => text(f, 300)),
      consent: text(form.consent, 4000),
      hasPrice: form.hasPrice === true,
      priceNote: text(form.priceNote, 4000),
      smeDeclaration: text(form.smeDeclaration, 4000),
    },
    goods: goods.map((g) => ({
      name: text(g.name, 500),
      characteristics: text(g.characteristics, 8000),
      quantity: text(g.quantity, 100),
    })),
    items: items.map((item) => ({
      clause: text(item.clause, 40),
      requirement: text(item.requirement, 4000),
      offer: text(item.offer, 8000),
    })),
    cast: castRows.length
      ? {
          clause: text(body.cast?.clause, 40),
          rows: castRows.map((row) => ({
            who: text(row.who, 200),
            name: text(row.name, 300).trim(),
            title: text(row.title, 300).trim(),
            titled: row.titled === true,
          })),
        }
      : null,
    price: Number.isFinite(price) && price > 0 ? price : null,
    profile,
  });
  return { ok: true, part, buffer };
}

// Имя файла в заголовке ответа: латиницей — для старых браузеров, по-русски — в filename*.
export const attachment = (name: string, fallback: string) =>
  `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
