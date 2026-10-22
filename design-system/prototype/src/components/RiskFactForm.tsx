import { ExternalLink, Trash2 } from '../lib/icons';
import { EMPTY_FACT, FACT_HYPOTHESES, riskFactAmount, type RiskFact } from '@/lib/risk-facts';
import { IconButton } from './ui';

// Отраслевой риск по найденному факту: затраты по статье × рост цен. Процент — из выдержки поиска (кнопка «взять» у числа) или свой; затраты вписывает участник.
// Источник, ссылка и выдержка остаются рядом с суммой (lib/risk-facts.ts): число не выдумано и не выбрано программой за вас. Метка «Не проверено» — выдержку из поиска никто не перепроверял.

export type RiskFactFormProps = {
  hypothesisId: string;
  fact: RiskFact | undefined;
  /** Цена, от которой показывается доля, ₽. Нет — доли нет. */
  price: number | null;
  onChange: (next: RiskFact | null) => void;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-right font-mono text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const ru = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');

export function RiskFactForm({ hypothesisId, fact, price, onChange }: RiskFactFormProps) {
  const cfg = FACT_HYPOTHESES[hypothesisId];
  if (!cfg) return null;
  const f = fact ?? EMPTY_FACT;
  const set = (patch: Partial<RiskFact>) => {
    const next = { ...f, ...patch };
    onChange(next.base.trim() === '' && next.pct.trim() === '' ? null : next);
  };
  const calc = riskFactAmount(f);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border px-3 py-2.5 pl-5 text-[12px]" aria-label={`Сумма по факту: ${hypothesisId}`}>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{cfg.base}</span>
          <input type="text" inputMode="decimal" value={f.base} placeholder="0" onChange={(e) => set({ base: e.target.value })} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{cfg.growth}</span>
          <input type="text" inputMode="decimal" value={f.pct} placeholder="из поиска или свой" onChange={(e) => set({ pct: e.target.value, ...(e.target.value !== f.pct && f.source ? { source: '', url: '', quote: '' } : {}) })} className={inputClass} />
        </label>
      </div>
      {calc ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-lg font-bold tabular-nums text-warn-foreground">+{ru(calc.amount)} ₽</span>
          {price !== null && price > 0 && <span className="font-semibold text-muted-foreground">{ru((calc.amount / price) * 100)} % цены</span>}
          <span className="text-muted-foreground">
            = {ru(calc.base)} ₽ × {ru(calc.pct)} %
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">Впишите затраты и процент — посчитаю в рублях.</p>
      )}
      {f.source && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span>
            Источник: <span className="font-medium text-foreground">{f.source}</span>
          </span>
          {f.url && (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
              открыть <ExternalLink className="size-3" />
            </a>
          )}
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">Не проверено</span>
        </p>
      )}
      {f.quote && <p className="break-words rounded-md bg-secondary/50 px-2.5 py-1.5 text-muted-foreground">«{f.quote}»</p>}
      {fact && (
        <div className="flex justify-end">
          <IconButton label="Убрать сумму" onClick={() => onChange(null)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
