import { useState } from 'react';
import type { Summary, Tone, VerdictLevel } from '@/lib/analytics-summary';
import { AlertTriangle, CheckCircle2, FileText, HelpCircle, XCircle } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Collapsible } from './Collapsible';
import { Button, Card, HelpTip } from './ui';

// Верх экрана «Аналитика» по уровням важности (решение владельца 22.10.2026: «важное — жирным, крупно, цветом; а то всё в кучу»):
//  1) итог светофором и ГЛАВНОЕ ЧИСЛО — цена, с которой можно участвовать, и две соседние цены — крупно и цветом;
//  2) крупнейшие риски в рублях — жирные суммы, цвет по доле цены;
//  3) причины, начальная цена и рынок — обычным шрифтом; кнопки отчёта — тихо.
// Светофор — не балл и не вероятность победы: он показывает, хватает ли прибыли на риски договора. Решение об участии — за человеком. Абзац резюме остался в отчёте Word и PDF.

const HERO: Record<VerdictLevel, { Icon: typeof CheckCircle2; wrap: string; title: string }> = {
  go: { Icon: CheckCircle2, wrap: 'border-success/40 bg-success/5', title: 'text-success' },
  careful: { Icon: AlertTriangle, wrap: 'border-warn/60 bg-warn-surface/40', title: 'text-warn-foreground' },
  stop: { Icon: XCircle, wrap: 'border-danger/40 bg-danger/5', title: 'text-danger' },
  unknown: { Icon: HelpCircle, wrap: 'border-border bg-card', title: 'text-foreground' },
};

const TONE_TEXT: Record<Tone, string> = { danger: 'text-danger', warn: 'text-warn-foreground', good: 'text-success', muted: 'text-foreground' };

export type ReportBusy = 'word' | 'pdf' | null;

export function AnalyticsSummary({
  summary,
  busy,
  error,
  onWord,
  onPdf,
  action,
  analyze,
}: {
  summary: Summary;
  busy: ReportBusy;
  error: string | null;
  onWord: () => void;
  onPdf: () => void;
  /** Быстрый переход к нужному разделу, например «Ввести затраты». */
  action?: { label: string; onClick: () => void };
  /** Дальше по закупке: шаг «Анализ» (загрузка уже пройдена). Стоит на самой плашке итога. */
  analyze?: { label: string; onClick: () => void };
}) {
  const [adviceOpen, setAdviceOpen] = useState(false);
  const { verdict } = summary;
  const headline = summary.headline ?? null;
  const topRisks = summary.topRisks ?? [];
  const { Icon, wrap, title } = HERO[verdict.level];
  // Числа, которые уже стоят крупно выше, в мелких плитках не повторяем.
  const risksTotal = summary.facts.find((f) => f.id === 'risks');
  const tiles = summary.facts.filter((f) => !(f.id === 'target' && headline) && !(f.id === 'risks' && topRisks.length > 0));
  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border p-5 shadow-sm ${wrap}`}>
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 size-6 shrink-0 ${title}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={`text-xl font-bold tracking-tight ${title}`}>{verdict.label}</p>
              <CertaintyBadge kind="estimate" />
              <HelpTip
                align="start"
                content="Светофор — не балл и не вероятность победы. Он показывает, хватает ли вашей прибыли на риски договора, при ваших затратах и допущениях ниже. Решение об участии принимаете вы."
              />
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[13px] font-medium">
              {verdict.reasons.map((reason) => (
                <li key={reason} className="break-words">
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {headline ? (
          <div className="mt-4 border-t border-foreground/10 pt-3">
            <p className="text-[12px] font-semibold text-muted-foreground">{headline.label}</p>
            <p className={`mt-0.5 break-words font-mono text-3xl font-bold tracking-tight ${TONE_TEXT[headline.tone]}`}>{headline.value}</p>
            {headline.note && <p className="mt-0.5 text-[12px] text-muted-foreground">{headline.note}</p>}
            {headline.extras.length > 0 && (
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                {headline.extras.map((x) => (
                  <div key={x.label} className="min-w-0">
                    <dt className="text-[11px] font-medium text-muted-foreground">{x.label}</dt>
                    <dd className={`mt-0.5 break-words font-mono text-lg font-bold tracking-tight ${TONE_TEXT[x.tone]}`}>{x.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          action && (
            <div className="mt-3">
              <Button onClick={action.onClick}>{action.label}</Button>
            </div>
          )
        )}

        {analyze && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-3">
            <Button onClick={analyze.onClick}>{analyze.label}</Button>
          </div>
        )}
      </div>

      {topRisks.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[14px] font-bold">Главные риски</p>
            {risksTotal && (
              <p className="text-[13px] text-muted-foreground">
                Если сработают все: <span className="font-mono text-base font-bold text-danger">{risksTotal.value}</span>
              </p>
            )}
          </div>
          <ul className="space-y-2.5">
            {topRisks.map((r) => (
              <li key={r.title} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={`font-mono text-lg font-bold tracking-tight ${TONE_TEXT[r.tone]}`}>{r.amount}</span>
                <span className={`text-[13px] font-semibold ${TONE_TEXT[r.tone]}`}>{r.pct}</span>
                <span className="min-w-0 basis-full break-words text-[13px] text-muted-foreground sm:flex-1 sm:basis-auto">{r.title}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3 p-4">
        {tiles.length > 0 && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-2">
            {tiles.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
                <dd className="mt-0.5 break-words font-mono text-[13px] font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onWord}>
            <FileText className="size-3.5" />
            {busy === 'word' ? 'Готовлю файл…' : 'Скачать Word'}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onPdf}>
            <FileText className="size-3.5" />
            {busy === 'pdf' ? 'Готовлю…' : 'Скачать PDF'}
          </Button>
          <HelpTip align="start" content="Полный отчёт со всеми разделами, цитатами и допущениями. Собирается в вашем браузере, на сервер не уходит. PDF: откроется окно печати — выберите «Сохранить как PDF»." />
        </div>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </Card>

      {summary.recommendations.length > 0 && (
        <Collapsible title={`Рекомендации (${summary.recommendations.length})`} open={adviceOpen} onToggle={() => setAdviceOpen((v) => !v)}>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
            {summary.recommendations.map((text) => (
              <li key={text} className="break-words">
                {text}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  );
}
