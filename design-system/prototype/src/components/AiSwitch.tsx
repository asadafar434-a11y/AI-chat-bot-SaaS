import { useAiEnabled } from '../lib/use-ai-mode';
import { BotMark } from './BotMark';
import { cx } from './ui';

// Переключатель «ИИ включён / выключен» (lib/ai-mode.ts) — в шапке меню. Выключено — программа не обращается к языковым моделям:
// расчёты, правила и аналитика работают как обычно, а разбор документов, черновики ТП, проверка заявки, чат и распознавание сканов не запускаются.
// Включён — фирменный градиент и робот-ассистент: переключатель видно сразу, но поведение и подписи для диктора прежние.
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
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-[12px] font-medium transition-all',
        on
          ? 'border-transparent bg-brand-gradient text-white shadow-md shadow-indigo-500/30 hover:brightness-110'
          : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <BotMark className={cx('size-6 shrink-0', !on && 'opacity-60 grayscale')} />
      <span>{on ? 'ИИ вкл' : 'ИИ выкл'}</span>
    </button>
  );
}
