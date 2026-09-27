import { CheckIcon, ClockIcon, EditIcon, WarningIcon } from "@/components/icons";
import type { BadgeIcon, BadgeInfo } from "@/lib/home";
import type { Tone } from "@/lib/steps";

// Бейдж статуса: пилюля с бледной заливкой статуса, текст и иконка — его цветом. Цвет всегда с подписью:
// янтарь — нужно ваше действие, красный — ошибка, зелёный — готово, индиго — следующий шаг, серый — справка.
const TONES: Record<Tone, string> = {
  warn: "bg-[var(--warn-tint)] text-[var(--warn)]",
  bad: "bg-[var(--danger-tint)] text-[var(--danger)]",
  ok: "bg-[var(--ok-tint)] text-[var(--ok)]",
  brand: "bg-[var(--brand-tint)] text-primary",
  calm: "bg-[var(--paper-2)] text-[var(--ink-2)]",
};

const ICONS: Record<BadgeIcon, typeof CheckIcon> = { check: CheckIcon, pen: EditIcon, alert: WarningIcon, clock: ClockIcon };

// onPaper — бейдж на серой поверхности («Сейчас важно»): серому бейджу там нужна белая заливка, иначе он пропадает.
export function Badge({ tone, text, icon, onPaper = false, className = "" }: BadgeInfo & { onPaper?: boolean; className?: string }) {
  const Icon = icon && ICONS[icon];
  const colors = onPaper && tone === "calm" ? "bg-card text-[var(--ink-2)]" : TONES[tone];
  return (
    <span className={`t-tag inline-flex min-h-[22px] items-center gap-1 whitespace-nowrap rounded-[var(--r-pill)] px-2 py-0.5 ${colors} ${className}`}>
      {Icon && <Icon aria-hidden className="size-3.5 flex-none" />}
      {text}
    </span>
  );
}
