import { useState, type ReactNode } from 'react';
import type { CardEdits, ProductCard } from '@/lib/product-card';
import type { RegistryDemand } from '@/lib/registry-demand';
import { STALE_DAYS, STATUS_TEXT, selectable, type CandidateView, type Decision, type DecisionStatus } from '@/lib/registry-decision';
import { optionsOf, type AutofillCheck, type RegistryChoice, type RegistryLogEntry } from '@/lib/registry-log';
import { REGISTRY_SHORT, REGISTRY_TITLES, moscowDay, moscowTime, scoreText, type RegistryKind } from '@/lib/registry-types';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileQuestion,
  HelpCircle,
  History,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from '../lib/icons';
import { Badge, Button, Card, HelpTip, cx, type Tone } from './ui';

// Блок «Реестровые номера товаров» на шаге «Пакет». Показывает, нужен ли номер, что нашлось по каждой позиции, чем найденное
// совпало и чем нет, и даёт выбрать запись. Сам к серверу не обращается: поиск и сохранение делает обёртка (real/registry.tsx).
// Номер попадает в заявку только после выбора участником; смысл каждого состояния выражен словами, а не только цветом.

export type PositionView = {
  card: ProductCard;
  status: DecisionStatus | 'searching';
  decision: Decision | null;
  error: string | null;
  choice: RegistryChoice | undefined;
  /** Что будет с номером при сборке файла: вписан или нет, и почему. */
  autofill: AutofillCheck;
  /** Сведения о товаре изменились после выбора записи. */
  cardChanged: boolean;
  /** Участник отказался от номера для этой позиции («Нет в реестре»): автоподбор её не трогает. */
  skipped: boolean;
};

/** Выгрузка одного реестра, по которой идёт поиск. */
export type DatasetBrief = { registry: RegistryKind; exportedAt: string | null; importedAt: string };

export type RegistryNumbersProps = {
  demand: RegistryDemand;
  /** Реестр, который назвала закупка. Поиск от этого не сужается: ищем сразу во всех загруженных реестрах. */
  required: RegistryKind | null;
  /** Выгрузки реестров, по которым идёт поиск. undefined — ещё грузится; пусто — на сервере ни одной нет. */
  datasets: DatasetBrief[] | undefined;
  datasetError: string | null;
  positions: PositionView[];
  /** Найти записи для позиций (сведения о товаре не менялись). */
  onSearch: (keys: string[]) => void;
  /** Сохранить сведения о товаре, которые вписал участник, и сразу искать по ним. */
  onSaveAndSearch: (key: string, edits: CardEdits) => void;
  searching: boolean;
  onSelect: (key: string, registryNumber: string, note: string) => void;
  onCancel: (key: string) => void;
  log: RegistryLogEntry[];
  /** Момент «сейчас» для возраста выгрузки; в тестах задаётся, в экране — текущий. */
  now?: number;
};

// Правило владельца (19.10.2026): товара в реестре нет, а запрет есть — этот факт декларирует заказчик, а не участник. В заявку программа ничего не добавляет
// и текста декларации не сочиняет: образца в документах закупок из папки примеров нет, поэтому вывод — только пометка с просьбой проверить документы.
const BAN_DECLARATION_SHORT = 'Если закупка запрещает иностранный товар, а в реестрах его нет, этот факт декларирует заказчик, а не вы.';
const BAN_DECLARATION_NOTE = `${BAN_DECLARATION_SHORT} В вашу заявку декларация не добавляется. Проверьте, что в документах закупки такая декларация заказчика есть; если её нет — спросите заказчика.`;

