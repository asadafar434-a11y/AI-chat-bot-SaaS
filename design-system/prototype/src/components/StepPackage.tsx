import { useState, type ReactNode } from 'react';
import { AlertTriangle, Archive, Check, CheckCircle2, Clock, CreditCard, Download, Eye, FileText, Info, Loader2, PenLine, RefreshCw, ShieldCheck, UserCheck, XCircle } from '../lib/icons';
import { AIDisclaimer, Badge, Button, Card, Checkbox, HelpTip, IconButton, Modal, Soon, TabPanel, Tabs, Tooltip, cx, type Tone } from './ui';
import { type AuditReport, type AuditSeverity } from '@/lib/submission-audit';
import { type ScoringReport } from '@/lib/scoring-engine';
import { pointsText } from '@/lib/criteria';
import { plural } from '@/lib/plural';
import { FinalCheck } from './StepReview';
import { CustomerTemplates } from './CustomerTemplates';
import type { CustomerTemplate } from '@/lib/customer-templates';
import type { SubmitItem } from '@/lib/application-files';
import type { Completeness } from '@/lib/fields';
import type { FileFormat } from '@/lib/file-format';
import type { BadgeInfo } from '@/lib/home';
import { rubShort } from '@/lib/price-calc';
import { PRICE_APP, PRICE_EXPERT } from '@/lib/pricing';
import type { TpPart } from '@/lib/tp-parts';
import type { Downloading } from '@/lib/use-application-files';
import type { DetectedForm } from '@/lib/tp';

// Шаг «Пакет»: состав заявки — файлы по одному и архивом, что требует заказчик, оплата и проверка специалистом.
// Разметка — прототипа; данные — настоящие (их собирает real/package.tsx). Оплаты и специалиста пока нет — «скоро».

// Окно просмотра документа: что показать и подписи вокруг.
export type PackagePreview = {
  title: string;
  subtitle: string;
  head: string;
  customer: string;
  // Пояснение над документом: по чему составлен или что составлен по прежним данным.
  note?: string;
  body: ReactNode;
  foot: [string, string];
  // Для участника, в файл не попадает: оценка баллов и что не засчитают.
  extra?: ReactNode;
};

export type PackageRow = {
  part: TpPart;
  title: string;
  sub: string;
  badge: BadgeInfo;
  action: 'download' | 'compose';
  preview: PackagePreview | null;
  // Часть уже составлена — её можно составить заново (новый запрос к ИИ).
  canRedo: boolean;
};

const TONE: Record<BadgeInfo['tone'], Tone> = { ok: 'success', warn: 'warn', bad: 'danger', brand: 'info', calm: 'neutral' };
const BADGE_ICON: Record<NonNullable<BadgeInfo['icon']>, ReactNode> = {
  check: <Check className="size-2.5" />,
  pen: <PenLine className="size-2.5" />,
  alert: <AlertTriangle className="size-2.5" />,
  clock: <Clock className="size-2.5" />,
};

// Форматы файлов: Word — править и дописывать жёлтые места, PDF — подписать и подать, ODT — для LibreOffice, Р7-Офис и МойОфис.
const FORMATS: { id: FileFormat; ext: string; label: string }[] = [
  { id: 'docx', ext: 'DOCX', label: 'Word — можно править и дописывать жёлтые места' },
  { id: 'pdf', ext: 'PDF', label: 'PDF — для подписи и подачи: тот же текст и жёлтые места, что в Word' },
  { id: 'odt', ext: 'ODT', label: 'ODT — для LibreOffice, Р7-Офис и МойОфис: тот же текст и жёлтые места, что в Word' },
];
const EXT: Record<FileFormat, string> = { docx: 'DOCX', pdf: 'PDF', odt: 'ODT' };
const NAME: Record<FileFormat, string> = { docx: 'Word', pdf: 'PDF', odt: 'ODT' };

// ——— Финальная проверка перед подачей ———

