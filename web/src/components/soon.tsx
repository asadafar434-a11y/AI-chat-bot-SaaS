// Пометка «скоро»: чего приложение ещё не умеет, не прячем и не выдаём за работающее (CLAUDE.md).
export function Soon({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex flex-none rounded-[var(--r-pill)] border border-dashed border-[var(--edge-2)] px-1.5 font-mono text-[10px] uppercase leading-4 tracking-wider text-[var(--ink-3)] ${className}`}
    >
      скоро
    </span>
  );
}
