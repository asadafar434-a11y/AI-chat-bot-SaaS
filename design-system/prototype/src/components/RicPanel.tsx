import { useState } from 'react';
import { RIC_METHOD, type Analog, type PositionResult, type RicData, type RicPosition, type RicResult, type Vat } from '@/lib/indicative-price';
import type { PriceBadge } from '@/lib/price-badge';
import { AlertTriangle, BarChart2, CheckCircle2, Download, Info, Plus, Trash2, TrendingDown, TrendingUp } from '../lib/icons';
import { CertaintyBadge } from './Certainty';
import { AnalogImportModal } from './AnalogImport';
import { Frame, frameBody, frameHead } from './Frame';
import { Badge, Button, Card, HelpTip, IconButton } from './ui';

// «РИЦ — расчёт индикативной цены»: ориентир рыночной цены закупки из цен-аналогов; с ним сравнивают начальную цену заказчика. Это не цена заявки.
// Сам ничего не считает и не хранит: расчёт — lib/indicative-price.ts, хранение — в обёртке (real/analytics.tsx).

export type RicPanelProps = {
  data: RicData;
  result: RicResult;
  badge: PriceBadge;
  /** Откуда взяты позиции, если их прочитали из бланка заказчика. */
  importSource: { doc: string; title: string } | null;
  importNote: string | null;
  onImport: () => void;
  onChange: (next: RicData) => void;
  saveError?: string | null;
  /** Внутри раскрывающегося раздела: без карточки и названия. */
  embedded?: boolean;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;

const rub = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function RicPanel({ data, result, badge, importSource, importNote, onImport, onChange, saveError, embedded }: RicPanelProps) {
  const base = data.settings.nmckVat === 'with' ? 'с НДС' : 'без НДС';

  const setPositions = (positions: RicPosition[]) => onChange({ ...data, positions });
  const patchPosition = (id: string, patch: Partial<RicPosition>) => setPositions(data.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const patchAnalog = (posId: string, analogId: string, patch: Partial<Analog>) =>
    setPositions(data.positions.map((p) => (p.id === posId ? { ...p, analogs: p.analogs.map((a) => (a.id === analogId ? { ...a, ...patch } : a)) } : p)));
  const addAnalog = (posId: string) =>
    setPositions(
      data.positions.map((p) =>
        p.id === posId ? { ...p, analogs: [...p.analogs, { id: newId('a'), price: '', vat: data.settings.nmckVat, source: '', date: '' }] } : p,
      ),
    );

  return (
    <div className="space-y-4">
      <Frame embedded={embedded}>
        <div className={`${frameHead(embedded)} justify-between`}>
          <div className="flex items-center gap-2">
            <BarChart2 className="size-4" />
            {!embedded && <span className="text-sm font-medium">РИЦ — расчёт индикативной цены</span>}
            <HelpTip
              align="start"
              content="Индикативная цена — ориентир рыночной цены закупки, который считается из цен-аналогов: коммерческих предложений, прайсов, цен контрактов. С ним сравнивают начальную цену заказчика. Это не цена вашей заявки. Цена без источника и даты в расчёт не попадает."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onImport}>
              <Download className="size-3.5" />
              Взять позиции из документов
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPositions([...data.positions, { id: newId('p'), name: '', unit: '', qty: '', analogs: [] }])}>
              <Plus className="size-3.5" />
              Добавить позицию
            </Button>
          </div>
        </div>

        <div className={frameBody(embedded, 'space-y-4')}>
          <Settings data={data} onChange={onChange} />
          {importSource && (
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Позиции — из бланка «{importSource.title}», файл «{importSource.doc}».
            </p>
          )}
          {importNote && (
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {importNote}
            </p>
          )}
          {saveError && (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {saveError}
            </p>
          )}

          {data.positions.length === 0 ? (
            <p className="text-muted-foreground">
              Добавьте позиции и цены-аналоги. Нужно не меньше {RIC_METHOD.minAnalogs} цен на позицию, для бейджа — {RIC_METHOD.badge.minObservations}.
            </p>
          ) : (
            <ul className="space-y-3">
              {result.positions.map((r) => (
                <PositionCard
                  key={r.position.id}
                  result={r}
                  base={base}
                  onPatch={(patch) => patchPosition(r.position.id, patch)}
                  onRemove={() => setPositions(data.positions.filter((p) => p.id !== r.position.id))}
                  onAddAnalog={() => addAnalog(r.position.id)}
                  defaultVat={data.settings.nmckVat}
                  onImportAnalogs={(list) => patchPosition(r.position.id, { analogs: [...r.position.analogs, ...list] })}
                  onPatchAnalog={(analogId, patch) => patchAnalog(r.position.id, analogId, patch)}
                  onRemoveAnalog={(analogId) => patchPosition(r.position.id, { analogs: r.position.analogs.filter((a) => a.id !== analogId) })}
                />
              ))}
            </ul>
          )}
        </div>
      </Frame>

      {data.positions.length > 0 && <Summary result={result} base={base} badge={badge} />}
      <Method data={data} />
    </div>
  );
}

