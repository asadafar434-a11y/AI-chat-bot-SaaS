import { AlertTriangleIcon, CheckIcon, ClockIcon, FileTextIcon } from "lucide-react";
import type { Due } from "@/lib/deadline";
import { plural } from "@/lib/plural";
import type { Purchase } from "@/lib/purchase";
import { fillCount } from "@/lib/tp";

export const daysText = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

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

// Отметка у закупки: сколько пунктов осталось вписать в ТП или что ТП готово.
export function TpMark({ purchase }: { purchase: Purchase }) {
  if (!purchase.tp) return null;
  const fill = fillCount(purchase.tp);
  if (fill) {
    return (
      <span className="bubble" title={`В ТП впишите ${fill} ${plural(fill, "пункт", "пункта", "пунктов")}`}>
        {fill}
        <span className="sr-only"> — впишите данные в ТП</span>
      </span>
    );
  }
  return (
    <span className="bubble bubble-ok" title="ТП готово">
      <CheckIcon className="size-3" />
      <span className="sr-only">ТП готово</span>
    </span>
  );
}

// Состояние ТП пилюлей — в списках, где есть место для слов.
export function TpTag({ purchase }: { purchase: Purchase }) {
  if (!purchase.tp) return <span className="tag">ТП не составлено</span>;
  const fill = fillCount(purchase.tp);
  if (!fill) return <span className="tag tag-ok">ТП готово</span>;
  return <span className="tag tag-warn">ТП: впишите {fill} {plural(fill, "пункт", "пункта", "пунктов")}</span>;
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
        <FileTextIcon className="size-3" />
        {source}
      </button>
      {open && <blockquote className="t-read mt-1 rounded-[var(--r-card)] bg-[var(--paper-2)] px-4 py-3">{quote}</blockquote>}
      {!verified && (
        <p className="t-caption flex items-center gap-2 text-[var(--warn)]">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Не нашёл эту цитату в документах дословно — сверьте {what} вручную.
        </p>
      )}
    </>
  );
}