const AUDIT_ICON: Record<AuditSeverity, ReactNode> = {
  CRITICAL: <XCircle className="size-3.5 text-danger" />,
  WARNING: <AlertTriangle className="size-3.5 text-warn" />,
  INFO: <Info className="size-3.5 text-muted-foreground" />,
};
const AUDIT_TONE: Record<AuditSeverity, Tone> = {
  CRITICAL: 'danger',
  WARNING: 'warn',
  INFO: 'neutral',
};
const AUDIT_LABEL: Record<AuditSeverity, string> = {
  CRITICAL: 'Критично',
  WARNING: 'Предупреждение',
  INFO: 'Информация',
};
const RISK_LABEL: Record<AuditReport['risk'], string> = {
  high: 'Высокий риск отклонения',
  medium: 'Средний риск',
  low: 'Готово к подаче',
};
// Цвет итога финальной проверки: красный — высокий риск, янтарный — средний, зелёный — готово.
const RISK_TEXT: Record<AuditReport['risk'], string> = {
  high: 'text-danger',
  medium: 'text-warn-foreground',
  low: 'text-success',
};

// Замечаний бывает несколько десятков (все они уже перечислены на «Проверке»): на «Пакете» видны первые, остальные — по кнопке.
const AUDIT_SHOWN = 6;

