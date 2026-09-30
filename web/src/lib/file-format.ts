// Форматы файлов заявки: Word — править и дописывать жёлтые места, PDF — подписать и подать. ODT пока нет.
// Модуль без зависимостей: им пользуются и сервер (сборка файла), и браузер (что скачать).
export type FileFormat = "docx" | "pdf";

export const FILE_FORMATS: Record<FileFormat, { ext: string; label: string; type: string }> = {
  docx: { ext: "docx", label: "Word", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { ext: "pdf", label: "PDF", type: "application/pdf" },
};

// Неизвестный формат — Word: так запросы без формата, как раньше, дают файл Word.
export const formatOf = (value: unknown): FileFormat => (value === "pdf" ? "pdf" : "docx");
