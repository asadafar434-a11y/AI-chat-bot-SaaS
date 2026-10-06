import { useState, type ReactNode } from 'react';
import { AlertTriangle, Archive, Check, CheckCircle2, Clock, CreditCard, Download, Eye, FileText, HelpCircle, Info, Loader2, PenLine, RefreshCw, ShieldCheck, UserCheck, XCircle } from '../lib/icons';
import { AIDisclaimer, Badge, Button, Card, Checkbox, HelpTip, IconButton, Modal, Soon, Tooltip, cx, type Tone } from './ui';
import { categorySummary, CATEGORY_TITLES, type ValidationReport, type ValidationCategory } from '@/lib/validation-engine';
import { BUILD_STEP_TITLES, type BuildReport, type BuildStepId, type BuildStepStatus } from '@/lib/application-builder';
import { type AuditReport, type AuditSeverity } from '@/lib/submission-audit';
import { type ScoringReport } from '@/lib/scoring-engine';
import { pointsText } from '@/lib/criteria';
import { FinalCheck } from './StepReview';
import type { SubmitItem } from '@/lib/application-files';
import type { Completeness } from '@/lib/fields';
import type { FileFormat } from '@/lib/file-format';
import type { BadgeInfo } from '@/lib/home';
import { rubShort } from '@/lib/price-calc';
import { PRICE_APP, PRICE_EXPERT } from '@/lib/pricing';
import type { TpPart } from '@/lib/tp-parts';
import type { Downloading } from '@/lib/use-application-files';
import type { TpForm, DetectedForm } from '@/lib/tp';

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

// ——— Детерминированная проверка ———

const STATUS_ICON: Record<string, ReactNode> = {
  PASS: <CheckCircle2 className="size-3.5 text-success" />,
  FAIL: <XCircle className="size-3.5 text-danger" />,
  NEEDS_HUMAN_REVIEW: <HelpCircle className="size-3.5 text-warn" />,
};
const STATUS_LABEL: Record<string, string> = {
  PASS: 'Пройдено',
  FAIL: 'Нарушение',
  NEEDS_HUMAN_REVIEW: 'Решает человек',
};
const STATUS_TONE: Record<string, Tone> = {
  PASS: 'success',
  FAIL: 'danger',
  NEEDS_HUMAN_REVIEW: 'warn',
};

const CATEGORY_ORDER: ValidationCategory[] = [
  'required_documents',
  'required_fields',
  'numeric_constraints',
  'dates',
  'validity_periods',
  'requisite_matching',
  'characteristic_matching',
  'evidence_presence',
  'document_contradictions',
];

