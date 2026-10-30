import { useMemo, useState } from 'react';
import { TrendingDown, ChevronDown, AlertTriangle, CheckCircle2 } from '../lib/icons';
import { Button, Card, HelpTip, Tooltip, cx } from './ui';
import { isAuction, isSingleSupplier, priceIntro } from '@/lib/law-kind';
import { priceFloor, type PriceCalc } from '@/lib/price-floor';
import { splitPrice, toKop } from '@/lib/price-split';

const MAX = 99; // шкала ползунка, % снижения — закон потолок не ставит, антидемпинг свой, независимо от шкалы
const ANTI_DUMPING = 25; // ч. 1–2 ст. 37 44-ФЗ

// Где на дорожке значение: центр бегунка ходит от 12 px до «ширина − 12 px».
const at_ = (value: number) => `calc(12px + (100% - 24px) * ${Math.min(value, MAX) / MAX})`;

const pctText = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const rub = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

// Одна короткая строка под заголовком; полный вводный текст — в подсказке (решение владельца 22.10.2026: мало текста, главное — крупно и цветом).
const shortIntro = (kind?: string) => (isSingleSupplier(kind) ? 'Цену называет заказчик — сверьте со своими расходами.' : isAuction(kind) ? 'Цену подают на торгах — до какой снижаться.' : 'Цену вы называете в заявке — ниже какой не опускаться.');

