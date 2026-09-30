import { useState, type ReactNode } from 'react';
import { AlertTriangle, Archive, Check, Clock, CreditCard, Download, Eye, FileText, Loader2, PenLine, RefreshCw, ShieldCheck, UserCheck } from '../lib/icons';
import { AIDisclaimer, Badge, Button, Card, Checkbox, HelpTip, IconButton, Modal, Soon, Tooltip, cx, type Tone } from './ui';
import { FinalCheck } from './StepReview';
import type { SubmitItem } from '@/lib/application-files';
import type { Completeness } from '@/lib/fields';
import type { FileFormat } from '@/lib/file-format';
import type { BadgeInfo } from '@/lib/home';
import { rubShort } from '@/lib/price-calc';
import { PRICE_APP, PRICE_EXPERT } from '@/lib/pricing';
import type { TpPart } from '@/lib/tp-parts';
import type { Downloading } from '@/lib/use-application-files';

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

// Форматы файлов: Word — править и дописывать жёлтые места, PDF — подписать и подать. ODT пока нет — помечен «скоро».
const FORMATS: { id: FileFormat | 'odt'; ext: string; label: string; soon: boolean }[] = [
  { id: 'docx', ext: 'DOCX', label: 'Word — можно править и дописывать жёлтые места', soon: false },
  { id: 'pdf', ext: 'PDF', label: 'PDF — для подписи и подачи: тот же текст и жёлтые места, что в Word', soon: false },
  { id: 'odt', ext: 'ODT', label: 'OpenDocument', soon: true },
];
const EXT: Record<FileFormat, string> = { docx: 'DOCX', pdf: 'PDF' };
const NAME: Record<FileFormat, string> = { docx: 'Word', pdf: 'PDF' };

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
function ChecklistItem({ item, onToggle }: { item: SubmitItem; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border px-4 py-3 last:border-0">
      <Checkbox checked={item.ready} onChange={onToggle}>
        <span className={cx('text-[13px] leading-snug', item.ready && 'text-muted-foreground line-through')}>{item.text}</span>
      </Checkbox>
      <div className="mt-1 pl-[26px] text-[12px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <FileText className="size-3" /> {item.source || 'цитата из документов'}
        </button>
        {open && <blockquote className="mt-1 rounded-md bg-secondary px-3 py-2 leading-snug text-muted-foreground">«{item.quote}»</blockquote>}
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
  format,
  onFormat,
  final,
  rows,
  count,
  items,
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
}: {
  hasTp: boolean;
  // Формат файлов: один на все скачивания на этом шаге.
  format: FileFormat;
  onFormat: (format: FileFormat) => void;
  final: Completeness;
  rows: PackageRow[];
  count: number;
  items: SubmitItem[];
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
}) {
  const [openPart, setOpenPart] = useState<TpPart | null>(null);
  const [redo, setRedo] = useState(false);
  const open = rows.find((r) => r.part === openPart && r.preview) ?? null;
  const preview = open?.preview ?? null;
  const ready = items.filter((i) => i.ready).length;
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
          <Tooltip key={f.ext} content={f.soon ? `${f.label} — скоро.` : f.label} side="bottom">
            <button
              type="button"
              disabled={f.soon || busy}
              aria-pressed={!f.soon && f.id === format}
              onClick={() => f.id !== 'odt' && onFormat(f.id)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                f.soon
                  ? 'cursor-not-allowed border-border bg-card text-muted-foreground opacity-60'
                  : f.id === format
                    ? 'border-foreground bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60',
              )}
            >
              {f.ext}
              {f.soon && <Soon />}
            </button>
          </Tooltip>
        ))}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {note && <p className="rounded-md bg-info/10 px-3 py-2 text-[13px] text-info">{note}</p>}

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
                  готово {ready} из {items.length}
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
                  <ChecklistItem key={`${i}:${item.text}`} item={item} onToggle={() => onToggleReady(item.text)} />
                ))}
              </ul>
            )}
          </Card>
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
