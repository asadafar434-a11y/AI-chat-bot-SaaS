import { useCallback, useEffect, useMemo, useState } from 'react';
import { excelGoodsOf } from '@/lib/excel-input';
import { deleteForm, getForm, getPrices, isOpenXmlName, listForms, MAX_FORM_BYTES, saveForm, savePrices, type StoredPrices } from '@/lib/forms-store';
import { parseRubles } from '@/lib/rub-words';
import { applyEdits, readBook, type FormBook } from '@/lib/xlsx-form';
import { planFill, type FillInput, type FillPlan } from '@/lib/xlsx-plan';
import { errorMessage } from '@/lib/http-error';
import { ExcelForms, type ExcelFormView } from '../components/ExcelForms';
import { useProfile } from './analysis';
import { usePurchase } from './purchase-provider';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Opened = { book: FormBook; plan: FillPlan } | { problem: string };
type Parsed = { book: FormBook } | { problem: string };

function parse(bytes: Uint8Array): Parsed {
  try {
    return { book: readBook(bytes) };
  } catch (e) {
    return { problem: errorMessage(e) };
  }
}

const nothingToDo = (plan: FillPlan) => plan.filled.length === 0 && plan.left.length === 0 && plan.manual.length === 0;

// Excel-бланки заказчика на шаге «Пакет»: файлы лежат в браузере (lib/forms-store.ts), реквизиты, сведения о товарах и цены вписываются прямо в них.
export function ExcelFormsBlock() {
  const { purchase, documents } = usePurchase();
  const profile = useProfile();
  const [files, setFiles] = useState<Record<string, Uint8Array>>({});
  const [prices, setPrices] = useState<Record<string, StoredPrices>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Файлы и введённые цены читаются заново при смене закупки и после каждого добавления или удаления (reload).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const nextFiles: Record<string, Uint8Array> = {};
        const nextPrices: Record<string, StoredPrices> = {};
        for (const meta of await listForms(purchase.id)) {
          const bytes = await getForm(purchase.id, meta.name);
          if (bytes) nextFiles[meta.name] = bytes;
          nextPrices[meta.name] = await getPrices(purchase.id, meta.name);
        }
        if (alive) {
          setFiles(nextFiles);
          setPrices(nextPrices);
        }
      } catch (e) {
        if (alive) setError(`Не удалось открыть сохранённые файлы Excel. ${errorMessage(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [purchase.id, version]);

  const docs = useMemo(() => documents.map((d) => ({ name: d.name, text: d.text })), [documents]);
  const base = useMemo(
    () => ({ profile, subject: purchase.subject ?? '', goods: excelGoodsOf(purchase, docs) }),
    [profile, purchase, docs],
  );
  const nmck = parseRubles(purchase.price);
  const tpPrice = purchase.tpPrice;
  const priceOf = useCallback((manual?: StoredPrices): FillInput['price'] => ({ nmck, tpPrice, manual }), [nmck, tpPrice]);

  // Файл разбирается один раз, а не на каждую набранную цифру цены.
  const parsed = useMemo(() => Object.entries(files).map(([name, bytes]) => [name, parse(bytes)] as const), [files]);
  const opened = useMemo(
    () =>
      parsed.map(([name, p]): readonly [string, Opened] => [name, 'problem' in p ? p : { book: p.book, plan: planFill(p.book, { ...base, price: priceOf(prices[name]) }) }]),
    [parsed, base, prices, priceOf],
  );

  // В списке — бланки, в которые есть что вписать или есть что сказать участнику; прочие Excel закупки (расчёты заказчика) не мешают.
  const forms: ExcelFormView[] = opened.flatMap(([name, result]): ExcelFormView[] => {
    if ('problem' in result) return [{ name, state: 'error', message: result.problem, filled: [], left: [] }];
    const { plan } = result;
    if (nothingToDo(plan)) return [];
    return [{ name, state: 'ready', filled: plan.filled, left: plan.left, manual: plan.manual }];
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
        const p = parse(bytes);
        if ('problem' in p) notes.push(`«${file.name}» — ${p.problem}`);
        else if (nothingToDo(planFill(p.book, { ...base, price: priceOf() }))) {
          notes.push(`«${file.name}» — не нашёл, что вписать: ни реквизитов участника, ни таблицы товаров со страной, производителем и реестровым номером, ни граф с ценой.`);
        } else {
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

  // Цена за единицу в строке бланка: сразу на экране, а в браузере сохраняется следом.
  function setPrice(name: string, key: string, value: string) {
    const next = { ...(prices[name] ?? {}), [key]: value };
    setPrices((all) => ({ ...all, [name]: next }));
    void savePrices(purchase.id, name, next).catch((e) => setError(`Цену не удалось сохранить в браузере. ${errorMessage(e)}`));
  }

  return (
    <ExcelForms forms={forms} error={error} note={note} onAdd={(f) => void add(f)} onDownload={download} onRemove={(n) => void remove(n)} onPrice={setPrice} />
  );
}
