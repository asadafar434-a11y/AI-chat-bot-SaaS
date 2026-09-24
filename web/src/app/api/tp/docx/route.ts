import { buildTpDocx, type TpDocxItem } from "@/lib/tp-docx";

type DocxRequest = { subject?: string; items?: Partial<TpDocxItem>[] };

const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);

export async function POST(request: Request) {
  const { subject = "", items = [] }: DocxRequest = await request.json();
  if (!Array.isArray(items) || items.length === 0) {
    return new Response("Нет пунктов для документа.", { status: 400 });
  }

  const buffer = await buildTpDocx(
    text(subject, 500),
    items.slice(0, 500).map((item) => ({
      clause: text(item.clause, 40),
      requirement: text(item.requirement, 4000),
      offer: text(item.offer, 8000),
    }))
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="technical-proposal.docx"; filename*=UTF-8''${encodeURIComponent("Техническое предложение.docx")}`,
    },
  });
}