function Settings({ data, onChange }: { data: RicData; onChange: (next: RicData) => void }) {
  const set = (patch: Partial<RicData['settings']>) => onChange({ ...data, settings: { ...data.settings, ...patch } });
  const number = (text: string, fallback: number) => {
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">Настройки расчёта: НДС, срок цен, порог бейджа</summary>
      <section aria-label="Настройки расчёта" className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-4">
      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Начальная цена (НМЦ) указана</span>
        <select value={data.settings.nmckVat} onChange={(e) => set({ nmckVat: e.target.value as Vat })} className={inputClass}>
          <option value="with">с НДС</option>
          <option value="without">без НДС</option>
        </select>
      </label>
      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Ставка НДС, %</span>
        <input type="text" inputMode="decimal" value={String(data.settings.vatRate)} onChange={(e) => set({ vatRate: Math.min(99, number(e.target.value, data.settings.vatRate)) })} className={numClass} />
      </label>
      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Цена считается устаревшей через, дней</span>
        <input type="text" inputMode="numeric" value={String(data.settings.staleDays)} onChange={(e) => set({ staleDays: Math.max(1, Math.round(number(e.target.value, data.settings.staleDays))) })} className={numClass} />
      </label>
      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">«Существенно» — отклонение от, %</span>
        <input type="text" inputMode="decimal" value={String(data.settings.badgePct)} onChange={(e) => set({ badgePct: Math.min(99, Math.max(1, number(e.target.value, data.settings.badgePct))) })} className={numClass} />
      </label>
      </section>
    </details>
  );
}

const STATUS: Record<PositionResult['status'], { tone: 'success' | 'warn' | 'neutral'; text: string }> = {
  ok: { tone: 'success', text: 'цены однородны' },
  heterogeneous: { tone: 'warn', text: `разброс выше ${Math.round(RIC_METHOD.maxVariation * 100)} %` },
  insufficient: { tone: 'neutral', text: `аналогов меньше ${RIC_METHOD.minAnalogs}` },
};

