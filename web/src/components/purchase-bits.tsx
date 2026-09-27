import { ClockIcon, DocumentIcon, WarningIcon } from "@/components/icons";
import { daysText, type Due } from "@/lib/deadline";
import type { Purchase } from "@/lib/purchase";

export { daysText };

// Значок закупки — номер закона: 44-ФЗ и 223-ФЗ поставщик различает с первого взгляда.
export const lawOf = (p: Purchase) => /(?<!\d)(44|223)-ФЗ/.exec(p.kind)?.[1] ?? "";

// На выделенной строке списка значок белый с контуром, иначе сливается с подсветкой.
const LAW_SELECTED = "bg-card shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_25%,transparent)]";

export function LawBadge({ purchase, big = false, selected = false }: { purchase: Purchase; big?: boolean; selected?: boolean }) {
  const law = lawOf(purchase);
  return (
    <span
      aria-hidden
      title={law ? `${law}-ФЗ` : "Закон не указан"}
      className={`law ${law === "223" ? "law-223" : ""} ${big ? "law-big" : ""} ${selected ? LAW_SELECTED : ""}`}
    >
      {law || "—"}
    </span>
  );
}

const DUE_TONES = {
  soon: "bg-[var(--warn-tint)] text-[var(--warn)]",
  calm: "bg-[var(--paper-2)] text-[var(--ink-2)]",
  past: "bg-[var(--paper-2)] text-[var(--ink-3)]",
};

export function DueChip({ due, className = "" }: { due: Due | null; className?: string }) {
  if (!due) return null;
  const text = due.days < 0 ? "приём закончился" : due.days === 0 ? "подать сегодня" : `${daysText(due.days)} до подачи`;
  return (
    <span className={`t-tag inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] px-3 ${DUE_TONES[due.tone]} ${className}`}>
      <ClockIcon className="size-[15px] shrink-0" />
      {text}
    </span>
  );
}

// Ссылка на источник: нажали — под ней точная цитата; ненайденная дословно помечена янтарём.
export function SourceQuote({ source, quote, verified, what, open, onToggle }: {
  source: string;
  quote: string;
  verified: boolean;
  what: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button type="button" aria-expanded={open} onClick={onToggle} className="src">
        <DocumentIcon className="size-3" />
        {source}
      </button>
      {open && <blockquote className="t-read mt-1 rounded-[var(--r-card)] bg-[var(--paper-2)] px-4 py-3">{quote}</blockquote>}
      {!verified && (
        <p className="t-caption flex items-center gap-2 text-[var(--warn)]">
          <WarningIcon className="size-4 shrink-0" />
          Не нашёл эту цитату в документах дословно — сверьте {what} вручную.
        </p>
      )}
    </>
  );
}
