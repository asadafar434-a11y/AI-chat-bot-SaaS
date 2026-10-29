import { useState } from 'react';
import type { MatrixData } from '@/lib/hidden-costs';
import { DEFAULT_WEIGHTS, GROUPS, LEVEL_TEXT, type CheckRow, type Level, type ManualResult, type MatrixSummary } from '@/lib/check-matrix';
import { percent } from '@/lib/analytics-summary';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from '../lib/icons';
import { Badge, Button, HelpTip, type Tone, fieldClass } from './ui';

// «Матрица проверок (27)» (lib/check-matrix.ts). По правилу «мало текста, много фактов, больше кнопок»: сверху итог и кнопки-фильтры со счётчиками, карта из 27 клеток, у строки — название, значок и факт по этой закупке;
// как проверяется, чего не хватает и запись своего результата — за кнопками. Пояснения — в ⓘ. Это не вероятность победы и не оценка заказчика.

export type CheckMatrixProps = {
  rows: CheckRow[];
  summary: MatrixSummary;
  data: MatrixData;
  onChange: (next: MatrixData) => void;
};

type Filter = 'all' | Level | 'insufficient' | 'not_checked';
type Shown = { tone: Tone; text: string; cell: string; key: Filter };

const inputClass = fieldClass('sm');
const LEVEL_TONE: Record<Level, Tone> = { ok: 'success', attention: 'warn', risk: 'danger' };
const CELL = {
  ok: 'border-success bg-success/15 text-success',
  attention: 'border-warn bg-warn/25 text-warn-foreground',
  risk: 'border-danger bg-danger/15 text-danger',
  insufficient: 'border-dashed border-muted-foreground/60 text-muted-foreground',
  not_checked: 'border-border bg-secondary text-muted-foreground',
};

function shownOf(row: CheckRow): Shown {
  const r = row.result;
  if (r.state === 'checked') return { tone: LEVEL_TONE[r.level], text: LEVEL_TEXT[r.level], cell: CELL[r.level], key: r.level };
  if (r.state === 'manual') return { tone: 'info', text: `Вы: ${LEVEL_TEXT[r.level].toLowerCase()}`, cell: CELL[r.level], key: r.level };
  if (r.state === 'insufficient') return { tone: 'neutral', text: 'Нет данных', cell: CELL.insufficient, key: 'insufficient' };
  return { tone: 'neutral', text: 'Ждёт источника', cell: CELL.not_checked, key: 'not_checked' };
}

const Icon = ({ k }: { k: Filter }) =>
  k === 'ok' ? <CheckCircle2 className="size-3" /> : k === 'attention' ? <AlertTriangle className="size-3" /> : k === 'risk' ? <XCircle className="size-3" /> : <HelpCircle className="size-3" />;

// Что показывать под названием закрытой строки: факт, когда он важен (внимание, риск, ваша запись) и чего не хватает, когда это можно сделать; у «в порядке» и «ждёт источника» — ничего.
function lineOf(row: CheckRow): string {
  const r = row.result;
  if (r.state === 'manual') return r.summary;
  if (r.state === 'checked') return r.level === 'ok' ? '' : r.summary;
  if (r.state === 'insufficient') return r.missing.length > 0 ? `Нужно: ${r.missing[0]}` : '';
  return '';
}

