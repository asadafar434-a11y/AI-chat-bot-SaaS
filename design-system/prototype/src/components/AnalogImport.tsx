import { useMemo, useState, type ChangeEvent } from 'react';
import { buildRows, decodeText, eisSearchUrl, guessRoles, parseTable, ROLE_LABELS, toAnalogs, type ColumnRole } from '@/lib/analog-import';
import { eisCardUrl, eisKind, eisRows, parseEisCards, parseEisList } from '@/lib/eis-contracts';
import type { Analog, Vat } from '@/lib/indicative-price';
import { AlertTriangle, ExternalLink } from '../lib/icons';
import { Button, Modal } from './ui';

// «Загрузить цены из таблицы» у позиции РИЦ: вставили таблицу из реестра контрактов ЕИС, Excel или сайта поставщика (или выбрали файл CSV/TXT) — программа находит столбцы, вы проверяете предпросмотр,
// и отмеченные цены становятся аналогами позиции с источником и датой (lib/analog-import.ts). Карточка контракта ЕИС («Платежи и объекты закупки») читается целиком — цена за единицу, количество, НДС, дата заключения (lib/eis-contracts.ts);
// список результатов ЕИС даёт только общую цену контракта, поэтому показываются ссылки на карточки. Всё в браузере. Дату и источник программа не придумывает: нет даты — цена в расчёт не пойдёт, пока вы её не впишете.

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground';
const rub = (price: string) => `${price} ₽`;
const dateRu = (iso: string) => iso.split('-').reverse().join('.');
const ROLES = Object.keys(ROLE_LABELS) as ColumnRole[];
const PREVIEW = 5;
const LIST_SHOWN = 8;
const rubTotal = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`);

export type AnalogImportFormProps = {
  positionName: string;
  /** НДС в расчёте РИЦ: с него начинается выбор «цены в таблице с НДС или без». */
  defaultVat: Vat;
  onImport: (analogs: Analog[]) => void;
  onCancel: () => void;
  makeId: () => string;
  /** Для проверки без браузера: уже вставленный текст. */
  initialText?: string;
};

export function AnalogImportForm({ positionName, defaultVat, onImport, onCancel, makeId, initialText = '' }: AnalogImportFormProps) {
  const [text, setText] = useState(initialText);
  const [fileName, setFileName] = useState('');
  const [rolesOverride, setRolesOverride] = useState<ColumnRole[] | null>(null);
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const [vat, setVat] = useState<Vat>(defaultVat);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const kind = useMemo(() => eisKind(text), [text]);
  const rows = useMemo(() => (kind === 'table' ? parseTable(text) : []), [text, kind]);
  const cards = useMemo(() => (kind === 'cards' ? parseEisCards(text) : []), [text, kind]);
  const list = useMemo(() => (kind === 'list' ? parseEisList(text) : []), [text, kind]);
  const guess = useMemo(() => guessRoles(rows), [rows]);
  const roles = rolesOverride && rolesOverride.length === guess.roles.length ? rolesOverride : guess.roles;
  const hasHeader = headerOverride ?? guess.hasHeader;
  const built = useMemo(
    () => (kind === 'cards' ? eisRows(cards) : buildRows(rows, roles, hasHeader, fileName || 'таблица')),
    [kind, cards, rows, roles, hasHeader, fileName],
  );
  const showResults = kind === 'cards' ? cards.length > 0 : rows.length > 0;
  const askVat = kind !== 'cards' || built.rows.some((r) => r.vat === null);
  const chosen = built.rows.filter((r) => !off.has(r.line));

  const load = (value: string, name: string) => {
    setText(value);
    setFileName(name);
    setRolesOverride(null);
    setHeaderOverride(null);
    setOff(new Set());
    setError(null);
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      setError('Файл Excel здесь не читается: выделите нужные ячейки в Excel, скопируйте и вставьте в поле ниже — или сохраните лист как CSV.');
      return;
    }
    try {
      load(decodeText(await file.arrayBuffer()), file.name);
    } catch {
      setError('Не удалось прочитать файл. Откройте его и вставьте таблицу в поле ниже.');
    }
  };
  const setRole = (col: number, role: ColumnRole) => {
    // Одна роль — один столбец (кроме «Не нужен»): прежний столбец с этой ролью освобождается.
    setRolesOverride(roles.map((r, i) => (i === col ? role : role !== 'ignore' && r === role ? 'ignore' : r)));
    setOff(new Set());
  };
  const toggle = (line: number) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  return (
    <div className="space-y-4 px-5 py-4 text-[13px]">
      <div className="space-y-1.5">
        <p className="text-muted-foreground">
          Вставьте таблицу с ценами или карточку контракта ЕИС («Платежи и объекты закупки»): цена за единицу, количество, НДС и дату программа найдёт сама. В ЕИС она не ходит — ссылки открываются в вашем браузере.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {(['44', '223'] as const).map((law) => (
            <a key={law} href={eisSearchUrl(positionName || 'товар', law)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
              {law === '44' ? 'Найти в реестре контрактов ЕИС (44-ФЗ)' : 'Найти в реестре договоров ЕИС (223-ФЗ)'}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      </div>

      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Таблица с ценами (вставьте или выберите файл)</span>
        <textarea
          aria-label="Таблица с ценами"
          value={text}
          onChange={(e) => load(e.target.value, '')}
          rows={5}
          placeholder={'Реестровый номер\tНаименование\tДата\tЦена за единицу\n1660100000126000012\tУголь ДПК\t15.09.2026\t9 850,00'}
          className="w-full rounded-md border border-border bg-background p-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
        />
      </label>
      <label className="block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Или файл CSV, TSV, TXT</span>
        <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" onChange={(e) => void onFile(e)} className="block text-[12px]" aria-label="Файл с ценами" />
      </label>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}

      {kind === 'list' && list.length > 0 && (
        <section className="space-y-2" aria-label="Список контрактов ЕИС">
          <p className="font-medium">
            Это список: в нём только общая цена контракта ({list.length})
            <span className="font-normal text-muted-foreground"> · цена за единицу — в карточке. Откройте её, выделите всё и вставьте сюда.</span>
          </p>
          <ul className="space-y-1.5 rounded-lg border border-border p-2">
            {list.slice(0, LIST_SHOWN).map((c) => (
              <li key={c.regNumber} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                <a href={eisCardUrl(c.regNumber)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono font-medium underline underline-offset-2">
                  № {c.regNumber}
                  <ExternalLink className="size-3" />
                </a>
                <span className="font-mono">{rubTotal(c.total)}</span>
                <span className="text-muted-foreground">{c.signedAt ? dateRu(c.signedAt) : 'без даты'}</span>
                {c.customer && <span className="min-w-0 basis-full break-words text-muted-foreground">{c.customer}</span>}
              </li>
            ))}
            {list.length > LIST_SHOWN && <li className="text-[12px] text-muted-foreground">…и ещё {list.length - LIST_SHOWN}</li>}
          </ul>
        </section>
      )}

      {showResults && (
        <>
          {kind === 'table' && (
            <section className="space-y-2" aria-label="Столбцы таблицы">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="font-medium">Проверьте, что в каком столбце</p>
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input type="checkbox" checked={hasHeader} onChange={(e) => (setHeaderOverride(e.target.checked), setOff(new Set()))} />
                  Первая строка — заголовки
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-[12px]">
                  <thead>
                    <tr>
                      {roles.map((role, col) => (
                        <th key={col} className="border-b border-border px-1.5 py-1.5 text-left font-normal">
                          <select aria-label={`Столбец ${col + 1}: что это`} value={role} onChange={(e) => setRole(col, e.target.value as ColumnRole)} className={inputClass}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, PREVIEW).map((r, i) => (
                      <tr key={i} className={i === 0 && hasHeader ? 'text-muted-foreground' : ''}>
                        {roles.map((_, col) => (
                          <td key={col} className="max-w-[12rem] truncate px-1.5 py-1" title={r[col] ?? ''}>
                            {r[col] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="space-y-2" aria-label="Что будет добавлено">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="font-medium">
                {kind === 'cards' && <span>Карточек ЕИС: {cards.length} · </span>}
                Найдено цен: {built.rows.length}
                {built.skipped.length > 0 && <span className="font-normal text-muted-foreground"> · пропущено строк: {built.skipped.length}</span>}
                {built.truncated > 0 && <span className="font-normal text-muted-foreground"> · за один раз берётся не больше {built.rows.length}, ещё {built.truncated} — загрузите отдельно</span>}
              </p>
              {askVat && (
                <label className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-muted-foreground">{kind === 'cards' ? 'Где НДС не назван, цена' : 'Цены в таблице'}</span>
                  <select aria-label="НДС в ценах таблицы" value={vat} onChange={(e) => setVat(e.target.value as Vat)} className={`${inputClass} w-auto`}>
                    <option value="with">с НДС</option>
                    <option value="without">без НДС</option>
                  </select>
                </label>
              )}
            </div>
            {built.rows.length > 0 && (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                {built.rows.map((r) => (
                  <li key={r.line} className="flex items-start gap-2 text-[12px]">
                    <input type="checkbox" className="mt-0.5" aria-label={`Добавить цену из строки ${r.line}`} checked={!off.has(r.line)} onChange={() => toggle(r.line)} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words">
                        <span className="font-mono font-medium">{rub(r.price)}</span>
                        <span className="text-muted-foreground"> · {r.date ? dateRu(r.date) : 'без даты'} · {r.source}</span>
                      </p>
                      {r.name && <p className="break-words text-muted-foreground">{r.name}</p>}
                      {r.detail && <p className="break-words text-muted-foreground">{r.detail}</p>}
                      {r.problems.map((problem) => (
                        <p key={problem} className="flex items-start gap-1 text-warn-foreground">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                          <span>{problem}</span>
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {built.skipped.length > 0 && (
              <details className="text-[12px] text-muted-foreground">
                <summary className="cursor-pointer">Почему строки пропущены</summary>
                <ul className="mt-1 space-y-0.5">
                  {built.skipped.slice(0, 10).map((s) => (
                    <li key={s.line}>
                      Строка {s.line}: {s.reason}
                    </li>
                  ))}
                  {built.skipped.length > 10 && <li>…и ещё {built.skipped.length - 10}</li>}
                </ul>
              </details>
            )}
            <p className="text-[12px] text-muted-foreground">Это цены, которые вы нашли сами: источник и дата у каждой остаются в расчёте, без даты цена в расчёт не идёт.</p>
          </section>
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button size="sm" disabled={chosen.length === 0} onClick={() => onImport(toAnalogs(chosen, vat, makeId))}>
          {chosen.length === 0 ? 'Нет цен для добавления' : `Добавить цен: ${chosen.length}`}
        </Button>
      </div>
    </div>
  );
}

export function AnalogImportModal({ open, onClose, positionName, ...rest }: Omit<AnalogImportFormProps, 'onCancel'> & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Загрузить цены из таблицы" subtitle={positionName ? `Позиция: ${positionName}` : undefined}>
      <AnalogImportForm positionName={positionName} {...rest} onCancel={onClose} />
    </Modal>
  );
}
