import { useRef } from 'react';
import type { FillItem, ManualPriceRow } from '@/lib/xlsx-plan';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Plus, Trash2 } from '../lib/icons';
import { Badge, Button, Card, HelpTip, IconButton } from './ui';

// Блок «Excel-бланки заказчика» на шаге «Пакет»: файл заказчика остаётся его файлом, в него вписываются реквизиты и сведения о товарах, которые участник сам указал.
// Сам ничего не читает и не пишет: файлы и вписывание — в обёртке (real/excel-forms.tsx).

export type ExcelFormView = {
  name: string;
  /** ready — можно вписать; unsupported — старый .xls; error — файл не открылся. */
  state: 'ready' | 'unsupported' | 'error';
  message?: string;
  /** Что будет вписано. */
  filled: FillItem[];
  /** Что бланк просит, а у приложения этого нет. */
  left: string[];
  /** Строки, где цену за единицу называет только участник: ввод цены. */
  manual?: ManualPriceRow[];
};

export type ExcelFormsProps = {
  forms: ExcelFormView[];
  error?: string | null;
  note?: string | null;
  onAdd: (files: File[]) => void;
  onDownload: (name: string) => void;
  onRemove: (name: string) => void;
  /** Участник ввёл цену за единицу в строке бланка. */
  onPrice?: (name: string, key: string, value: string) => void;
};

const SHOWN = 40;
const inputClass =
  'h-8 w-28 rounded-md border border-border bg-background px-2 text-right font-mono text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';

function PriceRows({ form, onPrice }: { form: ExcelFormView; onPrice?: (key: string, value: string) => void }) {
  const rows = form.manual ?? [];
  if (rows.length === 0) return null;
  const typed = rows.filter((r) => r.value.trim() !== '').length;
  return (
    <details className="border-t border-border px-3 py-2 text-[12px]">
      <summary className="cursor-pointer font-medium">
        Цены по строкам: введено {typed} из {rows.length}
      </summary>
      <p className="mt-2 text-muted-foreground">
        Цену за единицу в этих строках называет только участник — начальных цен у заказчика нет. Введите число (рубли, без НДС, если так просит бланк); итоги посчитают формулы файла при открытии в Excel. Что вы не
        введёте здесь, останется пустым в файле.
      </p>
      <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Строка</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Объём</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Цена за единицу</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="break-words px-2 py-1 align-middle">{r.name}</td>
                <td className="px-2 py-1 text-right align-middle font-mono">{r.qty.toLocaleString('ru-RU')}</td>
                <td className="px-2 py-1 text-right align-middle">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Цена за единицу: ${r.name}`}
                    placeholder="0,00"
                    value={r.value}
                    onChange={(e) => onPrice?.(r.key, e.target.value)}
                    className={inputClass}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function FormRow({
  form,
  onDownload,
  onRemove,
  onPrice,
}: {
  form: ExcelFormView;
  onDownload: () => void;
  onRemove: () => void;
  onPrice?: (key: string, value: string) => void;
}) {
  const ready = form.state === 'ready';
  return (
    <li className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-words text-[13px] font-medium">{form.name}</span>
        {ready && (
          <Badge tone={form.filled.length > 0 ? 'success' : 'neutral'}>
            {form.filled.length > 0 ? <CheckCircle2 className="size-3" /> : <Info className="size-3" />}
            Впишу: {form.filled.length}
          </Badge>
        )}
        {ready && form.left.length > 0 && (
          <Badge tone="warn" wrap>
            <AlertTriangle className="size-3" />
            Вам остаётся: {form.left.length}
          </Badge>
        )}
        {ready && form.filled.length > 0 && (
          <Button size="sm" onClick={onDownload}>
            <Download className="size-3.5" />
            Скачать заполненный
          </Button>
        )}
        <IconButton label="Убрать файл из пакета" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {!ready && (
        <p role="alert" className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-[12px] text-warn-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {form.message}
        </p>
      )}
      {ready && <PriceRows form={form} onPrice={onPrice} />}
      {ready && form.filled.length === 0 && (form.manual ?? []).length === 0 && (
        <p className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Пока вписывать нечего: заполните «Реквизиты» в карточке компании внизу меню и сведения о товарах в блоке «Реестровые номера» — они появятся в этом файле.
        </p>
      )}
      {ready && (form.filled.length > 0 || form.left.length > 0) && (
        <details className="border-t border-border px-3 py-2 text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">Что вписано и что остаётся вам</summary>
          {form.filled.length > 0 && (
            <ul className="mt-2 space-y-1">
              {form.filled.slice(0, SHOWN).map((item) => (
                <li key={`${item.sheet}!${item.ref}`} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="text-muted-foreground">
                    <span className="font-mono">{item.ref}</span> · {item.label}
                  </span>
                  <span className="break-words">{item.value}</span>
                </li>
              ))}
              {form.filled.length > SHOWN && <li className="text-muted-foreground">…и ещё {form.filled.length - SHOWN}</li>}
            </ul>
          )}
          {form.left.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Впишите сами в файле:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {form.left.slice(0, SHOWN).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
                {form.left.length > SHOWN && <li>…и ещё {form.left.length - SHOWN}</li>}
              </ul>
            </div>
          )}
        </details>
      )}
    </li>
  );
}

export function ExcelForms({ forms, error, note, onAdd, onDownload, onRemove, onPrice }: ExcelFormsProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4" />
          <span className="text-sm font-medium">Excel-бланки заказчика</span>
          <HelpTip
            content="Если заказчик дал бланк в Excel, он заполняется в самом его файле: формулы и оформление заказчика остаются. Программа вписывает только то, что вы сами указали: реквизиты, страну происхождения, производителя и реестровый номер товара. Цены и всё остальное впишите в Excel сами. Файлы лежат только в вашем браузере."
            align="start"
          />
        </div>
        <div>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="sr-only"
            aria-label="Добавить Excel-бланк заказчика"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length > 0) onAdd(files);
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
            <Plus className="size-3.5" />
            Добавить Excel-бланк
          </Button>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3 text-[13px]">
        {forms.length === 0 ? (
          <p className="text-muted-foreground">
            Если заказчик требует бланк в Excel (письмо оферты, коммерческое предложение, анкета), добавьте его файл: реквизиты и сведения о товарах впишутся в него, а формулы и оформление
            останутся как у заказчика.
          </p>
        ) : (
          <ul className="space-y-2">
            {forms.map((form) => (
              <FormRow key={form.name} form={form} onDownload={() => onDownload(form.name)} onRemove={() => onRemove(form.name)} onPrice={(key, value) => onPrice?.(form.name, key, value)} />
            ))}
          </ul>
        )}
        {note && (
          <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
