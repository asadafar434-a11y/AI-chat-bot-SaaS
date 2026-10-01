import { fileRoute } from "@/lib/tp-docx-request";

// Та же часть заявки файлом ODT: текст, таблицы и жёлтые места — как в Word и PDF, собирается из того же описания документа.
export const POST = (request: Request) => fileRoute(request, "odt");
