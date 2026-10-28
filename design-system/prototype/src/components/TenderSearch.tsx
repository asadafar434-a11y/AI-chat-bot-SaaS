import { useEffect, useRef, useState } from 'react';
import { eisNumberUrl, SORT_LABELS, type SearchResult, type TenderFilters, type TenderListing, type TenderSort } from '@/lib/tender-search';
import { plural } from '@/lib/plural';
import { ArrowUpRight, Copy, Loader2, Plus, Search, Trash2, Upload } from '../lib/icons';
import { Badge, Button, Card, Checkbox, HelpTip, fieldClass } from './ui';

// «Поиск закупок»: фильтры (слова и исключения, закон, цена, даты, «приём заявок идёт»), список закупок из выгрузки ЕИС и три шага, как её получить: «Найти в ЕИС» → закладка «Скопировать закупки» → вставить сюда.
// Закупки — только из выгрузки участника; чего в выгрузке нет, то не показываем (lib/tender-import.ts). Живая лента без выгрузки — «скоро»: нужен доступ к данным ЕИС с нашего сервера.

const inputClass = fieldClass('sm');

const rub = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n).replace(/ /g, ' ') + ' ₽';
const ruDate = (iso: string) => iso.split('-').reverse().join('.');
const dayDiff = (iso: string, today: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 rounded-md border px-3 text-[12px] font-medium transition-colors ${active ? 'border-foreground bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const numberOrNull = (text: string): number | null => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

function Row({ l, today, onNew }: { l: TenderListing; today: string; onNew: () => void }) {
  const left = l.deadline ? dayDiff(l.deadline, today) : null;
  return (
    <li className="space-y-1.5 border-b border-border px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <p className="min-w-[12rem] flex-1 break-words text-[13px] font-medium">{l.title}</p>
        {l.law && <Badge tone="neutral">{l.law}</Badge>}
        {l.method && <Badge tone="neutral" wrap>{l.method}</Badge>}
      </div>
      {l.customer && <p className="break-words text-[12px] text-muted-foreground">{l.customer}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-[15px] font-bold">{l.price !== null ? rub(l.price) : 'цена не указана'}</span>
        {l.deadline && (
          <span className={`text-[12px] ${left !== null && left >= 0 && left <= 3 ? 'font-medium text-warn-foreground' : 'text-muted-foreground'}`}>
            заявки до {ruDate(l.deadline)}
            {left !== null && left >= 0 && ` · ${left === 0 ? 'сегодня последний день' : `осталось ${left} ${plural(left, 'день', 'дня', 'дней')}`}`}
            {left !== null && left < 0 && ' · приём закончился'}
          </span>
        )}
        {l.publishedAt && <span className="text-[12px] text-muted-foreground">размещено {ruDate(l.publishedAt)}</span>}
        <span className="font-mono text-[11px] text-muted-foreground">№ {l.id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <a href={l.url ?? eisNumberUrl(l.id)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium hover:bg-secondary">
          Открыть в ЕИС <ArrowUpRight className="size-3.5" />
        </a>
        <Button size="sm" variant="ghost" onClick={onNew}>
          <Plus className="size-3.5" /> Загрузить документы
        </Button>
      </div>
    </li>
  );
}

export function TenderSearch({
  filters,
  onFilters,
  sort,
  onSort,
  result,
  loadedAt,
  today,
  eisUrl,
  bookmarklet,
  onImport,
  importNote,
  onClear,
  onNew,
  extension,
}: {
  filters: TenderFilters;
  onFilters: (patch: Partial<TenderFilters>) => void;
  sort: TenderSort;
  onSort: (sort: TenderSort) => void;
  result: SearchResult;
  loadedAt: string;
  today: string;
  /** Ссылка на поиск ЕИС с теми же фильтрами. */
  eisUrl: string;
  /** Адрес закладки «Скопировать закупки». */
  bookmarklet: string;
  /** Текст таблицы: вставка или файл. Возвращает сообщение об итоге в importNote. */
  onImport: (text: string) => void;
  importNote: { tone: 'info' | 'danger'; text: string } | null;
  onClear: () => void;
  onNew: () => void;
  /** Расширение Chrome «поиск закупок в ЕИС»: стоит ли оно, идёт ли поиск, запуск. Нет — прежний путь через закладку. */
  extension?: { available: boolean; busy: boolean; onSearch: () => void };
}) {
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  // React не пускает «javascript:» в href: закладку ставим на ссылку напрямую.
  useEffect(() => {
    link.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);
  const has = result.total > 0;

  const loadBody = (
    <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold">Загрузить закупки из ЕИС</span>
            <HelpTip
              align="start"
              content="1) Нажмите «Найти в ЕИС». 2) Перетащите кнопку «Скопировать закупки» на панель закладок браузера (один раз). 3) Когда в ЕИС открыты результаты, нажмите эту закладку — таблица на странице (до 50 закупок) скопируется. 4) Вставьте её сюда. Закупки читаются на вашей стороне: наш сервер в ЕИС не ходит. Для следующих страниц ЕИС повторите."
            />
          </div>
          <ol className="space-y-1 text-[13px] text-muted-foreground">
            <li>1. «Найти в ЕИС» выше — откроются результаты.</li>
            <li>
              2. Нажмите закладку{' '}
              <a ref={link} onClick={(e) => e.preventDefault()} draggable className="inline-flex h-8 cursor-grab items-center rounded-md border border-dashed border-foreground px-3 text-[12px] font-medium text-foreground">
                Скопировать закупки
              </a>{' '}
              <span className="text-[12px]">(перетащите её на панель закладок один раз)</span>.
            </li>
            <li>3. Вставьте скопированное:</li>
          </ol>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            aria-label="Таблица закупок из ЕИС"
            placeholder="Вставьте таблицу (Ctrl+V)"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={paste.trim() === ''}
              onClick={() => {
                onImport(paste);
                setPaste('');
              }}
            >
              Загрузить
            </Button>
            <input
              ref={file}
              type="file"
              accept=".csv,.tsv,.txt"
              aria-label="Файл выгрузки закупок"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void f.text().then(onImport);
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
              <Upload className="size-3.5" /> Файл CSV
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Живая лента без выгрузки — скоро: нужен доступ к данным ЕИС с нашего сервера.</p>
    </>
  );

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Поиск закупок</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {has ? `В выгрузке ${result.total} ${plural(result.total, 'закупка', 'закупки', 'закупок')}${loadedAt ? ` · загружена ${new Date(loadedAt).toLocaleDateString('ru-RU')}` : ''}` : 'Задайте фильтры, найдите закупки в ЕИС и загрузите их сюда.'}
          </p>
        </div>
        {has && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            <Trash2 className="size-3.5" /> Очистить выгрузку
          </Button>
        )}
      </div>

      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Слова — товар или услуга (минус исключает, фраза — в кавычках)">
            <input type="text" value={filters.query} onChange={(e) => onFilters({ query: e.target.value })} placeholder="уголь поставка -ремонт" className={inputClass} />
          </Field>
          <Field label="Заказчик (часть названия)">
            <input type="text" value={filters.customer} onChange={(e) => onFilters({ customer: e.target.value })} placeholder="Россети" className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Закон">
          <Choice active={filters.law === 'any'} onClick={() => onFilters({ law: 'any' })}>44-ФЗ и 223-ФЗ</Choice>
          <Choice active={filters.law === '44'} onClick={() => onFilters({ law: '44' })}>44-ФЗ</Choice>
          <Choice active={filters.law === '223'} onClick={() => onFilters({ law: '223' })}>223-ФЗ</Choice>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <Checkbox checked={filters.activeOnly} onChange={(v) => onFilters({ activeOnly: v })}>
            Только приём заявок идёт
          </Checkbox>
          <span className="inline-flex items-center gap-1.5">
            <Checkbox checked={filters.titleOnly} onChange={(v) => onFilters({ titleOnly: v })}>
              Слова — в названии закупки
            </Checkbox>
            <HelpTip align="start" content="ЕИС ищет слова и в названии, и в позициях внутри закупки. Галочка оставляет в списке только закупки, где слово есть в самом названии." />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Цена от, ₽">
            <input inputMode="numeric" value={filters.priceFrom ?? ''} onChange={(e) => onFilters({ priceFrom: numberOrNull(e.target.value) })} placeholder="0" className={`${inputClass} text-right font-mono`} />
          </Field>
          <Field label="Цена до, ₽">
            <input inputMode="numeric" value={filters.priceTo ?? ''} onChange={(e) => onFilters({ priceTo: numberOrNull(e.target.value) })} placeholder="без предела" className={`${inputClass} text-right font-mono`} />
          </Field>
          <Field label="Размещено с">
            <input type="date" value={filters.publishedFrom ?? ''} onChange={(e) => onFilters({ publishedFrom: e.target.value || null })} className={inputClass} />
          </Field>
          <Field label="Размещено по">
            <input type="date" value={filters.publishedTo ?? ''} onChange={(e) => onFilters({ publishedTo: e.target.value || null })} className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {extension?.available && (
            <Button disabled={extension.busy} onClick={extension.onSearch} className="w-full sm:w-auto">
              {extension.busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {extension.busy ? 'Ищу в ЕИС…' : 'Найти'}
            </Button>
          )}
          <a
            href={eisUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={
              extension?.available
                ? 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-secondary sm:w-auto'
                : 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 sm:w-auto'
            }
          >
            {!extension?.available && <Search className="size-4" />} {extension?.available ? 'Открыть в ЕИС' : 'Найти в ЕИС'} <ArrowUpRight className="size-3.5" />
          </a>
          <Button
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => {
              const done = () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2500);
              };
              if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(eisUrl).then(done, () => {});
            }}
          >
            <Copy className="size-3.5" /> {copied ? 'Скопировано' : 'Скопировать ссылку'}
          </Button>
          <HelpTip
            align="start"
            content="Откроется zakupki.gov.ru с теми же словами, законом, ценой и датами — в вашем браузере. Исключения слов («-слово») ЕИС не понимает: они сработают здесь, в списке после загрузки."
          />
        </div>
        {extension?.available ? (
          <p className="text-[11px] text-muted-foreground">Расширение ищет в фоне: до трёх страниц ЕИС, до 150 закупок за раз. Список заменяется результатом поиска.</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Расширение для Chrome «Тендерный юрист — поиск закупок в ЕИС» ищет прямо здесь, без закладки и вставки. Папка <span className="font-mono">extension/eis-bridge</span>: chrome://extensions → «Режим разработчика» → «Загрузить распакованное». ЕИС открывается не в каждом окне (во встроенном окне приложения — нет).
          </p>
        )}
        {importNote && (
          <p role={importNote.tone === 'danger' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-[12px] ${importNote.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-info/10 text-info'}`}>
            {importNote.text}
          </p>
        )}
      </Card>

      {extension?.available ? (
        <Card className="p-4">
          <details>
            <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground">Загрузка без расширения: закладка или вставка таблицы</summary>
            <div className="mt-3 space-y-3">{loadBody}</div>
          </details>
        </Card>
      ) : (
        <Card className="space-y-3 p-4">{loadBody}</Card>
      )}

      {has && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="text-[15px] font-bold">
              Найдено: {result.items.length}
              {result.items.length > 100 && ' · показаны первые 100'}
            </span>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              Сначала
              <select value={sort} onChange={(e) => onSort(e.target.value as TenderSort)} className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">
                {(Object.keys(SORT_LABELS) as TenderSort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {result.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">По этим фильтрам ничего нет. Ослабьте цену, даты или слова.</p>
          ) : (
            <ul>
              {result.items.slice(0, 100).map((l) => (
                <Row key={l.id} l={l} today={today} onNew={onNew} />
              ))}
            </ul>
          )}
          {(result.hiddenNoPrice > 0 || result.hiddenNoDate > 0) && (
            <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              {result.hiddenNoPrice > 0 && `Скрыто без цены в выгрузке: ${result.hiddenNoPrice}. `}
              {result.hiddenNoDate > 0 && `Скрыто без даты размещения: ${result.hiddenNoDate}.`}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