const STATUS_STYLE: Record<DecisionStatus | 'searching', { tone: Tone; icon: ReactNode }> = {
  no_requirement: { tone: 'neutral', icon: <Info className="size-3" /> },
  unsupported_registry: { tone: 'neutral', icon: <Info className="size-3" /> },
  no_dataset: { tone: 'warn', icon: <Archive className="size-3" /> },
  pending: { tone: 'info', icon: <Search className="size-3" /> },
  searching: { tone: 'info', icon: <Loader2 className="size-3 animate-spin" /> },
  confirmed: { tone: 'success', icon: <CheckCircle2 className="size-3" /> },
  choose: { tone: 'warn', icon: <HelpCircle className="size-3" /> },
  need_data: { tone: 'warn', icon: <AlertTriangle className="size-3" /> },
  contradiction: { tone: 'danger', icon: <XCircle className="size-3" /> },
  not_found: { tone: 'neutral', icon: <FileQuestion className="size-3" /> },
  inactive: { tone: 'danger', icon: <Clock className="size-3" /> },
  needs_update: { tone: 'warn', icon: <RefreshCw className="size-3" /> },
};

const STATUS_LABEL: Record<DecisionStatus | 'searching', string> = { ...STATUS_TEXT, searching: 'Выполняется поиск' };

// Даты записей реестра — «ГГГГ-ММ-ДД» без времени; моменты (выгрузка, подтверждение) переводим в московскую дату.
const dateRu = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');
const instantRu = (iso: string | null | undefined) => (iso ? dateRu(moscowDay(iso)) : '—');

const FIELDS: { key: keyof CardEdits; label: string; hint?: string; wide?: boolean }[] = [
  { key: 'offeredName', label: 'Как называется ваш товар', hint: 'Если иначе, чем в ТЗ', wide: true },
  { key: 'manufacturer', label: 'Производитель', hint: 'Название, как в документах на товар' },
  { key: 'inn', label: 'ИНН производителя', hint: '10 или 12 цифр' },
  { key: 'model', label: 'Модель', hint: 'Например, КО-100' },
  { key: 'article', label: 'Артикул' },
  { key: 'madeBy', label: 'ТУ или ГОСТ', hint: 'По которому изготовлен товар' },
  { key: 'registryNumber', label: 'Реестровый номер, если уже знаете', wide: true },
  { key: 'characteristics', label: 'Важные характеристики', hint: 'Объём, размеры — по ним сверяются отличия', wide: true },
];

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';

