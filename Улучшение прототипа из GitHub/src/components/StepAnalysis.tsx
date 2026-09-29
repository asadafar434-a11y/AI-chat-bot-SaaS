import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Sparkles, Loader2, ChevronRight } from '../lib/icons';
import { Button, Card, Badge, Dot } from './ui';
import { requiredDocs, type CheckStatus, type RequiredDoc } from '../lib/data';

const statusMeta: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; tone: 'success' | 'warn' | 'danger'; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'success', label: 'Готово' },
  warn: { icon: AlertTriangle, tone: 'warn', label: 'Требует внимания' },
  missing: { icon: XCircle, tone: 'danger', label: 'Отсутствует' },
};

// Что делать пользователю с этим документом — показывается при раскрытии.
function fixHint(doc: RequiredDoc): { what: string; where: string } {
  if (doc.status === 'ok')
    return {
      what: 'Документ сформирован автоматически из реквизитов компании и загруженной документации.',
      where: 'Действий не требуется — войдёт в итоговый пакет как есть.',
    };
  if (doc.id === 'license')
    return {
      what: 'Сертификат — отдельный файл от органа сертификации, ИИ не может создать его сам.',
      where: 'Приложите скан на шаге «Проверка» → карточка «Сертификат соответствия на МФУ» (кнопка загрузки).',
    };
  if (doc.id === 'guarantee')
    return {
      what: 'Статус блокировки суммы приходит из банка, а не из тендерной документации.',
      where: 'Подтвердите способ на шаге «Проверка» → карточка «Обеспечение заявки».',
    };
  return {
    what: 'Не хватает характеристик по позициям ТЗ — их знаете только вы (по моделям товара).',
    where: 'Впишите значения на шаге «Проверка» — нужные места подсвечены жёлтым в тексте заявки.',
  };
}

export function StepAnalysis({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [scanned, setScanned] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (scanned >= requiredDocs.length) return;
    const t = setTimeout(() => setScanned((s) => s + 1), 260);
    return () => clearTimeout(t);
  }, [scanned]);

  const done = scanned >= requiredDocs.length;
  const counts = requiredDocs.reduce(
    (acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + 1), acc),
    {} as Record<CheckStatus, number>,
  );

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Анализ комплекта</h1>
          {!done && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ИИ сверил требования извещения и ТЗ с составом заявки по 44-ФЗ. Ниже — обязательные
          документы для подачи. Нажмите на строку, где есть замечание, чтобы увидеть, что не так и
          где это исправить.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ['success', counts.ok ?? 0, 'Готово'],
          ['warn', counts.warn ?? 0, 'Внимание'],
          ['danger', counts.missing ?? 0, 'Не хватает'],
        ].map(([tone, n, label]) => (
          <Card key={label as string} className="p-4">
            <div className="flex items-center gap-2">
              <Dot tone={tone as 'success' | 'warn' | 'danger'} />
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{done ? (n as number) : '—'}</p>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {requiredDocs.map((doc, i) => {
          const meta = statusMeta[doc.status];
          const Icon = meta.icon;
          const revealed = i < scanned;
          const needsAttention = doc.status !== 'ok';
          const expanded = openId === doc.id;
          const hint = fixHint(doc);
          return (
            <div
              key={doc.id}
              className={`rounded-lg border bg-card transition-all duration-300 ${
                expanded ? 'border-foreground/30' : 'border-border'
              } ${revealed ? 'opacity-100' : 'animate-scan opacity-40'}`}
            >
              <button
                type="button"
                disabled={!revealed}
                onClick={() => setOpenId(expanded ? null : doc.id)}
                className="flex w-full gap-3 rounded-lg p-4 text-left transition-colors hover:bg-secondary/40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${
                    !revealed
                      ? 'text-muted-foreground'
                      : meta.tone === 'success'
                        ? 'text-success'
                        : meta.tone === 'warn'
                          ? 'text-warn'
                          : 'text-danger'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">{doc.title}</p>
                    {doc.auto && revealed && (
                      <Badge tone="neutral">
                        <Sparkles className="size-2.5" /> авто
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{doc.ref}</p>
                  {revealed && (
                    <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{doc.note}</p>
                  )}
                </div>
                {revealed && (
                  <div className="flex shrink-0 items-center gap-2 self-start pt-0.5">
                    <div className="hidden sm:block">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <ChevronRight
                      className={`size-4 text-muted-foreground transition-transform ${
                        expanded ? 'rotate-90' : ''
                      }`}
                    />
                  </div>
                )}
              </button>

              {expanded && revealed && (
                <div className="animate-fade-up border-t border-border px-4 py-3 pl-11">
                  <div className="space-y-2 text-[13px] leading-snug">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {needsAttention ? 'В чём проблема: ' : 'Источник: '}
                      </span>
                      {hint.what}
                    </p>
                    <p
                      className={
                        needsAttention
                          ? 'flex items-start gap-1.5 rounded-md bg-warn-surface/40 px-2.5 py-2 text-warn-foreground'
                          : 'text-muted-foreground'
                      }
                    >
                      {needsAttention && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                      <span>
                        <span className="font-medium">
                          {needsAttention ? 'Как исправить: ' : ''}
                        </span>
                        {hint.where}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext} disabled={!done}>
          Составить документы и цену →
        </Button>
      </div>
    </div>
  );
}
