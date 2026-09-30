import { useState } from 'react';
import { lawText } from '@/lib/dashboard';
import { extractRequirements, fromRequirements, type Purchase } from '@/lib/purchase';
import { savePurchaseWithDocuments } from '@/lib/purchase-store';
import { readDocuments, type FailedFile, type SentDocument } from '@/lib/read-documents';
import { dueLine } from '@/lib/deadline';
import { DocSearch } from '../components/DocSearch';
import { StepUpload, type Recognized, type UploadFile } from '../components/StepUpload';
import { usePurchase } from './purchase-provider';

// Что видно про файл: тип, сколько текста прочитано, со скана ли.
const metaOf = (d: SentDocument) => {
  const ext = d.name.includes('.') ? d.name.split('.').pop()!.toUpperCase() : '';
  return [ext, `${d.text.length.toLocaleString('ru-RU')} симв.`, d.scan ? 'со скана — сверьте цифры' : 'прочитан'].filter(Boolean).join(' · ');
};

const failedNote = (failed: FailedFile[]) =>
  failed.length ? `Не прочитаны: ${failed.map((f) => `${f.name} — ${f.reason}`).join('; ')}.` : null;

// Новая закупка: файлы читает сервер, потом ИИ выписывает требования (платный запрос — по кнопке), закупка сохраняется
// в браузере и открывается на шаге «Анализ».
export function NewPurchaseUpload({ onCreated }: { onCreated: (id: string) => void }) {
  const [docs, setDocs] = useState<SentDocument[]>([]);
  const [failed, setFailed] = useState<FailedFile[]>([]);
  const [busy, setBusy] = useState<'reading' | 'analyzing' | null>(null);
  const [error, setError] = useState('');

  async function add(files: File[]) {
    const fresh = files.filter((f) => !docs.some((d) => d.name === f.name));
    if (fresh.length === 0) return;
    setBusy('reading');
    setError('');
    try {
      const read = await readDocuments(fresh);
      setDocs((prev) => [...prev, ...read.documents]);
      setFailed(read.failed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy('analyzing');
    setError('');
    try {
      // Номер закупки — до разбора: по нему сервер считает бюджет ИИ этой заявки.
      const id = crypto.randomUUID();
      const result = await extractRequirements(docs, id);
      const purchase: Purchase = {
        ...fromRequirements(result),
        id,
        createdAt: new Date().toISOString(),
        files: docs.map((d) => d.name),
        unreadable: failed,
      };
      await savePurchaseWithDocuments(purchase, docs);
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const files: UploadFile[] = docs.map((d) => ({ name: d.name, meta: metaOf(d), warn: Boolean(d.scan) }));
  return (
    <StepUpload
      files={files}
      busy={busy}
      error={error}
      notice={failedNote(failed)}
      onFiles={(f) => void add(f)}
      onRemove={(name) => setDocs((prev) => prev.filter((d) => d.name !== name))}
      onNext={() => void create()}
      nextLabel="Анализировать документы →"
    />
  );
}

// Закупка уже создана: её документы, добавить ещё — закупка перечитывается целиком (как в приложении).
export function PurchaseUpload({ onNext }: { onNext: () => void }) {
  const { purchase, documents, replaceDocuments } = usePurchase();
  const [busy, setBusy] = useState<'reading' | 'analyzing' | null>(null);
  const [error, setError] = useState('');

  async function add(files: File[]) {
    setError('');
    try {
      setBusy('reading');
      const { documents: added, failed } = await readDocuments(files);
      const addedNames = new Set(added.map((d) => d.name));
      const failedNames = new Set(failed.map((f) => f.name));
      const all = [...documents.filter((d) => !addedNames.has(d.name)), ...added];
      setBusy('analyzing');
      const result = await extractRequirements(all, purchase.id);
      await replaceDocuments(all, {
        ...fromRequirements(result),
        files: all.map((d) => d.name),
        unreadable: [...purchase.unreadable.filter((f) => !addedNames.has(f.name) && !failedNames.has(f.name)), ...failed],
      });
    } catch (e) {
      setError(`Документы не добавлены. ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const scans = new Set(documents.filter((d) => d.scan).map((d) => d.name));
  const files: UploadFile[] = [
    ...purchase.files.map((name) => {
      const doc = documents.find((d) => d.name === name);
      return { name, meta: doc ? metaOf(doc) : 'прочитан', warn: scans.has(name) };
    }),
    ...purchase.unreadable.map((f) => ({ name: f.name, meta: `не прочитан: ${f.reason}`, warn: true })),
  ];
  const due = dueLine(purchase.deadline, true);
  const facts: [string, string][] = [
    ['Закон', lawText(purchase)],
    ['Начальная цена', purchase.price],
    ['Подать до', due ? due.head.replace(/^Подать /, '').replace(/^Приём заявок /, '') : ''],
    ['Заказчик', purchase.customer],
  ];
  const recognized: Recognized | null = facts.some(([, v]) => v)
    ? { title: purchase.subject || purchase.short, facts: facts.filter(([, v]) => v) }
    : null;

  return (
    <StepUpload
      files={files}
      busy={busy}
      error={error}
      recognized={recognized}
      extra={documents.length > 0 ? <DocSearch documents={documents} /> : undefined}
      onFiles={(f) => void add(f)}
      onNext={onNext}
      nextLabel="Анализировать документы →"
    />
  );
}
