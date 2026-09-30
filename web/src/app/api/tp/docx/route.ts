import { fileRoute } from "@/lib/tp-docx-request";

// Одна часть заявки файлом Word: техническое предложение по черновику или готовый документ, который написал ИИ.
export const POST = (request: Request) => fileRoute(request, "docx");
