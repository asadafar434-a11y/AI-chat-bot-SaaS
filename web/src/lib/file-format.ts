// Форматы файлов заявки: Word — править и дописывать жёлтые места, PDF — подписать и подать, ODT — для LibreOffice, Р7-Офис и МойОфис.
// Модуль без зависимостей: им пользуются и сервер (сборка файла), и браузер (что скачать).
export type FileFormat = "docx" | "pdf" | "odt";

export const FILE_FORMATS: Record<FileFormat, { ext: string; label: string; type: string }> = {
  docx: { ext: "docx", label: "Word", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { ext: "pdf", label: "PDF", type: "application/pdf" },
  odt: { ext: "odt", label: "ODT", type: "application/vnd.oasis.opendocument.text" },
};

// Неизвестный формат — Word: так запросы без формата, как раньше, дают файл Word.
export const formatOf = (value: unknown): FileFormat => (value === "pdf" || value === "odt" ? value : "docx");
