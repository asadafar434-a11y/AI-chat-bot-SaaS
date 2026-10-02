import { useMemo, useState, type ReactNode } from 'react';
import { dueLine } from '@/lib/deadline';
import { FACT_KIND_KEYS, FACT_KINDS, findValidity, todayIso, validityAt, type Fact, type FactKind } from '@/lib/evidence-base';
import { confirmed, draftOf, emptyDraft, factFromDraft, MEASURE_PRESETS, type Draft } from '@/lib/evidence-form';
import { EVIDENCE_TEXT, gapsOf, type Gap } from '@/lib/evidence-match';
import { deleteFact, saveFacts } from '@/lib/evidence-store';
import { evidenceSummary, factLines, gapFrom, gapPurchases, sourceLine, STATUS_HINT, STATUS_TONE, validityBadge } from '@/lib/evidence-view';
import { errorMessage } from '@/lib/http-error';
import { DOC_KINDS, FACT_SOURCE_KINDS, type DocKind } from '@/lib/my-docs';
import { findFactsInDocuments, type MyDocument } from '@/lib/me-store';
import { plural } from '@/lib/plural';
import { filledCount, PROFILE_KEYS, type Profile as ProfileData, type ProfileKey } from '@/lib/profile';
import { quoteFound } from '@/lib/quotes';
import { profileProblems } from '@/lib/requisites-check';
import { usePurchases } from '@/lib/use-purchases';
import { useFacts } from '../real/hooks';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Check,
  FileText,
  Info,
  Loader2,
  Package,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  User,
  UserCheck,
  Wallet,
  X,
} from '../lib/icons';
import { Badge, Button, Card, HelpTip, IconButton, Tooltip, cx, type Tone } from './ui';

// «База доказательств» — раздел «Профиля компании»: факты о компании — лицензии, сертификаты, документы, опыт, сотрудники, оборудование,
// финансы — и чем каждый подтверждён: документ и место в нём, срок действия. Ниже — что требуют закупки и чего в базе не хватает:
// требование → какое доказательство нужно → что есть у компании → проверка. Нет доказательства — «нет доказательства» или «решает
// человек», а не придуманное значение (web/src/lib/evidence-*.ts). Вид — прототипа, данные — настоящие, из браузера (IndexedDB).

const KIND_ICON: Record<FactKind, typeof FileText> = {
  license: ShieldCheck,
  certificate: Star,
  document: FileText,
  experience: Briefcase,
  employee: User,
  qualification: UserCheck,
  equipment: Package,
  finance: Wallet,
};

const INPUT =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground focus:ring-2 focus:ring-ring/20';

type Outcome = { tone: 'ok' | 'info' | 'warn'; text: string };
export type EvidenceDoc = Pick<MyDocument, 'id' | 'name' | 'text' | 'kinds' | 'map'>;
type Filter = FactKind | 'all' | 'requisites' | 'templates';
const isKind = (filter: Filter): filter is FactKind => filter in FACT_KINDS;

