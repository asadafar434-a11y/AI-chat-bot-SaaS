import { useMemo, useState } from 'react';
import { TrendingDown, Info, ChevronDown, AlertTriangle, CheckCircle2 } from '../lib/icons';
import { Button, Card, HelpTip, Tooltip, cx } from './ui';
import { costDefaults, priceRows, tender, rub } from '../lib/data';
import { priceFloor, type PriceCalc } from '../lib/price-floor';

const MAX = 30; // шкала ползунка, % снижения
const ANTI_DUMPING = 25; // ч. 1–2 ст. 37 44-ФЗ

// Где на дорожке значение: центр бегунка ходит от 12 px до «ширина − 12 px».
const at_ = (value: number) => `calc(12px + (100% - 24px) * ${Math.min(value, MAX) / MAX})`;

const pctText = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;

export function StepPricing({
  discount,
  setDiscount,
  onNext,
  onBack,
}: {
  discount: number;
  setDiscount: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [costs, setCosts] = useState(costDefaults);
  const [showCosts, setShowCosts] = useState(false);

  const nmck = priceRows.reduce((s, r) => s + r.nmc * r.qty, 0);
  const price = Math.round((nmck * (100 - discount)) / 100);

  // «До какой цены снижаться» — тот же расчёт, что в приложении (web/src/lib/price-floor.ts), без ИИ.
  const { floor, at } = useMemo(() => {
    const calc: PriceCalc = {
      nmck,
      costs: costs.costs,
      extra: costs.extra,
      taxPct: costs.taxPct,
      securityPct: tender.performancePct,
      smeOnly: false,
      exempt: false,
      method: 'guarantee',
      guaranteeRatePct: costs.guaranteeRatePct,
      moneyRatePct: null,
      days: costs.days,
      antiDumping: true,
      goodFaith: false,
      price: null,
    };
    return priceFloor(calc);
  }, [nmck, costs]);

  const floorPrice = floor.ok ? floor.price : null;
  const floorDrop = floorPrice ? Math.max(0, (1 - floorPrice / nmck) * 100) : null;
  const here = at(price);
  const profit = here?.profit ?? null;
  const loss = profit !== null && profit < 0;

  const set = (key: keyof typeof costDefaults) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCosts((c) => ({ ...c, [key]: Number(e.target.value.replace(/\s/g, '').replace(',', '.')) || 0 }));

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Цена</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          На аукционе цену подают во время торгов (ч. 2 ст. 49 44-ФЗ). Здесь — до какой цены можно снижаться, чтобы
          контракт не ушёл в убыток. Расчёт по вашим расходам, без ИИ.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Позиция</th>
                <th className="px-4 py-2.5 text-right font-medium">Кол-во</th>
                <th className="px-4 py-2.5 text-right font-medium">НМЦ / ед.</th>
                <th className="px-4 py-2.5 text-right font-medium">Наша / ед.</th>
              </tr>
            </thead>
            <tbody>
              {priceRows.map((r) => {
                const our = Math.round((r.nmc * (100 - discount)) / 100);
                return (
                  <tr key={r.position} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{r.position}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{r.qty}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                      {rub(r.nmc)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{rub(our)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Ползунок снижения */}
        <Card className="p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <label htmlFor="drop" className="flex items-center gap-1.5 text-sm font-medium">
                Снижение от НМЦК
                <HelpTip content="НМЦК — начальная (максимальная) цена контракта. Двигайте ползунок: справа от отметки «нижняя цена» контракт в убыток." />
              </label>
              <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">ваша цена {rub(price)}</p>
            </div>
            <span
              className={cx(
                'rounded-lg px-2.5 py-1 font-mono text-2xl font-semibold tabular-nums',
                loss ? 'bg-danger/10 text-danger' : 'bg-secondary text-foreground',
              )}
            >
              −{pctText(discount)}
            </span>
          </div>

          <input
            id="drop"
            type="range"
            min={0}
            max={MAX}
            step={0.5}
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            className="price-range mt-5"
            style={{ '--fill': at_(discount), '--floor': at_(floorDrop ?? MAX) } as React.CSSProperties}
          />

          {/* Отметки под дорожкой: нижняя цена и антидемпинг. Позиция — по центру бегунка (24 px). */}
          <div className="relative mt-1 h-9 font-mono text-[11px] text-muted-foreground">
            <span className="absolute left-0 top-0">0%</span>
            {floorDrop !== null && floorDrop < MAX && (
              <div className="absolute top-0 -translate-x-1/2" style={{ left: at_(floorDrop) }}>
                <Tooltip content={`Нижняя цена ${rub(floorPrice!)}: ниже — расходы и налог больше выручки.`} side="bottom">
                  <span className="flex cursor-help flex-col items-center whitespace-nowrap font-medium text-foreground">
                    <span className="h-2 w-px bg-foreground" />
                    предел −{pctText(floorDrop)}
                  </span>
                </Tooltip>
              </div>
            )}
            <div className="absolute top-0 -translate-x-1/2" style={{ left: at_(ANTI_DUMPING) }}>
              <Tooltip content="Снижение на 25% и больше — антидемпинговые меры ст. 37 44-ФЗ." side="bottom" align="end">
                <span className="flex cursor-help flex-col items-center whitespace-nowrap text-danger">
                  <span className="h-2 w-px bg-danger" />
                  25%
                </span>
              </Tooltip>
            </div>
            <span className="absolute right-0 top-0">30%</span>
          </div>

          <div className="mt-3 space-y-2.5 text-sm">
            <Row label="НМЦК" value={rub(nmck)} muted />
            <Row label="Ваше предложение" value={rub(price)} strong />
            <Row
              label="Экономия для заказчика"
              value={
                <span className="inline-flex items-center gap-1 text-success">
                  <TrendingDown className="size-3.5" /> {rub(nmck - price)}
                </span>
              }
            />
          </div>

          {discount >= ANTI_DUMPING && (
            <p className="mt-4 flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-2 text-[12px] leading-snug text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Снижение на 25% и больше — антидемпинговые меры: обеспечение исполнения в 1,5 раза больше (не меньше
              10%) или сведения о добросовестности (ч. 1–3 ст. 37 44-ФЗ).
            </p>
          )}
        </Card>

        {/* До какой цены снижаться — вместо «вероятности победы»: её нечем честно посчитать */}
        <Card className="flex flex-col p-5">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            До какой цены снижаться
            <HelpTip
              content="Самая низкая цена без убытка: ваши расходы, налог с выручки и стоимость обеспечения исполнения. С антидемпингом — с повышенным обеспечением."
              align="end"
            />
          </p>
          {floorPrice ? (
            <>
              <p className="mt-3 font-mono text-3xl font-semibold tabular-nums">{rub(floorPrice)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                нижняя цена · −{pctText(floorDrop!)} от НМЦК
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Впишите расходы — посчитаем нижнюю цену.</p>
          )}

          {profit !== null && (
            <div
              className={cx(
                'mt-4 flex items-start gap-2 rounded-md px-3 py-2 text-[13px]',
                loss ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
              )}
            >
              {loss ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
              <span>
                {loss ? 'Убыток при вашей цене: ' : 'Прибыль при вашей цене: '}
                <span className="font-mono font-semibold tabular-nums">{rub(Math.abs(profit))}</span>
              </span>
            </div>
          )}

          <button
            onClick={() => setShowCosts(!showCosts)}
            className="mt-4 flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-secondary"
          >
            Мои расходы
            <ChevronDown className={cx('size-4 text-muted-foreground transition-transform', showCosts && 'rotate-180')} />
          </button>
          {showCosts && (
            <div className="animate-fade-up mt-3 grid grid-cols-2 gap-2.5">
              <Field label="Закупка товара, ₽" value={costs.costs} onChange={set('costs')} hint="Сколько вы платите поставщикам за весь товар." />
              <Field label="Доставка и прочее, ₽" value={costs.extra} onChange={set('extra')} hint="Доставка, сборка, расходы на участие." />
              <Field label="Налог с выручки, %" value={costs.taxPct} onChange={set('taxPct')} hint="Например, 6% на УСН «Доходы»." />
              <Field label="Гарантия, % годовых" value={costs.guaranteeRatePct} onChange={set('guaranteeRatePct')} hint="Комиссия банка за независимую гарантию исполнения." />
              <Field label="Срок исполнения, дней" value={costs.days} onChange={set('days')} hint="Сколько дней действует обеспечение исполнения." />
            </div>
          )}

          <div className="mt-auto space-y-1 pt-4 font-mono text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1">
              Обеспечение заявки: {rub(tender.security)} ({tender.securityPct}% НМЦК)
              <HelpTip content="По ч. 2 ст. 44 44-ФЗ при НМЦК до 20 млн — от 0,5 до 1% НМЦК. Блокируется на спецсчёте до итогов." align="end" />
            </p>
            <p>Обеспечение исполнения: {tender.performancePct}% НМЦК — из извещения</p>
          </div>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Вероятность победы не показываем: без истории торгов заказчика её нечем честно посчитать.
      </p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext}>Проверить заявку →</Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hint: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
      <span className="flex items-center gap-1">
        {label}
        <HelpTip content={hint} />
      </span>
      <input
        inputMode="decimal"
        value={value.toLocaleString('ru-RU')}
        onChange={onChange}
        className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
      />
    </label>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
      <span
        className={`font-mono tabular-nums ${strong ? 'text-base font-semibold' : muted ? 'text-muted-foreground' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
