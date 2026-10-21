import { openCount, type Driver, type HypothesisView, type RegisterData, type RegisterItem, type RegisterState } from '@/lib/hidden-costs';
import { parseAmount } from '@/lib/indicative-price';
import type { SensitivityResult } from '@/lib/sensitivity';
import { AlertTriangle, Plus, Trash2 } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Badge, Button, Card, HelpTip, IconButton } from './ui';

// «Скрытые затраты и риски»: гипотезы о том, что может стоить дороже расчёта и чего нет в документах. Подтвердить их может только расчёт, запрос цены или документ — поэтому у блока метка «Гипотеза».
// По каждой участник решает: не разобрано, учтено в цене (с суммой) или не актуально. Ниже — «что будет с прибылью, если затраты вырастут». Расчёты — lib/hidden-costs.ts, lib/sensitivity.ts.

export type HiddenCostsProps = {
  hypotheses: HypothesisView[];
  typeLabel: string;
  data: RegisterData;
  sens: SensitivityResult;
  /** Названия типовых статей затрат для таблицы чувствительности. */
  defaultDrivers: string[];
  /** Цена заявки или начальная цена — подсказка в поле цены. */
  priceHint: string;
  onChange: (next: RegisterData) => void;
};

const SHOWN = 6;
const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;
const rub = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`.replace(/[  ]/g, ' ');
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`.replace(/[  ]/g, ' ');
const signed = (n: number) => (n >= 0 ? '+' : '−');
const newId = () => `d-${Math.random().toString(36).slice(2, 9)}`;

const STATES: { value: RegisterState; label: string }[] = [
  { value: 'open', label: 'Не разобрано' },
  { value: 'priced', label: 'Учтено в цене' },
  { value: 'skip', label: 'Не актуально' },
];

function Row({ h, item, onItem }: { h: HypothesisView; item: RegisterItem; onItem: (next: RegisterItem) => void }) {
  return (
    <li className="rounded-lg border border-border px-3 py-2.5 text-[12px]">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-medium">{h.title}</p>
          <p className="mt-0.5 break-words text-muted-foreground">{h.check}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`Решение: ${h.title}`} value={item.state} onChange={(e) => onItem({ ...item, state: e.target.value as RegisterState })} className={`${inputClass} w-36`}>
            {STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {item.state === 'priced' && (
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Сумма в цене: ${h.title}`}
              placeholder="сумма, ₽"
              value={item.amount}
              onChange={(e) => onItem({ ...item, amount: e.target.value })}
              className={`${numClass} w-28`}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function Sensitivity({ data, sens, defaultDrivers, priceHint, onChange }: Pick<HiddenCostsProps, 'data' | 'sens' | 'defaultDrivers' | 'priceHint' | 'onChange'>) {
  const s = data.sens;
  const set = (patch: Partial<RegisterData['sens']>) => onChange({ ...data, sens: { ...s, ...patch } });
  const patchDriver = (id: string, patch: Partial<Driver>) => set({ drivers: s.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-sm font-medium">Что будет с прибылью, если затраты вырастут</summary>
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
          <p className="text-muted-foreground">Введите цену контракта и свои затраты — программа покажет прибыль и запас. Своих цифр у программы нет.</p>
        ) : (
          <div className="space-y-1.5 rounded-md bg-secondary/40 px-3 py-2.5">
            <p>
              Прибыль сейчас: <span className="font-mono font-medium">{rub(sens.margin!)}</span> ({pct(sens.marginPct!)}).{' '}
              {sens.margin! <= 0 ? (
                <span className="text-danger">Контракт убыточный уже на ваших цифрах.</span>
              ) : (
                <>
                  Все затраты могут вырасти на <span className="font-medium">{pct(sens.reserve!)}</span>, пока прибыль не станет нулевой.
                </>
              )}
            </p>
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

export function HiddenCosts({ hypotheses, typeLabel, data, sens, defaultDrivers, priceHint, onChange }: HiddenCostsProps) {
  const open = openCount(hypotheses, data);
  const itemOf = (id: string): RegisterItem => data.items[id] ?? { state: 'open', amount: '' };
  const setItem = (id: string, next: RegisterItem) => onChange({ ...data, items: { ...data.items, [id]: next } });
  const priced = hypotheses.reduce((sum, h) => {
    const it = itemOf(h.id);
    return it.state === 'priced' ? sum + (parseAmount(it.amount) ?? 0) : sum;
  }, 0);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-medium">Скрытые затраты и риски</span>
        <HelpTip
          align="start"
          content="Чего нет в документах, но что часто стоит дороже расчёта: доставка, повторная приёмка, рост цен, кассовый разрыв и другое — по виду закупки. Это гипотезы, а не факты: подтвердить их можно расчётом, запросом цены или документом. По каждой решите: учтено в цене, не актуально или ещё не разобрано."
        />
        <CertaintyBadge kind="hypothesis" />
        <Badge tone={open > 0 ? 'warn' : 'success'}>{open > 0 ? `не разобрано: ${open}` : 'всё разобрано'}</Badge>
      </div>
      <div className="space-y-3 px-4 py-3 text-[13px]">
        <p className="text-[12px] text-muted-foreground">Для вида «{typeLabel}».</p>
        <ul className="space-y-2">
          {hypotheses.slice(0, SHOWN).map((h) => (
            <Row key={h.id} h={h} item={itemOf(h.id)} onItem={(next) => setItem(h.id, next)} />
          ))}
        </ul>
        {hypotheses.length > SHOWN && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted-foreground">Ещё гипотез: {hypotheses.length - SHOWN}</summary>
            <ul className="mt-2 space-y-2">
              {hypotheses.slice(SHOWN).map((h) => (
                <Row key={h.id} h={h} item={itemOf(h.id)} onItem={(next) => setItem(h.id, next)} />
              ))}
            </ul>
          </details>
        )}
        {priced > 0 && <p className="text-[12px] text-muted-foreground">Учтено в цене по гипотезам: <span className="font-mono">{rub(priced)}</span>.</p>}
        <Sensitivity data={data} sens={sens} defaultDrivers={defaultDrivers} priceHint={priceHint} onChange={onChange} />
      </div>
    </Card>
  );
}
