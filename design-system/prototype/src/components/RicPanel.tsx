import { RIC_METHOD, type Analog, type PositionResult, type RicData, type RicPosition, type RicResult, type Vat } from '@/lib/indicative-price';
import { AlertTriangle, BarChart2, CheckCircle2, Download, Info, Plus, Trash2 } from '../lib/icons';
import { Badge, Button, Card, HelpTip, IconButton, Soon } from './ui';

// «РИЦ — расчёт индикативной цены»: ориентир рыночной цены закупки из цен-аналогов; с ним сравнивают начальную цену заказчика. Это не цена заявки.
// Сам ничего не считает и не хранит: расчёт — lib/indicative-price.ts, хранение — в обёртке (real/analytics.tsx).

export type RicPanelProps = {
  data: RicData;
  result: RicResult;
  /** Откуда взяты позиции, если их прочитали из бланка заказчика. */
  importSource: { doc: string; title: string } | null;
  importNote: string | null;
  onImport: () => void;
  onChange: (next: RicData) => void;
  saveError?: string | null;
};

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const numClass = `${inputClass} text-right font-mono`;

const rub = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const pct = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function RicPanel({ data, result, importSource, importNote, onImport, onChange, saveError }: RicPanelProps) {
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
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="size-4" />
            <span className="text-sm font-medium">РИЦ — расчёт индикативной цены</span>
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

        <div className="space-y-4 px-4 py-3 text-[13px]">
          <Settings data={data} onChange={onChange} />
          {importSource && (
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Позиции и начальные цены за единицу взяты из бланка «{importSource.title}» (файл «{importSource.doc}»). Цены-аналоги добавляете вы.
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
              Добавьте позиции закупки (или возьмите их из бланка заказчика) и для каждой — цены-аналоги: коммерческие предложения, прайсы, цены контрактов. У каждой цены укажите источник и дату.
              Нужно не меньше {RIC_METHOD.minAnalogs} аналогов на позицию.
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
                  onPatchAnalog={(analogId, patch) => patchAnalog(r.position.id, analogId, patch)}
                  onRemoveAnalog={(analogId) => patchPosition(r.position.id, { analogs: r.position.analogs.filter((a) => a.id !== analogId) })}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {data.positions.length > 0 && <Summary result={result} base={base} />}
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
    <section aria-label="Настройки расчёта" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
    </section>
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
  onPatchAnalog,
  onRemoveAnalog,
}: {
  result: PositionResult;
  base: string;
  onPatch: (patch: Partial<RicPosition>) => void;
  onRemove: () => void;
  onAddAnalog: () => void;
  onPatchAnalog: (analogId: string, patch: Partial<Analog>) => void;
  onRemoveAnalog: (analogId: string) => void;
}) {
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
        <Button size="sm" variant="ghost" onClick={onAddAnalog}>
          <Plus className="size-3.5" />
          Добавить цену-аналог
        </Button>
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
            {result.total === null && <span className="text-muted-foreground"> · укажите количество, чтобы получить сумму</span>}
          </p>
        )}
        {result.unit === null && result.used > 0 && (
          <p className="text-muted-foreground">
            Нужно ещё {RIC_METHOD.minAnalogs - result.used} {RIC_METHOD.minAnalogs - result.used === 1 ? 'цена' : 'цены'}: по {result.used} {result.used === 1 ? 'цене' : 'ценам'} индикативную цену не считаем.
          </p>
        )}
        {result.suggest && (
          <p className="text-muted-foreground">
            Если не учитывать цену «{result.checks.find((c) => c.analog.id === result.suggest!.analogId)?.analog.source || 'без названия'}», вариация станет {pct(result.suggest.cv * 100)}.{' '}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => onPatchAnalog(result.suggest!.analogId, { excluded: true })}>
              Не учитывать
            </button>{' '}
            — решаете вы: подумайте, чем эта цена отличается от остальных.
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

function Summary({ result, base }: { result: RicResult; base: string }) {
  const dev = result.deviation;
  return (
    <Card className="p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-medium">Итог по закупке</div>
      <div className="space-y-3 px-4 py-3 text-[13px]">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-muted-foreground">РИЦ ({base})</dt>
            <dd className="font-mono text-base font-semibold">{result.ric !== null ? rub(result.ric) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Диапазон по крайним аналогам</dt>
            <dd className="font-mono text-[13px]">{result.range ? `${rub(result.range.from)} — ${rub(result.range.to)}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Начальная цена заказчика</dt>
            <dd className="font-mono text-[13px]">{result.nmck !== null ? rub(result.nmck) : 'не указана'}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted-foreground">Начальная цена против РИЦ</dt>
            <dd className="font-mono text-[13px]">{dev ? `${dev.abs >= 0 ? '+' : '−'}${rub(Math.abs(dev.abs))} (${dev.pct >= 0 ? '+' : '−'}${pct(Math.abs(dev.pct))})` : '—'}</dd>
          </div>
        </dl>

        {dev && (
          <p>
            Начальная цена {dev.abs >= 0 ? 'выше' : 'ниже'} индикативной на {pct(Math.abs(dev.pct))}. Это ещё не вывод о завышении или занижении: проверьте, одни ли это характеристики, объёмы и условия исполнения, и сколько у вас сопоставимых цен.
          </p>
        )}
        {!result.complete && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Расчёт неполный: цена посчитана у {result.counted} из {result.total} позиций{result.counted > 0 ? ` (${rub(result.partial)})` : ''}. Итог и сравнение с начальной ценой появятся, когда она будет у каждой позиции: нужны не меньше {RIC_METHOD.minAnalogs} аналогов и количество.
          </p>
        )}
        {result.complete && !result.reliable && (
          <p className="flex items-start gap-1.5 text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            У некоторых позиций цены неоднородны (разброс выше {Math.round(RIC_METHOD.maxVariation * 100)} %): такой РИЦ ненадёжен. Добавьте цены или решите, какую не учитывать.
          </p>
        )}
        {result.staleCount > 0 && (
          <p className="flex items-start gap-1.5 text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Устарели цен: {result.staleCount}. Они учтены, но проверьте актуальность.
          </p>
        )}
        <p className="flex items-center gap-2 text-muted-foreground">
          <Soon />
          Ценовой бейдж «ниже рынка» или «выше рынка»: покажется, когда у каждой позиции будет достаточно сопоставимых цен.
        </p>
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
        <li>Пороги ({RIC_METHOD.minAnalogs} аналога, {Math.round(RIC_METHOD.maxVariation * 100)} %) — настройки методики, как в обосновании цены у заказчика; сверяйте с методикой вашей закупки. Расчёт делает программа, а не ИИ. Всё хранится только в вашем браузере.</li>
      </ul>
    </details>
  );
}
