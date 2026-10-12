import { useState, type ReactNode } from 'react';
import type { CardEdits, ProductCard } from '@/lib/product-card';
import type { RegistryDemand } from '@/lib/registry-demand';
import { STALE_DAYS, STATUS_TEXT, selectable, type CandidateView, type DatasetRef, type Decision, type DecisionStatus } from '@/lib/registry-decision';
import type { AutofillCheck, RegistryChoice, RegistryLogEntry } from '@/lib/registry-log';
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
};

export type RegistryNumbersProps = {
  demand: RegistryDemand;
  required: RegistryKind | null;
  chosenRegistry: RegistryKind | undefined;
  onChooseRegistry: (kind: RegistryKind) => void;
  /** undefined — ещё грузится; null — выгрузки на сервере нет. */
  dataset: DatasetRef | null | undefined;
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

const STATUS_STYLE: Record<DecisionStatus | 'searching', { tone: Tone; icon: ReactNode }> = {
  no_requirement: { tone: 'neutral', icon: <Info className="size-3" /> },
  clarify_registry: { tone: 'warn', icon: <HelpCircle className="size-3" /> },
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
    <Badge tone={style.tone}>
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
  duplicates,
  onSelect,
}: {
  view: CandidateView;
  proposed: boolean;
  selected: boolean;
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
            {selected && <Badge tone="neutral">Выбрана</Badge>}
            {duplicates > 0 && (
              <Badge tone="warn">
                <AlertTriangle className="size-3" />
                Такое же название ещё у {duplicates} {duplicates === 1 ? 'записи' : 'записей'} — выберите свой номер
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[13px] font-medium">{view.productName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant={proposed ? 'primary' : 'secondary'} disabled={!can || selected} onClick={onSelect} title={blockReason || undefined}>
            {selected ? 'Выбрана' : 'Выбрать'}
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
  const usable = position.status !== 'no_requirement' && position.status !== 'unsupported_registry' && position.status !== 'clarify_registry';
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
          {choice && !position.cardChanged && (
            <Badge tone="neutral">
              <ListChecks className="size-3" />№ {choice.registryNumber} · {choice.basis === 'auto_proven' ? 'подтверждена совпадением' : 'выбрана вами'}
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
                        Выгрузка реестра от {instantRu(decision.search.dataset?.exportedAt)}, загружена {instantRu(decision.search.dataset?.importedAt)}. Запись должна
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
              {position.status === 'no_requirement' && 'В документах закупки не найдено требование о реестровом номере для этой позиции.'}
              {position.status === 'unsupported_registry' && 'Для этой закупки нужен реестр, выгрузки которого в системе нет: поиск не выполняется.'}
              {position.status === 'clarify_registry' && 'Сначала выберите реестр выше.'}
            </p>
          )}

          {choice && (
            <section aria-label="Выбранная запись" className="space-y-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
              <p className="text-[13px] font-medium">
                Выбрана запись № {choice.registryNumber} —{' '}
                {choice.basis === 'auto_proven' ? 'система доказала совпадение, вы подтвердили' : 'выбор участника: объективных подтверждений недостаточно'}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {choice.record.enterpriseName} · {choice.record.productName} · подтверждено {instantRu(choice.confirmedAt)}
                {choice.note && ` · «${choice.note}»`}
              </p>
              <p className="text-[12px] text-muted-foreground">
                Из реестра: {scoreText(choice.record.points, choice.record.percent) ?? 'баллы и процентный показатель в записи не указаны'}.
              </p>
              {position.autofill.ok ? (
                <p className="flex items-start gap-1.5 text-[12px] text-success">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />В заявку будет вписано: {position.autofill.line}
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-[12px] text-warn-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Номер в заявку не вписывается: {position.autofill.reason}.
                </p>
              )}
              <Button size="sm" variant="secondary" onClick={() => props.onCancel(card.key)}>
                Отменить выбор
              </Button>
            </section>
          )}
        </div>
      )}
    </li>
  );
}

