import { useState } from 'react';
import { UploadCloud, FileText, X, Link2, Loader2, CheckCircle2 } from '../lib/icons';
import { Button, Card } from './ui';
import { sourceDocs, tender, type SourceDoc } from '../lib/data';

export function StepUpload({ onNext, preloaded }: { onNext: () => void; preloaded?: boolean }) {
  const [files, setFiles] = useState<SourceDoc[]>(preloaded ? sourceDocs : sourceDocs.slice(0, 2));
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [url, setUrl] = useState('');

  const addRest = () => {
    setParsing(true);
    setTimeout(() => {
      setFiles(sourceDocs);
      setParsing(false);
    }, 1100);
  };

  const ready = files.length >= 3;

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Загрузка документации</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Загрузите документы с тендерной площадки или вставьте ссылку на закупку — ИИ распознает
          состав и извлечёт требования.
        </p>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Link2 className="size-4 text-muted-foreground" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://zakupki.gov.ru/epz/order/notice/... "
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" variant="secondary" onClick={addRest} disabled={parsing}>
            Импортировать
          </Button>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addRest();
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
              PDF, DOCX, XLSX, ZIP — до 50 МБ
            </p>
          </div>
          <input type="file" multiple className="hidden" onChange={addRest} />
        </label>
      </Card>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Загружено · {files.length} файла
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
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {f.kind} · {f.pages} стр. · {f.size}
                </p>
              </div>
              <button
                onClick={() => setFiles((prev) => prev.filter((p) => p.name !== f.name))}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {ready && (
        <Card className="animate-fade-up bg-secondary/40 p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Распознанная закупка
          </p>
          <p className="mt-2 text-sm font-medium leading-snug">{tender.title}</p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            {[
              ['Реестровый №', tender.id],
              ['Закон', tender.law],
              ['НМЦК', tender.nmck.toLocaleString('ru-RU') + ' ₽'],
              ['Подача до', tender.deadline],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-muted-foreground">{k}</p>
                <p className="mt-0.5 font-mono text-[12px] text-foreground">{v}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!ready}>
          Анализировать документы →
        </Button>
      </div>
    </div>
  );
}
