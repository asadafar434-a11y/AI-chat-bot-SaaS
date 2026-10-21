import type { Driver, HypothesisView, RegisterData } from '@/lib/hidden-costs';
import type { Assumptions, EstimateResult } from '@/lib/risk-estimate';
import type { SensitivityResult } from '@/lib/sensitivity';
import { AlertTriangle, Info, Plus, Trash2 } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Frame, frameBody, frameHead } from './Frame';
import { Badge, Button, HelpTip, IconButton } from './ui';

// «Сколько это может стоить по этому контракту»: программа сама считает риски в рублях по условиям договора и типовым допущениям (lib/risk-estimate.ts) — участнику не нужно ничего отмечать.
// Метка «Оценка»: сумма зависит от допущений, которые видно и можно поменять. Чего без данных не посчитать (ремонт, тариф перевозчика), так и сказано — число не выдумывается.

export type RiskEstimatesProps = {
  result: EstimateResult;
  /** Цена, от которой считалось, и откуда она: «цена вашей заявки» или «начальная цена». */
  price: number | null;
  priceNote: string;
  /** Гипотезы каталога по виду закупки: те, у которых нет суммы, показываются списком. */
  hypotheses: HypothesisView[];
  data: RegisterData;
  sens: SensitivityResult;
  defaultDrivers: string[];
  priceHint: string;
  onChange: (next: RegisterData) => void;
  /** Внутри раскрывающегося раздела: без карточки и названия. */
  embedded?: boolean;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;
const rub = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`.replace(/[  ]/g, ' ');
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`.replace(/[  ]/g, ' ');
const signed = (n: number) => (n >= 0 ? '+' : '−');
const newId = () => `d-${Math.random().toString(36).slice(2, 9)}`;

// Гипотезы каталога, по которым сумма уже посчитана выше: второй раз их не показываем.
const COVERED = new Set(['cashgap', 'guarantee', 'penalties', 'price-growth', 'warranty', 'region']);

const ASSUMPTIONS: { key: keyof Assumptions; label: string; hint?: string }[] = [
  { key: 'financeRatePct', label: 'Стоимость денег, % годовых', hint: 'По умолчанию — ключевая ставка Банка России 14 % (на 21.10.2026). Кредит бывает дороже.' },
  { key: 'guaranteeRatePct', label: 'Банковская гарантия, % годовых', hint: 'Рынок примерно 1–5 %; точно скажет банк.' },
  { key: 'delayDays', label: 'Просрочка по вашей вине, дней' },
  { key: 'costSharePct', label: 'Доля затрат в цене, %' },
  { key: 'growthPct', label: 'Рост затрат за срок, %' },
  { key: 'warrantyPct', label: 'Гарантийный резерв, % цены' },
  { key: 'keyRatePct', label: 'Ключевая ставка, % (для пени 1/300)' },
  { key: 'targetMarginPct', label: 'Целевая маржа, % цены', hint: 'От неё считается целевая цена заявки.' },
  { key: 'optimisticPct', label: 'Оптимистичный сценарий: затраты ниже на, %' },
];

function AssumptionsEditor({ data, onChange }: Pick<RiskEstimatesProps, 'data' | 'onChange'>) {
  const set = (key: keyof Assumptions, text: string) => {
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) return;
    onChange({ ...data, assumptions: { ...data.assumptions, [key]: n } });
  };
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">Допущения расчёта — можно поменять</summary>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ASSUMPTIONS.map((a) => (
          <label key={a.key} className="block" title={a.hint}>
            <span className="mb-1 block text-muted-foreground">{a.label}</span>
            <input type="text" inputMode="decimal" value={String(data.assumptions[a.key])} onChange={(e) => set(a.key, e.target.value)} className={numClass} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-muted-foreground">Это типовые допущения, а не факты о вашей компании. Чем точнее вы их поставите, тем точнее суммы.</p>
    </details>
  );
}

