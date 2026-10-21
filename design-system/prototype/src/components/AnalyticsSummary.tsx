import { useState } from 'react';
import type { Summary, VerdictLevel } from '@/lib/analytics-summary';
import { AlertTriangle, CheckCircle2, FileText, HelpCircle, XCircle } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Collapsible } from './Collapsible';
import { Button, Card, HelpTip } from './ui';

// Верх экрана «Аналитика»: итог светофором с причинами, резюме одним абзацем, главные цифры и рекомендации (свёрнуты). Подробности — в раскрывающихся разделах ниже, полный отчёт — в Word или PDF.
// Светофор — не балл и не вероятность победы: он показывает, хватает ли прибыли на риски договора. Решение об участии — за человеком.

const TONE: Record<VerdictLevel, { Icon: typeof CheckCircle2; chip: string }> = {
  go: { Icon: CheckCircle2, chip: 'bg-success/10 text-success' },
  careful: { Icon: AlertTriangle, chip: 'bg-warn-surface text-warn-foreground' },
  stop: { Icon: XCircle, chip: 'bg-danger/10 text-danger' },
  unknown: { Icon: HelpCircle, chip: 'bg-secondary text-muted-foreground' },
};

export type ReportBusy = 'word' | 'pdf' | null;

export function AnalyticsSummary({
  summary,
  busy,
  error,
  onWord,
  onPdf,
  action,
}: {
  summary: Summary;
  busy: ReportBusy;
  error: string | null;
  onWord: () => void;
  onPdf: () => void;
  /** Быстрый переход к нужному разделу, например «Ввести затраты». */
  action?: { label: string; onClick: () => void };
}) {
  const [adviceOpen, setAdviceOpen] = useState(false);
  const { verdict } = summary;
  const { Icon, chip } = TONE[verdict.level];
  return (
    <div className="space-y-2">
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${chip}`}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold tracking-tight">{verdict.label}</p>
              <CertaintyBadge kind="estimate" />
              <HelpTip
                align="start"
                content="Светофор — не балл и не вероятность победы. Он показывает, хватает ли вашей прибыли на риски договора, при ваших затратах и допущениях ниже. Решение об участии принимаете вы."
              />
            </div>
            <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
              {verdict.reasons.map((reason) => (
                <li key={reason} className="break-words">
                  {reason}
                </li>
              ))}
            </ul>
            {action && (
              <Button className="mt-2" size="sm" variant="secondary" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
          </div>
        </div>

        {summary.facts.length > 0 && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
            {summary.facts.map((fact) => (
              <div key={fact.label} className="min-w-0 rounded-lg border border-border px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
                <dd className="mt-0.5 break-words font-mono text-[13px] font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="rounded-lg bg-secondary/50 px-3 py-2.5">
          <p className="text-[12px] font-medium text-muted-foreground">Резюме</p>
          <p className="mt-1 break-words text-[13px] leading-relaxed">{summary.text}</p>
        </div>

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
