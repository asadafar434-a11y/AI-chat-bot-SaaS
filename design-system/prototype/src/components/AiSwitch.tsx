import { useAiEnabled } from '../lib/use-ai-mode';
import { cx } from './ui';

// Переключатель «ИИ включён / выключен» (lib/ai-mode.ts) — в шапке меню рядом со сменой темы. Выключено — программа не обращается к языковым моделям:
// расчёты, правила и аналитика работают как обычно, а разбор документов, черновики ТП, проверка заявки, чат и распознавание сканов не запускаются.
export function AiSwitch({ className }: { className?: string }) {
  const [on, set] = useAiEnabled();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? 'ИИ включён. Выключить' : 'ИИ выключен. Включить'}
      onClick={() => set(!on)}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-colors',
        on ? 'border-border text-foreground hover:bg-secondary' : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span aria-hidden className={cx('size-2 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} />
      {on ? 'ИИ вкл' : 'ИИ выкл'}
    </button>
  );
}