function Notice({ tone, children }: { tone: Outcome['tone']; children: ReactNode }) {
  const Icon = tone === 'ok' ? Check : tone === 'warn' ? AlertTriangle : Info;
  return (
    <p
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2 rounded-md px-3 py-2 text-[13px] leading-snug',
        tone === 'ok' && 'bg-success/10 text-success',
        tone === 'warn' && 'bg-warn-surface/50 text-warn-foreground',
        tone === 'info' && 'bg-info/10 text-info',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

// ———— Форма факта ————

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function FactForm({
  initial,
  docs,
  editing,
  onSave,
  onCancel,
}: {
  initial: Draft;
  docs: EvidenceDoc[];
  // Правка существующего факта: вид не меняется.
  editing?: Fact;
  onSave: (fact: Fact) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState('');
  const meta = FACT_KINDS[draft.kind];
  const doc = docs.find((d) => d.id === draft.docId);
  const found = useMemo(() => (doc ? findValidity(doc.text).slice(0, 3) : []), [doc]);
  const quoteMissing = Boolean(doc && draft.quote.trim() && !quoteFound(draft.quote, [doc.text]));

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setField = (key: string, value: string) => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } });
  const setMeasure = (i: number, patch: Partial<Draft['measures'][number]>) =>
    set({ measures: draft.measures.map((m, k) => (k === i ? { ...m, ...patch } : m)) });

  function submit() {
    const result = factFromDraft(draft, docs, editing);
    if ('error' in result) setError(result.error);
    else onSave(result.fact);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4 border-t border-border bg-secondary/30 px-4 py-4"
      aria-label={editing ? 'Правка факта' : 'Новый факт'}
    >
      <p className="text-sm font-medium">{editing ? 'Правка: ' : 'Новый факт: '}{meta.one.toLowerCase()}</p>

      {!editing && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Вид факта">
          {FACT_KIND_KEYS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={draft.kind === kind}
              onClick={() => set({ kind, fields: {}, measures: [] })}
              className={cx(
                'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                draft.kind === kind ? 'border-foreground bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-secondary',
              )}
            >
              {FACT_KINDS[kind].one}
            </button>
          ))}
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">{meta.hint}</p>

      <Field label="Название — что это">
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className={INPUT} autoComplete="off" placeholder="например, Лицензия на образовательную деятельность № Л035-00115-77" />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {meta.fields.map((def) => (
          <Field key={def.key} label={def.label}>
            <input
              type={'date' in def && def.date ? 'date' : 'text'}
              value={draft.fields[def.key] ?? ''}
              onChange={(e) => setField(def.key, e.target.value)}
              className={INPUT}
              autoComplete="off"
              placeholder={'example' in def ? def.example : undefined}
            />
          </Field>
        ))}
      </div>

      {meta.validity !== 'none' && (
        <fieldset className="space-y-2">
          <legend className="text-[12px] text-muted-foreground">Срок действия{meta.validity === 'required' ? ' — нужен: без него система не скажет, действует ли документ' : ''}</legend>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={draft.perpetual} onChange={(e) => set({ perpetual: e.target.checked })} className="size-4" />
            Бессрочно
          </label>
          {!draft.perpetual && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Действует с">
                <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className={INPUT} />
              </Field>
              <Field label="Действует до">
                <input type="date" value={draft.until} onChange={(e) => set({ until: e.target.value })} className={INPUT} />
              </Field>
            </div>
          )}
          {found.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <span>В документе есть срок:</span>
              {found.map((v) => (
                <button
                  key={v.quote}
                  type="button"
                  onClick={() => set({ perpetual: Boolean(v.perpetual), from: v.from ?? '', until: v.until ?? '', quote: draft.quote || v.quote })}
                  className="rounded-md border border-border bg-card px-2 py-1 text-left text-foreground hover:bg-secondary"
                >
                  «{v.quote}»{v.computed ? ' (посчитано)' : ''} — подставить
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="space-y-2">
        <p className="text-[12px] text-muted-foreground">Числа — по ним факт сверяется с требованием заказчика («зал не менее 150 мест»)</p>
        {draft.measures.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_90px_28px] items-center gap-2">
            <input aria-label="Название числа" value={m.what} onChange={(e) => setMeasure(i, { what: e.target.value })} className={INPUT} placeholder="вместимость" />
            <input aria-label="Значение" value={m.value} onChange={(e) => setMeasure(i, { value: e.target.value })} className={INPUT} inputMode="decimal" placeholder="200" />
            <input aria-label="Единица" value={m.unit} onChange={(e) => setMeasure(i, { unit: e.target.value })} className={INPUT} placeholder="мест" />
            <IconButton label="Убрать число" onClick={() => set({ measures: draft.measures.filter((_, k) => k !== i) })}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {[...MEASURE_PRESETS[draft.kind], { what: '', unit: '' }].map((p) => (
            <Button key={p.what || 'own'} size="sm" variant="secondary" type="button" onClick={() => set({ measures: [...draft.measures, { what: p.what, value: '', unit: p.unit }] })}>
              <Plus className="size-3.5" /> {p.what ? `${p.what}, ${p.unit}` : 'Своё число'}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Field label="Чем подтверждено — документ из «Образцов и документов»">
          <select value={draft.docId} onChange={(e) => set({ docId: e.target.value })} className={INPUT}>
            <option value="">Без документа — вписываю сам</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        {doc ? (
          <>
            <Field label="Фраза из документа, на которой основан факт (по желанию)">
              <input value={draft.quote} onChange={(e) => set({ quote: e.target.value })} className={INPUT} autoComplete="off" placeholder="дословно, например: Лицензия действительна до 12.05.2027" />
            </Field>
            {quoteMissing && <p className="text-[12px] text-warn-foreground">Такой фразы в документе нет — проверьте, что вписано дословно.</p>}
          </>
        ) : (
          <Field label="Откуда это известно (по желанию)">
            <input value={draft.note} onChange={(e) => set({ note: e.target.value })} className={INPUT} autoComplete="off" placeholder="например, со слов директора" />
          </Field>
        )}
        {!doc && <p className="text-[12px] text-muted-foreground">Без документа это только ваши слова: там, где заказчик просит копию документа, система напишет «нет доказательства».</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          <Check className="size-3.5" /> {editing ? 'Сохранить' : 'Добавить в базу'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

// ———— Строка факта ————

export function FactRow({
  fact,
  on,
  showKind,
  onEdit,
  onDelete,
  onConfirm,
}: {
  fact: Fact;
  on: string;
  showKind: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const Icon = KIND_ICON[fact.kind];
  const badge = validityBadge(fact, on);
  const lines = factLines(fact);
  const waiting = fact.origin === 'ai' && !fact.confirmed;
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{fact.title}</p>
          {/* Бейджи — под названием, а не справа: на телефоне справа они сжимали название до буквы в строке. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {showKind && <Badge>{FACT_KINDS[fact.kind].one}</Badge>}
            {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
          </div>
          {lines.length > 0 && <p className="mt-1 break-words text-[12px] text-muted-foreground">{lines.join(' · ')}</p>}
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{sourceLine(fact)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Изменить" onClick={onEdit}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label="Удалить" tone="danger" align="end" onClick={() => setAsking(!asking)}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      {waiting && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-[13px]">
          <span className="text-warn-foreground">Нашёл ИИ в документе — сверьте с ним и подтвердите. Пока не подтверждено, это не доказательство.</span>
          <Button size="sm" onClick={onConfirm}>
            <Check className="size-3.5" /> Подтверждаю
          </Button>
        </div>
      )}
      {asking && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-[13px]">
          <span>Удалить факт из базы?</span>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Удалить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  );
}

// ———— Что требуют закупки ————

export function GapList({ gaps, onAdd }: { gaps: Gap[]; onAdd: (gap: Gap) => void }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="divide-y divide-border" aria-label="Что требуют ваши закупки">
      {gaps.map((gap) => {
        const addable = gap.kind !== 'requisite' && (gap.status === 'needs_evidence' || gap.status === 'mismatch' || gap.status === 'expired');
        return (
          <li key={gap.key} className="space-y-1.5 px-4 py-3">
            <div>
              <p className="break-words text-sm font-medium">{gap.label}</p>
              {/* Статус — под названием: справа он на телефоне сжимал название в узкую колонку. */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Tooltip content={STATUS_HINT[gap.status]} align="start">
                  <Badge tone={STATUS_TONE[gap.status] as Tone}>{EVIDENCE_TEXT[gap.status]}</Badge>
                </Tooltip>
                {gap.optional && (
                  <Tooltip content="Заявку без этого подадут, но баллов или удобства будет меньше." align="start">
                    <Badge>по желанию или за баллы</Badge>
                  </Tooltip>
                )}
              </div>
              {gapFrom(gap).map((line) => (
                <p key={line} className="mt-1 break-words text-[12px] text-muted-foreground">
                  {line}
                </p>
              ))}
              <p className="mt-0.5 break-words text-[12px] text-muted-foreground">{gapPurchases(gap)}</p>
            </div>
            {gap.reasons.slice(0, 3).map((r) => (
              <p key={r} className="break-words text-[12px] text-muted-foreground">
                {r}
              </p>
            ))}
            {addable && (
              <Button size="sm" variant="secondary" onClick={() => onAdd(gap)}>
                <Plus className="size-3.5" /> Добавить в базу
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ———— Раздел целиком ————

const PAGE = 15;

// Что сказать о реквизитах и шаблонах: они не факты базы — лежат выше и ниже в профиле, здесь только сводка.
export type EvidenceSummaryInfo = {
  requisites: { filled: number; total: number; sources: string[]; problems: string[] };
  templates: { label: string; count: number }[];
};

export function EvidenceSection({
  facts,
  docs,
  on,
  info,
  gaps,
  busy,
  notice,
  eligible,
  onFind,
  onSave,
  onDelete,
  onConfirm,
  initialForm = null,
  initialFilter = 'all',
}: {
  facts: Fact[];
  docs: EvidenceDoc[];
  on: string;
  info: EvidenceSummaryInfo;
  gaps: Gap[];
  busy: boolean;
  notice: Outcome | null;
  // Сколько документов подходит для поиска фактов.
  eligible: number;
  onFind: () => void;
  onSave: (fact: Fact) => void;
  onDelete: (id: string) => void;
  onConfirm: (id: string) => void;
  initialForm?: { draft: Draft; editing?: Fact } | null;
  initialFilter?: Filter;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [form, setForm] = useState<{ draft: Draft; editing?: Fact } | null>(initialForm);
  const [limit, setLimit] = useState(PAGE);

  const summary = evidenceSummary(facts, on);
  const counts = (kind: FactKind) => facts.filter((f) => f.kind === kind).length;
  const shown = useMemo(() => {
    const list = filter === 'all' ? facts : facts.filter((f) => f.kind === filter);
    // Сначала то, что требует внимания: просрочено, нет срока, ждёт подтверждения, скоро кончится.
    const rank = (f: Fact) => {
      const at = validityAt(f.validity, on);
      if (at.state === 'expired') return 0;
      if (f.origin === 'ai' && !f.confirmed) return 1;
      if (at.state === 'unknown' && FACT_KINDS[f.kind].validity === 'required') return 1;
      if (at.state === 'valid' && at.days! <= 30) return 2;
      return 3;
    };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [facts, filter, on]);
  const attention = gaps.filter((g) => g.status !== 'ok');

  const chip = (key: Filter, label: string, n?: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => {
        setFilter(key);
        setLimit(PAGE);
      }}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
        filter === key ? 'border-foreground bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
      {n !== undefined && <span className="font-mono font-semibold tabular-nums text-foreground">{n}</span>}
    </button>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">
            База доказательств{facts.length > 0 && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{facts.length}</span>}
          </h2>
          <p className="mt-0.5 max-w-[70ch] text-[12px] text-muted-foreground">
            Что известно о вашей компании и чем это подтверждено: лицензии, сертификаты, договоры, сотрудники, оборудование, финансы. У каждого факта —
            документ-источник и срок действия. Нет документа — система так и скажет, а не придумает.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip
            content="ИИ найдёт в ваших документах лицензии, договоры, сотрудников и другие факты. Каждый факт программа сверит с текстом документа, а вы подтвердите. Это запрос к ИИ."
            align="end"
          >
            <Button size="sm" variant="secondary" disabled={busy || eligible === 0} onClick={onFind}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy ? 'Ищу факты…' : 'Найти факты в документах'}
            </Button>
          </Tooltip>
          <Button size="sm" onClick={() => setForm({ draft: emptyDraft(isKind(filter) ? filter : 'license') })}>
            <Plus className="size-3.5" /> Добавить факт
          </Button>
        </div>
      </div>

      <div className="space-y-2 px-4 pt-3 empty:hidden" aria-live="polite">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3 text-[12px] text-muted-foreground" aria-label="Сводка">
        <span>
          Действуют: <b className="font-mono tabular-nums text-foreground">{summary.valid}</b>
        </span>
        {summary.expiring > 0 && (
          <span className="text-warn-foreground">
            Скоро истекут: <b className="font-mono tabular-nums">{summary.expiring}</b>
          </span>
        )}
        {summary.expired > 0 && (
          <span className="text-danger">
            Просрочены: <b className="font-mono tabular-nums">{summary.expired}</b>
          </span>
        )}
        {summary.noTerm > 0 && (
          <span className="text-warn-foreground">
            Без срока: <b className="font-mono tabular-nums">{summary.noTerm}</b>
          </span>
        )}
        {summary.unconfirmed > 0 && (
          <span className="text-info">
            Ждут подтверждения: <b className="font-mono tabular-nums">{summary.unconfirmed}</b>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 py-3" role="group" aria-label="Виды фактов">
        {chip('all', 'Все', facts.length)}
        {chip('requisites', 'Реквизиты', info.requisites.filled)}
        {FACT_KIND_KEYS.map((kind) => chip(kind, FACT_KINDS[kind].title, counts(kind)))}
        {chip('templates', 'Шаблоны', info.templates.reduce((n, t) => n + t.count, 0))}
      </div>

      {form && (
        <FactForm
          key={form.editing?.id ?? 'new'}
          initial={form.draft}
          docs={docs}
          editing={form.editing}
          onSave={(fact) => {
            onSave(fact);
            setForm(null);
          }}
          onCancel={() => setForm(null)}
        />
      )}

      <div className="divide-y divide-border border-t border-border">
        {(filter === 'all' || filter === 'requisites') && (
          <div className="space-y-1 px-4 py-3">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Реквизиты компании</p>
                <p className="mt-0.5 break-words text-[12px] text-muted-foreground">
                  заполнено {info.requisites.filled} из {info.requisites.total} · правятся выше, в разделах «Организация», «Банковские реквизиты» и «Руководитель и контакты»
                </p>
                <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                  {info.requisites.sources.length > 0 ? `из ${info.requisites.sources.map((s) => `«${s}»`).join(', ')}` : 'вписаны вручную'}
                </p>
                {info.requisites.problems.map((p) => (
                  <p key={p} className="mt-0.5 break-words text-[12px] text-warn-foreground">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        {(filter === 'all' || filter === 'templates') && (
          <div className="space-y-1 px-4 py-3">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Шаблоны и образцы</p>
                <p className="mt-0.5 break-words text-[12px] text-muted-foreground">
                  {info.templates.some((t) => t.count > 0)
                    ? info.templates.filter((t) => t.count > 0).map((t) => `${t.label} — ${t.count}`).join(' · ')
                    : 'пока нет — загрузите прошлые заявки ниже, в «Образцах и документах»'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">по ним ИИ пишет документы заявки так же, как пишете вы</p>
              </div>
            </div>
          </div>
        )}
        {filter !== 'requisites' && filter !== 'templates' && shown.length === 0 && (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">
            {facts.length === 0
              ? 'База пока пуста. Загрузите документы компании ниже — ИИ найдёт в них лицензии, договоры и сотрудников, — или добавьте факт вручную.'
              : 'В этой группе пока ничего нет.'}
          </p>
        )}
        {filter !== 'requisites' && filter !== 'templates' &&
          shown.slice(0, limit).map((fact) => (
            <FactRow
              key={fact.id}
              fact={fact}
              on={on}
              showKind={filter === 'all'}
              onEdit={() => setForm({ draft: draftOf(fact), editing: fact })}
              onDelete={() => onDelete(fact.id)}
              onConfirm={() => onConfirm(fact.id)}
            />
          ))}
      </div>
      {filter !== 'requisites' && filter !== 'templates' && shown.length > limit && (
        <div className="border-t border-border p-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
            Показать ещё {Math.min(PAGE, shown.length - limit)}
            {shown.length - limit > PAGE && <> (осталось {shown.length - limit})</>}
          </Button>
        </div>
      )}

      {/* Требование → доказательство → проверка */}
      <div className="border-t border-border">
        <div className="flex items-start gap-2 px-4 pt-3">
          <p className="text-sm font-medium">Что требуют ваши закупки</p>
          <HelpTip content="По требованиям закупок, которые ещё в работе, система определяет, чем их нужно подтвердить, ищет это в базе и проверяет срок и числа на дату подачи. Нет доказательства — так и написано; система ничего не подставляет." align="start" />
        </div>
        {attention.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-[13px] text-muted-foreground">
            {gaps.length > 0
              ? `По закупкам в работе всё подтверждено: ${gaps.length} ${plural(gaps.length, 'требование', 'требования', 'требований')}.`
              : 'Закупок в работе, которым нужны доказательства, пока нет. Когда загрузите документы закупки, здесь появится, чего не хватает.'}
          </p>
        ) : (
          <>
            <p className="px-4 pb-1 pt-1 text-[12px] text-muted-foreground">
              Нужно внимание: {attention.length} из {gaps.length}. «Нет доказательства» — добавьте документ или факт; «решает человек» — подтвердите найденное или впишите недостающее.
            </p>
            <GapList gaps={attention} onAdd={(gap) => gap.kind !== 'requisite' && setForm({ draft: emptyDraft(gap.kind, { title: gap.label }) })} />
          </>
        )}
      </div>
    </Card>
  );
}

// ———— С данными из браузера ————

const TEMPLATE_KINDS: DocKind[] = ['tp', 'anketa', 'declaration', 'price', 'letter'];

export function EvidenceBase({ profile, sources, docs }: { profile: ProfileData; sources: Partial<Record<ProfileKey, string>>; docs: MyDocument[] }) {
  const { facts, failed } = useFacts();
  const { purchases } = usePurchases();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Outcome | null>(null);
  const on = todayIso();

  // Закупки в работе: не пример, не поданные, приём ещё не закончился.
  const active = useMemo(
    () => (purchases ?? []).filter((p) => !p.sample && !p.submitted && (dueLine(p.deadline, false)?.days ?? 0) >= 0),
    [purchases],
  );
  const gaps = useMemo(() => gapsOf(active, { facts, profile, sources }, on), [active, facts, profile, sources, on]);
  const info = useMemo<EvidenceSummaryInfo>(
    () => ({
      requisites: {
        filled: filledCount(profile),
        total: PROFILE_KEYS.length,
        sources: [...new Set(Object.values(sources).filter((s): s is string => Boolean(s)))],
        problems: Object.entries(profileProblems(profile)).map(([, message]) => message as string),
      },
      templates: TEMPLATE_KINDS.map((kind) => ({ label: DOC_KINDS[kind].few, count: docs.filter((d) => d.kinds.includes(kind)).length })),
    }),
    [profile, sources, docs],
  );
  const eligible = docs.filter((d) => d.kinds.some((k) => FACT_SOURCE_KINDS.includes(k))).length;

  async function guarded(run: () => Promise<void>, failure: string) {
    try {
      await run();
    } catch {
      setNotice({ tone: 'warn', text: failure });
    }
  }

  async function find() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await findFactsInDocuments(docs);
      const parts = [
        r.added > 0 ? `Нашёл ${r.added} ${plural(r.added, 'факт', 'факта', 'фактов')} — они ждут вашего подтверждения` : 'Новых фактов в документах не нашлось',
        r.skipped > 0 ? `${r.skipped} уже были в базе` : '',
        r.dropped > 0 ? `${r.dropped} отброшено: цитаты нет в документе` : '',
      ].filter(Boolean);
      setNotice({ tone: r.added > 0 ? 'ok' : 'info', text: `${parts.join('; ')}.${r.issues.length > 0 ? ` Что не сошлось с текстом документа: ${r.issues.slice(0, 3).join('; ')}.` : ''}` });
    } catch (e) {
      setNotice({ tone: 'warn', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {failed && <Notice tone="warn">Браузер не дал открыть базу доказательств. Обновите страницу.</Notice>}
      <EvidenceSection
        facts={facts}
        docs={docs}
        on={on}
        info={info}
        gaps={gaps}
        busy={busy}
        notice={notice}
        eligible={eligible}
        onFind={() => void find()}
        onSave={(fact) => void guarded(() => saveFacts([fact]), 'Не получилось сохранить факт — попробуйте ещё раз.')}
        onDelete={(id) => void guarded(() => deleteFact(id), 'Не получилось удалить факт — попробуйте ещё раз.')}
        onConfirm={(id) => {
          const fact = facts.find((f) => f.id === id);
          if (fact) void guarded(() => saveFacts([confirmed(fact)]), 'Не получилось сохранить подтверждение — попробуйте ещё раз.');
        }}
      />
    </>
  );
}
