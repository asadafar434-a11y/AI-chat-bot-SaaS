import { useState } from 'react';
import { EMPTY_DELIVERY, type DeliveryInputs, type DeliveryResult } from '@/lib/delivery-cost';
import { EMPTY_FX, FX_CURRENCIES, type FxCode, type FxResult } from '@/lib/fx-risk';
import type { RegisterData } from '@/lib/hidden-costs';
import { AlertTriangle } from '../lib/icons';
import { Button } from './ui';

// Цифры участника для сумм по фактам: доставка (расстояние найдено по документам и профилю, вписываются тариф и рейсы) и курс валюты (курс ЦБ загружается кнопкой, вписывается сумма в валюте).
// Сами суммы стоят в списке «Сколько это может стоить» выше; здесь — только то, что вводит человек, и факты, на которых держится число (lib/delivery-cost.ts, lib/fx-risk.ts).

export type FactCostsProps = {
  data: RegisterData;
  delivery: DeliveryResult;
  fx: FxResult;
  onChange: (next: RegisterData) => void;
  /** Загрузить курсы ЦБ за год: текст ошибки или null, если ряд сохранён. */
  onLoadFx: (code: FxCode) => Promise<string | null>;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;
const flat = (s: string) => s.replace(/[  ]/g, ' ');
const ru = (n: number, digits = 2) => flat(n.toLocaleString('ru-RU', { maximumFractionDigits: digits }));
const rub = (n: number) => flat(`${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`);
const pct1 = (n: number) => flat(n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const dateRu = (iso: string) => iso.split('-').reverse().join('.');

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input type="text" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={numClass} />
    </label>
  );
}

function DeliveryCard({ data, delivery, onChange }: Pick<FactCostsProps, 'data' | 'delivery' | 'onChange'>) {
  const leg = delivery.leg!;
  const d = data.delivery ?? EMPTY_DELIVERY;
  const set = (patch: Partial<DeliveryInputs>) => onChange({ ...data, delivery: { ...d, ...patch } });
  return (
    <section aria-label="Доставка" className="space-y-2.5 rounded-lg border border-border px-3 py-2.5">
      <p className="text-[13px] font-medium">
        Доставка: {leg.from.center} → {leg.to.center}
        {leg.road !== null && <span className="ml-2 font-mono font-normal text-muted-foreground">≈ {ru(leg.road, 0)} км</span>}
      </p>
      {leg.road === null ? (
        <p className="flex items-start gap-1.5 text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{leg.note} Запросите маршрут и тариф у перевозчика.</span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Чем возите">
            <Choice active={d.mode === 'carrier'} onClick={() => set({ mode: 'carrier' })}>
              Перевозчик
            </Choice>
            <Choice active={d.mode === 'own'} onClick={() => set({ mode: 'own' })}>
              Своя машина
            </Choice>
            <Choice active={d.roundTrip} onClick={() => set({ roundTrip: !d.roundTrip })}>
              Туда и обратно
            </Choice>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.mode === 'carrier' ? (
              <Field label="Тариф, ₽ за км" value={d.rate} placeholder="0" onChange={(v) => set({ rate: v })} />
            ) : (
              <>
                <Field label="Расход, л на 100 км" value={d.consumption} placeholder="0" onChange={(v) => set({ consumption: v })} />
                <Field label="Литр топлива, ₽" value={d.fuel} placeholder="0" onChange={(v) => set({ fuel: v })} />
              </>
            )}
            <Field label="Рейсов" value={d.trips} placeholder="1" onChange={(v) => set({ trips: v })} />
            <Field label="Обычно возите, км" value={d.usualKm} placeholder="не обязательно" onChange={(v) => set({ usualKm: v })} />
            <Field label="Дорога длиннее прямой в" value={d.factor} placeholder="1,3" onChange={(v) => set({ factor: v })} />
          </div>
          {delivery.cost !== null ? (
            <p className="font-mono text-[12px]">
              = {rub(delivery.cost)} <span className="font-sans text-muted-foreground">· {delivery.formula}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">Впишите: {delivery.missing.join(', ')}.</p>
          )}
        </>
      )}
    </section>
  );
}

function FxCard({ data, fx, onChange, onLoadFx }: Pick<FactCostsProps, 'data' | 'fx' | 'onChange' | 'onLoadFx'>) {
  const f = data.fx ?? EMPTY_FX;
  const cur = FX_CURRENCIES[f.code];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => onChange({ ...data, fx: { ...f, ...patch } });
  const pick = (code: FxCode) => {
    if (code === f.code) return;
    // Ряд курсов принадлежит выбранной валюте: при смене валюты прежний сбрасывается.
    setError(null);
    set({ code, series: [], fetchedAt: '' });
  };
  const load = async () => {
    setBusy(true);
    setError(null);
    const problem = await onLoadFx(f.code);
    setBusy(false);
    if (problem) setError(problem);
  };
  return (
    <section aria-label="Курс валюты" className="space-y-2.5 rounded-lg border border-border px-3 py-2.5">
      <p className="text-[13px] font-medium">Курс валюты</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Валюта">
        {(Object.keys(FX_CURRENCIES) as FxCode[]).map((code) => (
          <Choice key={code} active={f.code === code} onClick={() => pick(code)}>
            {FX_CURRENCIES[code].name}
          </Choice>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={`Закупаете, ${cur.sign}`} value={f.amount} placeholder="0" onChange={(v) => set({ amount: v })} />
        <Field label="Смотреть рост за, дней" value={f.windowDays} placeholder="90" onChange={(v) => set({ windowDays: v })} />
        <div className="flex items-end">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>
            {busy ? 'Загружаю…' : fx.last ? 'Обновить курс ЦБ' : 'Загрузить курс ЦБ'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {fx.last ? (
        <p className="text-muted-foreground">
          ЦБ на {dateRu(fx.last.date)}: <span className="font-mono text-foreground">{ru(fx.last.rate, 4)} ₽</span>
          {fx.rise && fx.windowDays && (
            <>
              {' '}
              · за год за {ru(fx.windowDays, 0)} дн. курс вырастал до <span className="font-mono text-foreground">+{pct1(fx.rise.pct)} %</span> (с {dateRu(fx.rise.from.date)} по {dateRu(fx.rise.to.date)})
            </>
          )}
        </p>
      ) : (
        <p className="text-muted-foreground">Курс загружается с сайта Банка России; уходит только выбранная валюта.</p>
      )}
      {fx.last && fx.missing.length > 0 && <p className="text-muted-foreground">Впишите: {fx.missing.join(', ')}.</p>}
    </section>
  );
}

export function FactCosts({ data, delivery, fx, onChange, onLoadFx }: FactCostsProps) {
  const needsInput = (delivery.leg !== null && delivery.leg.road !== null && delivery.cost === null) || (fx.last !== null && fx.missing.length > 0);
  // Раскрыт сразу, если без ввода сумм нет; дальше — как решил человек: блок не должен схлопываться посреди набора, когда появилась первая сумма.
  const [open, setOpen] = useState(needsInput);
  return (
    <details className="text-[12px]" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-muted-foreground">
        Свои цифры: {delivery.leg ? 'доставка и ' : ''}курс валюты
      </summary>
      <div className="mt-2 space-y-3">
        {delivery.leg && <DeliveryCard data={data} delivery={delivery} onChange={onChange} />}
        <FxCard data={data} fx={fx} onChange={onChange} onLoadFx={onLoadFx} />
      </div>
    </details>
  );
}
