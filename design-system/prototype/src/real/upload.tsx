import { useState } from 'react';
import { carryReady } from '@/lib/application-files';
import { lawText } from '@/lib/dashboard';
import { extractRequirements, fromRequirements, type Purchase } from '@/lib/purchase';
import { savePurchaseWithDocuments } from '@/lib/purchase-store';
import { readDocuments, type FailedFile, type SentDocument } from '@/lib/read-documents';
import { dueLine } from '@/lib/deadline';
import { dateText } from './tenders';
import { errorMessage } from '@/lib/http-error';
import { mergeUpload, type Upload } from '@/lib/upload-merge';
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
  // Загруженное: что прочиталось и что нет. Добавки складываются, а не затирают друг друга; файл с тем же именем — новая
  // версия, она заменяет прежнюю (lib/upload-merge.ts).
  const [upload, setUpload] = useState<Upload>({ documents: [], failed: [] });
  const { documents: docs, failed } = upload;
  const [busy, setBusy] = useState<'reading' | 'analyzing' | null>(null);
  const [error, setError] = useState('');

  async function add(files: File[]) {
    setBusy('reading');
    setError('');
    try {
      const read = await readDocuments(files);
      setUpload((prev) => mergeUpload(prev, read));
    } catch (e) {
      setError(errorMessage(e));
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
      setError(errorMessage(e));
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
      onRemove={(name) => setUpload((prev) => ({ ...prev, documents: prev.documents.filter((d) => d.name !== name) }))}
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
      const merged = mergeUpload({ documents, failed: purchase.unreadable }, await readDocuments(files));
      setBusy('analyzing');
      const result = await extractRequirements(merged.documents, purchase.id);
      const fresh = fromRequirements(result);
      // Пока ИИ читал документы, участник мог отметить пункты в других шагах: отметки берём из закупки на момент записи,
      // а у пунктов, которые ИИ переписал другими словами, они остаются по цитате (lib/application-files.ts).
      await replaceDocuments(merged.documents, (latest) => ({
        ...fresh,
        files: merged.documents.map((d) => d.name),
        unreadable: merged.failed,
        submitReady: carryReady(latest.requirements.submit, latest.submitReady ?? [], fresh.requirements.submit),
      }));
    } catch (e) {
      setError(`Документы не добавлены. ${errorMessage(e)}`);
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
  // В примере срок вымышленный: «закончился вчера» вводило бы в заблуждение, поэтому просто дата с пометкой.
  const until = purchase.sample ? `${dateText(purchase.deadline.date)} (вымышленная дата)` : due ? due.head.replace(/^Подать /, '').replace(/^Приём заявок /, '') : '';
  const facts: [string, string][] = [
    ['Закон', lawText(purchase)],
    ['Начальная цена', purchase.price],
    ['Подать до', until],
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