function Chip({ active, onClick, tone, children }: { active: boolean; onClick: () => void; tone: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'border-primary bg-primary text-primary-foreground' : `border-border bg-card hover:bg-secondary ${tone}`
      }`}
    >
      {children}
    </button>
  );
}

function Detail({ row, data, onChange }: { row: CheckRow; data: MatrixData; onChange: (next: MatrixData) => void }) {
  const { def, result } = row;
  const key = String(def.n);
  const mine = data.manual?.[key];
  const [level, setLevel] = useState<Level>(mine?.level ?? 'attention');
  const [how, setHow] = useState(false);
  const [write, setWrite] = useState(Boolean(mine));
  const canWrite = result.state !== 'checked';
  const save = (patch: Partial<ManualResult>) => {
    const next: ManualResult = { level, note: mine?.note ?? '', source: mine?.source ?? '', ...patch };
    const manual = { ...(data.manual ?? {}) };
    if (next.note.trim() === '') delete manual[key];
    else manual[key] = next;
    onChange({ ...data, manual: Object.keys(manual).length > 0 ? manual : undefined });
  };
  const setWeight = (value: number) => {
    const weights = { ...(data.weights ?? {}) };
    if (value === DEFAULT_WEIGHTS[def.n]) delete weights[key];
    else weights[key] = value;
    onChange({ ...data, weights: Object.keys(weights).length > 0 ? weights : undefined });
  };
  const facts = result.state === 'checked' ? result.facts : [];
  const missing = result.state === 'insufficient' || result.state === 'not_checked' ? result.missing : [];
  return (
    <div className="space-y-3 border-t border-border px-3 py-3 text-[12px]">
      {facts.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {facts.map((f) => (
            <li key={f} className="break-words">
              {f}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {missing.map((m) => (
            <li key={m} className="break-words">
              <span className="text-muted-foreground">Нужно: </span>
              {m}
            </li>
          ))}
        </ul>
      )}
      {result.state === 'manual' && (
        <p className="break-words">
          {result.summary}
          {result.source && <span className="text-muted-foreground"> · {result.source}</span>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setHow((v) => !v)} aria-expanded={how}>
          Как проверяется
        </Button>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setWrite((v) => !v)} aria-expanded={write}>
            {mine ? 'Моя запись' : 'Записать результат'}
          </Button>
        )}
        <div role="radiogroup" aria-label={`Проверка ${def.n}: важность`} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          Важность
          {[1, 2, 3].map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={row.weight === w}
              aria-label={`Важность ${w}`}
              onClick={() => setWeight(w)}
              className={`size-7 rounded-md border font-mono text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${row.weight === w ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-secondary'}`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {how && (
        <dl className="space-y-1.5 rounded-lg bg-secondary/50 px-3 py-2">
          <div>
            <dt className="text-muted-foreground">Что</dt>
            <dd className="break-words">{def.what}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Откуда</dt>
            <dd className="break-words">{def.source}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Как оценивается</dt>
            <dd className="break-words">{def.rule}</dd>
          </div>
        </dl>
      )}

      {canWrite && write && (
        <fieldset className="space-y-2 rounded-lg border border-border p-2.5">
          <legend className="sr-only">Результат вашей проверки</legend>
          <div role="radiogroup" aria-label={`Проверка ${def.n}: итог`} className="flex flex-wrap gap-1.5">
            {(Object.keys(LEVEL_TEXT) as Level[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={level === l}
                onClick={() => {
                  setLevel(l);
                  if (mine) save({ level: l });
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${level === l ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-secondary'}`}
              >
                <Icon k={l} />
                {LEVEL_TEXT[l]}
              </button>
            ))}
          </div>
          <input aria-label={`Проверка ${def.n}: что установили`} value={mine?.note ?? ''} onChange={(e) => save({ note: e.target.value })} placeholder="Факт: «в КАД 3 дела об оплате за 2025 год»" className={inputClass} />
          <input aria-label={`Проверка ${def.n}: источник`} value={mine?.source ?? ''} onChange={(e) => save({ source: e.target.value })} placeholder="Источник: ЕИС, КАД, номер дела" className={inputClass} />
        </fieldset>
      )}
    </div>
  );
}

export function CheckMatrix({ rows, summary, data, onChange }: CheckMatrixProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const show = (n: number) => {
    setFilter('all');
    setOpen(n);
    setTimeout(() => document.getElementById(`check-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  };
  const keep = (r: CheckRow) => filter === 'all' || shownOf(r).key === filter;
  const count = (k: Filter) => rows.filter((r) => shownOf(r).key === k).length;
  const none = rows.filter(keep).length === 0;
  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-semibold tracking-tight">
          Проверено {summary.program + summary.manual} из {summary.total} <span className="font-normal text-muted-foreground">({percent(summary.coveragePct)})</span>
        </p>
        <HelpTip
          align="start"
          content={`Программа проверяет по документам и вашим данным только то, что может доказать; остальное — «нет данных» или «ждёт источника». Баллов без данных нет. Это не вероятность победы и не оценка заказчика. Риск, описанный несколькими проверками (например, долгая оплата), считается один раз: тем с вниманием ${summary.uniqueAttention}, с риском ${summary.uniqueRisk}. Выводы по заказчику, судам и ФАС появятся с источниками (ЕИС, КАД); пока результат такой проверки можно записать самому, с источником.`}
        />
      </div>

      <div role="group" aria-label="Фильтр проверок" className="flex flex-wrap gap-1.5">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')} tone="">
          Все {rows.length}
        </Chip>
        <Chip active={filter === 'risk'} onClick={() => setFilter(filter === 'risk' ? 'all' : 'risk')} tone="text-danger">
          <XCircle className="size-3.5" />
          Риск {summary.risk}
        </Chip>
        <Chip active={filter === 'attention'} onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')} tone="text-warn-foreground">
          <AlertTriangle className="size-3.5" />
          Внимание {summary.attention}
        </Chip>
        <Chip active={filter === 'ok'} onClick={() => setFilter(filter === 'ok' ? 'all' : 'ok')} tone="text-success">
          <CheckCircle2 className="size-3.5" />В порядке {summary.ok}
        </Chip>
        <Chip active={filter === 'insufficient'} onClick={() => setFilter(filter === 'insufficient' ? 'all' : 'insufficient')} tone="text-muted-foreground">
          Нет данных {count('insufficient')}
        </Chip>
        <Chip active={filter === 'not_checked'} onClick={() => setFilter(filter === 'not_checked' ? 'all' : 'not_checked')} tone="text-muted-foreground">
          Ждут источника {count('not_checked')}
        </Chip>
      </div>

      <section aria-label="Карта проверок" className="space-y-1.5">
        {GROUPS.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="w-full text-[12px] text-muted-foreground sm:w-48">{g.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {rows
                .filter((r) => r.def.group === g.id)
                .map((r) => {
                  const s = shownOf(r);
                  const dim = filter !== 'all' && s.key !== filter;
                  return (
                    <button
                      key={r.def.n}
                      type="button"
                      onClick={() => show(r.def.n)}
                      title={`${r.def.n}. ${r.def.title}: ${s.text}`}
                      aria-label={`Проверка ${r.def.n}: ${r.def.title}. ${s.text}`}
                      className={`flex size-7 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-opacity hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s.cell} ${dim ? 'opacity-30' : ''} ${r.result.state === 'manual' ? 'underline decoration-2 underline-offset-2' : ''}`}
                    >
                      {r.def.n}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </section>

      {filter === 'all' && summary.first.length > 0 && (
        <section aria-label="Что смотреть первым" className="space-y-1.5">
          <h3 className="text-[13px] font-medium">Смотреть первым</h3>
          <ul className="space-y-1.5">
            {summary.first.slice(0, 3).map((r) => {
              const s = shownOf(r);
              return (
                <li key={r.def.n}>
                  <button type="button" onClick={() => show(r.def.n)} className="flex w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-secondary/60">
                    <Badge tone={s.tone}>
                      <Icon k={s.key} />
                      {s.text}
                    </Badge>
                    <span className="min-w-0 flex-1 break-words text-[12px]">
                      <span className="font-medium">
                        {r.def.n}. {r.def.title}
                      </span>
                      <span className="block text-muted-foreground">{r.result.summary}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {none && <p className="text-[12px] text-muted-foreground">Таких проверок нет.</p>}
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.def.group === g.id && keep(r));
        if (list.length === 0) return null;
        const gs = summary.groups.find((x) => x.id === g.id)!;
        return (
          <section key={g.id} aria-labelledby={`matrix-${g.id}`} className="space-y-1.5">
            <h3 id={`matrix-${g.id}`} className="text-[13px] font-medium">
              {g.title} <span className="font-normal text-muted-foreground">· {gs.done} из {gs.total}</span>
            </h3>
            <ul className="space-y-1.5">
              {list.map((r) => {
                const s = shownOf(r);
                const isOpen = open === r.def.n;
                const line = lineOf(r);
                return (
                  <li key={r.def.n} id={`check-${r.def.n}`} className="rounded-lg border border-border">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.def.n)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-[12px] text-muted-foreground">{r.def.n}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13px] font-medium">{r.def.title}</span>
                        {line && <span className="mt-0.5 block break-words text-[12px] text-muted-foreground">{line}</span>}
                      </span>
                      <Badge tone={s.tone}>
                        <Icon k={s.key} />
                        {s.text}
                      </Badge>
                    </button>
                    {isOpen && <Detail row={r} data={data} onChange={onChange} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
