import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Sparkles, Loader2, ChevronRight, Info } from '../lib/icons';
import { Button, Card, Badge, Dot, Tooltip } from './ui';
import { requiredDocs, type CheckStatus, type RequiredDoc } from '../lib/data';
import { sortedDocs, type Fixes } from '../lib/app-state';

const statusMeta: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; tone: 'success' | 'warn' | 'danger'; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'success', label: 'Готово' },
  warn: { icon: AlertTriangle, tone: 'warn', label: 'Требует внимания' },
  missing: { icon: XCircle, tone: 'danger', label: 'Отсутствует' },
};

// Что делать с документом — показывается при раскрытии. gap — куда перейти на шаге «Проверка».
function fixHint(doc: RequiredDoc, status: CheckStatus): { what: string; where: string; gap?: string } {
  if (status === 'ok')
    return {
      what:
        doc.id === 'account'
          ? 'Реквизиты взяты из профиля компании.'
          : doc.id === 'declaration'
            ? 'Стандартный текст декларации о соответствии требованиям ч. 1 ст. 31 44-ФЗ.'
            : 'Всё нужное заполнено и подтверждено.',
      where: 'Действий не требуется — войдёт в итоговый пакет.',
    };
  switch (doc.id) {
    case 'cert':
      return {
        what: 'Сертификат — отдельный файл от органа по сертификации, ИИ не может создать его сам.',
        where: 'Приложите скан на шаге «Проверка».',
        gap: 'cert-poz3',
      };
    case 'guarantee':
      return {
        what: 'Спецсчёт известен, но есть ли на нём деньги, знает только банк.',
        where: 'Подтвердите способ обеспечения на шаге «Проверка».',
        gap: 'guarantee',
      };
    case 'registry':
      return {
        what: 'Для МФУ и ИБП номеров записей в реестре российской продукции нет в ваших файлах.',
        where: 'Впишите номера или отметьте, что товар иностранный.',
        gap: 'registry',
      };
    case 'deal':
      return {
        what: 'Крупная ли сделка, зависит от баланса компании — его нет в файлах.',
        where: 'Ответьте на шаге «Проверка» — это один выбор.',
        gap: 'deal',
      };
    default:
      return {
        what: 'Не хватает характеристик по позициям ТЗ — их знаете только вы (по моделям товара).',
        where: 'Впишите значения на шаге «Проверка» — нужные места подсвечены жёлтым в тексте заявки.',
        gap: 'poz2-storage',
      };
  }
}

export function StepAnalysis({
  fixes,
  onNext,
  onBack,
  onFixGap,
}: {
  fixes: Fixes;
  onNext: () => void;
  onBack: () => void;
  onFixGap: (gapId: string) => void;
}) {
  const [scanned, setScanned] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (scanned >= requiredDocs.length) return;
    const t = setTimeout(() => setScanned((s) => s + 1), 260);
    return () => clearTimeout(t);
  }, [scanned]);

  const done = scanned >= requiredDocs.length;
  // Сначала отсутствующее, потом требующее внимания, готовое — вниз.
  const docs = sortedDocs(fixes);
  const counts = docs.reduce(
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
          ИИ сверил извещение и ТЗ с составом заявки на электронный аукцион. Сверху — то, без чего заявку
          отклонят, ниже — что требует внимания, готовое — в конце. Нажмите на строку, чтобы увидеть, что не так и
          где это исправить.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['danger', counts.missing ?? 0, 'Не хватает', 'Документа нет в загруженных файлах — без него заявку отклонят.'],
            ['warn', counts.warn ?? 0, 'Внимание', 'Документ есть, но нужно что-то дописать или подтвердить.'],
            ['success', counts.ok ?? 0, 'Готово', 'Составлено и заполнено — войдёт в пакет как есть.'],
          ] as const
        ).map(([tone, n, label, hint], i) => (
          <Tooltip key={label} content={hint} side="bottom" align={i === 0 ? 'start' : i === 2 ? 'end' : 'center'} className="w-full">
            <Card className="w-full p-4">
              <div className="flex items-center gap-2">
                <Dot tone={tone} />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{done ? n : '—'}</p>
            </Card>
          </Tooltip>
        ))}
      </div>

      <div className="space-y-2">
        {docs.map(({ doc, status }, i) => {
          const meta = statusMeta[status];
          const Icon = meta.icon;
          const revealed = i < scanned;
          const needsAttention = status !== 'ok';
          const expanded = openId === doc.id;
          const hint = fixHint(doc, status);
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
                className="flex w-full items-center gap-3 rounded-lg p-4 text-left transition-colors hover:bg-secondary/40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Icon
                  className={`size-4 shrink-0 self-start mt-0.5 ${
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
                      <Tooltip content="Документ ИИ составил сам — из документов закупки, профиля и ваших образцов.">
                        <Badge tone="neutral">
                          <Sparkles className="size-2.5" /> авто
                        </Badge>
                      </Tooltip>
                    )}
                    {!doc.file && revealed && (
                      <Tooltip content="Это требование, а не файл заявки: в пакет не входит, но без него заявку не примут.">
                        <Badge tone="neutral">
                          <Info className="size-2.5" /> не файл
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{doc.ref}</p>
                  {revealed && (
                    <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
                      {status === 'ok' && doc.status !== 'ok' ? 'Исправлено на шаге «Проверка».' : doc.note}
                    </p>
                  )}
                </div>
                {revealed && (
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="hidden sm:block">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <ChevronRight
                      className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
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
                    <div
                      className={
                        needsAttention
                          ? 'flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn-surface/40 px-2.5 py-2 text-warn-foreground'
                          : 'text-muted-foreground'
                      }
                    >
                      <span className="flex items-start gap-1.5">
                        {needsAttention && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                        <span>
                          <span className="font-medium">{needsAttention ? 'Как исправить: ' : ''}</span>
                          {hint.where}
                        </span>
                      </span>
                      {hint.gap && (
                        <Button size="sm" variant="secondary" onClick={() => onFixGap(hint.gap!)}>
                          Исправить →
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Наименование, ИНН и адрес в заявку на аукцион не пишут: по ч. 1 ст. 49 44-ФЗ заявка содержит сведения из пп.
        «м»–«п» п. 1, пп. «а»–«в» п. 2 и п. 5 ч. 1 ст. 43, остальное площадка передаёт сама.
      </p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext} disabled={!done}>
          Дальше: цена →
        </Button>
      </div>
    </div>
  );
}
