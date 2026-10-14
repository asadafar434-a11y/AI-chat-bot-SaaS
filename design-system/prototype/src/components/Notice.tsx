import type { ReactNode } from 'react';
import { AlertTriangle, Check, Info } from '../lib/icons';
import { cx } from './ui';

// Короткое сообщение о результате действия: готово (ok), к сведению (info) или нужно внимание (warn). Смысл — в тексте и значке, а не
// только в цвете; предупреждение читается экранным диктором сразу (role="alert").
export type Tone = 'ok' | 'info' | 'warn';

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : Info;
  return (
    <p
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2 rounded-md px-3 py-2 text-[13px] leading-snug',
        tone === 'ok' && 'bg-success/10 text-success',
        tone === 'warn' && 'bg-warn-surface/50 text-warn-foreground',
        tone === 'info' && 'bg-info/10 text-info',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
