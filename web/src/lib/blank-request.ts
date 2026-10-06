import type { DetectedForm } from "@/lib/tp";

// Запрос файла из одного бланка заказчика, без заявки: им пользуются и кнопка в составе пакета, и архив.
export const blankRequest = (subject: string, df: DetectedForm) => ({
  part: "application",
  blankOnly: true,
  subject,
  form: { title: df.title, source: df.source, participantFields: [], consent: "", hasPrice: false, priceNote: "", smeDeclaration: "", goodsTableHeaders: [] },
  detectedForms: [df],
  goods: [],
  items: [],
});