// Шаг «Цена». Вид — прототипа; расчёт — тот же, что в приложении (web/src/lib/price-floor.ts), без ИИ.
// Значения — из закупки: начальная цена и обеспечение из документов, расходы вписывает участник.
// Уровни важности: 1) нижняя цена — крупно и зелёным, с прибылью или убытком при вашей цене; 2) цена заявки и снижение; 3) расходы и пояснения — тише.
export function StepPricing({
  kind,
  calc,
  set,
  tpPrice,
  onPutPrice,
  notes,
  unitSum,
  volume,
  onNext,
  onBack,
}: {
  // Способ закупки из документов («44-ФЗ · запрос котировок»): от него зависит вводный текст.
  kind?: string;
  calc: PriceCalc;
  set: (patch: Partial<PriceCalc>) => void;
  // Цена, которая сейчас стоит в заявке.
  tpPrice?: number;
  onPutPrice: (price: number) => void;
  // Что взято из документов закупки — мелким шрифтом под расходами.
  notes: string[];
  // Торг по сумме цен единиц (документы закупки): начальная сумма и цены единиц, из которых она сложена, в рублях.
  unitSum?: { start: number; parts: number[] };
  // Объём закупки из документов (детодни, человеко-часы, м², рейсы…): себестоимость вписывается на единицу, итог — единица × объём.
  volume?: { total: number; unit: string; unitOf: string; unitsLabel: string; one: 'одного' | 'одной' };
  onNext: () => void;
  onBack: () => void;
}) {
  const [showCosts, setShowCosts] = useState(() => !calc.costs);
  // Закупка у единственного поставщика: цену называет заказчик, торгов и заявки нет — ползунка снижения нет.
  const fixed = isSingleSupplier(kind);

  const nmck = calc.nmck ?? 0;
  const price = calc.price ?? null;
  const discount = price !== null && nmck > 0 ? Math.max(0, (1 - price / nmck) * 100) : 0;
  const shownPrice = price ?? nmck;
  const above = price !== null && nmck > 0 && price > nmck;

  // «До какой цены снижаться» — расчёт приложения, без ИИ.
  const { floor, at } = useMemo(() => priceFloor(calc), [calc]);

  const floorPrice = floor.ok ? floor.price : null;
  const floorDrop = floorPrice && nmck > 0 ? Math.max(0, (1 - floorPrice / nmck) * 100) : null;
  const here = shownPrice > 0 ? at(shownPrice) : null;
  const profit = here?.profit ?? null;
  const loss = profit !== null && profit < 0;

  // Сумма цен единиц при выбранном снижении и цены единиц пропорционально начальным (копейки сходятся с суммой).
  const unitBid = (() => {
    if (!unitSum || nmck <= 0) return null;
    const start = toKop(unitSum.start);
    const split = splitPrice(
      unitSum.parts.map((p, i) => ({ name: String(i), qty: 1, baseKop: toKop(p) })),
      Math.round((start * (100 - discount)) / 100),
    );
    return split && { start, total: split.totalKop, units: split.lines.map((l) => l.unitKop) };
  })();

  const setNum = (key: keyof PriceCalc) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[\s ]/g, '').replace(',', '.');
    set({ [key]: raw === '' ? null : Number(raw) || 0 } as Partial<PriceCalc>);
  };

  return (
    <div className="animate-fade-up space-y-5">
      {/* Заголовок шага и главный расчёт — одним блоком: без отдельной шапки и без лишней подписи. */}
      <Card className={cx('p-4', loss ? 'border-danger/40 bg-danger/5' : floorPrice ? 'border-success/40 bg-success/5' : '')}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Цена</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {shortIntro(kind)}
            <HelpTip align="start" content={priceIntro(kind)} />
          </p>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          {fixed ? 'Что останется вам' : 'До какой цены снижаться'}
          <HelpTip
            content={
              fixed
                ? 'Самая низкая цена без убытка: ваши расходы, налог с выручки и стоимость обеспечения исполнения. Цена заказчика выше — договор в плюс.'
                : 'Самая низкая цена без убытка: ваши расходы, налог с выручки и стоимость обеспечения исполнения. С антидемпингом — с повышенным обеспечением.'
            }
            align="start"
          />
        </p>
        {floorPrice ? (
          <>
            <p className="mt-1 break-words font-mono text-3xl font-bold tabular-nums tracking-tight text-success">{rub(floorPrice)}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              нижняя цена{floorDrop !== null && !fixed ? ` · −${pctText(floorDrop)}% от НМЦК` : ''}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm font-medium">Впишите расходы — посчитаем нижнюю цену.</p>
        )}
        {profit !== null && (
          <p className={cx('mt-3 flex flex-wrap items-center gap-x-2 text-[14px] font-semibold', loss ? 'text-danger' : 'text-success')}>
            {loss ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
            {loss ? 'Убыток при вашей цене: ' : 'Прибыль при вашей цене: '}
            <span className="font-mono text-xl font-bold tabular-nums">{rub(Math.abs(profit))}</span>
          </p>
        )}
      </Card>

      <div className="space-y-4">
        {fixed ? (
          <Card className="p-5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Цена договора</p>
            {nmck > 0 ? (
              <>
                <p className="mt-3 font-mono text-3xl font-bold tabular-nums">{rub(nmck)}</p>
                <p className="mt-1 text-xs text-muted-foreground">названа заказчиком в извещении · торгов нет</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Цена в документах не нашлась — впишите её в «Моих расходах» справа.</p>
            )}
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <label htmlFor="drop" className="flex items-center gap-1.5 text-sm font-medium">
                  Снижение от НМЦК
                  <HelpTip content="НМЦК — начальная (максимальная) цена контракта. Двигайте ползунок: справа от отметки «нижняя цена» контракт в убыток. Вероятность победы не показываем: без истории торгов заказчика её нечем честно посчитать." />
                </label>
                <p className="mt-1 break-words font-mono text-2xl font-bold tabular-nums tracking-tight">{nmck > 0 ? rub(shownPrice) : '—'}</p>
                <p className="text-[12px] text-muted-foreground">ваша цена</p>
              </div>
              <span
                className={cx(
                  'rounded-lg px-2.5 py-1 font-mono text-xl font-bold tabular-nums',
                  loss ? 'bg-danger/10 text-danger' : 'bg-secondary text-foreground',
                )}
              >
                −{pctText(discount)}%
              </span>
            </div>

            <input
              id="drop"
              type="range"
              min={0}
              max={MAX}
              step={0.5}
              value={Math.min(discount, MAX)}
              disabled={nmck <= 0}
              onChange={(e) => set({ price: Math.round((nmck * (100 - Number(e.target.value))) / 100) })}
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
              <span className="absolute right-0 top-0">{MAX}%</span>
            </div>

            <div className="mt-3 space-y-2 text-[13px]">
              <Row label="НМЦК" value={nmck > 0 ? rub(nmck) : 'не указана — впишите в «Моих расходах»'} muted />
              {unitBid && (
                <>
                  <Row label="Торг: сумма цен единиц" value={`${rub(unitBid.total / 100)} из ${rub(unitBid.start / 100)}`} strong />
                  <Row label="Цены единиц" value={unitBid.units.map((u) => rub(u / 100)).join(' + ')} />
                </>
              )}
              <Row
                label="Экономия для заказчика"
                value={
                  <span className="inline-flex items-center gap-1 text-success">
                    <TrendingDown className="size-3.5" /> {price !== null && nmck > 0 ? rub(Math.max(0, nmck - price)) : '—'}
                  </span>
                }
              />
            </div>

            {above && (
              <p className="mt-4 flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-2 text-[13px] font-semibold leading-snug text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Цена выше начальной — заявку отклонят.
              </p>
            )}

            {discount >= ANTI_DUMPING && (
              <p className="mt-4 flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-2 text-[13px] font-semibold leading-snug text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Антидемпинг (снижение от 25%): обеспечение исполнения ×1,5, не меньше 10%, или сведения о добросовестности.
                  <HelpTip content="Снижение на 25% и больше — антидемпинговые меры: обеспечение исполнения в 1,5 раза больше (не меньше 10%) или сведения о добросовестности (ч. 1–3 ст. 37 44-ФЗ)." />
                </span>
              </p>
            )}

            {/* Цена заявки — отдельно от примерки: в техпредложение и предложение о цене попадает только поставленная. */}
            {price !== null && price > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
                {tpPrice === price ? (
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-success">
                    <CheckCircle2 className="size-4" /> Эта цена стоит в заявке
                  </p>
                ) : (
                  <>
                    <Button size="sm" disabled={above} onClick={() => onPutPrice(price)}>
                      Поставить цену в заявку
                    </Button>
                    <span className="text-[12px] text-muted-foreground">
                      {above ? 'Выше начальной цены ставить нельзя' : tpPrice ? `Сейчас в заявке: ${rub(tpPrice)}` : 'Попадёт в ТП и предложение о цене'}
                    </span>
                  </>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Уровень 3: расходы — вписываются один раз, поэтому тише. */}
        <Card className="p-4">
          <button
            onClick={() => setShowCosts(!showCosts)}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-secondary"
          >
            Мои расходы
            <ChevronDown className={cx('size-4 text-muted-foreground transition-transform', showCosts && 'rotate-180')} />
          </button>
          {showCosts && (
            <div className="animate-fade-up mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Field label="Начальная цена, ₽" value={calc.nmck} onChange={setNum('nmck')} hint="Начальная (максимальная) цена контракта — из извещения. Предложить больше нельзя." />
              {volume && (
                <Field
                  label={`Себестоимость ${volume.one} ${volume.unitOf}, ₽`}
                  value={calc.costs ? Math.round((calc.costs / volume.total) * 100) / 100 : null}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[\s ]/g, '').replace(',', '.');
                    const unit = Number(raw);
                    set({ costs: raw === '' || !Number.isFinite(unit) || unit <= 0 ? null : Math.round(unit * volume.total * 100) / 100 });
                  }}
                  hint={`Сколько обходится ${volume.one === 'одной' ? 'одна' : 'один'} ${volume.unit} (материалы, работа, оборудование, накладные). По документам объём — ${volume.total.toLocaleString('ru-RU')} ${volume.unitsLabel}: впишите одну цифру, и общая себестоимость посчитается сама.`}
                />
              )}
              <Field label="Себестоимость, ₽" value={calc.costs} onChange={setNum('costs')} hint="Сколько вы платите поставщикам и тратите на исполнение: товар, работа, доставка." />
              <Field label="Расходы на участие, ₽" value={calc.extra} onChange={setNum('extra')} hint="Обеспечение заявки, плата площадке, дорога — всё, что платите за участие." />
              <Field label="Налог с выручки, %" value={calc.taxPct} onChange={setNum('taxPct')} hint="Например, 6% на УСН «Доходы»." />
              <Field label="Гарантия, % годовых" value={calc.guaranteeRatePct} onChange={setNum('guaranteeRatePct')} hint="Комиссия банка за независимую гарантию исполнения." />
              <Field label="Срок исполнения, дней" value={calc.days} onChange={setNum('days')} hint="Сколько дней действует обеспечение исполнения." />
            </div>
          )}

          <div className="space-y-1 pt-3 font-mono text-[11px] text-muted-foreground">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button onClick={onNext}>{fixed ? 'Дальше →' : 'Проверить заявку →'}</Button>
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
  value: number | null | undefined;
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
        defaultValue={value === null || value === undefined ? '' : value.toLocaleString('ru-RU')}
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
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
      <span className={`text-right font-mono tabular-nums ${strong ? 'text-base font-semibold' : muted ? 'text-muted-foreground' : ''}`}>{value}</span>
    </div>
  );
}
