import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const TONES = {
  warn: "bg-[var(--warn-tint)] font-semibold text-[var(--warn)]",
  ok: "bg-[var(--ok-tint)] font-semibold text-[var(--ok)]",
  info: "bg-card text-[15px] text-[var(--ink-2)]",
};

type NoteProps = { tone: keyof typeof TONES; icon?: LucideIcon; className?: string; children: ReactNode };

export function Note({ tone, icon: Icon, className = "", children }: NoteProps) {
  return (
    <div className={`flex items-center gap-3 rounded-[var(--r-card)] px-4 py-3.5 ${TONES[tone]} ${className}`}>
      {Icon && <Icon className="size-5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
