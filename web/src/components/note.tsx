import type { ReactNode } from "react";
import { WarningIcon, type IconComponent } from "@/components/icons";

const TONES = {
  warn: "t-strong bg-[var(--warn-tint)] text-[var(--warn)]",
  ok: "t-strong bg-[var(--ok-tint)] text-[var(--ok)]",
  // Серая справка: на холсте — белым островом, внутри острова — серой плашкой (см. .note-info)
  info: "t-body note-info text-[var(--ink-2)]",
};

type NoteProps = { tone: keyof typeof TONES; icon?: IconComponent; className?: string; children: ReactNode };

// Скругление задаёт класс note: на холсте плашка — отдельный блок, как остров, внутри острова — мельче.
export function Note({ tone, icon: Icon, className = "", children }: NoteProps) {
  return (
    <div className={`note flex items-start gap-2.5 px-3 py-2.5 ${TONES[tone]} ${className}`}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Одно предупреждение — плашкой, несколько — одной плашкой со списком, а не стопкой жёлтых полос.
export function Warnings({ items, className = "" }: { items: (string | null | false | undefined)[]; className?: string }) {
  const list = items.filter((item): item is string => Boolean(item));
  if (list.length === 0) return null;
  return (
    <Note tone="warn" icon={WarningIcon} className={className}>
      {list.length === 1 ? (
        list[0]
      ) : (
        <>
          <p>Проверьте перед подачей</p>
          <ul className="t-body mt-0.5 list-disc pl-4">
            {list.map((text) => (
              <li key={text} className="mt-0.5 first:mt-0">
                {text}
              </li>
            ))}
          </ul>
        </>
      )}
    </Note>
  );
}
