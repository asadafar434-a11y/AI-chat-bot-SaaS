import type { ReactNode } from "react";
import { AlertTriangleIcon, type LucideIcon } from "lucide-react";

const TONES = {
  warn: "t-strong bg-[var(--warn-tint)] text-[var(--warn)]",
  ok: "t-strong bg-[var(--ok-tint)] text-[var(--ok)]",
  info: "t-body bg-[var(--paper-2)] text-[var(--ink-2)]",
};

type NoteProps = { tone: keyof typeof TONES; icon?: LucideIcon; className?: string; children: ReactNode };

export function Note({ tone, icon: Icon, className = "", children }: NoteProps) {
  return (
    <div className={`flex items-start gap-3 rounded-[var(--r-card)] px-4 py-3 ${TONES[tone]} ${className}`}>
      {Icon && <Icon className="mt-px size-[18px] shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Одно предупреждение — плашкой, несколько — одной плашкой со списком, а не стопкой жёлтых полос.
export function Warnings({ items, className = "" }: { items: (string | null | false | undefined)[]; className?: string }) {
  const list = items.filter((item): item is string => Boolean(item));
  if (list.length === 0) return null;
  return (
    <Note tone="warn" icon={AlertTriangleIcon} className={className}>
      {list.length === 1 ? (
        list[0]
      ) : (
        <>
          <p>Проверьте перед подачей</p>
          <ul className="t-body mt-1 list-disc pl-[18px]">
            {list.map((text) => (
              <li key={text} className="mt-1 first:mt-0">
                {text}
              </li>
            ))}
          </ul>
        </>
      )}
    </Note>
  );
}
