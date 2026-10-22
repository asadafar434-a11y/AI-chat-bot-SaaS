import type { RicAdjustment, RicData, RicResult } from '@/lib/indicative-price';
import { METHOD_LABELS, readiness, SCENARIO_OPTIONS, SOURCE_LABELS, scenarioRic, type Applied, type Unit } from '@/lib/ric-scenarios';
import { AlertTriangle, CheckCircle2, Info, Plus, Trash2 } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Badge, Button, HelpTip, IconButton } from './ui';

// «Как считается РИЦ для вашей сферы»: у ИТ, логистики, стройки и других сфер свои метод, опора, поправки и отраслевые риски (lib/ric-scenarios.ts).
// Программа не придумывает числа сфер: поправку или резерв на риск вводит участник с основанием (откуда число), без основания они в расчёт не идут. Методика — на проверку юристу.

export type RicScenarioPanelProps = {
  data: RicData;
  result: RicResult;
  /** Предмет закупки и её вид — по ним определяется сфера, пока участник не выбрал свою. */
  subject: string;
  type: string;
  onChange: (next: RicData) => void;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;
const rub = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`.replace(/[  ]/g, ' ');
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`.replace(/[  ]/g, ' ');
const signedRub = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${rub(Math.abs(n))}`;
const newId = () => `custom-${Math.random().toString(36).slice(2, 9)}`;

function Tile({ title, value, hint, badge }: { title: string; value: string; hint: string; badge: 'own' | 'estimate' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground">{title}</p>
        <CertaintyBadge kind={badge} />
      </div>
      <p className="mt-0.5 break-words font-mono text-[15px] font-semibold">{value}</p>
      <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Row({
  applied,
  hint,
  entry,
  unit,
  vat,
  onPatch,
  onRemove,
  custom,
}: {
  applied: Applied;
  hint: string;
  entry: RicAdjustment | undefined;
  unit: Unit;
  vat: string;
  onPatch: (patch: Partial<RicAdjustment>) => void;
  onRemove?: () => void;
  custom?: boolean;
}) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {custom ? (
            <input aria-label="Название поправки" value={entry?.label ?? ''} onChange={(e) => onPatch({ label: e.target.value })} placeholder="Название поправки" className={inputClass} />
          ) : (
            <>
              <p className="flex items-center gap-1.5 break-words text-[13px] font-medium">
                {applied.label}
                <HelpTip align="start" content={hint} />
              </p>
            </>
          )}
        </div>
        {onRemove && (
          <IconButton label={`Убрать: ${applied.label}`} onClick={onRemove} side="bottom" align="end">
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="block text-[12px]">
          <span className="mb-1 block text-muted-foreground">
            {unit === 'percent' ? 'Поправка, % (минус — уменьшает)' : `Сумма, ₽ (${vat})`}
            {custom && (
              <select aria-label="Единица" value={unit} onChange={(e) => onPatch({ unit: e.target.value as Unit })} className="ml-1 rounded border border-border bg-background text-[11px]">
                <option value="rub">₽</option>
                <option value="percent">%</option>
              </select>
            )}
          </span>
          <input aria-label={`${applied.label}: значение`} inputMode="decimal" value={entry?.value ?? ''} onChange={(e) => onPatch({ value: e.target.value })} placeholder="0" className={numClass} />
        </label>
        <label className="block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Основание</span>
          <input aria-label={`${applied.label}: основание`} value={entry?.basis ?? ''} onChange={(e) => onPatch({ basis: e.target.value })} placeholder="Откуда число: КП, расчёт, источник" className={inputClass} />
        </label>
      </div>
      {applied.counted && applied.effect !== null && (
        <p className="text-[12px] text-muted-foreground">
          Вклад в расчёт: <span className={`font-mono ${applied.effect < 0 ? 'text-success' : ''}`}>{signedRub(applied.effect)}</span>
        </p>
      )}
      {applied.reason && (
        <p className="flex items-start gap-1.5 text-[12px] text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{applied.reason}</span>
        </p>
      )}
    </li>
  );
}

export function RicScenarioPanel({ data, result, subject, type, onChange }: RicScenarioPanelProps) {
  const calc = scenarioRic(data, result, subject, type);
  const { scenario } = calc;
  const entries = new Map((data.adjustments ?? []).map((a) => [a.id, a]));
  const vat = data.settings.nmckVat === 'with' ? 'с НДС, как РИЦ' : 'без НДС, как РИЦ';
  const checks = readiness(scenario, result, data);
  const customs = calc.adjustments.filter((a) => a.id.startsWith('custom-'));
  const mainMethod = scenario.methods.find((m) => m.role === 'основной') ?? scenario.methods[0];

  const write = (next: RicAdjustment[]) => onChange({ ...data, adjustments: next.length > 0 ? next : undefined });
  const patch = (id: string, change: Partial<RicAdjustment>, custom = false) => {
    const list = data.adjustments ?? [];
    const current = list.find((a) => a.id === id);
    const merged: RicAdjustment = { ...(current ?? { id, value: '', basis: '' }), ...change };
    const empty = !custom && merged.value.trim() === '' && merged.basis.trim() === '';
    write(empty ? list.filter((a) => a.id !== id) : current ? list.map((a) => (a.id === id ? merged : a)) : [...list, merged]);
  };
  const remove = (id: string) => write((data.adjustments ?? []).filter((a) => a.id !== id));

  return (
    <section aria-labelledby="ric-scenario" className="space-y-3 rounded-lg border border-border p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="ric-scenario" className="text-[13px] font-medium">
          Как считается РИЦ для вашей сферы
        </h3>
        <Badge tone="warn">Методика — на проверку юристу</Badge>
        <HelpTip
          align="start"
          content="Метод, опора и поправки составлены программой по типовой практике и ст. 22 44-ФЗ; юрист ещё не проверил их. Числа сфер программа не придумывает: поправку или резерв на риск вводите вы, с основанием — без него число в расчёт не идёт."
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label className="flex w-full items-center gap-2 text-[12px] sm:w-auto">
          <span className="shrink-0 text-muted-foreground">Сфера</span>
          <select
            aria-label="Сфера закупки"
            value={calc.chosen ? scenario.id : ''}
            onChange={(e) => onChange({ ...data, scenario: e.target.value || undefined })}
            className={`${inputClass} min-w-0 flex-1 sm:w-auto sm:flex-none`}
          >
            <option value="">Определить по предмету</option>
            {SCENARIO_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {calc.chosen ? 'Выбрана вами' : 'Определена по предмету закупки'}: {scenario.title}
          <HelpTip align="start" content={scenario.applies} />
        </span>
      </div>

      <ul className="space-y-1.5">
        {scenario.methods.map((m, i) => (
          <li key={`${m.id}-${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-[12px]">
            <Badge tone={m.role === 'основной' ? 'info' : 'neutral'}>{m.role}</Badge>
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium">{METHOD_LABELS[m.id]}.</span>{' '}
              <span className="inline-block align-middle">
                <HelpTip align="start" content={m.why} />
              </span>
            </span>
          </li>
        ))}
      </ul>

      {scenario.caution && (
        <p className="flex items-start gap-1.5 rounded-md bg-warn-surface px-2.5 py-2 text-[12px] text-warn-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{scenario.caution}</span>
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
        <Tile title="РИЦ по методу" value={calc.base !== null ? rub(calc.base) : '—'} hint={calc.base !== null ? 'Из цен-аналогов, без поправок' : 'Появится, когда цены есть по всем позициям'} badge="own" />
        <Tile
          title="РИЦ с поправками"
          value={calc.adjusted !== null ? rub(calc.adjusted) : '—'}
          hint={calc.adjusted !== null ? `Поправок учтено: ${calc.adjustments.filter((a) => a.counted).length}` : 'После РИЦ по методу'}
          badge="own"
        />
        <Tile
          title="С учётом отраслевых рисков"
          value={calc.withRisks !== null ? rub(calc.withRisks) : '—'}
          hint={calc.withRisks !== null ? `Резерв: ${rub(calc.reserve ?? 0)}. Для вашего расчёта цены, не рыночный ориентир` : 'После РИЦ по методу'}
          badge="estimate"
        />
      </div>
      {calc.deviation && (
        <p className="text-[12px] text-muted-foreground">
          Начальная цена заказчика {calc.deviation.abs >= 0 ? 'выше' : 'ниже'} РИЦ с поправками на {rub(Math.abs(calc.deviation.abs))} ({pct(Math.abs(calc.deviation.pct))}).
        </p>
      )}

      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">Как считается и на что опирается</summary>
        <div className="mt-2 space-y-3">
          <ol className="list-decimal space-y-1 pl-5">
            {scenario.steps.map((step) => (
              <li key={step} className="break-words">
                {step}
              </li>
            ))}
          </ol>
          <ul className="space-y-2">
            {scenario.basis.map((b) => (
              <li key={b.what} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words font-medium">{b.what}</span>
                  <Badge tone={b.source === 'external' ? 'warn' : b.source === 'documents' ? 'success' : 'info'} wrap>
                    {SOURCE_LABELS[b.source]}
                  </Badge>
                </div>
                <p className="mt-1 break-words text-muted-foreground">{b.note}</p>
              </li>
            ))}
          </ul>
          <p className="font-medium">Правовая основа</p>
          <ul className="-mt-2 space-y-0.5 text-muted-foreground">
            {scenario.legal.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details className="text-[12px]" open={calc.adjustments.some((a) => a.counted || a.reason !== null)}>
        <summary className="cursor-pointer text-muted-foreground">Поправки на условия вашей закупки</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">% — от РИЦ по методу, ₽ — как есть ({vat}). Без числа и основания не считается.</p>
          <ul className="space-y-2">
            {scenario.adjustments.map((def) => {
              const applied = calc.adjustments.find((a) => a.id === def.id)!;
              return <Row key={def.id} applied={applied} hint={def.hint} entry={entries.get(def.id)} unit={def.unit} vat={vat} onPatch={(change) => patch(def.id, change)} />;
            })}
            {customs.map((applied) => {
              const entry = entries.get(applied.id);
              return (
                <Row
                  key={applied.id}
                  custom
                  applied={{ ...applied, label: entry?.label || 'Своя поправка' }}
                  hint=""
                  entry={entry}
                  unit={entry?.unit ?? 'rub'}
                  vat={vat}
                  onPatch={(change) => patch(applied.id, change, true)}
                  onRemove={() => remove(applied.id)}
                />
              );
            })}
          </ul>
          <Button size="sm" variant="secondary" onClick={() => write([...(data.adjustments ?? []), { id: newId(), label: '', unit: 'rub', value: '', basis: '' }])}>
            <Plus className="size-3.5" />
            Добавить свою поправку
          </Button>
        </div>
      </details>

      <details className="text-[12px]" open={calc.risks.some((a) => a.counted || a.reason !== null)}>
        <summary className="cursor-pointer text-muted-foreground">Отраслевые риски и резерв на них: {scenario.risks.length}</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">Резерв: % — от РИЦ с поправками, ₽ — как есть. Пусто — риск не считается.</p>
          <ul className="space-y-2">
            {scenario.risks.map((def) => {
              const applied = calc.risks.find((a) => a.id === def.id)!;
              return <Row key={def.id} applied={applied} hint={`${def.effect} Что запросить: ${def.ask}`} entry={entries.get(`risk-${def.id}`)} unit={def.unit} vat={vat} onPatch={(change) => patch(`risk-${def.id}`, change)} />;
            })}
          </ul>
        </div>
      </details>

      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">Что нужно для надёжного расчёта</summary>
        <ul className="mt-2 space-y-1">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-1.5">
              {c.ok === true ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : c.ok === false ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn-foreground" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
              <span className="break-words">{c.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
