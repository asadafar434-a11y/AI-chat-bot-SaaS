import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Check,
  HelpCircle,
  Pencil,
  Paperclip,
  Eye,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  RefreshCw,
  ListChecks,
  Loader2,
  UserCheck,
  Clock,
  PenLine,
  Sparkles,
} from '../lib/icons';
import { Button, Card, Badge, Modal, Tooltip, HelpTip, cx, type Tone } from './ui';
import { AUTO_TOTAL, RECHECKS, RECHECK_PACK, autoFields, gaps, kindMeta, rub, tender, type FieldKind, type Gap } from '../lib/data';
import {
  checkKey,
  completeness,
  fieldCounts,
  gapProblem,
  gapState,
  lcFirst,
  riskOf,
  type AppState,
  type Remark,
} from '../lib/app-state';

type Patch = (p: Partial<AppState> | ((a: AppState) => Partial<AppState>)) => void;

const sevMeta = {
  high: { tone: 'danger' as const, label: 'Критично' },
  medium: { tone: 'warn' as const, label: 'Важно' },
  low: { tone: 'neutral' as const, label: 'Уточнение' },
};

// Порядок мастера: ошибки, непонятное, обязательное к вводу (сначала критичное), в конце — подтверждения.
const rankOf = (g: Gap, fixes: AppState['fixes']) =>
  gapState(g, fixes) === 'invalid' ? 0 : g.field === 'unknown' ? 1 : g.field === 'manual' ? (g.severity === 'high' ? 2 : 3) : 4;