function ValidationPanel({ report }: { report: ValidationReport }) {
  const [expanded, setExpanded] = useState<ValidationCategory | null>(null);
  const summary = categorySummary(report);

  if (summary.length === 0) {
    return (
      <Card className="flex items-center gap-2.5 p-4">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <p className="text-[13px] text-muted-foreground">Детерминированных нарушений не найдено.</p>
      </Card>
    );
  }

  const sorted = CATEGORY_ORDER.filter((c) => summary.some((s) => s.category === c))
    .map((c) => summary.find((s) => s.category === c)!)
    .concat(summary.filter((s) => !CATEGORY_ORDER.includes(s.category)));

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {report.status === 'PASS' ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : report.status === 'FAIL' ? (
            <XCircle className="size-4 text-danger" />
          ) : (
            <HelpCircle className="size-4 text-warn" />
          )}
          <span className="text-sm font-medium">Детерминированная проверка</span>
        </div>
        <div className="flex items-center gap-1.5">
          {report.fail > 0 && <Badge tone="danger">{report.fail} нарушение</Badge>}
          {report.needsHuman > 0 && <Badge tone="warn">{report.needsHuman} на проверку</Badge>}
          {report.fail === 0 && report.needsHuman === 0 && <Badge tone="success">Всё в порядке</Badge>}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {sorted.map((s) => {
          const isOpen = expanded === s.category;
          const findings = report.findings.filter((f) => f.category === s.category && f.status !== 'PASS');
          return (
            <li key={s.category}>
              <button
                type="button"
                aria-expanded={isOpen}
                disabled={findings.length === 0}
                onClick={() => setExpanded(isOpen ? null : s.category)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {STATUS_ICON[s.status]}
                <span className="min-w-0 flex-1 text-[13px]">{CATEGORY_TITLES[s.category]}</span>
                <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              </button>
              {isOpen && findings.length > 0 && (
                <ul className="border-t border-border bg-secondary/30 px-4 py-2 space-y-3">
                  {findings.map((f) => (
                    <li key={f.id} className="space-y-0.5">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0">{STATUS_ICON[f.status]}</span>
                        <span className="text-[13px] font-medium">{f.title}</span>
                      </div>
                      <ul className="pl-5 space-y-0.5">
                        {f.reasons.map((r, i) => (
                          <li key={i} className="text-[12px] text-muted-foreground">{r}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Критические проверки — без ИИ: числа, сроки, реквизиты, обязательные поля. ИИ интерпретирует текст, правила считают факты.
        </p>
      </div>
    </Card>
  );
}

// ——— Сборка заявки: 7 шагов ———

const BUILD_STATUS_ICON: Record<BuildStepStatus, ReactNode> = {
  done: <CheckCircle2 className="size-3.5 text-success" />,
  partial: <AlertTriangle className="size-3.5 text-warn" />,
  pending: <Clock className="size-3.5 text-muted-foreground" />,
  na: <span className="inline-block size-3.5 text-center text-[10px] leading-[14px] text-muted-foreground">—</span>,
};
const BUILD_STATUS_TONE: Record<BuildStepStatus, Tone> = {
  done: 'success',
  partial: 'warn',
  pending: 'neutral',
  na: 'neutral',
};
const BUILD_STATUS_LABEL: Record<BuildStepStatus, string> = {
  done: 'Готово',
  partial: 'Частично',
  pending: 'Ожидает',
  na: 'Не требуется',
};

const BUILD_STEP_ORDER: BuildStepId[] = [
  'required_documents',
  'existing_documents',
  'generated_documents',
  'auto_filled',
  'confirmed_facts',
  'unknown_marked',
  'package_assembled',
];

function BuildPanel({ report }: { report: BuildReport }) {
  const [expanded, setExpanded] = useState<BuildStepId | null>(null);
  const sorted = BUILD_STEP_ORDER.map((id) => report.steps.find((s) => s.id === id)!).filter(Boolean);

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {BUILD_STATUS_ICON[report.overall]}
          <span className="text-sm font-medium">Сборка заявки</span>
        </div>
        <div className="flex items-center gap-1.5">
          {report.blockingCount > 0 ? (
            <Badge tone="warn">{report.blockingCount} не готово</Badge>
          ) : (
            <Badge tone="success">Все шаги выполнены</Badge>
          )}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {sorted.map((step, i) => {
          const isOpen = expanded === step.id;
          return (
            <li key={step.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : step.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                {BUILD_STATUS_ICON[step.status]}
                <span className="min-w-0 flex-1 text-[13px]">{BUILD_STEP_TITLES[step.id]}</span>
                <Badge tone={BUILD_STATUS_TONE[step.status]}>{BUILD_STATUS_LABEL[step.status]}</Badge>
              </button>
              {isOpen && (
                <p className="border-t border-border bg-secondary/30 px-4 py-2 text-[12px] text-muted-foreground">
                  {step.detail}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Система только вставляет подтверждённые факты и отмечает жёлтым то, что не знает. Предположений нет.
        </p>
      </div>
    </Card>
  );
}

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
const RISK_TONE: Record<AuditReport['risk'], Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'success',
};

function AuditPanel({ report }: { report: AuditReport }) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
          <span className="text-sm font-medium">Финальная проверка</span>
        </div>
        <div className="flex items-center gap-1.5">
          {report.critical > 0 && <Badge tone="danger">{report.critical} критичных</Badge>}
          {report.warnings > 0 && <Badge tone="warn">{report.warnings} предупреждений</Badge>}
          {report.info > 0 && <Badge tone="neutral">{report.info} инфо</Badge>}
          <Badge tone={RISK_TONE[report.risk]}>{RISK_LABEL[report.risk]}</Badge>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {report.findings.map((f) => {
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
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Критичные нарушения — вероятное отклонение заявки. Предупреждения — нужна проверка человека.
        </p>
      </div>
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
          <span className="text-sm font-medium">Оценка по критериям</span>
        </div>
        <div className="flex items-center gap-1.5">
          {report.totalPoints !== null && report.totalMax !== null ? (
            <Badge tone="neutral">
              {pointsText(report.totalPoints)} из {pointsText(report.totalMax)}
            </Badge>
          ) : (
            <Badge tone="neutral">Не все формулы распознаны</Badge>
          )}
        </div>
      </div>
      <div className="divide-y divide-border">
        {report.groups.map((group) => (
          <div key={group.name}>
            <div className="flex items-center justify-between gap-2 bg-secondary/40 px-4 py-2">
              <span className="text-[13px] font-medium truncate">{group.name}</span>
              {group.weightText && (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{group.weightText}</span>
              )}
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-1.5 text-left font-medium text-muted-foreground">Показатель</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">Макс.</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">База</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap">Балл</th>
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
                      <td className="px-4 py-2 leading-snug">
                        <p className="truncate" title={label}>{label}</p>
                        {c.gap && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground truncate" title={c.gap}>{c.gap}</p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">
                        {c.maxPoints !== null ? pointsText(c.maxPoints) : '?'}
                      </td>
                      <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{compVal}</td>
                      <td className="px-2 py-2 text-right font-medium whitespace-nowrap">
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
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Баллы рассчитаны по базе доказательств. ИИ не участвует — только код. Цена считается площадкой.
        </p>
      </div>
    </Card>
  );
}

// ——— Формы заказчика: паспорт форм ———

function FormsPanel({
  form,
  detectedForms,
  format,
  onDownloadForm,
}: {
  form: TpForm;
  detectedForms: DetectedForm[];
  format: FileFormat;
  onDownloadForm?: (df: DetectedForm) => void;
}) {
  const hasMain = !!form.source || (form.title !== 'Техническое предложение' && !!form.title);
  const hasGoods = form.goodsTableHeaders.length > 0;
  const detected = detectedForms.map((f) => ({
    raw: f,
    title: f.title,
    source: f.source,
    pages: f.pages,
    total: f.fields.length,
    filled: f.fields.filter((fld) => fld.value.trim() !== '').length,
  }));

  if (!hasMain && !hasGoods && detected.length === 0) return null;

  const totalForms = (hasMain || hasGoods ? 1 : 0) + detected.length;
  const plural = totalForms === 1 ? 'форма' : totalForms < 5 ? 'формы' : 'форм';

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4" />
          <span className="text-sm font-medium">Формы заказчика</span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">{totalForms} {plural}</span>
      </div>
      <ul className="divide-y divide-border">
        {(hasMain || hasGoods) && (
          <li className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium truncate">{form.title || 'Форма заявки'}</p>
                {form.source && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{form.source}</p>
                )}
              </div>
              <Badge tone="neutral">Главная</Badge>
            </div>
            {(form.participantFields.length > 0 || hasGoods) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {form.participantFields.length > 0 && (
                  <span>{form.participantFields.length} полей участника</span>
                )}
                {hasGoods && (
                  <span>
                    таблица товаров
                    {form.goodsTableHeaders.map((h, i) => (
                      <span key={i} className="font-mono"> · {h}</span>
                    ))}
                  </span>
                )}
              </div>
            )}
          </li>
        )}
        {detected.map((f, i) => {
          const empty = f.total - f.filled;
          const done = f.total === 0 || empty === 0;
          const emptyLabel = empty === 1 ? 'поле' : empty < 5 ? 'поля' : 'полей';
          return (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium truncate">{f.title}</p>
                    <Badge tone={done ? 'success' : 'warn'}>
                      {f.total === 0 ? 'пусто' : `${f.filled}/${f.total}`}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    {f.source && <span className="truncate max-w-[200px]">{f.source}</span>}
                    {f.pages && <span className="font-mono shrink-0">стр. {f.pages}</span>}
                  </div>
                  {!done && (
                    <p className="mt-1 text-[11px] text-warn-foreground">
                      {empty} {emptyLabel} — дописывает участник
                    </p>
                  )}
                </div>
                {onDownloadForm && (
                  <Tooltip content={`Скачать бланк отдельным файлом ${EXT[format]}`} side="top">
                    <IconButton label="Скачать бланк" onClick={() => onDownloadForm(f.raw)}>
                      <Download className="size-4" />
                    </IconButton>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">
          Формы взяты из документов закупки как есть. Где данные найдены — заполнены; жёлтые места в файле — вписывает участник.
        </p>
      </div>
    </Card>
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
  validation,
  buildReport,
  auditReport: auditRep,
  scoringReport: scoringRep,
  tpForm,
  detectedForms,
  onDownloadForm,
}: {
  hasTp: boolean;
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
  // Результат детерминированной проверки (validation-engine.ts): если не задан, блок не показывается.
  validation?: ValidationReport;
  // Статус сборки заявки по 7 шагам (application-builder.ts): если не задан, блок не показывается.
  buildReport?: BuildReport;
  // Финальная проверка перед подачей (submission-audit.ts): если не задан, блок не показывается.
  auditReport?: AuditReport;
  // Оценка по критериям (scoring-engine.ts): если не задан или howWins ≠ points, блок не показывается.
  scoringReport?: ScoringReport;
  // Формы заказчика — паспорт форм (FormsPanel): главная форма + доп. бланки из detectedForms.
  tpForm?: TpForm;
  detectedForms?: DetectedForm[];
  // Скачать отдельный бланк как файл (вызывается из FormsPanel).
  onDownloadForm?: (df: DetectedForm) => void;
}) {
  const [openPart, setOpenPart] = useState<TpPart | null>(null);
  const [redo, setRedo] = useState(false);
  const open = rows.find((r) => r.part === openPart && r.preview) ?? null;
  const preview = open?.preview ?? null;
  // Отметки ждут только пункты, которые держат подачу; остальные — площадка передаст, «не требуется», «по желанию».
  const needed = items.filter((i) => i.required);
  const ready = needed.filter((i) => i.ready).length;
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

  return (
    <div className="animate-fade-up space-y-5">
      <div>
        <div className="flex items-center gap-2">
          {hasTp && final.ready ? <ShieldCheck className="size-5 text-success" /> : <AlertTriangle className="size-5 text-warn" />}
          <h1 className="text-2xl font-semibold tracking-tight">
            {!hasTp ? 'Пакет документов' : final.ready ? 'Пакет документов готов' : 'Пакет почти готов'}
          </h1>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Скачайте файлы {NAME[format]} по одному или архивом и отметьте, что из списка заказчика уже собрано. Потом подпишите заявку
          электронной подписью и подайте на площадке.
        </p>
      </div>

      {notice}

      {!hasTp ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-surface/30 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <p className="text-sm font-medium">Документы заявки ещё не составлены</p>
              <p className="text-[13px] text-muted-foreground">
                Составьте их на шаге «Проверка» — форму заявки беру из документов закупки. Тогда здесь появятся файлы.
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onFix}>
            К проверке
          </Button>
        </Card>
      ) : (
        openCount > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-surface/30 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <div>
                <p className="text-sm font-medium">Осталось незакрытых пунктов: {openCount}</p>
                <p className="text-[13px] text-muted-foreground">
                  Скачать можно и так, но риск отклонения выше. В файлах незаполненное — жёлтым.
                </p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={onFix}>
              Вернуться к проверке
            </Button>
          </Card>
        )
      )}

      {hasTp && <FinalCheck final={final} />}

      {/* Оплата заявки — пока без денег: файлы скачиваются бесплатно */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
            <CreditCard className="size-4" />
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Заявка под ключ · {rubShort(PRICE_APP)} <Soon />
            </p>
            <p className="text-[13px] text-muted-foreground">
              Оплаты пока нет — документы скачиваются бесплатно. Пакет 5 или 10 заявок будет дешевле.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled>
            <CreditCard className="size-4" /> Оплатить {rubShort(PRICE_APP)}
          </Button>
          <Button variant="ghost" size="sm" onClick={onTariffs}>
            Тарифы
          </Button>
        </div>
      </Card>

      {/* Формат */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Формат:</span>
        {FORMATS.map((f) => (
          <Tooltip key={f.ext} content={f.label} side="bottom">
            <button
              type="button"
              disabled={busy}
              aria-pressed={f.id === format}
              onClick={() => onFormat(f.id)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
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

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {note && <p role="status" className="rounded-md bg-info/10 px-3 py-2 text-[13px] text-info">{note}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {/* Состав пакета */}
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <span className="text-sm font-medium">Состав пакета · {count} док.</span>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">файлы {NAME[format]}, которые составляет приложение</p>
              </div>
              <Tooltip content={hasTp ? `Все документы в ${EXT[format]} одним архивом.` : 'Сначала составьте документы на шаге «Проверка».'} align="end">
                <Button size="sm" disabled={busy || !hasTp} onClick={onDownloadAll}>
                  {downloading === 'all' ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                  {downloading === 'all' ? (writing ? 'Пишу документ…' : 'Собираю архив…') : 'Всё архивом · ZIP'}
                </Button>
              </Tooltip>
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
            </div>
          </Card>

          {/* Формы заказчика: паспорт форм */}
          {tpForm && (
            <FormsPanel
              form={tpForm}
              detectedForms={detectedForms ?? []}
              format={format}
              onDownloadForm={onDownloadForm}
            />
          )}

          {/* Сборка заявки по 7 шагам */}
          {buildReport && <BuildPanel report={buildReport} />}

          {/* Что требует заказчик */}
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <span className="text-sm font-medium">Что требует заказчик</span>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Всё, что заказчик просит приложить. Часть закрывают файлы выше — отметьте, что уже готово.
                </p>
              </div>
              {items.length > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
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
          {/* Финальная проверка перед подачей */}
          {auditRep && <AuditPanel report={auditRep} />}

          {/* Детерминированная проверка */}
          {validation && <ValidationPanel report={validation} />}

          {/* Оценка по критериям */}
          {scoringRep && <ScoringPanel report={scoringRep} />}
        </div>

        {/* Проверка специалистом — пока не работает */}
        <Card className="flex flex-col self-start p-5">
          <div className="flex items-center gap-2">
            <UserCheck className="size-4" />
            <span className="text-sm font-medium">Проверка специалистом</span>
            <Soon />
            <HelpTip content="Живой тендерный юрист вручную сверит пакет с извещением и даст письменное заключение." align="end" />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Пакет проверил ИИ. Тендерный юрист вручную сверит документы с извещением и даст заключение перед подачей. Пока недоступно:
            подключим вместе с оплатой.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {['Ручная сверка с извещением', 'То, чего не видит ИИ: сроки, подписи, формы', 'Заключение за 2 часа'].map((t) => (
              <li key={t} className="flex items-center gap-2 text-muted-foreground">
                <Check className="size-3.5 text-success" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Разовая услуга</span>
              <span className="font-mono text-xl font-semibold">{rubShort(PRICE_EXPERT)}</span>
            </div>
            <Button variant="accent" className="h-10 w-full" disabled>
              <UserCheck className="size-4" /> Отправить специалисту · {rubShort(PRICE_EXPERT)}
            </Button>
          </div>
        </Card>
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