function AuditPanel({ report }: { report: AuditReport }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  if (report.findings.length === 0) {
    return (
      <Card className="flex items-center gap-2.5 p-4">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <p className="text-[13px] text-muted-foreground">Нарушений перед подачей не обнаружено.</p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {report.risk === 'high' ? (
            <XCircle className="size-4 text-danger" />
          ) : report.risk === 'medium' ? (
            <AlertTriangle className="size-4 text-warn" />
          ) : (
            <CheckCircle2 className="size-4 text-success" />
          )}
          <span className="text-[15px] font-bold">Финальная проверка</span>
          <HelpTip align="start" content="Критичные нарушения — вероятное отклонение заявки. Предупреждения — нужна проверка человека." />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {report.critical > 0 && <Badge tone="danger">{report.critical} {plural(report.critical, 'критичное', 'критичных', 'критичных')}</Badge>}
          {report.warnings > 0 && <Badge tone="warn">{report.warnings} {plural(report.warnings, 'предупреждение', 'предупреждения', 'предупреждений')}</Badge>}
          {report.info > 0 && <Badge tone="neutral">{report.info} инфо</Badge>}
          <span className={cx('text-[14px] font-bold', RISK_TEXT[report.risk])}>{RISK_LABEL[report.risk]}</span>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {(all ? report.findings : report.findings.slice(0, AUDIT_SHOWN)).map((f) => {
          const isOpen = expanded === f.id;
          return (
            <li key={f.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : f.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
              >
                {AUDIT_ICON[f.severity]}
                <span className="min-w-0 flex-1 text-[13px]">{f.what}</span>
                <Badge tone={AUDIT_TONE[f.severity]}>{AUDIT_LABEL[f.severity]}</Badge>
              </button>
              {isOpen && (
                <dl className="border-t border-border bg-secondary/30 px-4 py-3 space-y-1.5 text-[12px]">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground w-24">Требование</dt>
                    <dd>{f.requirement}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground w-24">Источник</dt>
                    <dd>{f.source}</dd>
                  </div>
                  {f.evidence && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground w-24">Доказательство</dt>
                      <dd>{f.evidence}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground w-24 font-medium">Что сделать</dt>
                    <dd className="font-medium">{f.fix}</dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {report.findings.length > AUDIT_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-border px-4 py-2.5 text-center text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground">
          {all ? 'Свернуть' : `Показать ещё ${report.findings.length - AUDIT_SHOWN}`}
        </button>
      )}
    </Card>
  );
}

// ——— Оценка по критериям ———

function ScoringPanel({ report }: { report: ScoringReport }) {
  if (report.howWins !== 'points' || report.groups.length === 0) return null;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-muted-foreground" />
          <span className="text-[15px] font-bold">Оценка по критериям</span>
          <HelpTip align="start" content="Баллы рассчитаны по базе доказательств. ИИ не участвует — только код. Цена считается площадкой." />
        </div>
        <div className="flex items-center gap-1.5">
          {report.totalPoints !== null && report.totalMax !== null ? (
            <Badge tone="neutral">
              {pointsText(report.totalPoints)} из {pointsText(report.totalMax)}
            </Badge>
          ) : (
            <Badge tone="neutral">Баллы посчитаны не полностью</Badge>
          )}
        </div>
      </div>
      <div className="divide-y divide-border">
        {report.groups.map((group) => (
          <div key={group.name}>
            <div className="flex items-center justify-between gap-2 bg-secondary/40 px-4 py-2">
              <span className="min-w-0 break-words text-[13px] font-medium">{group.name}</span>
              {group.weightText && (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{group.weightText}</span>
              )}
            </div>
            <table className="w-full table-fixed text-[12px]">
              <colgroup>
                <col />
                <col className="w-[5.5rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[4rem] pr-2" />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-1.5 text-left font-medium text-muted-foreground">Показатель</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">Макс.</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">База</th>
                  <th className="px-2 py-1.5 pr-4 text-right font-medium text-muted-foreground whitespace-nowrap">Балл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {group.criteria.map((c, i) => {
                  const label = c.row.indicator || c.row.detail || c.row.criterion;
                  const compVal =
                    c.value.kind === 'count' ? `${c.value.n} шт.` :
                    c.value.kind === 'present' ? (c.value.yes ? 'Есть' : 'Нет') : '—';
                  return (
                    <tr key={i}>
                      <td className="break-words px-4 py-2 leading-snug">
                        <p>{label}</p>
                        {c.gap && <p className="mt-0.5 text-[11px] text-muted-foreground">{c.gap}</p>}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">
                        {c.maxPoints !== null ? pointsText(c.maxPoints) : '?'}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{compVal}</td>
                      <td className="px-2 py-2 pr-4 text-right font-medium whitespace-nowrap">
                        {c.points !== null ? pointsText(c.points) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Бланк заказчика — строкой в «Составе пакета»: сколько полей ждут участника и скачивание отдельным файлом.
function BlankRow({ form, onDownload }: { form: DetectedForm; onDownload: () => void }) {
  const empty = form.fields.filter((f) => f.value.trim() === '').length;
  const sub = [form.source, form.pages].filter(Boolean).join(' · ');
  return (
    <div className="group flex items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <FileText className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium">{form.title}</p>
          {empty > 0 ? (
            <Badge tone="warn">
              <PenLine className="size-2.5" />
              впишите {empty} {empty === 1 ? 'поле' : empty < 5 ? 'поля' : 'полей'}
            </Badge>
          ) : (
            <Badge tone="success">
              <Check className="size-2.5" />
              готово
            </Badge>
          )}
        </div>
        {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Скачать бланк" onClick={onDownload}>
          <Download className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

function FileRow({
  row,
  format,
  downloading,
  busy,
  onOpen,
  onDownload,
  onCompose,
}: {
  row: PackageRow;
  format: FileFormat;
  downloading: Downloading;
  busy: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onCompose: () => void;
}) {
  const warn = row.badge.tone === 'warn' || row.badge.tone === 'bad';
  const working = downloading === row.part;
  const head = (
    <>
      <FileText className={cx('mt-0.5 size-4 shrink-0 self-start', warn ? 'text-warn' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cx('text-sm font-medium', row.preview && 'group-hover:underline')}>{row.title}</p>
          <Badge tone={TONE[row.badge.tone]}>
            {row.badge.icon && BADGE_ICON[row.badge.icon]}
            {row.badge.text}
          </Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.sub}</p>
      </div>
    </>
  );
  return (
    <div className="group flex items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      {row.preview ? (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          {head}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">{head}</div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {row.preview && (
          <IconButton label="Предпросмотр" onClick={onOpen}>
            <Eye className="size-4" />
          </IconButton>
        )}
        {row.action === 'compose' ? (
          <Button size="sm" variant="secondary" onClick={onCompose}>
            Составить
          </Button>
        ) : (
          <IconButton
            label={working ? 'Собираю файл…' : `Скачать ${EXT[format]}`}
            align="end"
            disabled={busy}
            onClick={onDownload}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          </IconButton>
        )}
      </div>
    </div>
  );
}

// Пункт «Что требует заказчик»: отметка «готово» и откуда взят пункт.
// where — где в файлах закупки стоит цитата: файл, страница, таблица, пункт (lib/doc-locate.ts); считается, когда пункт раскрыт.
function ChecklistItem({ item, onToggle, whereOf }: { item: SubmitItem; onToggle: () => void; whereOf?: (quote: string) => string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border px-4 py-3 last:border-0">
      <Checkbox checked={item.ready} onChange={onToggle}>
        <span className={cx('text-[13px] leading-snug', item.ready && 'text-muted-foreground line-through')}>{item.text}</span>
      </Checkbox>
      {/* Площадка передаст сама, «не требуется», «по желанию» — подаче не мешает, отметка не обязательна. */}
      {!item.required && item.note && <p className="mt-1 pl-[26px] text-[12px] text-muted-foreground">Не мешает подаче: {item.note}</p>}
      <div className="mt-1 pl-[26px] text-[12px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <FileText className="size-3" /> {item.source || 'цитата из документов'}
        </button>
        {open && (
          <blockquote className="mt-1 rounded-md bg-secondary px-3 py-2 leading-snug text-muted-foreground">
            «{item.quote}»
            {whereOf?.(item.quote) && <span className="mt-1 block break-words text-[11px]">{whereOf(item.quote)}</span>}
          </blockquote>
        )}
        {!item.verified && (
          <p className="mt-1 flex items-start gap-1.5 text-warn-foreground">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Цитата не найдена в документах дословно — сверьте пункт вручную.
          </p>
        )}
      </div>
    </li>
  );
}

export function StepPackage({
  hasTp,
  noApplication = false,
  notice,
  format,
  onFormat,
  final,
  rows,
  count,
  items,
  whereOf,
  downloading,
  writing,
  busy,
  error,
  note,
  onToggleReady,
  onDownload,
  onRedo,
  onDownloadAll,
  onFix,
  onTariffs,
  onBack,
  auditReport: auditRep,
  scoringReport: scoringRep,
  detectedForms,
  templates,
  onDownloadForm,
  registry,
  excelForms,
}: {
  hasTp: boolean;
  // Закупка без заявки (у единственного поставщика): файлов нет, остаётся список того, что просит заказчик.
  noApplication?: boolean;
  // Блок под заголовком шага — например, «документы закупки изменились».
  notice?: ReactNode;
  // Формат файлов: один на все скачивания на этом шаге.
  format: FileFormat;
  onFormat: (format: FileFormat) => void;
  final: Completeness;
  rows: PackageRow[];
  count: number;
  items: SubmitItem[];
  // Где в файлах закупки стоит цитата пункта: файл, страница, таблица, пункт. Не задана — адреса не показываем.
  whereOf?: (quote: string) => string | undefined;
  downloading: Downloading;
  writing: TpPart | null;
  busy: boolean;
  error: string | null;
  note: string | null;
  onToggleReady: (text: string) => void;
  onDownload: (part: TpPart) => void;
  // Составить часть заново и скачать: новый запрос к ИИ.
  onRedo: (part: TpPart) => void;
  onDownloadAll: () => void;
  // К шагу «Проверка»: дописать, подтвердить или составить документы.
  onFix: () => void;
  onTariffs: () => void;
  onBack: () => void;
  // Финальная проверка перед подачей (submission-audit.ts): если не задан, блок не показывается.
  auditReport?: AuditReport;
  // Оценка по критериям (scoring-engine.ts): если не задан или howWins ≠ points, блок не показывается.
  scoringReport?: ScoringReport;
  // Бланки заказчика — строками в «Составе пакета».
  detectedForms?: DetectedForm[];
  // Шаблоны заказчика: файлы документации, которые он дал как образцы (lib/customer-templates.ts); список — над «Составом пакета».
  templates?: CustomerTemplate[];
  // Скачать один бланк отдельным файлом.
  onDownloadForm?: (df: DetectedForm) => void;
  // Блок «Реестровые номера товаров» (real/registry.tsx); на макете без закупки не задаётся.
  registry?: ReactNode;
  // Блок «Excel-бланки заказчика» (real/excel-forms.tsx); на макете без закупки не задаётся.
  excelForms?: ReactNode;
}) {
  const [openPart, setOpenPart] = useState<TpPart | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [redo, setRedo] = useState(false);
  const open = rows.find((r) => r.part === openPart && r.preview) ?? null;
  const preview = open?.preview ?? null;
  // Отметки ждут только пункты, которые держат подачу; остальные — площадка передаст, «не требуется», «по желанию».
  const needed = items.filter((i) => i.required);
  const ready = needed.filter((i) => i.ready).length;
  // Вкладки «Пакета»: «Файлы» — шаблоны, состав пакета и Excel-бланки (нет ни одного — вкладки нет); «Реестровые номера» и «Финальная проверка» — если блок есть; «Что требует заказчик» — всегда.
  const hasFilesTab = !noApplication || (detectedForms?.length ?? 0) > 0 || (templates?.length ?? 0) > 0 || Boolean(excelForms);
  const tabItems: { key: string; label: string; badge?: ReactNode }[] = [
    ...(hasFilesTab ? [{ key: 'files', label: 'Файлы' }] : []),
    ...(registry ? [{ key: 'registry', label: 'Реестровые номера' }] : []),
    {
      key: 'needs',
      label: 'Что требует заказчик',
      badge: needed.length > 0 ? <Badge tone={ready === needed.length ? 'success' : 'neutral'}>{ready}/{needed.length}</Badge> : undefined,
    },
    ...(auditRep || scoringRep
      ? [{ key: 'audit', label: 'Финальная проверка', badge: auditRep && auditRep.critical > 0 ? <Badge tone="danger">{auditRep.critical}</Badge> : undefined }]
      : []),
  ];
  const activeTab = tabItems.some((t) => t.key === tab) ? (tab as string) : tabItems[0].key;
  // Сколько пунктов ещё не закрыто: пустые и неверные поля, неподтверждённое и документы заказчика.
  const openCount =
    final.fields.empty +
    final.fields.invalid +
    (final.confirmations.required - final.confirmations.done) +
    (final.documents.required - final.documents.ready);
  const close = () => {
    setOpenPart(null);
    setRedo(false);
  };

  // Уровни важности (решение владельца 22.10.2026): 1) итог пакета и главное действие — крупно и цветом; 2) файлы и список заказчика; 3) оплата и проверка специалистом («скоро») — тонкими строками, пояснения — в подсказках.
  const heroTone = noApplication ? '' : hasTp && final.ready ? 'border-success/40 bg-success/5' : 'border-warn/50 bg-warn-surface/30';
  const heroText = hasTp && final.ready ? 'text-success' : 'text-warn-foreground';
  const zipLabel = downloading === 'all' ? (writing ? 'Пишу документ…' : 'Собираю архив…') : 'Всё архивом · ZIP';

  return (
    <div className="animate-fade-up space-y-4">
      <Card className={cx('p-5', heroTone)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className={cx('flex items-center gap-2 text-2xl font-bold tracking-tight', !noApplication && heroText)}>
              {!noApplication && (hasTp && final.ready ? <ShieldCheck className="size-6 shrink-0" /> : <AlertTriangle className="size-6 shrink-0" />)}
              {noApplication ? 'Что подготовить' : !hasTp ? 'Пакет документов' : final.ready ? 'Пакет документов готов' : 'Пакет почти готов'}
            </h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              {noApplication ? 'Заявки нет — подготовьте то, что просит заказчик.' : 'Скачайте файлы, отметьте собранное, подпишите и подайте.'}
              <HelpTip
                align="start"
                content={
                  noApplication
                    ? 'В этой закупке заявки нет: заказчик заключает договор с названным поставщиком. Подготовьте то, что он просит, и отметьте готовое.'
                    : `Скачайте файлы ${NAME[format]} по одному или архивом и отметьте, что из списка заказчика уже собрано. Потом подпишите заявку электронной подписью и подайте на площадке.`
                }
              />
            </p>
            {hasTp && !noApplication && openCount > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[15px] font-bold text-warn-foreground">
                Осталось незакрытых пунктов: {openCount}
                <HelpTip align="start" content="Скачать можно и так, но риск отклонения выше. В файлах незаполненное — жёлтым." />
              </p>
            )}
          </div>
          {!noApplication && (
            <div className="flex flex-wrap items-center gap-2">
              {(!hasTp || openCount > 0) && (
                <Button variant="secondary" onClick={onFix}>
                  {hasTp ? 'Вернуться к проверке' : 'К проверке'}
                </Button>
              )}
              {hasTp && (
                <Tooltip content={`Все документы в ${EXT[format]} одним архивом.`} align="end">
                  <Button disabled={busy} onClick={onDownloadAll}>
                    {downloading === 'all' ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
                    {zipLabel}
                  </Button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        {!noApplication && !hasTp && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium">
            Документы заявки ещё не составлены
            <HelpTip align="start" content="Составьте их на шаге «Проверка» — форму заявки беру из документов закупки. Тогда здесь появятся файлы." />
          </p>
        )}
      </Card>

      {notice}

      {hasTp && !noApplication && <FinalCheck final={final} compact />}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {note && <p role="status" className="rounded-md bg-info/10 px-3 py-2 text-[13px] text-info">{note}</p>}

      {/* Оплата и проверка специалистом пока не работают («скоро»): тонкие строки над документами (решение владельца 17.10.2026), пояснения — в подсказках. */}
      {!noApplication && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              <CreditCard className="size-4" />
              Заявка под ключ · {rubShort(PRICE_APP)} <Soon />
              <HelpTip align="start" content="Оплаты пока нет — документы скачиваются бесплатно. Пакет 5 или 10 заявок будет дешевле." />
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled>
                <CreditCard className="size-3.5" /> Оплатить {rubShort(PRICE_APP)}
              </Button>
              <Button variant="ghost" size="sm" onClick={onTariffs}>
                Тарифы
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              <UserCheck className="size-4" />
              Проверка специалистом <Soon />
              <HelpTip
                align="start"
                content="Пакет проверил ИИ. Живой тендерный юрист вручную сверит документы с извещением и даст письменное заключение перед подачей — разовая услуга. Ручная сверка с извещением. То, чего не видит ИИ: сроки, подписи, формы. Заключение за 2 часа. Пока недоступно: подключим вместе с оплатой."
              />
            </p>
            <Button variant="accent" size="sm" disabled>
              <UserCheck className="size-3.5" /> Отправить специалисту · {rubShort(PRICE_EXPERT)}
            </Button>
          </div>
        </>
      )}

      {/* Блоки «Пакета» — вкладками: на экране один, а не все сразу. Содержимое остальных остаётся в странице скрытым, поэтому введённое и открытое не теряется. */}
      {tabItems.length > 1 && <Tabs idPrefix="pkg" items={tabItems} active={activeTab} onChange={setTab} />}
      <div className="grid grid-cols-1 gap-4">
        <div className="min-w-0 space-y-4">
          {hasFilesTab && (
            <TabPanel idPrefix="pkg" tabKey="files" active={activeTab} className="space-y-4">
              {/* Шаблоны заказчика: что он прислал как образцы */}
              {templates && templates.length > 0 && <CustomerTemplates templates={templates} />}

              {/* Состав пакета: без заявки файлов нет, остаются только бланки заказчика, если они есть */}
              {(!noApplication || (detectedForms?.length ?? 0) > 0) && (
              <Card className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <span className="text-[15px] font-bold">Состав пакета · {count} док.</span>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Формат файлов">
                    {FORMATS.map((f) => (
                      <Tooltip key={f.ext} content={f.label} side="bottom" align="end">
                        <button
                          type="button"
                          disabled={busy}
                          aria-pressed={f.id === format}
                          onClick={() => onFormat(f.id)}
                          className={cx(
                            'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors',
                            f.id === format
                              ? 'border-foreground bg-primary text-primary-foreground'
                              : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60',
                          )}
                        >
                          {f.ext}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </div>
                <div>
                  {rows.map((row) => (
                    <FileRow
                      key={row.part}
                      row={row}
                      format={format}
                      downloading={downloading}
                      busy={busy || !hasTp}
                      onOpen={() => setOpenPart(row.part)}
                      onDownload={() => onDownload(row.part)}
                      onCompose={onFix}
                    />
                  ))}
                  {(detectedForms ?? []).map((df, i) => (
                    <BlankRow key={`blank:${i}`} form={df} onDownload={() => onDownloadForm?.(df)} />
                  ))}
                </div>
              </Card>
              )}

              {/* Excel-бланки заказчика */}
              {excelForms}

            </TabPanel>
          )}
          {registry && (
            <TabPanel idPrefix="pkg" tabKey="registry" active={activeTab} className="space-y-4">
              {/* Реестровые номера товаров */}
              {registry}

            </TabPanel>
          )}
          <TabPanel idPrefix="pkg" tabKey="needs" active={activeTab} className="space-y-4">
              {/* Что требует заказчик */}
              <Card className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[15px] font-bold">
                    Что требует заказчик
                    <HelpTip
                      align="start"
                      content={
                        noApplication
                          ? 'Всё, что заказчик просит от участника. Отметьте, что уже готово.'
                          : 'Всё, что заказчик просит приложить. Часть закрывают файлы выше — отметьте, что уже готово.'
                      }
                    />
                  </span>
                  {items.length > 0 && (
                    <span className={cx('font-mono text-[13px] font-bold tabular-nums', needed.length > 0 && ready === needed.length ? 'text-success' : 'text-foreground')}>
                      {needed.length ? `готово ${ready} из ${needed.length}` : 'отмечать нечего'}
                    </span>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="px-4 py-3 text-[13px] text-muted-foreground">
                    Перечня документов в документах закупки не нашлось — сверьтесь с извещением: что подать, обычно сказано в требованиях
                    к заявке.
                  </p>
                ) : (
                  <ul>
                    {items.map((item, i) => (
                      <ChecklistItem key={`${i}:${item.text}`} item={item} onToggle={() => onToggleReady(item.text)} whereOf={whereOf} />
                    ))}
                  </ul>
                )}
              </Card>
          </TabPanel>
          {(auditRep || scoringRep) && (
            <TabPanel idPrefix="pkg" tabKey="audit" active={activeTab} className="space-y-4">
              {/* Финальная проверка перед подачей */}
              {auditRep && <AuditPanel report={auditRep} />}

              {/* Оценка по критериям */}
              {scoringRep && <ScoringPanel report={scoringRep} />}
            </TabPanel>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← Назад
        </Button>
        <AIDisclaimer className="text-right" />
      </div>

      <Modal
        open={!!open}
        onClose={close}
        title={preview?.title ?? ''}
        subtitle={preview?.subtitle}
        footer={
          open && preview ? (
            redo ? (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                <p className="flex-1 text-[12px] text-muted-foreground">
                  ИИ напишет документ ещё раз и скачает новый файл {NAME[format]}. Всё, что вы поправили в прежнем файле, не сохранится.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setRedo(false)}>
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setRedo(false);
                      onRedo(open.part);
                    }}
                  >
                    Составить и скачать
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {open.canRedo ? (
                  <Tooltip content="ИИ напишет документ ещё раз по вашим реквизитам, цене и образцам." align="start">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRedo(true)}>
                      {downloading === open.part ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      Составить заново
                    </Button>
                  </Tooltip>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      close();
                      onFix();
                    }}
                  >
                    Править на шаге «Проверка»
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={close}>
                  Закрыть
                </Button>
                <Button size="sm" disabled={busy} onClick={() => onDownload(open.part)}>
                  <Download className="size-3.5" /> Скачать {EXT[format]}
                </Button>
              </>
            )
          ) : undefined
        }
      >
        {open && preview && (
          <div className="bg-secondary/30 p-6">
            {preview.note && <p className="mx-auto mb-3 max-w-lg text-[12px] text-muted-foreground">{preview.note}</p>}
            <div className="mx-auto max-w-lg rounded-md border border-border bg-card p-8 shadow-sm">
              <div className="mb-5 border-b border-border pb-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{preview.head}</p>
                {preview.customer && <p className="mt-2 text-xs text-muted-foreground">{preview.customer}</p>}
              </div>
              {downloading === open.part ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {writing === open.part ? 'ИИ составляет документ заново — около минуты…' : 'Собираю файл…'}
                </p>
              ) : (
                preview.body
              )}
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 text-[11px] text-muted-foreground">
                <span>{preview.foot[0]}</span>
                <span className="font-mono">{preview.foot[1]}</span>
              </div>
            </div>
            {preview.extra && <div className="mx-auto mt-4 max-w-lg space-y-2 text-[12px]">{preview.extra}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