export function RegistryNumbers(props: RegistryNumbersProps) {
  const { demand, required, dataset, positions } = props;
  const [openKey, setOpenKey] = useState<string | null>(positions.length === 1 ? positions[0].card.key : null);
  const age = dataset?.exportedAt ? Math.floor(((props.now ?? Date.now()) - Date.parse(dataset.exportedAt)) / 86400000) : null;
  const stale = age !== null && age > STALE_DAYS;
  const withNumber = positions.filter((p) => p.choice && p.autofill.ok).length;
  const searchable = positions.filter((p) => p.status !== 'no_requirement' && p.status !== 'unsupported_registry' && p.status !== 'clarify_registry');

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4" />
          <span className="text-sm font-medium">Реестровые номера товаров</span>
          <HelpTip content="Если закупка требует подтвердить российское происхождение, в заявке нужен номер записи из реестра. Программа ищет кандидатов в выгрузке реестра, но выбирает номер человек: по одному названию товар не определить." align="start" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {demand.status === 'found' && <Badge tone="info">Требование обнаружено</Badge>}
          {demand.status === 'unclear' && <Badge tone="warn">Требуется уточнение реестра</Badge>}
          {demand.status === 'none' && <Badge tone="neutral">Требование не обнаружено</Badge>}
          {positions.length > 0 && demand.status !== 'none' && (
            <span className="font-mono text-[11px] text-muted-foreground">в заявку попадёт номеров: {withNumber} из {positions.length}</span>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-3">
        <section aria-label="Что требует закупка" className="space-y-2 text-[13px]">
          {demand.status === 'none' && (
            <p className="text-muted-foreground">
              В документах закупки не найдено требование о номере реестровой записи. Если вы знаете, что оно есть (например, в документе, который не загружен),
              укажите реестр ниже.
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
          {(demand.status !== 'found' || !demand.registry) && !demand.unsupported && !required && (
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] font-medium">В каком реестре искать?</legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="registry-kind" checked={props.chosenRegistry === 'gisp_rpp_719'} onChange={() => props.onChooseRegistry('gisp_rpp_719')} />
                {REGISTRY_TITLES.gisp_rpp_719}
              </label>
            </fieldset>
          )}
        </section>

        <section aria-label="Данные реестра" className="rounded-md bg-secondary/40 px-3 py-2 text-[12px]">
          {props.datasetError ? (
            <p role="alert" className="flex items-start gap-1.5 text-danger">
              <XCircle className="mt-0.5 size-3.5 shrink-0" />
              {props.datasetError}
            </p>
          ) : dataset === undefined ? (
            <p className="text-muted-foreground">Сведения о выгрузке реестра ещё не загружены — нажмите «Найти в реестре» у позиции.</p>
          ) : dataset === null ? (
            <p className="flex items-start gap-1.5 text-warn-foreground">
              <Archive className="mt-0.5 size-3.5 shrink-0" />
              Выгрузка реестра ещё не загружена на сервер, поэтому поиск невозможен. Загрузку выполняет администратор.
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {required ? REGISTRY_SHORT[required] : 'Реестр'}: выгрузка от <b className="font-medium">{instantRu(dataset.exportedAt)}</b>, загружена {instantRu(dataset.importedAt)}.
              </span>
              {stale ? (
                <Badge tone="warn">
                  <RefreshCw className="size-3" />
                  Данные требуют обновления ({age} дн.)
                </Badge>
              ) : (
                <span className="text-muted-foreground">Реестр меняется каждый день: данные верны на дату выгрузки.</span>
              )}
            </p>
          )}
        </section>

        {searchable.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={props.searching} onClick={() => props.onSearch(searchable.map((p) => p.card.key))}>
              {props.searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Найти для всех позиций
            </Button>
            <span className="text-[12px] text-muted-foreground">По ТЗ без сведений о вашем товаре покажем только кандидатов — номер не выбирается.</span>
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
          Номер вписывается в файлы заявки только для позиций, где вы выбрали запись и сведения о товаре не менялись после выбора. Программа не подтверждает
          юридическую достаточность реестровой записи: проверьте её на сайте ГИСП перед подачей.
        </p>
      </div>
    </Card>
  );
}
