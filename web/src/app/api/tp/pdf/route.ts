import { fileRoute } from "@/lib/tp-docx-request";

// Та же часть заявки файлом PDF: текст, таблицы и жёлтые места — как в Word, собирается из того же описания документа.
export const POST = (request: Request) => fileRoute(request, "pdf");
