import { useRef, useState } from 'react';
import { introOf, purchaseForAnalytics, type Intro, type IntakeFields } from '@/lib/analytics-intake';
import { saveExcelFiles } from '@/lib/forms-store';
import { errorMessage } from '@/lib/http-error';
import { savePurchaseWithDocuments } from '@/lib/purchase-store';
import { docMeta, readDocuments } from '@/lib/read-documents';
import { mergeUpload, type Upload } from '@/lib/upload-merge';
import { AnalyticsIntakeModal } from '../components/AnalyticsIntake';

// «Загрузить закупку» в «Аналитике»: файлы читает сервер (текст, без распознавания сканов — оно платное), закупка сохраняется в браузере и сразу открывается в аналитике. ИИ не вызывается.
const EMPTY: IntakeFields = { title: '', price: '', law: '' };

export function AnalyticsIntake({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [upload, setUpload] = useState<Upload>({ documents: [], failed: [] });
  const [fields, setFields] = useState<IntakeFields>(EMPTY);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState('');
  // Поля, которые участник поправил сам: следующие добавленные файлы их не затирают.
  const touched = useRef(new Set<keyof IntakeFields>());
  const intro = useRef<Intro>(introOf([]));
  const sources = useRef(new Map<string, File>());

  const reset = () => {
    setUpload({ documents: [], failed: [] });
    setFields(EMPTY);
    setError('');
    setBusy(null);
    touched.current = new Set();
    intro.current = introOf([]);
    sources.current = new Map();
  };
  const close = () => {
    reset();
    onClose();
  };

  const refill = (documents: Upload['documents']) => {
    intro.current = introOf(documents);
    const found = intro.current;
    setFields((f) => ({
      title: touched.current.has('title') ? f.title : found.title,
      price: touched.current.has('price') ? f.price : found.price,
      law: touched.current.has('law') ? f.law : found.law,
    }));
  };

  async function add(files: File[]) {
    setBusy('reading');
    setError('');
    try {
      // Распознавание сканов — платное (ИИ), поэтому здесь выключено.
      const read = await readDocuments(files, fetch, false);
      for (const file of files) sources.current.set(file.name, file);
      const next = mergeUpload(upload, read);
      setUpload(next);
      refill(next.documents);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('saving');
    setError('');
    try {
      const id = crypto.randomUUID();
      const purchase = purchaseForAnalytics({ id, createdAt: new Date().toISOString(), docs: upload.documents, failed: upload.failed, fields, intro: intro.current });
      await savePurchaseWithDocuments(purchase, upload.documents);
      await saveExcelFiles(id, upload.documents.flatMap((d) => sources.current.get(d.name) ?? []));
      reset();
      onCreated(id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <AnalyticsIntakeModal
      open={open}
      onClose={close}
      onSave={() => void save()}
      canSave={upload.documents.length > 0}
      files={upload.documents.map((d) => ({ name: d.name, meta: docMeta(d) }))}
      failed={upload.failed.length > 0 ? `Не прочитаны: ${upload.failed.map((f) => `${f.name} — ${f.reason}`).join('; ')}` : null}
      busy={busy}
      error={error}
      fields={fields}
      onFiles={(files) => void add(files)}
      onRemove={(name) => {
        const documents = upload.documents.filter((d) => d.name !== name);
        setUpload({ ...upload, documents });
        refill(documents);
      }}
      onField={(patch) => {
        for (const key of Object.keys(patch) as (keyof IntakeFields)[]) touched.current.add(key);
        setFields((f) => ({ ...f, ...patch }));
      }}
    />
  );
}
