"use client";

import Link from "next/link";

// Документы открываются в новой вкладке: введённое на странице не пропадёт.
export const legalLink = (href: string, text: string) => (
  <Link href={href} target="_blank" rel="noopener noreferrer" className="link">
    {text}
  </Link>
);

// Две галочки, не отмеченные заранее: согласие на обработку и отдельное согласие на передачу за рубеж.
// Одни и те же на странице входа и перед началом работы без пароля.
export function ConsentChecks({
  processing,
  transfer,
  onProcessing,
  onTransfer,
}: {
  processing: boolean;
  transfer: boolean;
  onProcessing: (value: boolean) => void;
  onTransfer: (value: boolean) => void;
}) {
  return (
    <>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={processing}
          onChange={(e) => onProcessing(e.currentTarget.checked)}
          required
          className="mt-0.5 size-4 flex-none accent-[var(--brand)]"
        />
        <span className="text-[var(--ink-2)]">Даю {legalLink("/consent", "согласие на обработку персональных данных")}</span>
      </label>
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={transfer}
          onChange={(e) => onTransfer(e.currentTarget.checked)}
          required
          className="mt-0.5 size-4 flex-none accent-[var(--brand)]"
        />
        <span className="text-[var(--ink-2)]">
          Даю {legalLink("/consent-transfer", "согласие на передачу данных за рубеж")} — модели ИИ в США, без этого сервис не
          прочитает документы
        </span>
      </label>
    </>
  );
}
