import { useRef, useState, type ReactNode } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Check,
  HelpCircle,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  RefreshCw,
  ListChecks,
  PenLine,
  Sparkles,
} from '../lib/icons';
import { Button, Card, Badge, Soon, Tooltip, HelpTip, cx, type Tone } from './ui';
import { kindMeta, type FieldKind } from '../lib/data';
import { acceptableValue, parseHint } from '@/lib/conditions';
import { fieldQueue, fieldSummary, type ApplicationField, type Completeness } from '@/lib/fields';
import type { Purchase } from '@/lib/purchase';
import { ApplicationPreview } from './ApplicationPreview';

// Шаг «Проверка». Вид — прототипа; поля — настоящая карта полей заявки приложения (web/src/lib/fields.ts):
// что заполнено само, что подтвердить, что вписать, что не определено и что может только человек.

// Жёлтое место в тексте: сам текст с выделенным местом, которое сейчас вписывают.
function holeText(p: Purchase, key: string): { text: string; hole: number } | null {
  const [kind, what, index, hole] = key.split(':');
  if (kind !== 'tp' || !p.tp || hole === 'done') return null;
  if (what === 'item' && p.tp.items[Number(index)]) return { text: p.tp.items[Number(index)].offer, hole: Number(hole) };
  if (what === 'good' && p.tp.goods[Number(index)]) return { text: p.tp.goods[Number(index)].characteristics, hole: Number(hole) };
  if (what === 'consent' && index !== undefined) return { text: p.tp.form.consent, hole: Number(index) };
  return null;
}

function Snippet({ text, hole }: { text: string; hole: number }) {
  const parts = text.split(/(\[[^\]]+\])/).filter(Boolean);
  let n = -1;
  return (
    <p className="whitespace-pre-wrap rounded-md bg-secondary/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
      {parts.map((part, i) => {
        if (!/^\[[^\]]+\]$/.test(part)) return <span key={i}>{part}</span>;
        n += 1;
        return (
          <mark key={i} className={cx('highlight', n === hole && 'ring-1 ring-warn')}>
            {part}
          </mark>
        );
      })}
    </p>
  );
}

export type DocSnippet = { name: string; before: string; match: string; after: string };

// Показывает адрес цитаты и кнопку «Показать в тексте» — раскрывает фрагмент с выделенной цитатой.
export function DocSnippetToggle({ snippet, where }: { snippet?: DocSnippet; where?: string }) {
  const [open, setOpen] = useState(false);
  if (!where && !snippet) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {where && (
          <p className="break-words text-[11px] text-muted-foreground">
            Место в файле: <span className="font-mono">{where}</span>
          </p>
        )}
        {snippet && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="shrink-0 whitespace-nowrap text-[11px] text-info underline-offset-2 hover:underline"
          >
            {open ? 'Скрыть ↑' : 'Показать в тексте ↓'}
          </button>
        )}
      </div>
      {open && snippet && (
        <div className="rounded-md bg-secondary/60 px-3 py-2 text-[12px] leading-relaxed">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{snippet.name}</p>
          <p className="whitespace-pre-wrap break-words text-muted-foreground">
            {snippet.before}
            <mark className="highlight">{snippet.match}</mark>
            {snippet.after}
          </p>
        </div>
      )}
    </div>
  );
}

// Вес открытого пункта в «риске отклонения»: ошибка — 35, не определено — 18, пустое обязательное — 10, подтвердить — 7, остальное — 3.
const weightOf = (f: ApplicationField) =>
  f.status === 'invalid' ? 35 : f.kind === 'unknown' ? 18 : f.status === 'needs_input' ? (f.required ? 10 : 3) : f.status === 'needs_confirmation' ? 7 : 0;

const badgeOf = (f: ApplicationField): { tone: Tone; text: string } =>
  f.status === 'invalid'
    ? { tone: 'danger', text: 'Ошибка' }
    : f.kind === 'unknown'
      ? { tone: 'danger', text: 'Не определено' }
      : f.status === 'filled'
        ? { tone: 'success', text: 'Готово' }
        : f.status === 'needs_confirmation'
          ? { tone: 'warn', text: 'Подтвердить' }
          : { tone: 'info', text: 'Ввести' };

