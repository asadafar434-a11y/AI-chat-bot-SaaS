import { useRef, useState, type ReactNode } from 'react';
import { UploadCloud, FileText, X, Link2, Loader2, CheckCircle2, AlertTriangle } from '../lib/icons';
import { Button, Card, Soon, Tooltip } from './ui';

// Шаг «Загрузка». Вид — прототипа; данные — настоящие: файлы, которые прочитал сервер, и то, что из них распознано.
export type UploadFile = { name: string; meta: string; warn?: boolean };
export type Recognized = { title: string; facts: [string, string][] };

export function StepUpload({
  files,
  busy,
  error,
  recognized,
  onFiles,
  onRemove,
  onNext,
  nextLabel,
  nextDisabled,
  notice,
  extra,
}: {
  files: UploadFile[];
  // reading — сервер читает файлы; analyzing — ИИ выписывает требования.
  busy: 'reading' | 'analyzing' | null;
  error?: string;
  recognized?: Recognized | null;
  onFiles: (files: File[]) => void;
  // Убрать файл из списка можно, пока закупка не создана.
  onRemove?: (name: string) => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  notice?: string | null;
  // Блок под списком файлов — например, поиск по документам закупки.
  extra?: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const parsing = busy === 'reading';
  const ready = files.length > 0 && !files.some((f) => f.warn);

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Загрузка документации</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Загрузите документы закупки с тендерной площадки — ИИ распознает состав и извлечёт
          требования.
        </p>
      </div>

      <Card>
        <Tooltip
          content="Импорт по ссылке из ЕИС — в разработке. Сейчас скачайте файлы закупки с площадки и перетащите сюда."
          side="bottom"
          className="flex w-full"
        >
          <div className="flex w-full items-center gap-2 border-b border-border px-4 py-3 opacity-70">
            <Link2 className="size-4 text-muted-foreground" />
            <input
              disabled
              aria-label="Ссылка на закупку в ЕИС — скоро"
              placeholder="Ссылка на закупку в ЕИС — zakupki.gov.ru/epz/order/notice/…"
              className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Soon />
            <Button size="sm" variant="secondary" disabled>
              Импортировать
            </Button>
          </div>
        </Tooltip>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = [...e.dataTransfer.files];
            if (dropped.length) onFiles(dropped);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-12 text-center transition-colors ${
            dragging ? 'bg-secondary' : 'bg-transparent'
          }`}
        >
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary">
            {parsing ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <UploadCloud className="size-5" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {parsing ? 'Распознаём документы…' : 'Перетащите файлы сюда или нажмите для выбора'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              PDF, Word, Excel, ZIP, сканы и фото
            </p>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.rtf,.xlsx,.xlsm,.zip,.txt,.md,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = '';
              if (picked.length) onFiles(picked);
            }}
          />
        </label>
      </Card>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warn-surface/40 px-3 py-2 text-[13px] text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Загружено · {files.length} {files.length === 1 ? 'файл' : files.length < 5 ? 'файла' : 'файлов'}
            </p>
            {ready && (
              <span className="inline-flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="size-3.5" /> Комплект распознан
              </span>
            )}
          </div>
          {files.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5"
            >
              {f.warn ? (
                <AlertTriangle className="size-4 shrink-0 text-warn" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className={`font-mono text-[11px] ${f.warn ? 'text-warn-foreground' : 'text-muted-foreground'}`}>{f.meta}</p>
              </div>
              {onRemove && (
                <button
                  onClick={() => onRemove(f.name)}
                  disabled={busy !== null}
                  aria-label={`Убрать ${f.name}`}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {recognized && (
        <Card className="animate-fade-up bg-secondary/40 p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Распознанная закупка
          </p>
          <p className="mt-2 text-sm font-medium leading-snug">{recognized.title}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            {recognized.facts.map(([k, v]) => (
              <div key={k}>
                <p className="text-muted-foreground">{k}</p>
                <p className="mt-0.5 font-mono text-[12px] text-foreground">{v}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {extra}

      <div className="flex items-center justify-end gap-3">
        {busy === 'analyzing' && (
          <span className="text-xs text-muted-foreground">ИИ читает документы — это может занять минуту…</span>
        )}
        <Button onClick={onNext} disabled={nextDisabled || busy !== null || files.length === 0}>
          {busy === 'analyzing' && <Loader2 className="size-4 animate-spin" />}
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