function PositionCard({
  result,
  base,
  onPatch,
  onRemove,
  onAddAnalog,
  defaultVat,
  onImportAnalogs,
  onPatchAnalog,
  onRemoveAnalog,
}: {
  result: PositionResult;
  base: string;
  onPatch: (patch: Partial<RicPosition>) => void;
  onRemove: () => void;
  onAddAnalog: () => void;
  defaultVat: Vat;
  onImportAnalogs: (analogs: Analog[]) => void;
  onPatchAnalog: (analogId: string, patch: Partial<Analog>) => void;
  onRemoveAnalog: (analogId: string) => void;
}) {
  const [importing, setImporting] = useState(false);
  const p = result.position;
  const label = p.name.trim() || 'позиция';
  const status = STATUS[result.status];
  return (
    <li className="rounded-lg border border-border">
      <div className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]">
        <input type="text" aria-label="Название позиции" placeholder="Название позиции" value={p.name} onChange={(e) => onPatch({ name: e.target.value })} className={inputClass} />
        <input type="text" inputMode="decimal" aria-label={`Количество: ${label}`} placeholder="Количество" value={p.qty} onChange={(e) => onPatch({ qty: e.target.value })} className={numClass} />
        <input type="text" aria-label={`Единица: ${label}`} placeholder="Ед. изм." value={p.unit} onChange={(e) => onPatch({ unit: e.target.value })} className={inputClass} />
        <IconButton label="Убрать позицию" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      <div className="space-y-2 border-t border-border px-3 py-2.5">
        {result.checks.length > 0 && (
          <div className="hidden gap-2 px-0.5 text-[11px] text-muted-foreground sm:grid sm:grid-cols-[7rem_6.5rem_minmax(0,1fr)_9rem_5.5rem_1.75rem]">
            <span className="text-right">Цена за единицу</span>
            <span>НДС</span>
            <span>Источник (кто назвал цену)</span>
            <span>Дата</span>
            <span>Не учитывать</span>
            <span />
          </div>
        )}
        {result.checks.map((c) => (
          <div key={c.analog.id}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_6.5rem_minmax(0,1fr)_9rem_5.5rem_1.75rem] sm:items-center">
              <input type="text" inputMode="decimal" aria-label={`Цена-аналог: ${label}`} placeholder="0,00" value={c.analog.price} onChange={(e) => onPatchAnalog(c.analog.id, { price: e.target.value })} className={numClass} />
              <select aria-label={`НДС в цене: ${label}`} value={c.analog.vat} onChange={(e) => onPatchAnalog(c.analog.id, { vat: e.target.value as Vat })} className={inputClass}>
                <option value="with">с НДС</option>
                <option value="without">без НДС</option>
              </select>
              <input type="text" aria-label={`Источник цены: ${label}`} placeholder="Например: КП ООО «Север»" value={c.analog.source} onChange={(e) => onPatchAnalog(c.analog.id, { source: e.target.value })} className={`${inputClass} col-span-2 sm:col-span-1`} />
              <input type="date" aria-label={`Дата цены: ${label}`} value={c.analog.date} onChange={(e) => onPatchAnalog(c.analog.id, { date: e.target.value })} className={inputClass} />
              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={c.analog.excluded === true} onChange={(e) => onPatchAnalog(c.analog.id, { excluded: e.target.checked })} />
                <span className="sm:sr-only">Не учитывать</span>
              </label>
              <IconButton label="Убрать цену" onClick={() => onRemoveAnalog(c.analog.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
            {(c.state !== 'used' || c.stale) && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-warn-foreground">
                <AlertTriangle className="size-3 shrink-0" />
                {c.state === 'used' ? 'Цена устарела: считается, но проверьте актуальность' : c.state === 'excluded' ? 'Не учитывается: исключена вами' : `Не учитывается: ${c.reason}`}
              </p>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <Button size="sm" variant="ghost" onClick={onAddAnalog}>
            <Plus className="size-3.5" />
            Добавить цену-аналог
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            <Download className="size-3.5" />
            Загрузить цены из таблицы
          </Button>
        </div>
        <AnalogImportModal
          open={importing}
          onClose={() => setImporting(false)}
          positionName={p.name.trim()}
          defaultVat={defaultVat}
          makeId={() => newId('a')}
          onImport={(list) => {
            onImportAnalogs(list);
            setImporting(false);
          }}
        />
      </div>

      <div className="space-y-1.5 border-t border-border bg-secondary/30 px-3 py-2.5 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={status.tone} wrap>
            {result.status === 'ok' ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
            {status.text}
          </Badge>
          {result.stats && result.used > 0 && (
            <span className="text-muted-foreground">
              учтено цен: {result.used} · вариация {pct(result.stats.cv * 100)} (допустимо до {Math.round(RIC_METHOD.maxVariation * 100)} %)
            </span>
          )}
        </div>
        {result.unit !== null && (
          <p>
            Индикативная цена единицы ({base}): <span className="font-mono font-medium">{rub(result.unit)}</span>
            {result.total !== null && (
              <>
                {' '}
                · сумма по позиции: <span className="font-mono font-medium">{rub(result.total)}</span>
              </>
            )}
            {result.total === null && <span className="text-muted-foreground"> · впишите количество</span>}
          </p>
        )}
        {result.unit === null && result.used > 0 && (
          <p className="text-muted-foreground">
            Нужно ещё {RIC_METHOD.minAnalogs - result.used} {RIC_METHOD.minAnalogs - result.used === 1 ? 'цена' : 'цены'}
          </p>
        )}
        {result.suggest && (
          <p className="text-muted-foreground">
            Если не учитывать цену «{result.checks.find((c) => c.analog.id === result.suggest!.analogId)?.analog.source || 'без названия'}», вариация станет {pct(result.suggest.cv * 100)}.{' '}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => onPatchAnalog(result.suggest!.analogId, { excluded: true })}>
              Не учитывать
            </button>
          </p>
        )}
        {result.customer && (
          <p>
            Начальная цена заказчика за единицу: <span className="font-mono font-medium">{p.customerUnit !== undefined ? rub(p.customerUnit) : ''}</span> —{' '}
            {result.customer.abs >= 0 ? 'выше' : 'ниже'} индикативной на {pct(Math.abs(result.customer.pct))}.
          </p>
        )}
      </div>
    </li>
  );
}

const dateRu = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}`;

// Итог: ценовой бейдж и главные цифры. Детали бейджа — свёрнуты: видно, на чём он держится, но экран не перегружен.
function Summary({ result, base, badge }: { result: RicResult; base: string; badge: PriceBadge }) {
  const dev = result.deviation;
  const detail = badge.detail;
  const tone = { below: 'warn', above: 'info', within: 'success', insufficient: 'neutral' }[badge.status] as 'warn' | 'info' | 'success' | 'neutral';
  const Icon = badge.status === 'below' ? TrendingDown : badge.status === 'above' ? TrendingUp : badge.status === 'within' ? CheckCircle2 : Info;
  return (
    <Card className="p-0">
      <div className="space-y-3 px-4 py-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone} wrap>
            <Icon className="size-3" />
            {badge.title}
          </Badge>
          {detail && <CertaintyBadge kind="own" />}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-muted-foreground">РИЦ ({base})</dt>
            <dd className="break-words font-mono text-2xl font-bold tracking-tight">{result.ric !== null ? rub(result.ric) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Начальная цена заказчика</dt>
            <dd className="font-mono text-[13px]">{result.nmck !== null ? rub(result.nmck) : 'не указана'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Отклонение от РИЦ</dt>
            <dd className="font-mono text-[15px] font-bold">{dev ? `${signed(dev.abs)}${rub(Math.abs(dev.abs))} (${signed(dev.pct)}${pct(Math.abs(dev.pct))})` : '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Диапазон цен-аналогов</dt>
            <dd className="font-mono text-[13px]">{result.range ? `${rub(result.range.from)} — ${rub(result.range.to)}` : '—'}</dd>
          </div>
        </dl>

        {badge.status === 'below' && <p>Проверьте: хватит ли цены на затраты, объёмы и характеристики.</p>}
        {badge.status === 'above' && (
          <p className="flex items-center gap-1.5">
            Высокая цена — не повод для выводов: сверьте объёмы и условия.
            <HelpTip align="start" content="Высокая цена ещё не значит выгодный контракт. Это не вывод о нарушении со стороны заказчика." />
          </p>
        )}
        {badge.missing.length > 0 && (
          <div className="text-muted-foreground">
            <p className="font-medium text-foreground">Чего не хватает для оценки цены:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {badge.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {result.staleCount > 0 && (
          <p className="flex items-start gap-1.5 text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Устарело цен: {result.staleCount} (учтены)
          </p>
        )}

        {detail && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted-foreground">Почему такой бейдж</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Начальная цена</dt>
              <dd className="font-mono">{rub(detail.nmck)}</dd>
              <dt className="text-muted-foreground">РИЦ — среднее по аналогам</dt>
              <dd className="font-mono">{rub(detail.ric)}</dd>
              <dt className="text-muted-foreground">Рыночная медиана</dt>
              <dd className="font-mono">{rub(detail.median)}</dd>
              <dt className="text-muted-foreground">Диапазон цен-аналогов</dt>
              <dd className="font-mono">
                {rub(detail.range.from)} — {rub(detail.range.to)}
              </dd>
              <dt className="text-muted-foreground">Отклонение</dt>
              <dd className="font-mono">
                {signed(detail.abs)}
                {rub(Math.abs(detail.abs))} ({signed(detail.pct)}
                {pct(Math.abs(detail.pct))})
              </dd>
              <dt className="text-muted-foreground">Сопоставимых цен</dt>
              <dd>по позиции не меньше {detail.observations.min}, всего {detail.observations.total}</dd>
              <dt className="text-muted-foreground">Даты цен</dt>
              <dd>
                {dateRu(detail.dates.from)} — {dateRu(detail.dates.to)}
              </dd>
              <dt className="text-muted-foreground">Источники</dt>
              <dd className="break-words">{detail.sources.join('; ')}</dd>
              <dt className="text-muted-foreground">Уверенность</dt>
              <dd>{detail.confidence === 'high' ? 'высокая' : 'средняя'}</dd>
              <dt className="text-muted-foreground">Когда бейдж «выше» или «ниже»</dt>
              <dd>цена вне диапазона аналогов и отклонение от РИЦ не меньше {detail.threshold} %</dd>
            </dl>
          </details>
        )}
      </div>
    </Card>
  );
}

function Method({ data }: { data: RicData }) {
  return (
    <details className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] shadow-sm">
      <summary className="cursor-pointer text-sm font-medium">Как считается РИЦ</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Цены-аналоги приводятся к одной основе — без НДС (ставка {data.settings.vatRate} %). Индикативная цена единицы — среднее по учтённым ценам.</li>
        <li>
          Однородность: среднее квадратичное отклонение (по выборке) делится на среднее. Если вариация выше {Math.round(RIC_METHOD.maxVariation * 100)} %, цены считаются неоднородными. Меньше {RIC_METHOD.minAnalogs} аналогов — цену позиции не считаем.
        </li>
        <li>Цена без источника и даты, с датой в будущем или исключённая вами в расчёт не идёт. Цена старше {data.settings.staleDays} дней учитывается, но помечена «устарела».</li>
        <li>Сумма по позиции — цена единицы на количество. РИЦ закупки — сумма по позициям, пересчитанная в основу начальной цены (с НДС или без). Пока цены нет у какой-то позиции, итога и сравнения нет.</li>
        <li>Пороги ({RIC_METHOD.minAnalogs} аналога, {Math.round(RIC_METHOD.maxVariation * 100)} %) — как в обосновании цены у заказчика; сверяйте с методикой закупки. Считает программа, не ИИ; всё хранится в вашем браузере.</li>
      </ul>
    </details>
  );
}