function Sensitivity({ data, sens, defaultDrivers, priceHint, onChange, total }: Pick<RiskEstimatesProps, 'data' | 'sens' | 'defaultDrivers' | 'priceHint' | 'onChange'> & { total: number }) {
  const s = data.sens;
  const set = (patch: Partial<RegisterData['sens']>) => onChange({ ...data, sens: { ...s, ...patch } });
  const patchDriver = (id: string, patch: Partial<Driver>) => set({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">Проверить на своих цифрах: хватит ли прибыли</summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Цена контракта, ₽</span>
            <input type="text" inputMode="decimal" placeholder={priceHint} value={s.price} onChange={(e) => set({ price: e.target.value })} className={numClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Все ваши затраты на контракт, ₽</span>
            <input type="text" inputMode="decimal" placeholder="0,00" value={s.cost} onChange={(e) => set({ cost: e.target.value })} className={numClass} />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground">Статьи затрат: сколько рублей они занимают и на сколько процентов могут вырасти (например, топливо +10 %). Сумма статей не больше всех затрат.</p>
          {s.drivers.map((d) => (
            <div key={d.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_1.75rem] items-center gap-2">
              <input type="text" aria-label="Название статьи" placeholder="Название статьи" value={d.name} onChange={(e) => patchDriver(d.id, { name: e.target.value })} className={inputClass} />
              <input type="text" inputMode="decimal" aria-label={`Сумма статьи: ${d.name || 'без названия'}`} placeholder="₽" value={d.amount} onChange={(e) => patchDriver(d.id, { amount: e.target.value })} className={numClass} />
              <input type="text" inputMode="decimal" aria-label={`Рост статьи, %: ${d.name || 'без названия'}`} placeholder="+ %" value={d.shock} onChange={(e) => patchDriver(d.id, { shock: e.target.value })} className={numClass} />
              <IconButton label="Убрать статью" onClick={() => set({ drivers: s.drivers.filter((x) => x.id !== d.id) })}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => set({ drivers: [...s.drivers, { id: newId(), name: '', amount: '', shock: '10' }] })}>
              <Plus className="size-3.5" />
              Добавить статью
            </Button>
            {s.drivers.length === 0 && (
              <Button size="sm" variant="ghost" onClick={() => set({ drivers: defaultDrivers.map((name) => ({ id: newId(), name, amount: '', shock: '10' })) })}>
                Подставить типовые статьи
              </Button>
            )}
          </div>
        </div>

        {!sens.ready ? (
          <p className="text-muted-foreground">Введите цену контракта и свои затраты — программа сравнит прибыль с рисками. Своих цифр у программы нет.</p>
        ) : (
          <div className="space-y-1.5 rounded-md bg-secondary/40 px-3 py-2.5">
            <p>
              Прибыль на ваших цифрах: <span className="font-mono font-medium">{rub(sens.margin!)}</span> ({pct(sens.marginPct!)}).{' '}
              {sens.margin! <= 0 ? (
                <span className="text-danger">Контракт убыточный уже на ваших цифрах.</span>
              ) : (
                <>
                  Затраты могут вырасти на <span className="font-medium">{pct(sens.reserve!)}</span>, пока прибыль не станет нулевой.
                </>
              )}
            </p>
            {total > 0 && sens.margin! > 0 && (
              <p className={total > sens.margin! ? 'font-medium text-danger' : ''}>
                Если сработают все оценённые риски (<span className="font-mono">{rub(total)}</span>), {total > sens.margin! ? 'прибыли не хватит: контракт уйдёт в убыток.' : `прибыль останется ${rub(sens.margin! - total)}.`}
              </p>
            )}
            {sens.rows.map((r) => (
              <p key={r.id}>
                {r.name}: {signed(r.delta)}
                {rub(Math.abs(r.delta))} → прибыль <span className="font-mono">{rub(r.margin)}</span> ({pct(r.marginPct)})
              </p>
            ))}
            {sens.total && sens.rows.length > 1 && (
              <p className="font-medium">
                Если сработают все статьи: {signed(sens.total.delta)}
                {rub(Math.abs(sens.total.delta))} → прибыль <span className="font-mono">{rub(sens.total.margin)}</span> ({pct(sens.total.marginPct)})
              </p>
            )}
          </div>
        )}
        {sens.problems.map((p) => (
          <p key={p} className="flex items-start gap-1.5 text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {p}
          </p>
        ))}
      </div>
    </details>
  );
}

export function RiskEstimates({ result, price, priceNote, hypotheses, data, sens, defaultDrivers, priceHint, onChange, embedded }: RiskEstimatesProps) {
  const rest = hypotheses.filter((h) => !COVERED.has(h.id));
  const sorted = [...result.items].sort((a, b) => (a.amount === null ? 1 : 0) - (b.amount === null ? 1 : 0) || (b.amount ?? 0) - (a.amount ?? 0));
  return (
    <Frame embedded={embedded}>
      <div className={frameHead(embedded)}>
        {!embedded && <span className="text-sm font-medium">Сколько это может стоить по этому контракту</span>}
        <HelpTip
          align="start"
          content="Программа сама считает риски в рублях: условия договора (пеня, срок оплаты, обеспечение, твёрдая цена) плюс типовые допущения (ставка кредита, банковская гарантия, гарантийный резерв). Допущения видны и меняются. Чего без данных не посчитать (ремонт, тариф перевозчика), так и написано — числа не выдумываются."
        />
        <CertaintyBadge kind="estimate" />
      </div>
      <div className={frameBody(embedded)}>
        {price === null ? (
          <p className="text-muted-foreground">Цена контракта не найдена в документах, поэтому оценить в рублях нечего. Укажите цену на шаге «Цена» закупки.</p>
        ) : (
          <>
            <div>
              <p className="text-[12px] text-muted-foreground">Если сработают все риски с оценкой ({priceNote} {rub(price)})</p>
              <p className="font-mono text-lg font-semibold">
                {result.total > 0 ? rub(result.total) : '—'}
                {result.totalPct !== null && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{pct(result.totalPct)} цены</span>}
              </p>
              {result.unknown > 0 && <p className="text-[12px] text-muted-foreground">Ещё {result.unknown} без суммы: нужны данные (цена эксперта, тариф перевозчика).</p>}
            </div>
            {sorted.length === 0 ? (
              <p className="text-muted-foreground">В договоре не нашёл условий, по которым можно посчитать (пеня, срок оплаты, обеспечение, твёрдая цена). Это не значит, что рисков нет.</p>
            ) : (
              <ul className="space-y-2">
                {sorted.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 flex-1 break-words text-[13px] font-medium">{e.title}</p>
                      {e.amount !== null ? (
                        <p className="font-mono text-[13px] font-semibold">
                          {rub(e.amount)} <span className="font-normal text-muted-foreground">· {pct(e.pct!)}</span>
                        </p>
                      ) : (
                        <Badge tone="neutral">сумма не определена</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 break-words text-muted-foreground">{e.scenario}</p>
                    {e.ask && <p className="mt-0.5 text-muted-foreground">{e.ask}.</p>}
                    {e.amount !== null && !e.inTotal && <p className="mt-0.5 text-muted-foreground">В итог не входит: это не потеря, а возможное изменение объёма.</p>}
                  </li>
                ))}
              </ul>
            )}
            {sorted.length > 0 && (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted-foreground">На чём держатся числа</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {sorted.map((e) => (
                    <li key={e.id} className="break-words">
                      {e.title}: {e.basis}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <AssumptionsEditor data={data} onChange={onChange} />
        <Sensitivity data={data} sens={sens} defaultDrivers={defaultDrivers} priceHint={priceHint} onChange={onChange} total={result.total} />
        {rest.length > 0 && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted-foreground">Ещё риски для такой закупки без оценки: {rest.length}</summary>
            <ul className="mt-2 space-y-1.5">
              {rest.map((h) => (
                <li key={h.id} className="break-words">
                  <span className="flex items-start gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="font-medium">{h.title}.</span> <span className="text-muted-foreground">{h.check}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">Сумму по ним посчитает ИИ с российским поиском, когда их подключат; сейчас данных для числа нет.</p>
          </details>
        )}
      </div>
    </Frame>
  );
}
