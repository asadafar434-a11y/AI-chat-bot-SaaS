import "server-only";
import { FILE_FORMATS, type FileFormat } from "@/lib/file-format";
import { buildPartDocx, buildTpDocx } from "@/lib/tp-docx";
import { buildPartOdt, buildTpOdt } from "@/lib/tp-odt";
import type { CastLine, TpDocx } from "@/lib/tp-doc-model";
import { PART_TITLES, type TpPart } from "@/lib/tp-parts";
import { PartDocFileSchema, type PartDoc } from "@/lib/part-doc";
import { EMPTY_PROFILE, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { PLAIN_FORM, type TpForm } from "@/lib/tp";
import { badRequest, readJson } from "@/lib/read-json";

// Файл части заявки — Word, PDF или ODT — из того, что прислал браузер. Одинаково для одного файла (api/tp/docx, api/tp/pdf,
// api/tp/odt) и для архива со всеми (api/tp/zip).

type Loose<T> = { [K in keyof T]?: unknown };
export type DocxRequest = {
  part?: unknown;
  subject?: unknown;
  form?: Loose<TpForm>;
  goods?: Loose<{ name: string; characteristics: string; quantity: string }>[];
  items?: Loose<{ clause: string; requirement: string; offer: string }>[];
  // Дополнительные бланки заказчика, найденные ИИ в документах закупки.
  detectedForms?: Loose<{ source: string; title: string; pages?: string; fields: Loose<{ label: string; value: string }>[] }>[];
  // Скачивание одного доп. бланка — файл только из него.
  blankOnly?: unknown;
  cast?: { clause?: unknown; rows?: Loose<CastLine>[] };
  price?: unknown;
  profile?: Record<string, unknown>;
  // Строки формы анкеты заказчика сверх реквизитов — что участник вписал под эту закупку.
  anketaExtra?: Record<string, unknown>;
  // Анкета, декларация или цена, которые ИИ написал по образцам, — уже готовым документом.
  doc?: unknown;
};

export type FileResult = { ok: true; part: TpPart; name: string; buffer: Buffer } | { ok: false; status: number; message: string };

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

// Из чего собирается файл: готовый документ, который написал ИИ, или данные закупки и реквизиты.
type Source = { kind: "doc"; part: TpPart; doc: PartDoc } | { kind: "data"; part: TpPart; data: TpDocx };
type SourceResult = { ok: true; source: Source } | { ok: false; status: number; message: string };

// Файл собирается из того, что прислал браузер, поэтому всё приводим к ожидаемому виду и длине.
function sourceFromRequest(body: DocxRequest): SourceResult {
  const part = partOf(body.part);

  // Техническое предложение так не собирается никогда: в нём не должно быть ничего об участнике.
  if (body.doc !== undefined && part !== "tp") {
    const parsed = PartDocFileSchema.safeParse(body.doc);
    if (!parsed.success) return { ok: false, status: 400, message: "Документ повреждён — составьте его заново." };
    return { ok: true, source: { kind: "doc", part, doc: cleanPartDoc(parsed.data) } };
  }

  const form = body.form ?? {};
  const goods = list<NonNullable<DocxRequest["goods"]>[number]>(body.goods);
  const items = list<NonNullable<DocxRequest["items"]>[number]>(body.items);
  const formConsent = typeof form.consent === "string" ? form.consent.trim() : "";
  // "application" — единый бланк заявки: он заполняется из реквизитов, товары не обязательны.
  if (goods.length === 0 && items.length === 0 && !formConsent && part !== "application") {
    return { ok: false, status: 400, message: "В черновике нет пунктов для документа." };
  }
  const castRows = list<Loose<CastLine>>(body.cast?.rows).slice(0, 200);
  const price = Number(body.price);
  // Техническое предложение подают анонимно, поэтому реквизиты в него не попадают, даже если их прислали.
  const profile: Profile | null =
    part === "tp" || !body.profile
      ? null
      : { ...EMPTY_PROFILE, ...Object.fromEntries(PROFILE_KEYS.map((key) => [key, text(body.profile?.[key], 500)])) };

  const data: TpDocx = {
    subject: text(body.subject, 500),
    form: {
      title: text(form.title, 300) || PLAIN_FORM.title,
      source: text(form.source, 300),
      participantFields: list<unknown>(form.participantFields).slice(0, 50).map((f) => text(f, 300)),
      consent: text(form.consent, 4000),
      hasPrice: form.hasPrice === true,
      priceNote: text(form.priceNote, 4000),
      smeDeclaration: text(form.smeDeclaration, 4000),
      // Заголовки столбцов таблицы предложения о поставке товара из формы заказчика.
      goodsTableHeaders: list<unknown>(form.goodsTableHeaders).slice(0, 20).map((h) => text(h, 200)),
    },
    blankOnly: body.blankOnly === true,
    detectedForms: list<NonNullable<DocxRequest["detectedForms"]>[number]>(body.detectedForms)
      .slice(0, 20)
      .map((df) => ({
        source: text(df.source, 300),
        title: text(df.title, 300),
        pages: typeof df.pages === "string" ? df.pages.slice(0, 40) : undefined,
        fields: list<{ label?: unknown; value?: unknown }>(df.fields)
          .slice(0, 100)
          .map((f) => ({ label: text(f.label, 300), value: text(f.value, 2000) })),
      })),
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
    // Только в анкету и только вместе с реквизитами: в техническое предложение данные участника не попадают.
    anketaExtra: profile && body.anketaExtra && typeof body.anketaExtra === "object"
      ? Object.fromEntries(Object.entries(body.anketaExtra).slice(0, 50).map(([label, value]) => [text(label, 300), text(value, 2000)]))
      : undefined,
  };
  return { ok: true, source: { kind: "data", part, data } };
}

// PDF собирается библиотекой, которую незачем грузить, пока просят только Word.
async function render(source: Source, format: FileFormat): Promise<Buffer> {
  if (format === "pdf") {
    const { buildPartPdf, buildTpPdf } = await import("@/lib/tp-pdf");
    return source.kind === "doc" ? buildPartPdf(source.doc) : buildTpPdf(source.part, source.data);
  }
  if (format === "odt") return source.kind === "doc" ? buildPartOdt(source.doc) : buildTpOdt(source.part, source.data);
  return source.kind === "doc" ? buildPartDocx(source.doc) : buildTpDocx(source.part, source.data);
}

export async function fileFromRequest(body: DocxRequest, format: FileFormat = "docx"): Promise<FileResult> {
  const made = sourceFromRequest(body);
  if (!made.ok) return made;
  const { source } = made;
  const blank = source.kind === "data" && source.data.blankOnly ? source.data.detectedForms?.[0] : undefined;
  return { ok: true, part: source.part, name: blank?.title ?? PART_TITLES[source.part], buffer: await render(source, format) };
}

// Имя файла в заголовке ответа: латиницей — для старых браузеров, по-русски — в filename*.
export const attachment = (name: string, fallback: string) =>
  `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// Ответ api/tp/docx, api/tp/pdf и api/tp/odt: один файл части заявки. Имя по-русски — в заголовке, не в адресе.
export async function fileRoute(request: Request, format: FileFormat): Promise<Response> {
  const body = (await readJson(request)) as DocxRequest | null;
  if (!body) return badRequest();
  const made = await fileFromRequest(body, format);
  if (!made.ok) return new Response(made.message, { status: made.status });
  const { ext, type } = FILE_FORMATS[format];
  return new Response(new Uint8Array(made.buffer), {
    headers: { "Content-Type": type, "Content-Disposition": attachment(`${made.name}.${ext}`, `proposal.${ext}`) },
  });
}
