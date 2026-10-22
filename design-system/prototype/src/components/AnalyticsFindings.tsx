import type { FindingLine, Tone } from '@/lib/analytics-summary';
import { Button, Card } from './ui';

// Подпись внизу экрана закупки в «Аналитике» (решение владельца 22.10.2026: «внизу 4–5 основных моментов — что нашёл поиск, какая аналитика сработала, какой риск, ценовой»).
// Полей ввода нет: всё считается внутри (lib/analytics-summary.ts, findingsOf), подробности — в отчёте Word и PDF. Единственная кнопка — бесплатный поиск по рискам отрасли и региона.
// Оценка — не прогноз и не гарантия: это сказано под строками.

const DOT: Record<Tone, string> = { danger: 'bg-danger', warn: 'bg-warn', good: 'bg-success', muted: 'bg-muted-foreground/40' };

export type FindingsSearch = {
  /** Строка о поиске; null — искать нечего (у закупки нет тем, которые проверяются в интернете). */
  line: FindingLine | null;
  /** Сколько тем ещё не искали: если ноль, кнопки нет. */
  pending: number;
  busy: boolean;
  done: number;
  error: string | null;
  onRun: () => void;
};

export function AnalyticsFindings({ lines, search }: { lines: FindingLine[]; search: FindingsSearch }) {
  const all = search.line ? [...lines, search.line] : lines;
  return (
    <Card className="space-y-3 p-4">
      <p className="text-[14px] font-bold">Что нашла аналитика</p>
      <ul className="space-y-2">
        {all.map((l) => (
          <li key={l.label} className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[l.tone]}`} />
              {l.label}
            </span>
            <span className="min-w-0 break-words text-[13px]">
              {l.text}
              {l.label === 'Поиск' && search.pending > 0 && (
                <Button size="sm" variant="secondary" className="mt-1.5 align-middle sm:ml-2 sm:mt-0" disabled={search.busy} onClick={search.onRun}>
                  {search.busy ? `Ищу: ${search.done} из ${search.pending + search.done}` : `Проверить поиском (${search.pending})`}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {search.error && (
        <p role="alert" className="text-[12px] text-danger">
          {search.error}
        </p>
      )}
      <p className="border-t border-border pt-3 text-[12px] text-muted-foreground">
        Это расчётная оценка по документам закупки и типовым допущениям (ставки, сроки, рост затрат) — не прогноз и не гарантия результата. Решение об участии принимает человек.
      </p>
    </Card>
  );
}
