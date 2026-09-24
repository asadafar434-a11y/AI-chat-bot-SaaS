import { buildTpDocx, PART_TITLES, type TpPart } from "@/lib/tp-docx";
import { EMPTY_PROFILE, PROFILE_KEYS, type Profile } from "@/lib/profile";
import { PLAIN_FORM, type TpForm } from "@/lib/tp";

type Loose<T> = { [K in keyof T]?: unknown };
type DocxRequest = {
  part?: unknown;
  subject?: unknown;
  form?: Loose<TpForm>;
  goods?: Loose<{ name: string; characteristics: string; quantity: string }>[];
  items?: Loose<{ clause: string; requirement: string; offer: string }>[];
  price?: unknown;
  profile?: Record<string, unknown>;
};

const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? value.slice(0, 1000) : []);

// Документ собирается из того, что прислал браузер, поэтому всё приводим к ожидаемому виду и длине.
export async function POST(request: Request) {
  const body: DocxRequest = await request.json();
  const form = body.form ?? {};
  const goods = list<NonNullable<DocxRequest["goods"]>[number]>(body.goods);
  const items = list<NonNullable<DocxRequest["items"]>[number]>(body.items);
  if (goods.length === 0 && items.length === 0) {
    return new Response("В черновике нет пунктов для документа.", { status: 400 });
  }
  const price = Number(body.price);
  const part: TpPart = typeof body.part === "string" && body.part in PART_TITLES ? (body.part as TpPart) : "tp";
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
    price: Number.isFinite(price) && price > 0 ? price : null,
    profile,
  });

  const filename = PART_TITLES[part];
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="proposal.docx"; filename*=UTF-8''${encodeURIComponent(`${filename}.docx`)}`,
    },
  });
}
