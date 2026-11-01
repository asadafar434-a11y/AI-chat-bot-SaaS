import { useRef, useState } from 'react';
import { calculatorsBySphere, findCalculator } from '@/lib/core/calculators/registry';
import type { CalculatorInput, CalculatorResult, CalculatorValue } from '@/lib/core/calculators/types';
import { coreModules, type CoreModuleKey } from '@/lib/core/modules/index';
import { assertAiEnabled } from '@/lib/ai-mode';
import { titleOf, type Purchase } from '@/lib/purchase';
import { getDocuments } from '@/lib/purchase-store';
import { forServer, readDocuments, type SentDocument } from '@/lib/read-documents';
import { AlertTriangle, Calculator as CalculatorIcon, RefreshCw, Upload } from '../lib/icons';
import { useAiEnabled } from '../lib/use-ai-mode';
import { AIDisclaimer, Badge, Button, Card, fieldClass } from './ui';
import { SectionIcon } from './SectionIcon';

const SUB_SPHERE_LABELS: Record<string, string> = { general: 'Общий', device: 'Медизделия', medicine: 'Лекарства' };
const subSphereLabel = (key: string) => SUB_SPHERE_LABELS[key] ?? key;

const SECTION_LABELS: Record<string, string> = {
  price: 'Цена и маржа',
  securityApplication: 'Обеспечение заявки',
  securityContract: 'Обеспечение контракта',
  schedule: 'Срок исполнения',
  risk: 'Итоговый риск',
  vehicleYear: 'Год выпуска',
  vehicleMileage: 'Пробег',
  shelfLife: 'Срок годности',
  zhvnlp: 'Предельная цена ЖНВЛП',
  vat: 'НДС',
  markup: 'Оптовая надбавка',
  registryMatch: 'Сверка с реестром',
  postAward: 'Документы после контракта',
  executionCost: 'Себестоимость исполнения (персонал и техника)',
  logistics: 'Доставка и монтаж',
  delivery: 'Доставка',
};
const sectionLabel = (key: string) => SECTION_LABELS[key] ?? key;

function splitKey(key: string): { section: string; rest: string } {
  const dot = key.indexOf('.');
  return dot < 0 ? { section: '', rest: key } : { section: key.slice(0, dot), rest: key.slice(dot + 1) };
}
const formatNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

// Группирует по разделу расчёта (для подзаголовков вроде «Обеспечение заявки» / «Обеспечение контракта»), порядок — по первому появлению.
function groupBySection<T>(items: T[], sectionOf: (item: T) => string): { section: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const section = sectionOf(item);
    if (!groups.has(section)) {
      groups.set(section, []);
      order.push(section);
    }
    groups.get(section)!.push(item);
  }
  return order.map((section) => ({ section, items: groups.get(section)! }));
}

const sphereKeys = Object.keys(calculatorsBySphere);

function BoolToggle({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex gap-1.5">
      {([true, false] as const).map((option) => (
        <button
          key={String(option)}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`h-9 rounded-md px-4 text-[13px] font-medium transition-colors ${
            value === option ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70'
          }`}
        >
          {option ? 'Да' : 'Нет'}
        </button>
      ))}
    </div>
  );
}

function ValueRow({ item }: { item: CalculatorValue }) {
  const { rest } = splitKey(item.key);
  const isCompliant = rest === 'compliant' || rest === 'matched';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{item.label}</span>
      {typeof item.value === 'boolean' ? (
        isCompliant ? (
          <Badge tone={item.value ? 'success' : 'danger'}>{item.value ? 'Да' : 'Нет'}</Badge>
        ) : (
          <span className="font-medium">{item.value ? 'Да' : 'Нет'}</span>
        )
      ) : (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {item.value === null ? '—' : typeof item.value === 'number' ? formatNumber(item.value) : item.value}
          {item.unit ? ` ${item.unit}` : ''}
        </span>
      )}
    </div>
  );
}

