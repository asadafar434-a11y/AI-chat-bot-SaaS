import type { EconResult } from '@/lib/economics';
import type { RegisterData } from '@/lib/hidden-costs';
import { AlertTriangle, CheckCircle2 } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { Frame, frameBody, frameHead } from './Frame';
import { HelpTip } from './ui';

// «Какую цену ставить»: три сценария и три цены — не ниже, безопасная, целевая (lib/economics.ts). Налог и обеспечение — из расчёта шага «Цена», сверху риски по договору.
// Затраты вводит участник (здесь или на шаге «Цена»): своих цифр у программы нет. Метка «Оценка»: результат зависит от допущений, которые видно и можно поменять.

export type EconomicsProps = {
  result: EconResult;
  nmck: number | null;
  priceNote: string;
  /** Затраты и налог уже введены на шаге «Цена»: поле в этом блоке пустое, значит берутся оттуда. */
  fromStep: { costs: number | null; extra: number | null; taxPct: number | null };
  targetMarginPct: number;
  data: RegisterData;
  onChange: (next: RegisterData) => void;
  /** Внутри раскрывающегося раздела: без карточки и названия. */
  embedded?: boolean;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;
const clean = (s: string) => s.replace(/[  ]/g, ' ');
const rub = (n: number) => clean(`${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`).replace('-', '−');
const pct = (n: number) => clean(`${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`).replace('-', '−');
const dropOf = (price: number, nmck: number) => ((1 - price / nmck) * 100);
const stepText = (n: number | null) => (n === null ? '0,00' : `из шага «Цена»: ${clean(n.toLocaleString('ru-RU'))}`);

const SCENARIOS = [
  { key: 'optimistic', label: 'Оптимистичный', hint: 'Затраты ниже, гарантийных поломок нет, неустоек нет.' },
  { key: 'base', label: 'Базовый', hint: 'Ваши затраты, проценты за деньги до оплаты, обеспечение, гарантийный резерв.' },
  { key: 'stress', label: 'Стрессовый', hint: 'Затраты выросли, гарантийный резерв вдвое, одна неустойка по договору.' },
] as const;

export function Economics({ result, nmck, priceNote, fromStep, targetMarginPct, data, onChange, embedded }: EconomicsProps) {
  const e = data.econ;
  const set = (patch: Partial<RegisterData['econ']>) => onChange({ ...data, econ: { ...e, ...patch } });
  return (
    <Frame embedded={embedded}>
      <div className={frameHead(embedded)}>
        {!embedded && <span className="text-sm font-medium">Какую цену ставить</span>}
        <HelpTip
          align="start"
          content="Три сценария (оптимистичный, базовый, стрессовый) и три цены: не ниже (дальше базовый сценарий в убытке), безопасная (выдержит стрессовый) и целевая (даёт нужную маржу). Налог и обеспечение считаются так же, как на шаге «Цена»; сверху — риски из договора. Затраты вводите вы."
        />
        <CertaintyBadge kind="estimate" />
      </div>
      <div className={frameBody(embedded)}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-[12px]">
            <span className="mb-1 block text-muted-foreground">Затраты на исполнение, ₽</span>
            <input type="text" inputMode="decimal" placeholder={stepText(fromStep.costs)} value={e.costs} onChange={(ev) => set({ costs: ev.target.value })} className={numClass} />
          </label>
          <label className="block text-[12px]">
            <span className="mb-1 block text-muted-foreground">Расходы на участие, ₽</span>
            <input type="text" inputMode="decimal" placeholder={stepText(fromStep.extra)} value={e.extra} onChange={(ev) => set({ extra: ev.target.value })} className={numClass} />
          </label>
          <label className="block text-[12px]">
            <span className="mb-1 block text-muted-foreground">Налог с выручки, %</span>
            <input type="text" inputMode="decimal" placeholder={stepText(fromStep.taxPct)} value={e.taxPct} onChange={(ev) => set({ taxPct: ev.target.value })} className={numClass} />
          </label>
        </div>

        {!result.ready ? (
          <p className="text-muted-foreground">
            {result.reason === 'nmck'
              ? 'Начальная цена в документах не найдена — цену посчитать не от чего.'
              : 'Введите свои затраты на исполнение — без них цену не посчитать. Их же можно ввести на шаге «Цена». Своих цифр у программы нет.'}
          </p>
        ) : (
          <>
            <Verdict result={result} nmck={nmck ?? result.nmck} targetMarginPct={targetMarginPct} />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <PriceTile title="Не ниже" hint="Ниже этой цены базовый сценарий уходит в убыток" price={result.min} nmck={result.nmck} />
              <PriceTile title="Безопасная" hint="Ниже неё в убыток уходит стрессовый сценарий" price={result.safe} nmck={result.nmck} />
              <PriceTile title="Целевая" hint={`Маржа ${pct(targetMarginPct)} в базовом сценарии`} price={result.target} nmck={result.nmck} strong />
            </div>

            <p className="pb-1 text-[12px] text-muted-foreground">
              Прибыль по сценариям при {priceNote} {rub(result.price)}
            </p>
            <div className="overflow-x-auto">
              <table aria-label="Прибыль по сценариям" className="w-full min-w-[22rem] border-collapse text-[12px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    {SCENARIOS.map((s) => (
                      <th key={s.key} title={s.hint} className="border-b border-border px-2 py-1.5 font-medium">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {SCENARIOS.map((s) => {
                      const r = result.scenarios[s.key];
                      return (
                        <td key={s.key} className={`px-2 py-2 align-top ${r.profit < 0 ? 'text-danger' : ''}`}>
                          <span className="block font-mono text-[13px] font-semibold">{rub(r.profit)}</span>
                          <span className="block text-muted-foreground">маржа {pct(r.margin)}</span>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground">Снижение цены: что будет с прибылью</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[22rem] border-collapse">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="border-b border-border px-2 py-1.5 font-medium">Снижение</th>
                      <th className="border-b border-border px-2 py-1.5 text-right font-medium">Цена</th>
                      <th className="border-b border-border px-2 py-1.5 text-right font-medium">Базовый</th>
                      <th className="border-b border-border px-2 py-1.5 text-right font-medium">Стрессовый</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.table.map((t) => (
                      <tr key={t.drop} className="border-t border-border">
                        <td className="px-2 py-1">{t.drop} %</td>
                        <td className="px-2 py-1 text-right font-mono">{rub(t.price)}</td>
                        <td className={`px-2 py-1 text-right font-mono ${t.base < 0 ? 'text-danger' : ''}`}>{rub(t.base)}</td>
                        <td className={`px-2 py-1 text-right font-mono ${t.stress < 0 ? 'text-danger' : ''}`}>{rub(t.stress)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground">Как посчитано</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {result.scenarios.base.lines.map((l) => (
                  <li key={l.label}>
                    {l.label}: {rub(l.amount)}
                  </li>
                ))}
                <li>Прибыль = цена − все эти статьи. В стрессе затраты выросли{result.growthApplied ? '' : ' (договор допускает индексацию цены — рост затрат не берётся)'}, гарантийный резерв вдвое{result.penaltyUsed ? `, плюс одна неустойка: ${result.penaltyUsed}` : ''}.</li>
                <li>Налог и обеспечение исполнения — по тем же правилам, что на шаге «Цена»; проценты за деньги, гарантия и резерв — допущения выше (можно поменять).</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </Frame>
  );
}

function PriceTile({ title, hint, price, nmck, strong }: { title: string; hint: string; price: number | null; nmck: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${strong ? 'border-foreground/40 bg-secondary/50' : 'border-border'}`} title={hint}>
      <p className="text-[12px] text-muted-foreground">{title}</p>
      {price === null ? (
        <p className="text-[13px] text-muted-foreground">не достижима</p>
      ) : (
        <>
          <p className="font-mono text-[14px] font-semibold">{rub(price)}</p>
          <p className="text-[11px] text-muted-foreground">{pct(dropOf(price, nmck))} от начальной</p>
        </>
      )}
    </div>
  );
}

function Verdict({ result, nmck, targetMarginPct }: { result: Extract<EconResult, { ready: true }>; nmck: number; targetMarginPct: number }) {
  const atNmck = result.table[0];
  if (result.min === null) {
    return (
      <p className="flex items-start gap-1.5 text-danger">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Даже по начальной цене ({rub(nmck)}) контракт убыточный на ваших затратах: прибыль {rub(atNmck.base)}. Участвовать не стоит, пока затраты не снизятся.
      </p>
    );
  }
  if (result.target === null) {
    return (
      <p className="flex items-start gap-1.5 text-warn-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Целевая маржа {pct(targetMarginPct)} недостижима даже по начальной цене: прибыль {rub(atNmck.base)} ({pct((atNmck.base / nmck) * 100)}). Ниже {rub(result.min)} — убыток.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5">
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
      <span>
        Ставьте не ниже <span className="font-mono font-semibold">{rub(result.target)}</span> ({pct(dropOf(result.target, nmck))} от начальной): маржа {pct(targetMarginPct)} в базовом сценарии.
        {result.safe !== null && result.safe > result.target && <> Чтобы выдержать стресс — не ниже {rub(result.safe)}.</>}
      </span>
    </p>
  );
}