function StatusBadge({ status }: { status: DecisionStatus | 'searching' }) {
  const style = STATUS_STYLE[status];
  return (
    <Badge tone={style.tone} wrap>
      {style.icon}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function SignalList({ view }: { view: CandidateView }) {
  const groups: { verdict: 'confirm' | 'neutral' | 'contradict'; title: string; icon: ReactNode }[] = [
    { verdict: 'confirm', title: 'Совпало', icon: <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> },
    { verdict: 'neutral', title: 'Не удалось проверить', icon: <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> },
    { verdict: 'contradict', title: 'Расходится', icon: <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" /> },
  ];
  return (
    <div className="space-y-2.5">
      {groups.map((g) => {
        const list = view.signals.filter((s) => s.verdict === g.verdict);
        if (!list.length) return null;
        return (
          <div key={g.verdict}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.title}</p>
            <ul className="mt-1 space-y-1">
              {list.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12px]">
                  {g.icon}
                  <span>
                    {s.text}
                    {s.critical && <span className="ml-1 font-medium text-danger">— выбрать нельзя</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Записи с одним названием у одного производителя — это разные реестровые номера одного и того же товара. Их помечаем, чтобы выбор был осознанным.
const sameName = (a: CandidateView, b: CandidateView) => a.inn === b.inn && a.productName.trim().toLowerCase() === b.productName.trim().toLowerCase();
const duplicatesOf = (all: CandidateView[], one: CandidateView) => all.filter((x) => x.registryNumber !== one.registryNumber && sameName(x, one)).length;

function CandidateRow({
  view,
  proposed,
  selected,
  autoPicked,
  duplicates,
  onSelect,
}: {
  view: CandidateView;
  proposed: boolean;
  selected: boolean;
  /** Эту запись подобрала система, а участник её ещё не проверил. */
  autoPicked: boolean;
  /** Сколько других записей с тем же названием у того же производителя: это разные номера, выбирать нужно свой. */
  duplicates: number;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const can = selectable(view);
  const blockReason = !view.activity.active ? `Запись неактуальна: ${view.activity.reasons.join('; ')}` : view.blocked ? 'Есть расхождение с данными о товаре' : '';
  const confirmed = view.signals.filter((s) => s.verdict === 'confirm').length;
  const contradictions = view.signals.filter((s) => s.verdict === 'contradict').length;
  return (
    <li className={cx('rounded-lg border bg-card', selected ? 'border-foreground' : 'border-border')}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-medium tabular-nums">№ {view.registryNumber}</span>
            {view.registries.map((kind) => (
              <Badge key={kind} tone="neutral">
                {REGISTRY_SHORT[kind]}
              </Badge>
            ))}
            {view.activity.active ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" />
                Действует{view.validUntil ? ` до ${dateRu(view.validUntil)}` : ''}
              </Badge>
            ) : (
              <Badge tone="danger">
                <Clock className="size-3" />
                Неактуальна
              </Badge>
            )}
            {proposed && (
              <Badge tone="info">
                <CheckCircle2 className="size-3" />
                Подтверждена совпадением
              </Badge>
            )}
            {selected && !autoPicked && <Badge tone="neutral">Выбрана</Badge>}
            {selected && autoPicked && (
              <Badge tone="warn" wrap>
                <AlertTriangle className="size-3 shrink-0" />
                Подобрана автоматически — проверьте
              </Badge>
            )}
            {duplicates > 0 && (
              <Badge tone="warn" wrap>
                <AlertTriangle className="size-3 shrink-0" />
                Такое же название ещё у {duplicates} {duplicates === 1 ? 'записи' : 'записей'} — выберите свой номер
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[13px] font-medium">{view.productName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant={proposed || autoPicked ? 'primary' : 'secondary'} disabled={!can || (selected && !autoPicked)} onClick={onSelect} title={blockReason || undefined}>
            {selected && !autoPicked ? 'Выбрана' : autoPicked ? 'Подтвердить' : 'Выбрать'}
          </Button>
        </div>
      </div>
      <dl className="grid gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Производитель</dt>
          <dd>
            {view.enterpriseName} <span className="font-mono text-muted-foreground">ИНН {view.inn}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Изготовлена по (ТУ, ГОСТ)</dt>
          <dd>{view.madeBy || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Баллы и процентный показатель</dt>
          <dd>{scoreText(view.points, view.percent) ?? <span className="text-muted-foreground">в записи не указаны</span>}</dd>
        </div>
        {view.radioLevel && (
          <div>
            <dt className="text-muted-foreground">Уровень радиоэлектронной продукции</dt>
            <dd>{view.radioLevel}</dd>
          </div>
        )}
        {view.extractUrl && (
          <div>
            <dt className="text-muted-foreground">Выписка из реестра</dt>
            <dd>
              <a href={view.extractUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                открыть на сайте ГИСП
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">Сверка с вашим товаром</dt>
          <dd>
            совпало: {confirmed}
            {contradictions > 0 && <span className="font-medium text-danger">, расходится: {contradictions}</span>}
          </dd>
        </div>
      </dl>
      {blockReason && (
        <p className="flex items-start gap-1.5 border-t border-border bg-danger/5 px-3 py-1.5 text-[12px] text-danger">
          <XCircle className="mt-0.5 size-3.5 shrink-0" />
          {blockReason}. Выбрать эту запись нельзя.
        </p>
      )}
      {view.activity.warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 border-t border-border bg-warn-surface px-3 py-1.5 text-[12px] text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {w}
        </p>
      ))}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary/50"
      >
        <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Скрыть основания сопоставления' : 'Показать основания сопоставления'}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border bg-secondary/30 px-3 py-3">
          {view.conformity && (
            <p className="text-[12px]">
              <span className="font-medium">О соответствии (из реестра):</span> {view.conformity.length > 600 ? `${view.conformity.slice(0, 600)}…` : view.conformity}
            </p>
          )}
          <SignalList view={view} />
          <p className="text-[11px] text-muted-foreground">
            Внесена в реестр: {dateRu(view.addedAt)}. Оснований у записи: {view.basisCount}
            {view.validUntilMin && view.validUntilMin !== view.validUntil && ` (сроки от ${dateRu(view.validUntilMin)} до ${dateRu(view.validUntil)})`}. ТН ВЭД: {view.tnved || '—'}.
          </p>
        </div>
      )}
    </li>
  );
}

function CardForm({ card, onSave, busy }: { card: ProductCard; onSave: (edits: CardEdits) => void; busy: boolean }) {
  const initial = (key: keyof CardEdits): string => {
    if (key === 'offeredName') return card.offeredName?.value ?? '';
    const f = card.fields[key];
    return f ? f.value : '';
  };
  const [draft, setDraft] = useState<CardEdits>(() => Object.fromEntries(FIELDS.map((f) => [f.key, initial(f.key)])));

  const save = () => {
    const edits: CardEdits = {};
    for (const f of FIELDS) {
      const value = (draft[f.key] ?? '').trim();
      if (!value) continue;
      edits[f.key] = value;
    }
    onSave(edits);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Наименование «{card.name}» взято из ТЗ — это то, что хочет заказчик, а не доказательство, какой товар поставите вы. Чтобы запись реестра можно было
        подтвердить, укажите производителя и модель вашего товара.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const id = `rg-${card.key}-${f.key}`;
          return (
            <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
              <label htmlFor={id} className="mb-1 block text-[12px] font-medium">
                {f.label}
              </label>
              <input
                id={id}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                placeholder={f.hint}
                autoComplete="off"
                className={inputClass}
              />
            </div>
          );
        })}
      </div>
      <Button size="sm" onClick={save} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        Найти в реестре
      </Button>
    </div>
  );
}

/** Вариант номера в выпадающем списке: коротко, но так, чтобы можно было сверить с товаром. */
const optionLabel = (v: CandidateView) =>
  `№ ${v.registryNumber} — ${v.productName.length > 90 ? `${v.productName.slice(0, 90)}…` : v.productName} · ${v.enterpriseName.length > 40 ? `${v.enterpriseName.slice(0, 40)}…` : v.enterpriseName} (${v.registries.map((k) => REGISTRY_SHORT[k]).join(', ')})${v.validUntil ? ` · до ${dateRu(v.validUntil)}` : ''}`;

/**
 * Номер позиции под её названием: выпадающий список вариантов, а у подобранного автоматически — заметная пометка «Проверьте обязательно»
 * и кнопка «Всё верно». Выбор в списке — это решение участника: пометка снимается.
 */
function NumberPicker({ position, onSelect, onSkip }: { position: PositionView; onSelect: (number: string) => void; onSkip: () => void }) {
  const { card, decision, choice } = position;
  const current = choice && !position.cardChanged ? choice : undefined;
  const unverified = Boolean(current && !current.confirmedAt && current.basis === 'auto_picked');
  const found = decision ? optionsOf(decision) : [];
  // Текущий номер должен быть в списке, даже когда варианты ещё не найдены (после перезагрузки страницы они ищутся заново).
  const items = found.map((v) => ({ number: v.registryNumber, label: optionLabel(v) }));
  if (current && !items.some((x) => x.number === current.registryNumber)) {
    items.unshift({ number: current.registryNumber, label: `№ ${current.registryNumber} — ${current.record.productName} · ${current.record.enterpriseName} (${REGISTRY_SHORT[current.registryKind]})` });
  }
  if (position.status === 'searching' && !current) {
    return (
      <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Ищем варианты номера…
      </p>
    );
  }
  if (items.length === 0) return null;
  const many = (current?.options ?? found.length) > 1;
  const choosing = !current && !position.skipped;
  return (
    <div className={cx('space-y-2 border-t px-3 py-2.5', unverified ? 'border-warn/50 bg-warn-surface' : 'border-border')}>
      {choosing && (
        <p className="text-[12px] text-muted-foreground">
          Номер сам не подставлен: совпадения по названию недостаточно, чтобы быть уверенным. Выберите подходящую запись из списка — номер пойдёт в заявку.
        </p>
      )}
      {unverified && (
        <p className="flex items-start gap-1.5 text-[12px] font-medium text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Проверьте обязательно: номер подобран автоматически{many ? `, вариантов — ${current?.options ?? found.length}` : ''}. Сверьте с вашим товаром и выберите нужный в списке — пока вы не
            подтвердили, в заявке номер выделен жёлтым и помечен «ПРОВЕРЬТЕ».
          </span>
        </p>
      )}
      {position.skipped && !current && (
        <p className="text-[12px] text-muted-foreground">
          Вы отметили, что товара нет в реестрах, — номер в заявку не пойдёт. Если он всё-таки есть — выберите его в списке. {BAN_DECLARATION_SHORT}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`rg-pick-${card.key}`} className="mb-1 block text-[12px] font-medium">
            Номер реестровой записи{items.length > 1 ? ` (вариантов: ${items.length})` : ''}
          </label>
          <select
            id={`rg-pick-${card.key}`}
            value={current?.registryNumber ?? ''}
            onChange={(e) => e.target.value && onSelect(e.target.value)}
            className={inputClass}
          >
            {!current && <option value="">— выберите номер —</option>}
            {items.map((x) => (
              <option key={x.number} value={x.number}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        {unverified && current && (
          <>
            <Button size="sm" onClick={() => onSelect(current.registryNumber)}>
              <CheckCircle2 className="size-3.5" />
              Всё верно
            </Button>
            <Button size="sm" variant="secondary" onClick={onSkip}>
              Нет в реестре
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PositionCard({
  position,
  index,
  open,
  onToggle,
  props,
}: {
  position: PositionView;
  index: number;
  open: boolean;
  onToggle: () => void;
  props: RegistryNumbersProps;
}) {
  const { card, decision, choice, status } = position;
  const [note, setNote] = useState('');
  const busy = status === 'searching';
  const autoPicked = Boolean(choice && !choice.confirmedAt && choice.basis === 'auto_picked' && !position.cardChanged);
  // Реестр участник не выбирает: ищем сразу во всех загруженных. Поиск доступен и тогда, когда требование в документах не найдено.
  const usable = position.status !== 'unsupported_registry';
  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
      >
        <span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1 text-[13px] font-medium">
          {card.name}
          {card.quantity && <span className="ml-1.5 font-normal text-muted-foreground">· {card.quantity}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {choice && !position.cardChanged && autoPicked && (
            <Badge tone="warn" wrap>
              <AlertTriangle className="size-3 shrink-0" />№ {choice.registryNumber} · проверьте обязательно
            </Badge>
          )}
          {choice && !position.cardChanged && !autoPicked && (
            <Badge tone="neutral" wrap>
              <ListChecks className="size-3 shrink-0" />№ {choice.registryNumber} · {choice.basis === 'auto_proven' ? 'подтверждена совпадением' : 'выбрана вами'}
            </Badge>
          )}
          {position.cardChanged && (
            <Badge tone="warn">
              <AlertTriangle className="size-3" />
              Данные о товаре изменились
            </Badge>
          )}
          {!(choice && status === 'pending') && <StatusBadge status={status} />}
          <ChevronDown className={cx('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      <NumberPicker position={position} onSelect={(number) => props.onSelect(card.key, number, '')} onSkip={() => props.onCancel(card.key)} />
      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          {position.error && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              {position.error}
            </p>
          )}

          {usable ? (
            <>
              <CardForm
                key={`${card.key}:${JSON.stringify(card.fields)}:${card.offeredName?.value ?? ''}`}
                card={card}
                busy={busy || props.searching}
                onSave={(edits) => props.onSaveAndSearch(card.key, edits)}
              />

              {decision && (
                <section aria-label="Результат поиска" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={decision.status} />
                    {decision.proposed && <span className="text-[12px]">Предложена запись № {decision.proposed}</span>}
                  </div>
                  <ul className="space-y-1">
                    {decision.reasons.map((r, i) => (
                      <li key={i} className="text-[12px]">{r}</li>
                    ))}
                  </ul>
                  {decision.missing.length > 0 && (
                    <div className="rounded-md border border-warn/40 bg-warn-surface px-3 py-2 text-[12px] text-warn-foreground">
                      <p className="font-medium">Чего не хватает, чтобы подтвердить запись:</p>
                      <ul className="mt-1 list-disc pl-4">
                        {decision.missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {decision.differences.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">Найденные записи различаются по: {decision.differences.join(', ')}.</p>
                  )}
                  {decision.candidates.length > 0 && (
                    <>
                      <p className="text-[12px] text-muted-foreground">
                        Показано записей: {decision.candidates.length}
                        {decision.matchedTotal > decision.candidates.length && ` из ${decision.matchedTotal}`}. Название лишь помогает найти кандидатов — выбор делается по производителю, модели и ТУ.
                      </p>
                      <ul className="space-y-2">
                        {decision.candidates.map((c) => (
                          <CandidateRow
                            key={c.registryNumber}
                            view={c}
                            proposed={decision.proposed === c.registryNumber}
                            selected={choice?.registryNumber === c.registryNumber}
                            autoPicked={autoPicked && choice?.registryNumber === c.registryNumber}
                            duplicates={duplicatesOf(decision.candidates, c)}
                            onSelect={() => props.onSelect(card.key, c.registryNumber, note)}
                          />
                        ))}
                      </ul>
                      <div>
                        <label htmlFor={`rg-note-${card.key}`} className="mb-1 block text-[12px] font-medium">
                          Почему выбрали эту запись (необязательно, сохранится в истории)
                        </label>
                        <input id={`rg-note-${card.key}`} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} autoComplete="off" />
                      </div>
                    </>
                  )}
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-muted-foreground">Что и где искали, на каких допущениях</summary>
                    <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                      {decision.search.filters.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                      <li>
                        Самая старая из выгрузок — от {instantRu(decision.search.dataset?.exportedAt)}, загружена {instantRu(decision.search.dataset?.importedAt)}. Запись должна
                        действовать на {dateRu(decision.search.asOf)}.
                      </li>
                      {decision.assumptions.map((a, i) => (
                        <li key={`a${i}`}>Допущение: {a}</li>
                      ))}
                    </ul>
                  </details>
                </section>
              )}
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {position.status === 'unsupported_registry' && 'Для этой закупки нужен реестр, выгрузки которого в системе нет: поиск не выполняется.'}
            </p>
          )}

          {choice && (
            <section aria-label="Выбранная запись" className="space-y-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
              <p className="text-[13px] font-medium">
                {autoPicked ? 'Подобрана запись' : 'Выбрана запись'} № {choice.registryNumber} ({REGISTRY_SHORT[choice.registryKind]}) —{' '}
                {choice.basis === 'auto_picked'
                  ? 'подобрана автоматически, ждёт вашей проверки'
                  : choice.basis === 'auto_proven'
                    ? 'система доказала совпадение, вы подтвердили'
                    : 'выбор участника: объективных подтверждений недостаточно'}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {choice.record.enterpriseName} · {choice.record.productName}
                {choice.confirmedAt ? ` · подтверждено ${instantRu(choice.confirmedAt)}` : ''}
                {choice.note && ` · «${choice.note}»`}
              </p>
              <p className="text-[12px] text-muted-foreground">
                Из реестра: {scoreText(choice.record.points, choice.record.percent) ?? 'баллы и процентный показатель в записи не указаны'}.
              </p>
              {position.autofill.ok ? (
                position.autofill.unverified ? (
                  <p className="flex items-start gap-1.5 text-[12px] text-warn-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />В заявку будет вписано, выделено жёлтым и с пометкой «ПРОВЕРЬТЕ»: {position.autofill.line}
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-[12px] text-success">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />В заявку будет вписано: {position.autofill.line}
                  </p>
                )
              ) : (
                <p className="flex items-start gap-1.5 text-[12px] text-warn-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Номер в заявку не вписывается: {position.autofill.reason}.
                </p>
              )}
              {!autoPicked && (
                <Button size="sm" variant="secondary" onClick={() => props.onCancel(card.key)}>
                  Отменить выбор
                </Button>
              )}
            </section>
          )}
        </div>
      )}
    </li>
  );
}

export function RegistryNumbers(props: RegistryNumbersProps) {
  const { demand, datasets, positions } = props;
  const [openKey, setOpenKey] = useState<string | null>(positions.length === 1 ? positions[0].card.key : null);
  // Возраст считаем по самой старой из выгрузок: честнее, чем по самой свежей.
  const stamps = (datasets ?? []).map((d) => d.exportedAt).filter((x): x is string => Boolean(x)).map((x) => Date.parse(x));
  const age = stamps.length ? Math.floor(((props.now ?? Date.now()) - Math.min(...stamps)) / 86400000) : null;
  const stale = age !== null && age > STALE_DAYS;
  const withNumber = positions.filter((p) => p.choice && p.autofill.ok).length;
  // Номер подобрала система, участник его ещё не проверил: такие места в заявке выделены и считаются незаполненными.
  const unverifiedCount = positions.filter((p) => p.choice && p.autofill.ok && p.autofill.unverified).length;
  const searchable = positions.filter((p) => p.status !== 'unsupported_registry');

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4" />
          <span className="text-sm font-medium">Реестровые номера товаров</span>
          <HelpTip content="В заявке у каждого товара нужен номер записи из реестра российской продукции. Программа ищет записи в обоих реестрах. Когда закупка требует номер, подставляет лучший и помечает его «проверьте обязательно»; когда не говорит о нём — подставляет, только если уверена, иначе даёт список на выбор. По одному названию товар не определить: подтверждает номер человек." align="start" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {demand.status === 'found' && <Badge tone="info">Требование обнаружено</Badge>}
          {demand.status === 'unclear' && <Badge tone="warn">Требуется уточнение реестра</Badge>}
          {demand.status === 'none' && <Badge tone="neutral">В документах о номере не сказано</Badge>}
          {positions.length > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">в заявку попадёт номеров: {withNumber} из {positions.length}</span>
          )}
          {unverifiedCount > 0 && (
            <Badge tone="warn">
              <AlertTriangle className="size-3" />
              Ждут проверки: {unverifiedCount}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-3">
        {unverifiedCount > 0 && (
          <section aria-label="Нужна проверка" className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn-surface px-3 py-2.5 text-[13px] text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              <b className="font-semibold">Проверьте обязательно.</b> Номера подобраны автоматически у позиций: {unverifiedCount} из {positions.length}. Сверьте каждый с вашим товаром
              и выберите нужный в списке под названием позиции или нажмите «Всё верно». Пока вы не подтвердили, в заявке номер выделен жёлтым и помечен «ПРОВЕРЬТЕ».
            </p>
          </section>
        )}
        <section aria-label="Что требует закупка" className="space-y-2 text-[13px]">
          {demand.status === 'none' && (
            <p className="text-muted-foreground">
              В документах закупки о номере реестровой записи не сказано, но он нужен у каждого товара. Поиск идёт сразу в обоих реестрах. Если программа
              уверена в записи, номер подставится сам и будет помечен «проверьте обязательно»; если нет — под товаром появится список вариантов, выберите
              нужный. Товара нет в реестрах — нажмите «Нет в реестре».
            </p>
          )}
          {demand.status === 'found' && !demand.unsupported && demand.registry && (
            <p>
              Закупка требует подтвердить происхождение товара по реестру: <b className="font-medium">{REGISTRY_TITLES[demand.registry]}</b>.
            </p>
          )}
          {demand.notes.map((n, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {n}
            </p>
          ))}
          {(demand.status !== 'none' || positions.some((p) => p.skipped)) && (
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {BAN_DECLARATION_NOTE}
            </p>
          )}
          {demand.mentions.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground">Где в документах об этом сказано ({demand.mentions.length})</summary>
              <ul className="mt-1.5 space-y-2">
                {demand.mentions.map((m, i) => (
                  <li key={i} className="rounded-md bg-secondary/50 px-2.5 py-1.5">
                    <p className="italic">«{m.quote}»</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {m.place ?? m.document} ·{' '}
                      {m.role === 'requirement' ? 'требование' : m.role === 'exemption' ? 'оговорка «не применяется»' : 'упоминание'}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section aria-label="Данные реестра" className="rounded-md bg-secondary/40 px-3 py-2 text-[12px]">
          {props.datasetError ? (
            <p role="alert" className="flex items-start gap-1.5 text-danger">
              <XCircle className="mt-0.5 size-3.5 shrink-0" />
              {props.datasetError}
            </p>
          ) : datasets === undefined ? (
            <p className="text-muted-foreground">Сведения о выгрузках реестров ещё не загружены — нажмите «Найти в реестре» у позиции.</p>
          ) : datasets.length === 0 ? (
            <p className="flex items-start gap-1.5 text-warn-foreground">
              <Archive className="mt-0.5 size-3.5 shrink-0" />
              Выгрузки реестров ещё не загружены на сервер, поэтому поиск невозможен. Загрузку выполняет администратор.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-muted-foreground">Ищем сразу в {datasets.length === 1 ? 'загруженном реестре' : 'обоих реестрах'}: выбирать реестр не нужно.</p>
              {datasets.map((d) => (
                <p key={d.registry}>
                  {REGISTRY_SHORT[d.registry]}: выгрузка от <b className="font-medium">{instantRu(d.exportedAt)}</b>, загружена {instantRu(d.importedAt)}.
                </p>
              ))}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {stale ? (
                  <Badge tone="warn">
                    <RefreshCw className="size-3" />
                    Данные требуют обновления ({age} дн.)
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Реестр меняется каждый день: данные верны на дату выгрузки.</span>
                )}
              </p>
            </div>
          )}
        </section>

        {searchable.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={props.searching} onClick={() => props.onSearch(searchable.map((p) => p.card.key))}>
              {props.searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Найти для всех позиций
            </Button>
            <span className="text-[12px] text-muted-foreground">{demand.status === 'none'
                ? 'Если программа уверена в записи, номер подставится сам и будет помечен «проверьте обязательно»; иначе выберите из списка.'
                : 'Если вариантов несколько, лучший номер подставится сам и будет помечен «проверьте обязательно».'}</span>
          </div>
        )}

        {positions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">В ТП пока нет перечня товаров. Составьте ТП на шаге «Проверка» — позиции появятся здесь.</p>
        ) : (
          <ul className="space-y-2">
            {positions.map((p, i) => (
              <PositionCard
                key={p.card.key}
                position={p}
                index={i}
                open={openKey === p.card.key}
                onToggle={() => setOpenKey(openKey === p.card.key ? null : p.card.key)}
                props={props}
              />
            ))}
          </ul>
        )}

        {props.log.length > 0 && (
          <details className="text-[12px]">
            <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <History className="size-3.5" />
              История решений ({props.log.length})
            </summary>
            <ul className="mt-1.5 space-y-1">
              {[...props.log].reverse().slice(0, 30).map((e, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-mono">{instantRu(e.at)} {moscowTime(e.at)}</span> — {e.text}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Номер вписывается в файлы заявки, пока сведения о товаре не менялись после выбора. Подобранный автоматически выделен жёлтым и помечен «ПРОВЕРЬТЕ», пока вы
          его не выберете или не подтвердите. Программа не подтверждает юридическую достаточность реестровой записи: проверьте её на сайте ГИСП перед подачей.
        </p>
      </div>
    </Card>
  );
}
