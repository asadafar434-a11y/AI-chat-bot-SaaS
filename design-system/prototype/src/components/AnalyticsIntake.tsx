import { useRef, useState } from 'react';
import type { IntakeFields, Law } from '@/lib/analytics-intake';
import { AlertTriangle, FileText, Loader2, UploadCloud, X } from '../lib/icons';
import { Badge, Button, HelpTip, IconButton, Modal, fieldClass } from './ui';

// «Загрузить закупку» в разделе «Аналитика»: файлы → название, цена и закон, найденные программой, → открыть расчёт. Чтение файлов без ИИ (lib/analytics-intake.ts): файлы читает сервер как текст,
// а найденное участник видит и может поправить до сохранения. По «Открыть аналитику» при включённом «ИИ» сразу идут разбор документов (≈55 ₽) и поиск закупочных цен (до 30 ₽) — пока они идут, окно это показывает.
// Требования и заявка — на обычной загрузке закупки.

export type IntakeFile = { name: string; meta: string };

export type AnalyticsIntakeFormProps = {
  files: IntakeFile[];
  /** Файлы, которые не прочитались, одной строкой: имя — причина. */
  failed: string | null;
  busy: 'reading' | 'saving' | 'searching' | null;
  /** Что сейчас делается, одной строкой (при поиске цен). */
  status?: string | null;
  /** ИИ включён: при открытии аналитики будут искаться закупочные цены (платно). */
  aiOn?: boolean;
  error: string;
  fields: IntakeFields;
  onFiles: (files: File[]) => void;
  onRemove: (name: string) => void;
  onField: (patch: Partial<IntakeFields>) => void;
};

const ACCEPT = '.pdf,.docx,.doc,.rtf,.xls,.xlsx,.xlsm,.zip,.txt,.md';
const inputClass = fieldClass('sm');

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-secondary'
      }`}
    >
      {children}
    </button>
  );
}

const LAWS: { id: Law; label: string }[] = [
  { id: '44', label: '44-ФЗ' },
  { id: '223', label: '223-ФЗ' },
  { id: '', label: 'Не указан' },
];

export function AnalyticsIntakeForm({ files, failed, busy, status, aiOn = false, error, fields, onFiles, onRemove, onField }: AnalyticsIntakeFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const reading = busy === 'reading';
  return (
    <div className="space-y-4 px-5 py-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {aiOn ? <Badge tone="warn">Платно: разбор документов ≈55 ₽ и поиск цен до 30 ₽</Badge> : <Badge tone="success">Бесплатно: без ИИ</Badge>}
        <HelpTip
          align="start"
          content={
            aiOn
              ? "Файлы читает сервер как текст; название, цену, закон и список товаров находит программа — ИИ здесь не используется. Само чтение файлов бесплатно. По кнопке «Открыть аналитику» программа сразу разбирает документы (требования заказчика, ≈55 ₽ за большую закупку, меньше — дешевле) и ищет закупочные цены по главным позициям в интернете (3–10 ₽, не больше 30 ₽); это до двух минут, и экран откроется уже с результатом. Выключить платное можно переключателем «ИИ» в меню. Сканы без ИИ не читаются: для них есть обычная загрузка закупки."
              : "Файлы читает сервер как текст; название, цену, закон и список товаров находит программа — ИИ здесь не используется. Переключатель «ИИ» выключен: закупочные цены в интернете искаться не будут. Сканы без ИИ не читаются: для них есть обычная загрузка закупки."
          }
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) onFiles(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-foreground bg-secondary/50' : 'border-border'}`}
      >
        {reading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <UploadCloud className="size-5 text-muted-foreground" />}
        <p className="text-muted-foreground">{reading ? 'Читаю файлы…' : 'Перетащите файлы закупки сюда'}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Файлы закупки"
          className="sr-only"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (picked.length > 0) onFiles(picked);
          }}
        />
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => input.current?.click()}>
          Выбрать файлы
        </Button>
        <p className="text-[11px] text-muted-foreground">PDF, Word, Excel, ZIP</p>
      </div>

      {busy === 'searching' && status && (
        <p role="status" className="flex items-start gap-1.5 text-[12px]">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="break-words">{status}</span>
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      {failed && (
        <p className="flex items-start gap-1.5 text-[12px] text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{failed}</span>
        </p>
      )}

      {files.length > 0 && (
        <>
          <ul className="space-y-1.5" aria-label="Загруженные файлы">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px]">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{f.name}</p>
                  <p className="break-words text-muted-foreground">{f.meta}</p>
                </div>
                <IconButton label={`Убрать файл ${f.name}`} onClick={() => onRemove(f.name)}>
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>

          <section aria-label="Что нашла программа" className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <label className="block text-[12px]">
                <span className="mb-1 block text-muted-foreground">Название</span>
                <input type="text" value={fields.title} onChange={(e) => onField({ title: e.target.value })} placeholder="Название закупки" className={inputClass} />
              </label>
              <label className="block text-[12px]">
                <span className="mb-1 block text-muted-foreground">Начальная цена</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fields.price}
                  onChange={(e) => onField({ price: e.target.value })}
                  placeholder="не найдена — впишите"
                  className={`${inputClass} text-right font-mono`}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Закон">
              {LAWS.map((l) => (
                <Choice key={l.id || 'none'} active={fields.law === l.id} onClick={() => onField({ law: l.id })}>
                  {l.label}
                </Choice>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function AnalyticsIntakeModal({
  open,
  onClose,
  onSave,
  canSave,
  ...form
}: AnalyticsIntakeFormProps & { open: boolean; onClose: () => void; onSave: () => void; canSave: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Загрузить закупку"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" disabled={!canSave || form.busy !== null} onClick={onSave}>
            {form.busy === 'searching' ? 'Ищу цены…' : form.busy === 'saving' ? 'Открываю…' : 'Открыть аналитику'}
          </Button>
        </>
      }
    >
      <AnalyticsIntakeForm {...form} />
    </Modal>
  );
}
