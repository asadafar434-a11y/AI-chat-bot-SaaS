import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { checkCounts, checkInputKey, checkSummary, docsKeyOfDocuments, sameDocuments, type CheckFinding, type CheckResponse, type CheckResult } from '@/lib/check';
import { sampleCheck } from '@/lib/check-sample';
import { errorMessage, errorText } from '@/lib/http-error';
import { plural } from '@/lib/plural';
import { aiHeaders } from '@/lib/purchase';
import { ACCEPTED_FILES, readDocuments } from '@/lib/read-documents';
import { AlertTriangle, Check, ChevronDown, FileText, ListChecks, Loader2, Upload, X } from '../lib/icons';
import { usePurchase } from '../real/purchase-provider';
import { Badge, Button, Card, cx } from './ui';

// Своя заявка файлом — для тех, кто готовил заявку сам: участник загружает её, ИИ сверяет с документами закупки по
// пунктам. В примере вместо загруженного файла проверяется вымышленная заявка — бесплатно и без ИИ.
// Та же проверка, что в приложении на Next (web/src/components/own-check.tsx).

const WORKING_STEPS = [
  'Читаю заявку…',
  'Сверяю с ТЗ по пунктам…',
  'Проверяю состав заявки…',
  'Ищу незаполненные места…',
  'Сверяю цитаты с документами…',
];

// Пока ИИ проверяет — что он сейчас делает: так видно, что работа идёт.
function Working() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, WORKING_STEPS.length - 1)), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="py-4" aria-live="polite">
      <p className="flex items-center gap-2.5 text-sm">
        <Loader2 className="size-4 animate-spin" /> {WORKING_STEPS[i]}
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">Проверка занимает до минуты.</p>
    </div>
  );
}

function Finding({ finding: f, open, onToggle }: { finding: CheckFinding; open: boolean; onToggle: () => void }) {
  const bad = f.kind === 'bad';
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 py-3">
      <span
        aria-hidden
        className={cx(
          'grid size-6 place-items-center rounded-full text-[12px] font-semibold',
          bad ? 'bg-danger/10 text-danger' : 'bg-warn-surface text-warn-foreground',
        )}
      >
        {bad ? <X className="size-3.5" /> : '!'}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">
          <span className="sr-only">{bad ? 'Ошибка: ' : 'Замечание: '}</span>
          {f.what}
        </p>
        <p className="text-[13px] leading-snug text-muted-foreground">{f.todo}</p>
        {(f.quote || f.inApplication) && (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <FileText className="size-3" /> {f.source || 'цитаты'}
          </button>
        )}
        {open && (
          <div className="space-y-1.5 text-[12px] leading-snug">
            {f.quote && (
              <blockquote className="rounded-md bg-secondary px-3 py-2 text-muted-foreground">
                <span className="font-medium">В документах закупки: </span>«{f.quote}»
              </blockquote>
            )}
            {f.inApplication && (
              <blockquote className="rounded-md bg-secondary px-3 py-2 text-muted-foreground">
                <span className="font-medium">В заявке: </span>«{f.inApplication}»
              </blockquote>
            )}
          </div>
        )}
        {f.quote && !f.verified && (
          <p className="flex items-center gap-1.5 text-[12px] text-warn-foreground">
            <AlertTriangle className="size-3.5 shrink-0" /> Не нашёл требование в документах закупки дословно — сверьте вручную.
          </p>
        )}
        {f.inApplication && !f.appVerified && (
          <p className="flex items-center gap-1.5 text-[12px] text-warn-foreground">
            <AlertTriangle className="size-3.5 shrink-0" /> Не нашёл этот текст в заявке дословно — сверьте вручную.
          </p>
        )}
      </div>
    </li>
  );
}

function verdict(check: CheckResult): { title: ReactNode; lead: string } {
  const { bad, warn } = checkCounts(check);
  const bads = `${bad} ${plural(bad, 'ошибку', 'ошибки', 'ошибок')}`;
  const warns = `${warn} ${plural(warn, 'замечание', 'замечания', 'замечаний')}`;
  if (bad) {
    return {
      title: (
        <>
          Нашёл <span className="text-danger">{bads}</span>
          {warn > 0 && (
            <>
              {' '}
              и <span className="text-warn-foreground">{warns}</span>
            </>
          )}
        </>
      ),
      lead: warn ? 'Исправьте ошибки до подачи — замечания тоже лучше поправить.' : 'Исправьте ошибки до подачи.',
    };
  }
  if (warn) {
    return {
      title: (
        <>
          Нашёл <span className="text-warn-foreground">{warns}</span>
        </>
      ),
      lead: 'Отклонять не за что, но замечания лучше поправить.',
    };
  }
  return {
    title: <>Ошибок не нашёл</>,
    lead: 'Заявка соответствует документам закупки по всем проверенным пунктам. Перед подачей всё равно просмотрите её глазами.',
  };
}

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const TONE = { bad: 'danger', warn: 'warn', ok: 'success' } as const;