export function StepReview({
  app,
  setFix,
  patch,
  focusGap,
  onFocused,
  onNext,
  onBack,
}: {
  app: AppState;
  setFix: (id: string, value: string) => void;
  patch: Patch;
  focusGap: string | null;
  onFocused: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const fixes = app.fixes;
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<FieldKind | 'all'>('all');
  const [whyRisk, setWhyRisk] = useState(false);
  const [wizard, setWizard] = useState<string[] | null>(null);
  const [recheck, setRecheck] = useState<'idle' | 'running' | 'same' | 'done'>('idle');
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const counts = fieldCounts(fixes);
  const risk = riskOf(fixes);
  const final = completeness(fixes);
  const allClear = risk.open.length === 0;
  const remarks = app.specialist?.status === 'replied' ? app.specialist.remarks : [];
  const remarkFor = (id: string) => remarks.find((r) => r.gapId === id && r.tone !== 'ok');
  const queue = gaps.filter((g) => gapState(g, fixes) !== 'done').sort((a, b) => rankOf(a, fixes) - rankOf(b, fixes));

  const select = (id: string) => {
    setOpen(id);
    setFilter('all');
    requestAnimationFrame(() => rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  // Переход сюда из «Анализа» или из замечания специалиста — сразу к нужному пункту.
  useEffect(() => {
    if (!focusGap) return;
    select(focusGap);
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGap]);

  // Полный повторный разбор ИИ — 3 раза на заявку. Данные не менялись — ИИ не вызывается, попытка не списывается.
  const runRecheck = () => {
    if (app.checkedKey === checkKey(fixes)) {
      setRecheck('same');
      return;
    }
    setRecheck('running');
    window.setTimeout(() => {
      patch((a) => ({ rechecks: a.rechecks + 1, checkedKey: checkKey(a.fixes) }));
      setRecheck('done');
    }, 1200);
  };
  // 3 пересчёта в заявке, дальше — пакетами «ещё 3 за 99 ₽».
  const total = RECHECKS + app.recheckPacks * RECHECK_PACK.count;
  const left = Math.max(0, total - app.rechecks);

  const shown = filter === 'all' ? gaps : gaps.filter((g) => g.field === filter);

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Проверка перед подачей</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ИИ сверил заявку с извещением и ТЗ. <mark className="highlight">Жёлтым</mark> — что дописать или подтвердить; у
          каждого пункта — почему ИИ не заполнил сам и откуда взято значение.
        </p>
      </div>

      {app.specialist && <ExpertBanner status={app.specialist.status} remarks={remarks} onGo={select} />}

      {/* Сводка: заполнение, риск, пересчёт — одним островом */}
      <Card className="divide-y divide-border p-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <div className="min-w-[200px] flex-1">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium">Подготовка заявки</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {counts.done} из {counts.total} · {Math.round(counts.share * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${counts.share * 100}%` }} />
            </div>
          </div>
          {queue.length > 0 ? (
            <Button size="sm" onClick={() => setWizard(queue.map((g) => g.id))}>
              <ListChecks className="size-3.5" /> Заполнить {queue.length} {queue.length === 1 ? 'пункт' : queue.length < 5 ? 'пункта' : 'пунктов'}
            </Button>
          ) : (
            <Badge tone="success">
              <Check className="size-3" /> Всё заполнено
            </Badge>
          )}
        </div>

        {/* Виды полей — нажатие показывает только их */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5">
          <KindChip kind="auto" n={counts.auto} active={filter === 'auto'} onClick={() => setFilter(filter === 'auto' ? 'all' : 'auto')} />
          <KindChip kind="confirm" n={counts.confirm} active={filter === 'confirm'} onClick={() => setFilter(filter === 'confirm' ? 'all' : 'confirm')} />
          <KindChip kind="manual" n={counts.manual} active={filter === 'manual'} onClick={() => setFilter(filter === 'manual' ? 'all' : 'manual')} />
          <KindChip kind="unknown" n={counts.unknown} active={filter === 'unknown'} onClick={() => setFilter(filter === 'unknown' ? 'all' : 'unknown')} />
          <KindChip kind="sign" n={counts.sign} active={filter === 'sign'} onClick={() => setFilter(filter === 'sign' ? 'all' : 'sign')} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {allClear ? (
              <ShieldCheck className="size-5 text-success" />
            ) : (
              <ShieldAlert className={cx('size-5', risk.critical ? 'text-danger' : 'text-warn')} />
            )}
            <span className="text-[13px] font-medium">Риск отклонения</span>
            <Tooltip content="Оценка по открытым пунктам: критичное — 35 баллов, важное — 10–18, уточнение — 3–7. Не вероятность, а шкала." align="start">
              <span
                className={cx(
                  'font-mono text-lg font-semibold tabular-nums',
                  allClear ? 'text-success' : risk.critical ? 'text-danger' : 'text-warn-foreground',
                )}
              >
                {risk.pct}%
              </span>
            </Tooltip>
            <span className="text-[12px] text-muted-foreground">{risk.level}</span>
          </div>
          <button
            onClick={() => setWhyRisk(!whyRisk)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            <HelpCircle className="size-3.5" /> Почему такой риск?
          </button>
          <div className="ml-auto">
            <Tooltip
              content="Полный повторный разбор ИИ — 3 раза на заявку. Если данные не менялись, ИИ не вызывается и попытка не списывается. Правки полей проверяются бесплатно и сразу."
              align="end"
            >
              <Button size="sm" variant="secondary" disabled={left === 0 || recheck === 'running'} onClick={runRecheck}>
                {recheck === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Пересчитать с ИИ · {left} из {total}
              </Button>
            </Tooltip>
          </div>
        </div>

        {(whyRisk || recheck !== 'idle' || left === 0) && (
          <div className="space-y-2 px-4 py-3 text-[12px]">
            {whyRisk && (
              <div className="space-y-1.5">
                {risk.open.length === 0 ? (
                  <p className="text-success">Открытых пунктов нет — риск минимальный.</p>
                ) : (
                  risk.open
                    .slice()
                    .sort((a, b) => b.weight - a.weight)
                    .map((g) => (
                      <button key={g.id} onClick={() => select(g.id)} className="flex w-full items-center gap-2 text-left hover:text-foreground">
                        <span className="w-9 shrink-0 text-right font-mono tabular-nums text-muted-foreground">+{g.weight}</span>
                        <span className="min-w-0 flex-1 truncate">{g.label}</span>
                        <Badge tone={sevMeta[g.severity].tone}>{sevMeta[g.severity].label}</Badge>
                      </button>
                    ))
                )}
                <p className="text-muted-foreground">Ответ из сохранённой проверки — ИИ не вызывался.</p>
              </div>
            )}
            {recheck === 'running' && <p className="text-muted-foreground">ИИ заново разбирает заявку с учётом ваших правок…</p>}
            {recheck === 'same' && (
              <p className="text-muted-foreground">Данные не менялись с прошлого пересчёта — показан сохранённый результат. Попытка не списана.</p>
            )}
            {recheck === 'done' && <p className="text-muted-foreground">Пересчитано. Новых замечаний нет. Осталось пересчётов: {left} из {total}.</p>}
            {left === 0 && recheck !== 'running' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-warn-foreground">
                  Вы использовали все повторные AI-проверки для этой заявки. Правки полей по-прежнему проверяются бесплатно и сразу.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    patch((a) => ({ recheckPacks: a.recheckPacks + 1 }));
                    setRecheck('idle');
                  }}
                >
                  <RefreshCw className="size-3.5" /> Ещё {RECHECK_PACK.count} пересчёта · {rub(RECHECK_PACK.price)}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Пункты: компактные строки, раскрываются по нажатию */}
        <div className="space-y-2">
          {filter === 'auto' ? (
            <AutoList />
          ) : filter === 'sign' ? (
            <SignRow />
          ) : (
            shown.map((gap) => (
              <GapRow
                key={gap.id}
                gap={gap}
                fixes={fixes}
                expanded={open === gap.id}
                remark={remarkFor(gap.id)}
                onToggle={() => setOpen(open === gap.id ? null : gap.id)}
                onFix={(v) => setFix(gap.id, v)}
                rowRef={(el) => (rowRefs.current[gap.id] = el)}
              />
            ))
          )}
          {filter === 'all' && <AutoList collapsed />}
        </div>

        {/* Живой предпросмотр */}
        <Card className="p-0 lg:sticky lg:top-4 lg:h-fit">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Заявка · предпросмотр</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Eye className="size-3" /> живой
            </span>
          </div>
          <div className="space-y-3 p-5 text-[13px] leading-relaxed">
            <p className="font-semibold">Предложение участника в отношении объекта закупки</p>
            <p className="text-muted-foreground">
              Закупка №{tender.id}. Страна происхождения: <Mark id="country" fixes={fixes} onSelect={select} open={open} />
            </p>
            <p>
              <b>Поз. 1. Моноблок 23,8".</b> Intel Core i5, ОЗУ 16 ГБ, SSD 512 ГБ.
            </p>
            <p>
              <b>Поз. 2. Ноутбук 15,6".</b> Intel Core i5, ОЗУ 16 ГБ, накопитель <Mark id="poz2-storage" fixes={fixes} onSelect={select} open={open} />
            </p>
            <p>
              <b>Поз. 3. МФУ лазерное А4.</b> Скорость печати <Mark id="poz3-speed" fixes={fixes} onSelect={select} open={open} /> стр/мин,
              сертификат соответствия — <Mark id="cert-poz3" fixes={fixes} onSelect={select} open={open} />.
            </p>
            <p>
              <b>Поз. 4. ИБП.</b> Выходная мощность <Mark id="poz4-power" fixes={fixes} onSelect={select} open={open} />
            </p>
            <p>
              <b>Реестровые записи.</b> Поз. 1, 2 — из прайса; поз. 3, 4 — <Mark id="registry" fixes={fixes} onSelect={select} open={open} />
            </p>
            <div className="space-y-1.5 border-t border-border pt-3 text-[12px] text-muted-foreground">
              <p>Обеспечение заявки 42 800 ₽ — <Mark id="guarantee" fixes={fixes} onSelect={select} open={open} /></p>
              <p>Крупная сделка — <Mark id="deal" fixes={fixes} onSelect={select} open={open} /></p>
              <p>«Приложение 3 к ТЗ» — <Mark id="file-unread" fixes={fixes} onSelect={select} open={open} /></p>
              <p>Подписывает — <Mark id="signer" fixes={fixes} onSelect={select} open={open} /></p>
            </div>
          </div>
        </Card>
      </div>

      {/* Итоговая проверка: ни одного пустого обязательного поля */}
      <FinalCheck final={final} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <Button variant={risk.critical ? 'secondary' : 'primary'} onClick={onNext} className="ml-auto">
          {allClear ? 'Сформировать пакет →' : 'Продолжить с открытыми пунктами →'}
        </Button>
      </div>

      {wizard && (
        <Wizard
          ids={wizard}
          fixes={fixes}
          onFix={setFix}
          onClose={() => setWizard(null)}
        />
      )}
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

// Замечания специалиста — наверху «Проверки», с переходом к пункту.
function ExpertBanner({ status, remarks, onGo }: { status: 'sent' | 'replied'; remarks: Remark[]; onGo: (id: string) => void }) {
  if (status === 'sent') {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-warn/40 bg-warn-surface/40 px-4 py-2.5 text-[13px] text-warn-foreground">
        <Clock className="size-4 shrink-0" />
        Пакет у специалиста — ответ придёт в течение 2 часов. Замечания появятся здесь, у нужных пунктов.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-info/40 bg-info/5 px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-info">
        <UserCheck className="size-4" /> Замечания специалиста · {remarks.filter((r) => r.tone !== 'ok').length}
      </p>
      <ul className="mt-2 space-y-1.5">
        {remarks.map((r) => (
          <li key={r.text} className="flex items-start gap-2 text-[12px]">
            <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', r.tone === 'danger' ? 'bg-danger' : r.tone === 'warn' ? 'bg-warn' : 'bg-success')} />
            <span className="min-w-0 flex-1 text-muted-foreground">{r.text}</span>
            {r.gapId && (
              <button onClick={() => onGo(r.gapId!)} className="shrink-0 font-medium text-foreground underline underline-offset-2">
                Перейти
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function stateIcon(gap: Gap, fixes: AppState['fixes']) {
  const st = gapState(gap, fixes);
  if (st === 'done') return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (st === 'invalid') return <XCircle className="size-4 shrink-0 text-danger" />;
  if (gap.field === 'unknown') return <HelpCircle className="size-4 shrink-0 text-danger" />;
  return <AlertTriangle className={cx('size-4 shrink-0', gap.severity === 'high' ? 'text-danger' : 'text-warn')} />;
}

const kindTone = (k: FieldKind): Tone => (kindMeta[k].tone === 'info' ? 'info' : kindMeta[k].tone);

const shownValue = (gap: Gap, value: string) => (gap.kind === 'upload' ? `📎 ${value}` : value);

function GapRow({
  gap,
  fixes,
  expanded,
  remark,
  onToggle,
  onFix,
  rowRef,
}: {
  gap: Gap;
  fixes: AppState['fixes'];
  expanded: boolean;
  remark?: Remark;
  onToggle: () => void;
  onFix: (v: string) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const st = gapState(gap, fixes);
  const value = fixes[gap.id];
  return (
    <div
      ref={rowRef}
      className={cx(
        'scroll-mt-24 rounded-lg border bg-card transition-all',
        expanded ? 'border-foreground/30 shadow-sm' : 'border-border',
        st !== 'done' && gap.severity === 'high' && 'border-l-2 border-l-danger',
      )}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        {stateIcon(gap, fixes)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{gap.position}</span>
            <span className="truncate text-[13px] font-medium">{gap.label}</span>
          </div>
          {st === 'done' && value && <p className="mt-0.5 truncate text-[12px] text-success">{shownValue(gap, value)}</p>}
          {st === 'invalid' && <p className="mt-0.5 truncate text-[12px] text-danger">{gapProblem(gap, fixes)}</p>}
        </div>
        {remark && (
          <Tooltip content={`Специалист: ${remark.text}`} align="end">
            <Badge tone="info">
              <UserCheck className="size-2.5" /> юрист
            </Badge>
          </Tooltip>
        )}
        <span className="hidden sm:inline-flex">
          <Badge tone={st === 'done' ? 'success' : kindTone(gap.field)}>{st === 'done' ? 'Готово' : kindMeta[gap.field].short}</Badge>
        </span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="animate-fade-up border-t border-border px-3 pb-3 pt-2.5">
          {remark && (
            <p className="mb-2 flex items-start gap-1.5 rounded-md bg-info/10 px-2.5 py-2 text-[12px] text-info">
              <UserCheck className="mt-0.5 size-3.5 shrink-0" /> Специалист: {remark.text}
            </p>
          )}
          <GapBody gap={gap} fixes={fixes} onFix={onFix} />
        </div>
      )}
    </div>
  );
}

// Почему ИИ не заполнил сам, откуда взято, что будет, если оставить, и сам способ исправить.
function GapBody({ gap, fixes, onFix, autoFocus }: { gap: Gap; fixes: AppState['fixes']; onFix: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <Badge tone={sevMeta[gap.severity].tone}>{sevMeta[gap.severity].label}</Badge>
        <span className="font-mono">{gap.ref}</span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">Источник: </span>
        {gap.source}
      </p>
      <div className="space-y-1 rounded-md bg-secondary/60 p-2.5 text-[12px] leading-snug text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Почему ИИ не заполнил сам: </span>
          {gap.why}
        </p>
        <p>
          <span className="font-medium text-foreground">Если оставить: </span>
          {gap.consequence}
        </p>
      </div>
      <GapControl gap={gap} fixes={fixes} onFix={onFix} autoFocus={autoFocus} />
    </div>
  );
}

function GapControl({ gap, fixes, onFix, autoFocus }: { gap: Gap; fixes: AppState['fixes']; onFix: (v: string) => void; autoFocus?: boolean }) {
  const value = fixes[gap.id];
  const st = gapState(gap, fixes);
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value ?? ''), [value]);

  if (st === 'done' && !editing && gap.kind !== 'choice') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/30 bg-success/5 px-3 py-2">
        <span className="min-w-0 truncate text-[13px] text-success">
          {gap.kind === 'confirm' && value === gap.found ? '✓ Подтверждено: ' : ''}
          {shownValue(gap, value!)}
        </span>
        <button
          onClick={() => {
            setDraft(value ?? '');
            setEditing(true);
          }}
          className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="size-3" /> Изменить
        </button>
      </div>
    );
  }

  if (gap.kind === 'confirm' && !editing) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-warn/40 bg-warn-surface/30 px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">ИИ нашёл: </span>
          <span className="font-medium">{gap.found}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onFix(gap.found!)}>
            <Check className="size-3.5" /> Подтвердить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Изменить
          </Button>
        </div>
      </div>
    );
  }

  if (gap.kind === 'text' || (gap.kind === 'confirm' && editing)) {
    const save = () => {
      if (!draft.trim()) return;
      onFix(draft.trim());
      setEditing(false);
    };
    return (
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            autoFocus={autoFocus || editing}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={gap.placeholder ?? gap.found}
            className={cx(
              'h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20',
              st === 'invalid' ? 'border-danger focus:border-danger' : 'border-border focus:border-foreground',
            )}
          />
          <Button size="sm" disabled={!draft.trim()} onClick={save}>
            Сохранить
          </Button>
        </div>
        {st === 'invalid' && <p className="text-[12px] text-danger">{gapProblem(gap, fixes)}</p>}
      </div>
    );
  }

  if (gap.kind === 'choice') {
    return (
      <div className="flex flex-col gap-1.5">
        {gap.choices!.map((c) => {
          const active = value === c.label;
          return (
            <button
              key={c.label}
              onClick={() => onFix(c.label)}
              className={cx(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] transition-colors',
                active
                  ? c.ok
                    ? 'border-success/50 bg-success/5 text-foreground'
                    : 'border-warn/50 bg-warn-surface/40 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-secondary',
              )}
            >
              <span
                className={cx(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-foreground bg-primary text-primary-foreground' : 'border-border',
                )}
              >
                {active && <Check className="size-2.5" />}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          onFix(e.target.files?.[0]?.name ?? 'Сертификат_соответствия.pdf');
          setEditing(false);
        }}
      />
      <Button variant="secondary" size="sm" className="w-full" onClick={() => fileInput.current?.click()}>
        <Paperclip className="size-3.5" /> Загрузить файл
      </Button>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{gap.accept}</p>
    </div>
  );
}

// Место в тексте заявки: жёлтое — дописать, красное — ошибка, зелёное — готово. Нажатие — к пункту слева.
function Mark({ id, fixes, onSelect, open }: { id: string; fixes: AppState['fixes']; onSelect: (id: string) => void; open: string | null }) {
  const gap = gaps.find((g) => g.id === id)!;
  const st = gapState(gap, fixes);
  const value = fixes[id];
  const isSel = open === id;
  if (st === 'done') {
    return (
      <button
        onClick={() => onSelect(id)}
        className={cx(
          'rounded px-1 font-medium text-success underline decoration-success/40 underline-offset-2 transition-colors hover:bg-success/10',
          isSel && 'bg-success/10',
        )}
      >
        {shownValue(gap, value!)}
      </button>
    );
  }
  if (st === 'invalid') {
    return (
      <button onClick={() => onSelect(id)} className={cx('rounded bg-danger/10 px-1 font-medium text-danger', isSel && 'ring-2 ring-danger')}>
        ⚠ {gapProblem(gap, fixes)}
      </button>
    );
  }
  const text =
    gap.kind === 'upload'
      ? 'приложить сертификат'
      : gap.kind === 'confirm'
        ? `подтвердить: ${gap.found}`
        : gap.kind === 'choice'
          ? `выбрать: ${lcFirst(gap.label)}`
          : `вписать: ${lcFirst(gap.label)}`;
  return (
    <button onClick={() => onSelect(id)} className={cx('highlight cursor-pointer text-left font-medium transition-shadow', isSel && 'ring-2 ring-warn')}>
      ⚠ {text}
    </button>
  );
}

// Заполнено автоматически — с источником у каждого поля.
function AutoList({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <Sparkles className="size-4 shrink-0 text-success" />
        <span className="min-w-0 flex-1 text-[13px] font-medium">Заполнено автоматически · {AUTO_TOTAL}</span>
        <span className="hidden text-[12px] text-muted-foreground sm:inline">с источниками</span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {autoFields.map((f) => (
            <div key={f.label} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-muted-foreground">{f.label}</span>
                <span className="truncate text-right font-mono text-[12px]">{f.value}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">Источник: {f.source}</p>
            </div>
          ))}
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            И ещё {AUTO_TOTAL - autoFields.length} — характеристики по ТЗ, номера и даты. Все видны в документах пакета.
          </p>
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

export function FinalCheck({ final }: { final: ReturnType<typeof completeness> }) {
  const rows: [string, ReactNode, string][] = [
    ['Обязательные поля', `${final.fields.filled} из ${final.fields.required}${final.fields.empty ? ` · пустых ${final.fields.empty}` : ' · пустых 0'}${final.fields.invalid ? ` · с ошибкой ${final.fields.invalid}` : ''}`, 'Всё, без чего заявку отклонят: реквизиты, характеристики, документы.'],
    ['Документы', `${final.documents.ready} из ${final.documents.required}`, 'Файлы заявки, которые уйдут на площадку.'],
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

// Пошаговый мастер: по одному пункту, вместо длинного документа.
function Wizard({ ids, fixes, onFix, onClose }: { ids: string[]; fixes: AppState['fixes']; onFix: (id: string, v: string) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const gap = gaps.find((g) => g.id === ids[i])!;
  const done = gapState(gap, fixes) === 'done';
  const last = i === ids.length - 1;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Заполнение заявки · шаг ${i + 1} из ${ids.length}`}
      subtitle={`${gap.position} · ${kindMeta[gap.field].label}`}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>
            ← Назад
          </Button>
          {!done && !last && (
            <Button variant="secondary" size="sm" onClick={() => setI(i + 1)}>
              Пропустить
            </Button>
          )}
          <Button size="sm" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'Готово' : 'Дальше →'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${((i + (done ? 1 : 0)) / ids.length) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          {done ? <CheckCircle2 className="size-5 text-success" /> : <AlertTriangle className="size-5 text-warn" />}
          <p className="text-base font-semibold">{gap.label}</p>
        </div>
        <GapBody key={gap.id} gap={gap} fixes={fixes} onFix={(v) => onFix(gap.id, v)} autoFocus />
      </div>
    </Modal>
  );
}
