import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronRight, Copy, Loader2, ShieldAlert } from '../lib/icons';
import {
  CRITICALITY_TEXT,
  KIND_TEXT,
  HIDDEN_KINDS,
  filterHiddenFindings,
  hiddenRequirementsCounts,
  hiddenRequirementsSummary,
  type Criticality,
  type HiddenFinding,
  type HiddenKind,
  type HiddenRequirementsResult,
} from '@/lib/hidden-requirements';
import { Badge, Button, Card, type Tone } from './ui';

// Скрытые требования, неоднозначности и условия допуска: платная проверка по кнопке (web/src/lib/hidden-requirements.ts).
// Показываем источник каждой находки, объяснение «почему это риск», готовый вопрос заказчику и фильтры по важности и типу.
export type HiddenRequirementsCard = {
  result: HiddenRequirementsResult | null;
  // Документы изменились после проверки.
  stale: boolean;
  running: boolean;
  error: string;
  onRun: () => void;
};

const CRITICALITY_TONE: Record<Criticality, Tone> = { critical: 'danger', high: 'warn', medium: 'info', low: 'neutral' };
const CRITICALITY_CHIP: Record<Criticality, string> = {
  critical: 'Критические',
  high: 'Высокие',
  medium: 'Средние',
  low: 'Низкие',
};
const KIND_CHIP: Record<HiddenKind, string> = {
  direct: 'Прямые',
  hidden: 'Скрытые',
  ambiguity: 'Неоднозначности',
  conflict: 'Противоречия',
  missing: 'Не хватает данных',
  legal: 'Правовые',
  financial: 'Деньги и расходы',
};

const keyOf = (f: HiddenFinding) => `${f.title}:${f.source}:${f.quote.slice(0, 40)}`;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-8 rounded-full border px-2.5 text-[12px] font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <p className="min-w-0 break-words">
      <span className="font-medium">{title}: </span>
      <span className="text-muted-foreground">{children}</span>
    </p>
  );
}

function Quote({ finding }: { finding: HiddenFinding }) {
  return (
    <div className="min-w-0 break-words rounded bg-secondary/50 px-2.5 py-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">
        {finding.source || 'Документы закупки'}
        {finding.at ? ` · ${finding.at}` : ''}
      </p>
      <p>«{finding.quote}»</p>
      {!finding.verified && (
        <p className="text-[12px] text-warn">Цитата не найдена в документах дословно — сверьте вручную.</p>
      )}
    </div>
  );
}

export function HiddenRequirementsBlock({ card }: { card: HiddenRequirementsCard }) {
  const { result, stale, running, error, onRun } = card;
  const [criticality, setCriticality] = useState<Criticality | 'all'>('all');
  const [kind, setKind] = useState<HiddenKind | 'all'>('all');
  // undefined — первая (самая важная) находка раскрыта; null — всё свёрнуто по выбору человека.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState<string | null>(null);

  const counts = result ? hiddenRequirementsCounts(result) : null;
  const shown = useMemo(
    () => (result ? filterHiddenFindings(result.findings, { criticality, kind }) : []),
    [result, criticality, kind],
  );
  const activeId = openId === undefined ? (shown[0] ? keyOf(shown[0]) : null) : openId;
  const criticalityOptions = counts
    ? (['critical', 'high', 'medium', 'low'] as const).filter((c) => counts[c] > 0)
    : [];
  const kindOptions = result ? HIDDEN_KINDS.filter((k) => result.findings.some((f) => f.kind === k)) : [];

  const copy = (text: string, key: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(key))
      .catch(() => {});
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="size-4 shrink-0" /> Скрытые требования и неоднозначности
          </p>
          <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted-foreground">
            ИИ перечитает извещение, ТЗ, договор и приложения: найдёт требования, которые легко пропустить, и места, которые можно понять
            двояко. Платный запрос к ИИ — только по кнопке.
          </p>
        </div>
        <Button size="sm" variant="ai" busy={running} disabled={running} onClick={onRun}>
          {running ? 'ИИ читает документы…' : result ? 'Проверить заново' : 'Найти скрытые требования'}
        </Button>
      </div>
      {running && <p className="text-[12px] text-muted-foreground">Это занимает до двух минут.</p>}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {result && (
        <>
          <p className="text-[13px] font-medium">{hiddenRequirementsSummary(result)}</p>
          {stale && <p className="text-[12px] text-warn">Документы изменились после проверки — результат мог устареть.</p>}
          {counts && counts.withQuestion > 0 && (
            <p className="text-[12px] text-muted-foreground">
              {counts.withQuestion} из {counts.total} — с готовым вопросом заказчику.
            </p>
          )}

          {criticalityOptions.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Фильтр по критичности">
              <Chip active={criticality === 'all'} onClick={() => setCriticality('all')}>
                Все · {counts?.total}
              </Chip>
              {criticalityOptions.map((c) => (
                <Chip key={c} active={criticality === c} onClick={() => setCriticality(c)}>
                  {CRITICALITY_CHIP[c]} · {counts?.[c]}
                </Chip>
              ))}
            </div>
          )}
          {kindOptions.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Фильтр по типу проблемы">
              <Chip active={kind === 'all'} onClick={() => setKind('all')}>
                Любой тип
              </Chip>
              {kindOptions.map((k) => (
                <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
                  {KIND_CHIP[k]}
                </Chip>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {result.findings.length === 0 ? 'ИИ не нашёл обоснованных проблем — проверьте документы на месте.' : 'Под выбранный фильтр ничего не подходит.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {shown.map((f) => {
                const key = keyOf(f);
                const open = activeId === key;
                return (
                  <li key={key} className="card-hover min-w-0 space-y-1.5 rounded-md border border-border p-3 text-[13px]">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : key)}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={CRITICALITY_TONE[f.criticality]}>{CRITICALITY_TEXT[f.criticality]}</Badge>
                          <Badge tone="neutral">{KIND_TEXT[f.kind]}</Badge>
                        </span>
                        <span className="block min-w-0 break-words font-medium">{f.title}</span>
                        <span className="block min-w-0 break-words text-muted-foreground">{f.what}</span>
                      </span>
                      <ChevronRight
                        className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                      />
                    </button>
                    <Quote finding={f} />
                    {open && (
                      <div className="animate-fade-up space-y-1.5 border-t border-border pt-2">
                        <Detail title="Почему это важно">{f.why}</Detail>
                        {f.interpretations && <Detail title="Возможные трактовки">{f.interpretations}</Detail>}
                        <Detail title="Риск для участника">{f.risk}</Detail>
                        <Detail title="Что проверить">{f.check}</Detail>
                        <Detail title="Что сделать">{f.action}</Detail>
                        {f.ask && (
                          <div className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-info/5 px-2.5 py-2">
                            <p className="min-w-0 flex-1 break-words">
                              <b className="font-medium">Вопрос заказчику:</b> {f.ask}
                            </p>
                            <Button size="sm" variant="ghost" onClick={() => copy(f.ask, key)}>
                              {copied === key ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                              {copied === key ? 'Скопировано' : 'Скопировать'}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}


