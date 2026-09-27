import { PART_TITLES } from "@/lib/tp-parts";
import { attachment, docxFromRequest, type DocxRequest } from "@/lib/tp-docx-request";
import { badRequest, readJson } from "@/lib/read-json";

// Одна часть заявки файлом Word: техническое предложение по черновику или готовый документ, который написал ИИ.
export async function POST(request: Request) {
  const body = (await readJson(request)) as DocxRequest | null;
  if (!body) return badRequest();
  const made = await docxFromRequest(body);
  if (!made.ok) return new Response(made.message, { status: made.status });
  return new Response(new Uint8Array(made.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": attachment(`${PART_TITLES[made.part]}.docx`, "proposal.docx"),
    },
  });
}