function ResultView({ result }: { result: CalculatorResult }) {
  const groups = groupBySection(result.values, (item) => splitKey(item.key).section);
  return (
    <div className="space-y-3">
      {result.needsInput.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-warn/10 px-3 py-2.5 text-[13px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Не хватает данных: {result.needsInput.map((f) => f.label).join(', ')}</span>
        </div>
      )}
      {groups.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map(({ section, items }) => (
            <div key={section} className="space-y-2 rounded-md border border-border p-3">
              <h4 className="text-[13px] font-semibold">{sectionLabel(section)}</h4>
              <div className="space-y-1 text-[13px]">
                {items.map((item) => (
                  <ValueRow key={item.key} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {result.explanation && <p className="text-[12px] text-muted-foreground">{result.explanation}</p>}
    </div>
  );
}

type Mode = 'manual' | 'ai';
type DocSource = 'none' | 'purchase' | 'upload';

export function CalculatorScreen({ purchases }: { purchases: Purchase[] | null }) {
  const [sphereKey, setSphereKey] = useState(sphereKeys[0] ?? '');
  const subSphereKeys = (calculatorsBySphere[sphereKey] ?? []).map((d) => d.subSphereKey);
  const [subSphereKey, setSubSphereKey] = useState(subSphereKeys[0] ?? '');
  const [values, setValues] = useState<CalculatorInput>({});
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [mode, setMode] = useState<Mode>('manual');
  const [docSource, setDocSource] = useState<DocSource>('none');
  const [purchaseId, setPurchaseId] = useState('');
  const [uploaded, setUploaded] = useState<SentDocument[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [aiFilled, setAiFilled] = useState(false);
  const [hiddenCosts, setHiddenCosts] = useState<string[]>([]);
  const [aiError, setAiError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  // Общий переключатель «ИИ» в шапке меню: выключен — запрос к модели не уходит и кнопка недоступна.
  const [aiOn] = useAiEnabled();

  const descriptor = findCalculator(sphereKey, subSphereKey);

  function resetForm() {
    setValues({});
    setResult(null);
    setAiNote('');
    setAiFilled(false);
    setHiddenCosts([]);
    setAiError('');
  }

  function onSphereChange(key: string) {
    const subs = (calculatorsBySphere[key] ?? []).map((d) => d.subSphereKey);
    setSphereKey(key);
    setSubSphereKey(subs[0] ?? '');
    resetForm();
  }

  function setField(key: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function run() {
    if (!descriptor) return;
    setResult(descriptor.calculate(values));
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { documents } = await readDocuments(Array.from(files));
    setUploaded(documents);
  }

  async function fillWithAi() {
    if (!descriptor) return;
    setAiBusy(true);
    setAiError('');
    setAiNote('');
    setHiddenCosts([]);
    try {
      assertAiEnabled();
      let documents: SentDocument[] = [];
      if (docSource === 'purchase' && purchaseId) documents = await getDocuments(purchaseId);
      else if (docSource === 'upload') documents = uploaded;

      const response = await fetch('/api/calculator-ai-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(purchaseId ? { 'x-application-id': purchaseId } : {}) },
        body: JSON.stringify({ sphereKey, subSphereKey, currentValues: values, documents: forServer(documents) }),
      });
      if (!response.ok) {
        setAiError(await response.text());
        return;
      }
      const data = (await response.json()) as { values: Record<string, unknown>; note: string; hiddenCosts: string[] };
      setValues((prev) => ({ ...prev, ...data.values }));
      if (Object.keys(data.values).length > 0) setAiFilled(true);
      setAiNote(data.note);
      setHiddenCosts(data.hiddenCosts ?? []);
    } catch {
      setAiError('Не получилось связаться с сервером — повторите.');
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><SectionIcon name="calculator" className="size-8" />Калькулятор</h1>
        <p className="text-[13px] text-muted-foreground">Цена, маржа, обеспечение, срок и риск по правилам сферы</p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[13px] font-medium">Сфера закупки</span>
            <select value={sphereKey} onChange={(e) => onSphereChange(e.target.value)} className={fieldClass()}>
              {sphereKeys.map((key) => (
                <option key={key} value={key}>
                  {coreModules[key as CoreModuleKey]?.name ?? key}
                </option>
              ))}
            </select>
          </label>
          {subSphereKeys.length > 1 && (
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium">Вид</span>
              <select
                value={subSphereKey}
                onChange={(e) => {
                  setSubSphereKey(e.target.value);
                  resetForm();
                }}
                className={fieldClass()}
              >
                {subSphereKeys.map((key) => (
                  <option key={key} value={key}>
                    {subSphereLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-[13px] font-medium">Как заполнять</span>
          <div className="inline-flex gap-1.5">
            {([
              ['manual', 'Вручную'],
              ['ai', 'С ИИ'],
            ] as const).map(([option, text]) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => {
                  setMode(option);
                  setAiError('');
                }}
                className={`h-9 rounded-md px-4 text-[13px] font-medium transition-colors ${
                  mode === option ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70'
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        {mode === 'ai' && descriptor && (
          <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3">
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium">Источник документов</span>
              <div className="inline-flex flex-wrap gap-1.5">
                {([
                  ['none', 'Без документов'],
                  ['purchase', 'Выбрать закупку'],
                  ['upload', 'Загрузить файл'],
                ] as const).map(([option, text]) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={docSource === option}
                    onClick={() => setDocSource(option)}
                    className={`h-8 rounded-md px-3 text-[12px] font-medium transition-colors ${
                      docSource === option ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/70'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            {docSource === 'purchase' && (
              <select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)} className={fieldClass('sm')}>
                <option value="">Выберите закупку…</option>
                {(purchases ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {titleOf(p)}
                  </option>
                ))}
              </select>
            )}

            {docSource === 'upload' && (
              <div className="space-y-1.5">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-3.5" />
                  Выбрать файлы
                </Button>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
                {uploaded.length > 0 && <p className="text-[12px] text-muted-foreground">Загружено: {uploaded.map((d) => d.name).join(', ')}</p>}
              </div>
            )}

            <p className="text-[12px] text-muted-foreground">
              С документами ИИ сначала ищет цифры и скрытые расходы в них самих; без документов — оценивает по рыночным ориентирам.
            </p>
            <Button type="button" variant="ai" size="sm" busy={aiBusy} onClick={fillWithAi} disabled={aiBusy || !aiOn}>
              {aiBusy ? 'Запрашиваю ИИ…' : 'Подставить значения с ИИ'}
            </Button>
            <p className="text-[12px] text-muted-foreground">
              {aiOn
                ? `Платно: ${docSource === 'none' ? 'без документов — около 2–5 ₽' : 'с документами — от 5 до 50 ₽, зависит от их объёма'}. Режим «Вручную» бесплатный.`
                : 'ИИ выключен: включите переключатель «ИИ» в шапке меню или считайте вручную.'}
            </p>
          </div>
        )}

        {descriptor && (
          <>
            <div className="space-y-4">
              {groupBySection(descriptor.inputSchema, (field) => field.section ?? '').map(({ section, items }) => (
                <div key={section || '_'} className="space-y-2">
                  {section && <h4 className="text-[13px] font-semibold text-muted-foreground">{sectionLabel(section)}</h4>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {items.map((field) => (
                      <label key={field.key} className="space-y-1.5">
                        <span className="text-[13px] font-medium">
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                        </span>
                        {field.kind === 'boolean' ? (
                          <BoolToggle value={values[field.key] as boolean | undefined} onChange={(v) => setField(field.key, v)} />
                        ) : (
                          <div className="relative">
                            <input
                              type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
                              value={values[field.key] === undefined ? '' : String(values[field.key])}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setField(field.key, field.kind === 'number' ? (raw === '' ? undefined : Number(raw)) : raw);
                              }}
                              className={fieldClass()}
                            />
                            {field.unit && (
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
                                {field.unit}
                              </span>
                            )}
                          </div>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" onClick={run}>
              <CalculatorIcon className="size-4" />
              Рассчитать
            </Button>
          </>
        )}

        {aiError && (
          <div className="flex items-start gap-2 rounded-md bg-warn/10 px-3 py-2.5 text-[13px] text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}

        {result && <ResultView result={result} />}

        {hiddenCosts.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-warn/40 bg-warn/10 p-3">
            <h4 className="text-[13px] font-semibold text-warn">Скрытые расходы в документах</h4>
            <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
              {hiddenCosts.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {aiFilled && (
          <div className="space-y-1">
            {aiNote && <p className="text-[12px] text-muted-foreground">{aiNote}</p>}
            <AIDisclaimer />
          </div>
        )}
      </Card>
    </div>
  );
}
