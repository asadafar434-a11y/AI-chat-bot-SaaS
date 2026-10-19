import { useCallback, useEffect, useMemo, useState } from 'react';
import { excelGoodsOf } from '@/lib/excel-input';
import { deleteForm, getForm, isOpenXmlName, listForms, MAX_FORM_BYTES, saveForm } from '@/lib/forms-store';
import { applyEdits, readBook, type FormBook } from '@/lib/xlsx-form';
import { planFill, type FillInput, type FillPlan } from '@/lib/xlsx-plan';
import { errorMessage } from '@/lib/http-error';
import { ExcelForms, type ExcelFormView } from '../components/ExcelForms';
import { useProfile } from './analysis';
import { usePurchase } from './purchase-provider';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Opened = { book: FormBook; plan: FillPlan } | { problem: string };

function open(bytes: Uint8Array, input: FillInput): Opened {
  try {
    const book = readBook(bytes);
    return { book, plan: planFill(book, input) };
  } catch (e) {
    return { problem: errorMessage(e) };
  }
}

// Excel-бланки заказчика на шаге «Пакет»: файлы лежат в браузере (lib/forms-store.ts), реквизиты и сведения о товарах вписываются прямо в них.
export function ExcelFormsBlock() {
  const { purchase, documents } = usePurchase();
  const profile = useProfile();
  const [files, setFiles] = useState<Record<string, Uint8Array>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Файлы читаются заново при смене закупки и после каждого добавления или удаления (reload).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next: Record<string, Uint8Array> = {};
        for (const meta of await listForms(purchase.id)) {
          const bytes = await getForm(purchase.id, meta.name);
          if (bytes) next[meta.name] = bytes;
        }
        if (alive) setFiles(next);
      } catch (e) {
        if (alive) setError(`Не удалось открыть сохранённые файлы Excel. ${errorMessage(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [purchase.id, version]);

  const docs = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const input = useMemo<FillInput>(
    () => ({ profile, subject: purchase.subject ?? '', goods: excelGoodsOf(purchase, docs) }),
    [profile, purchase, docs],
  );
  const opened = useMemo(() => Object.entries(files).map(([name, bytes]) => [name, open(bytes, input)] as const), [files, input]);

  // В списке — бланки, в которые есть что вписать или есть что сказать участнику; прочие Excel закупки (расчёты заказчика) не мешают.
  const forms: ExcelFormView[] = opened.flatMap(([name, result]): ExcelFormView[] => {
    if ('problem' in result) return [{ name, state: 'error', message: result.problem, filled: [], left: [] }];
    const { plan } = result;
    if (plan.filled.length === 0 && plan.left.length === 0) return [];
    return [{ name, state: 'ready', filled: plan.filled, left: plan.left }];
  });

  async function add(picked: File[]) {
    setError(null);
    const notes: string[] = [];
    for (const file of picked) {
      if (!/\.xls[xm]?$/i.test(file.name)) {
        notes.push(`«${file.name}» — не Excel.`);
      } else if (!isOpenXmlName(file.name)) {
        notes.push(`«${file.name}» — старый формат .xls: откройте файл в Excel, сохраните как .xlsx и добавьте снова.`);
      } else if (file.size > MAX_FORM_BYTES) {
        notes.push(`«${file.name}» — файл больше ${MAX_FORM_BYTES / 1024 / 1024} МБ.`);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = open(bytes, input);
        if ('problem' in result) notes.push(`«${file.name}» — ${result.problem}`);
        else if (result.plan.filled.length === 0 && result.plan.left.length === 0) notes.push(`«${file.name}» — не нашёл, что вписать: ни реквизитов участника, ни таблицы товаров со страной, производителем и реестровым номером.`);
        else {
          try {
            await saveForm(purchase.id, file.name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
          } catch (e) {
            notes.push(`«${file.name}» — не удалось сохранить в браузере. ${errorMessage(e)}`);
          }
        }
      }
    }
    setNote(notes.length > 0 ? notes.join(' ') : null);
    reload();
  }

  function download(name: string) {
    const result = opened.find(([n]) => n === name)?.[1];
    if (!result || 'problem' in result) return;
    try {
      const out = applyEdits(result.book, result.plan.edits);
      const url = URL.createObjectURL(new Blob([out as BlobPart], { type: XLSX_TYPE }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name.replace(/(\.xls[xm])$/i, ' (заполнено)$1');
      a.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      setError(`Не удалось собрать файл «${name}». ${errorMessage(e)}`);
    }
  }

  async function remove(name: string) {
    try {
      await deleteForm(purchase.id, name);
    } catch (e) {
      setError(errorMessage(e));
    }
    reload();
  }

  return <ExcelForms forms={forms} error={error} note={note} onAdd={(f) => void add(f)} onDownload={download} onRemove={(n) => void remove(n)} />;
}