export function OwnCheck() {
  const { purchase, documents, update } = usePurchase();
  const check = purchase.check;
  const [open, setOpen] = useState(!!check);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openFinding, setOpenFinding] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Отпечаток документов закупки — по содержимому, а не по именам: заменили файл новой версией с тем же именем — проверка устарела.
  const docsKey = useMemo(() => docsKeyOfDocuments(documents), [documents]);
  const docsChanged = useMemo(() => !!check && !sameDocuments(check.docsKey, documents), [check, documents]);

  async function run(files: File[]) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      // Тот же файл заявки при тех же документах закупки уже проверен — показываем сохранённую проверку:
      // ни чтение файла, ни ИИ не нужны. Повторная проверка того же — пустая трата бюджета заявки.
      const inputKey = checkInputKey(files, docsKey);
      if (!purchase.sample && check?.inputKey === inputKey) {
        setNotice('Этот файл уже проверен — показываю сохранённую проверку. Исправили заявку — загрузите исправленный файл.');
        return;
      }
      let result: CheckResult;
      if (purchase.sample) {
        result = sampleCheck();
      } else {
        const { documents: application, failed } = await readDocuments(files);
        const res = await fetch('/api/check', {
          method: 'POST',
          headers: aiHeaders(purchase.id),
          body: JSON.stringify({ documents, application }),
        });
        if (!res.ok) throw new Error(await errorText(res, 'Не удалось проверить заявку.'));
        const body: CheckResponse = await res.json();
        result = { ...body, files: application.map((d) => d.name), docsKey, checkedAt: new Date().toISOString(), inputKey };
        if (failed.length) setNotice(`Не прочитаны и не проверены: ${failed.map((f) => `${f.name} — ${f.reason}`).join('; ')}.`);
      }
      setOpenFinding(null);
      update({ check: result });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = [...e.dataTransfer.files];
    if (files.length && !working) void run(files);
  };
  const pick = () => (purchase.sample ? void run([]) : input.current?.click());

  const summary = check ? checkSummary(check) : null;
  const shown = check ? verdict(check) : null;

  return (
    <Card className="p-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <ListChecks className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Проверить свою заявку файлом</p>
          <p className="text-[12px] text-muted-foreground">Готовили заявку сами? Загрузите файл — ИИ сверит её с документами закупки по пунктам.</p>
        </div>
        {summary && <Badge tone={TONE[summary.tone]}>{summary.text}</Badge>}
        <ChevronDown className={cx('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-fade-up space-y-3 border-t border-border px-4 pb-4 pt-3">
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              const files = e.currentTarget.files ? [...e.currentTarget.files] : [];
              e.currentTarget.value = '';
              if (files.length) void run(files);
            }}
          />

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
            </p>
          )}

          {working ? (
            <Working />
          ) : !check || !shown ? (
            <div onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
              <button
                type="button"
                onClick={pick}
                className={cx(
                  'flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
                  drag ? 'border-foreground bg-secondary' : 'border-border hover:bg-secondary/50',
                )}
              >
                <Upload className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium">Загрузить заявку</span>
                <span className="text-[12px] text-muted-foreground">
                  {purchase.sample
                    ? 'В примере проверится вымышленная заявка — бесплатно и без ИИ.'
                    : 'Перетащите сюда файлы своей заявки — можно сразу несколько. PDF, Word, Excel, ZIP, сканы.'}
                </span>
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h3 className="text-base font-semibold tracking-tight">{shown.title}</h3>
                <p className="max-w-[70ch] text-[13px] text-muted-foreground">{shown.lead}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Проверено: {check.files.join(', ')} · {when(check.checkedAt)}
                </p>
                <div className="pt-1.5">
                  <Button size="sm" variant={check.findings.length ? 'primary' : 'secondary'} onClick={pick}>
                    {check.findings.length ? 'Проверить исправленный файл' : 'Проверить другой файл'}
                  </Button>
                </div>
              </div>

              {purchase.sample && (
                <p className="rounded-md bg-info/10 px-3 py-2 text-[13px] text-info">Это пример: проверена вымышленная заявка к вымышленной закупке.</p>
              )}
              {!purchase.sample && docsChanged && (
                <p className="flex items-start gap-2 rounded-md bg-warn-surface/50 px-3 py-2 text-[13px] text-warn-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> После проверки в закупку добавили документы — проверьте заявку заново.
                </p>
              )}
              {notice && (
                <p className="flex items-start gap-2 rounded-md bg-warn-surface/50 px-3 py-2 text-[13px] text-warn-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{notice}</span>
                </p>
              )}

              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {check.findings.length ? `Что исправить · ${check.findings.length}` : 'Проверенные пункты'}
                </p>
                <ul className="divide-y divide-border">
                  {check.findings.map((f, i) => (
                    <Finding key={i} finding={f} open={openFinding === i} onToggle={() => setOpenFinding(openFinding === i ? null : i)} />
                  ))}
                  {check.okCount > 0 && (
                    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 py-3">
                      <span aria-hidden className="grid size-6 place-items-center rounded-full bg-success/10 text-success">
                        <Check className="size-3.5" />
                      </span>
                      <p className="text-[13px] font-medium text-success">
                        {check.findings.length ? 'Остальные' : 'Все'} {check.okCount} {plural(check.okCount, 'пункт', 'пункта', 'пунктов')} — в порядке.
                      </p>
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