export function StepReview({
  purchase,
  fields,
  final,
  focusKey,
  warnings,
  notice,
  before,
  after,
  whereOf,
  snippetOf,
  onFocus,
  onSave,
  onGo,
  onOpenProfile,
  onNext,
  onBack,
}: {
  purchase: Purchase;
  fields: ApplicationField[];
  final: Completeness;
  // Предупреждения по заявке: утечка реквизитов в ТП, цитаты без подтверждения, сканы.
  warnings: string[];
  // Блок под заголовком шага — например, «документы закупки изменились».
  notice?: ReactNode;
  // Блок над списком пунктов — например, состав исполнителей.
  before?: ReactNode;
  // Блок под списком и предпросмотром — проверка своей заявки файлом.
  after?: ReactNode;
  focusKey: string | null;
  // Где в файлах закупки стоит цитата поля: файл, страница, таблица, пункт (lib/doc-locate.ts). Нет — адреса не показываем.
  whereOf?: (quote: string) => string | undefined;
  // Контекст цитаты в документе: текст до, сама цитата, текст после — для кнопки «Показать в тексте».
  snippetOf?: (quote: string) => DocSnippet | undefined;
  onFocus: (key: string | null) => void;
  // Вписать значение в жёлтое место или строку анкеты; для подтверждения значение пустое.
  onSave: (key: string, value: string) => void;
  onGo: (step: number) => void;
  onOpenProfile: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<FieldKind | 'all'>('all');
  const [whyRisk, setWhyRisk] = useState(false);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const summary = fieldSummary(fields);
  const queue = fieldQueue(fields);
  const isProfile = (f: ApplicationField) => f.key.startsWith('profile:') || (f.key === 'confirm:signer' && f.status === 'needs_input');
  const profileLeft = queue.filter(isProfile);
  const own = queue.filter((f) => !isProfile(f));
  const ownEmpty = own.filter((f) => f.status === 'needs_input' && !f.key.startsWith('file:')).length;

  const open = queue.filter((f) => weightOf(f) > 0);
  const weight = open.reduce((s, f) => s + weightOf(f), 0);
  const risk = { pct: weight === 0 ? 3 : Math.min(74, weight + 2), critical: open.some((f) => f.status === 'invalid' || f.kind === 'unknown') };
  const allClear = open.length === 0;
  const level = risk.pct >= 50 ? 'высокий' : risk.pct >= 25 ? 'средний' : 'низкий';

  const select = (key: string) => {
    setFilter('all');
    onFocus(key);
    requestAnimationFrame(() => {
      const row = rowRefs.current[key];
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.querySelector('input')?.focus({ preventScroll: true });
    });
  };
  const first = own.find((f) => f.status === 'needs_input' && !f.key.startsWith('file:'));

  const shown = (() => {
    if (filter === 'confirm') return own.filter((f) => f.status === 'needs_confirmation');
    if (filter === 'manual') return own.filter((f) => f.kind === 'manual' && (f.status === 'needs_input' || f.status === 'invalid'));
    if (filter === 'unknown') return own.filter((f) => f.kind === 'unknown');
    return own;
  })();

  const counts: Record<FieldKind, number> = {
    auto: summary.auto,
    confirm: summary.confirm,
    manual: summary.manual + summary.invalid,
    unknown: summary.unknown,
    sign: summary.sign,
  };

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Проверка перед подачей</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ИИ сверил заявку с извещением и ТЗ. <mark className="highlight">Жёлтым</mark> — что дописать или подтвердить; у
          каждого пункта видно, откуда взято значение или почему его нет.
        </p>
      </div>

      {notice}

      {/* Сводка: заполнение, риск — одним островом */}
      <Card className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <div className="min-w-[200px] flex-1">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium">Подготовка заявки</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {summary.done} из {summary.total} · {Math.round(summary.share * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${summary.share * 100}%` }} />
            </div>
          </div>
          {first ? (
            <Button size="sm" onClick={() => select(first.key)}>
              <ListChecks className="size-3.5" /> Заполнить {ownEmpty} {ownEmpty === 1 ? 'пункт' : ownEmpty < 5 ? 'пункта' : 'пунктов'}
            </Button>
          ) : (
            <Badge tone="success">
              <Check className="size-3" /> Всё, что можно вписать, заполнено
            </Badge>
          )}
        </div>

        {/* Виды полей — нажатие показывает только их */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5">
          {(['auto', 'confirm', 'manual', 'unknown', 'sign'] as FieldKind[]).map((kind) => (
            <KindChip key={kind} kind={kind} n={counts[kind]} active={filter === kind} onClick={() => setFilter(filter === kind ? 'all' : kind)} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {allClear ? (
              <ShieldCheck className="size-5 text-success" />
            ) : (
              <ShieldAlert className={cx('size-5', risk.critical ? 'text-danger' : 'text-warn')} />
            )}
            <span className="text-[13px] font-medium">Риск отклонения</span>
            <Tooltip content="Оценка по открытым пунктам: ошибка — 35 баллов, не определено — 18, пустое обязательное поле — 10, подтвердить — 7. Не вероятность, а шкала." align="start">
              <span
                className={cx(
                  'font-mono text-lg font-semibold tabular-nums',
                  allClear ? 'text-success' : risk.critical ? 'text-danger' : 'text-warn-foreground',
                )}
              >
                {risk.pct}%
              </span>
            </Tooltip>
            <span className="text-[12px] text-muted-foreground">{allClear ? 'минимальный' : level}</span>
          </div>
          <button
            onClick={() => setWhyRisk(!whyRisk)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            <HelpCircle className="size-3.5" /> Почему такой риск?
          </button>
          <div className="ml-auto">
            <Tooltip content="Полный повторный разбор заявки ИИ с учётом ваших правок — в разработке. Правки полей проверяются бесплатно и сразу." align="end">
              <Button size="sm" variant="secondary" disabled>
                <RefreshCw className="size-3.5" /> Пересчитать с ИИ <Soon className="ml-1" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {whyRisk && (
          <div className="space-y-1.5 px-4 py-3 text-[12px]">
            {open.length === 0 ? (
              <p className="text-success">Открытых пунктов нет — риск минимальный.</p>
            ) : (
              open
                .slice()
                .sort((a, b) => weightOf(b) - weightOf(a))
                .slice(0, 12)
                .map((f) => (
                  <button key={f.key} onClick={() => select(f.key)} className="flex w-full items-center gap-2 text-left hover:text-foreground">
                    <span className="w-9 shrink-0 text-right font-mono tabular-nums text-muted-foreground">+{weightOf(f)}</span>
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    <Badge tone={badgeOf(f).tone}>{badgeOf(f).text}</Badge>
                  </button>
                ))
            )}
            <p className="text-muted-foreground">Считается в браузере по открытым пунктам — ИИ не вызывается.</p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Пункты: компактные карточки, раскрываются по нажатию */}
        <div className="min-w-0 space-y-2">
          {warnings.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-warn/40 bg-warn-surface/30 px-3 py-2.5">
              {warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-[13px] leading-snug text-warn-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}
          {before}
          {filter === 'auto' ? (
            <AutoList fields={fields.filter((f) => f.kind === 'auto' && f.status === 'filled')} whereOf={whereOf} snippetOf={snippetOf} />
          ) : filter === 'sign' ? (
            <SignRow />
          ) : (
            <>
              {shown
                .filter((f) => f.status === 'invalid')
                .concat(shown.filter((f) => f.status !== 'invalid'))
                .map((f) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    purchase={purchase}
                    whereOf={whereOf}
                    snippetOf={snippetOf}
                    expanded={focusKey === f.key}
                    onToggle={() => onFocus(focusKey === f.key ? null : f.key)}
                    onSave={onSave}
                    onGo={onGo}
                    onOpenProfile={onOpenProfile}
                    rowRef={(el) => (rowRefs.current[f.key] = el)}
                  />
                ))}
              {filter === 'all' && profileLeft.length > 0 && (
                <div className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div className="min-w-0 flex-1 text-[13px]">
                      <p className="font-medium">
                        Реквизиты компании: не хватает {profileLeft.length} {profileLeft.length === 1 ? 'поля' : 'полей'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {profileLeft.slice(0, 4).map((f) => f.label).join(', ')}
                        {profileLeft.length > 4 ? ` и ещё ${profileLeft.length - 4}` : ''} · подставятся в документы
                      </p>
                      <button onClick={onOpenProfile} className="mt-1.5 text-[12px] font-medium underline underline-offset-4 hover:text-foreground">
                        Вписать в «Профиле компании»
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {filter !== 'all' && shown.length === 0 && (
                <p className="rounded-lg border border-border bg-card px-3 py-3 text-[13px] text-muted-foreground">Здесь пусто.</p>
              )}
              {filter === 'all' && own.length === 0 && profileLeft.length === 0 && (
                <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-3 text-[13px] text-success">
                  <CheckCircle2 className="size-4" /> Всё заполнено. Осталось подписать заявку электронной подписью и подать на площадке.
                </p>
              )}
              {filter === 'all' && <AutoList fields={fields.filter((f) => f.kind === 'auto' && f.status === 'filled')} collapsed whereOf={whereOf} snippetOf={snippetOf} />}
            </>
          )}
        </div>

        <ApplicationPreview purchase={purchase} focusKey={focusKey} onSelect={select} />
      </div>

      {after}

      {/* Итоговая проверка: ни одного пустого обязательного поля */}
      <FinalCheck final={final} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button variant={risk.critical ? 'secondary' : 'primary'} onClick={onNext} className="ml-auto">
          {final.ready ? 'Сформировать пакет →' : 'Продолжить с открытыми пунктами →'}
        </Button>
      </div>
    </div>
  );
}

function KindChip({ kind, n, active, onClick }: { kind: FieldKind; n: number; active: boolean; onClick: () => void }) {
  const meta = kindMeta[kind];
  const dot: Record<typeof meta.tone, string> = {
    success: 'bg-success',
    warn: 'bg-warn',
    info: 'bg-info',
    danger: 'bg-danger',
    neutral: 'bg-muted-foreground',
  };
  return (
    <Tooltip content={meta.hint} side="bottom">
      <button
        onClick={onClick}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
          active ? 'border-foreground bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
        )}
      >
        <span className={cx('size-2 rounded-full', dot[meta.tone])} />
        {meta.label}
        <span className="font-mono font-semibold tabular-nums text-foreground">{n}</span>
      </button>
    </Tooltip>
  );
}

function stateIcon(f: ApplicationField) {
  if (f.status === 'filled') return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (f.status === 'invalid') return <XCircle className="size-4 shrink-0 text-danger" />;
  if (f.kind === 'unknown') return <HelpCircle className="size-4 shrink-0 text-danger" />;
  return <AlertTriangle className="size-4 shrink-0 text-warn" />;
}

function FieldRow({
  field,
  purchase,
  whereOf,
  snippetOf,
  expanded,
  onToggle,
  onSave,
  onGo,
  onOpenProfile,
  rowRef,
}: {
  field: ApplicationField;
  purchase: Purchase;
  whereOf?: (quote: string) => string | undefined;
  snippetOf?: (quote: string) => DocSnippet | undefined;
  expanded: boolean;
  onToggle: () => void;
  onSave: (key: string, value: string) => void;
  onGo: (step: number) => void;
  onOpenProfile: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const badge = badgeOf(field);
  const where = [field.doc, field.context].filter(Boolean).join(' · ');
  return (
    <div
      ref={rowRef}
      className={cx(
        'scroll-mt-24 rounded-lg border bg-card transition-all',
        expanded ? 'border-foreground/30 shadow-sm' : 'border-border',
        field.status === 'invalid' && 'border-l-2 border-l-danger',
      )}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        {stateIcon(field)}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {where && <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted-foreground">{where}</span>}
            <span className="min-w-0 truncate text-[13px] font-medium">{field.label}</span>
          </div>
          {field.status === 'filled' && field.value && <p className="mt-0.5 truncate text-[12px] text-success">{field.value}</p>}
          {field.problem && <p className={cx('mt-0.5 truncate text-[12px]', field.status === 'invalid' ? 'text-danger' : 'text-warn-foreground')}>{field.problem}</p>}
        </div>
        <span className="hidden sm:inline-flex">
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="animate-fade-up space-y-2.5 border-t border-border px-3 pb-3 pt-2.5">
          {field.source && (
            <p className="text-[11px] text-muted-foreground">
              Откуда: <span className="font-mono">{field.source}</span>
            </p>
          )}
          {field.quote && (
            <DocSnippetToggle where={whereOf?.(field.quote)} snippet={snippetOf?.(field.quote)} />
          )}
          <Control field={field} purchase={purchase} onSave={onSave} onGo={onGo} onOpenProfile={onOpenProfile} />
        </div>
      )}
    </div>
  );
}

// Способ исправить: вписать, подтвердить или перейти туда, где это делается.
function Control({
  field: f,
  purchase,
  onSave,
  onGo,
  onOpenProfile,
}: {
  field: ApplicationField;
  purchase: Purchase;
  onSave: (key: string, value: string) => void;
  onGo: (step: number) => void;
  onOpenProfile: () => void;
}) {
  // Уже вписанное место: поле сразу с прежним значением, чтобы его исправить.
  const [value, setValue] = useState(f.key.includes(':done:') ? f.value : '');
  const snippet = holeText(purchase, f.key);
  // Подсказка «число, не меньше 150» — граница заказчика: значение вписывает участник, ИИ его не выбирает.
  const hint = snippet && f.status === 'needs_input' ? parseHint(f.label) : null;
  const accept = hint ? acceptableValue(hint) : null;

  if (f.key.startsWith('anketa:') || (snippet && f.status === 'needs_input')) {
    return (
      <div className="space-y-2">
        {snippet && <Snippet {...snippet} />}
        {hint && (
          <p className="text-[12px] leading-snug text-muted-foreground">
            Заказчик назвал только границу: <span className="font-mono">{f.label.replace(/^(?:число|размер), /, '')}</span>. Сколько предложить —
            решаете вы: ИИ за вас это не выбирает.
            {accept && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onSave(f.key, accept)}
                  className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
                >
                  Предложить ровно {accept}
                </button>{' '}
                — если готовы дать именно столько.
              </>
            )}
          </p>
        )}
        {/* Вписали одно место — следующее в том же тексте получает тот же ключ: форма пересоздаётся по тексту и очищается. */}
        <form
          key={`${f.key}:${snippet?.text ?? ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) {
              onSave(f.key, value.trim());
              setValue('');
            }
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={f.label}
            aria-label={`${f.label}${f.context ? ` — ${f.context}` : ''}`}
            autoComplete="off"
            className="h-9 min-w-0 max-w-[48ch] flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
          />
          <Button size="sm" type="submit" disabled={!value.trim()}>
            Вписать
          </Button>
        </form>
      </div>
    );
  }
  if (f.key === 'confirm:price') {
    return (
      <Button size="sm" variant="secondary" onClick={() => onGo(2)}>
        {f.value ? 'Изменить цену на шаге «Цена»' : 'Выбрать цену на шаге «Цена»'} →
      </Button>
    );
  }
  if (f.status === 'needs_confirmation') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {f.value && <span className="text-[13px] text-muted-foreground">{f.value}</span>}
        <Button size="sm" onClick={() => onSave(f.key, '')}>
          <Check className="size-3.5" /> Подтверждаю
        </Button>
      </div>
    );
  }
  if (f.key === 'confirm:signer' || f.key === 'confirm:experience' || f.key === 'confirm:staff') {
    return (
      <Button size="sm" variant="secondary" onClick={onOpenProfile}>
        {f.key === 'confirm:signer' ? 'Вписать подписанта в «Профиле компании»' : 'Загрузить документы в «Профиль компании»'} →
      </Button>
    );
  }
  if (f.key.startsWith('file:')) {
    return (
      <Button size="sm" variant="secondary" onClick={() => onGo(0)}>
        Пересохранить и добавить заново на шаге «Загрузка» →
      </Button>
    );
  }
  if (f.key.includes(':done:')) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const next = value.trim();
          if (next && next !== f.value) onSave(f.key, next);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`${f.label}${f.context ? ` — ${f.context}` : ''}`}
          autoComplete="off"
          className="h-9 min-w-0 max-w-[48ch] flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-ring/20"
        />
        <Button size="sm" type="submit" disabled={!value.trim() || value.trim() === f.value}>
          Изменить
        </Button>
      </form>
    );
  }
  if (f.key.startsWith('cast:')) {
    return (
      <Button size="sm" variant="secondary" onClick={() => document.getElementById('cast-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        Вписать исполнителей выше ↑
      </Button>
    );
  }
  return null;
}

function AutoList({ fields, collapsed, whereOf, snippetOf }: { fields: ApplicationField[]; collapsed?: boolean; whereOf?: (quote: string) => string | undefined; snippetOf?: (quote: string) => DocSnippet | undefined }) {
  const [open, setOpen] = useState(!collapsed);
  if (fields.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <Sparkles className="size-4 shrink-0 text-success" />
        <span className="min-w-0 flex-1 text-[13px] font-medium">Заполнено автоматически · {fields.length}</span>
        <span className="hidden text-[12px] text-muted-foreground sm:inline">с источниками</span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {fields.slice(0, 40).map((f) => (
            <div key={f.key} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-muted-foreground">{f.label}</span>
                <span className="max-w-[55%] truncate text-right font-mono text-[12px]">{f.value}</span>
              </div>
              {f.source && <p className="mt-0.5 text-[11px] text-muted-foreground">Источник: {f.source}</p>}
              {f.quote && <DocSnippetToggle where={whereOf?.(f.quote)} snippet={snippetOf?.(f.quote)} />}
            </div>
          ))}
          {fields.length > 40 && <p className="px-3 py-2 text-[11px] text-muted-foreground">И ещё {fields.length - 40} — все видны в документах пакета.</p>}
        </div>
      )}
    </div>
  );
}

function SignRow() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <PenLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="text-[13px]">
        <p className="font-medium">Подписать заявку электронной подписью и подать на площадке</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Только вы: сервис не ставит подпись и не подаёт заявку за вас.</p>
      </div>
    </div>
  );
}

export function FinalCheck({ final }: { final: Completeness }) {
  const rows: [string, ReactNode, string][] = [
    ['Обязательные поля', `${final.fields.filled} из ${final.fields.required}${final.fields.empty ? ` · пустых ${final.fields.empty}` : ' · пустых 0'}${final.fields.invalid ? ` · с ошибкой ${final.fields.invalid}` : ''}`, 'Всё, без чего заявку отклонят: реквизиты, характеристики, документы.'],
    ['Документы', `${final.documents.ready} из ${final.documents.required}`, 'Документы заказчика из списка «Что подать», отмеченные готовыми.'],
    ['Подтверждения', `${final.confirmations.done} из ${final.confirmations.required}`, 'Значения, которые ИИ нашёл, а решение за вами.'],
    ['Подписи', `${final.signatures.done} из ${final.signatures.required} · на площадке`, 'Подпись ставите вы электронной подписью при подаче.'],
  ];
  return (
    <Card className={cx('p-4', final.ready ? 'border-success/40' : 'border-warn/40')}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Итоговая проверка</span>
        <HelpTip content="Перед скачиванием система проходит по всей заявке: ни одного пустого обязательного поля." />
      </div>
      <div className="mt-2.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-[12px]">
            <Tooltip content={hint} align="start">
              <span className="cursor-help text-muted-foreground">{label}</span>
            </Tooltip>
            <span className="font-mono tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <p
        className={cx(
          'mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[13px] font-medium',
          final.ready ? 'bg-success/10 text-success' : 'bg-warn-surface/50 text-warn-foreground',
        )}
      >
        {final.ready ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
        {final.text}
      </p>
    </Card>
  );
}
