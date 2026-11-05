import { useState } from 'react';
import { eisNumberUrl, SORT_LABELS, type Facets, type SearchResult, type TenderFilters, type TenderListing, type TenderSort } from '@/lib/tender-search';
import { plural } from '@/lib/plural';
import { ArrowUpRight, ChevronDown, Copy, Download, FileText, Loader2, Mail, Phone, Search, Trash2 } from '../lib/icons';
import { Alert, Select } from './data';
import { Badge, Button, Card, Checkbox, Chip, HelpTip, Modal, fieldClass, fieldBase } from './ui';
import { ScreenHeader } from './ScreenHeader';
import { SummaryCard } from './SummaryCard';

// «Поиск закупок»: фильтры (слова и исключения, закон, цена, даты, «приём заявок идёт»), список закупок из выгрузки ЕИС и три шага, как её получить: «Найти в ЕИС» → закладка «Скопировать закупки» → вставить сюда.
// Закупки — только из выгрузки участника; чего в выгрузке нет, то не показываем (lib/tender-import.ts). Живая лента без выгрузки — «скоро»: нужен доступ к данным ЕИС с нашего сервера.

const inputClass = fieldClass('sm');

const rub = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n).replace(/ /g, ' ') + ' ₽';
const ruDate = (iso: string) => iso.split('-').reverse().join('.');
const dayDiff = (iso: string, today: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-micro text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const numberOrNull = (text: string): number | null => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

const sizeText = (bytes: number | null) => (bytes === null ? '' : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Документы закупки: список файлов со ссылками и архив одним файлом. Раскрывается по нажатию: у карточки их бывает много. */
function Docs({ l, defaultOpen = false }: { l: TenderListing; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const docs = l.docs ?? [];
  if (docs.length === 0 && !l.archive) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-sunken/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex min-h-7 items-center gap-1.5 text-ui font-medium">
          <FileText className="size-3.5 text-muted-foreground" />
          Документы · {docs.length}
          <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {l.archive && (
          <a href={l.archive} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-caption font-medium hover:bg-secondary">
            <Download className="size-3.5" /> Скачать всё архивом
          </a>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {docs.map((d) => (
            <li key={d.link}>
              <a href={d.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-3 py-2 text-ui hover:bg-secondary/60">
                <span className="min-w-0 flex-1 break-words">{d.title}</span>
                {d.ext && <Badge tone="neutral">{d.ext}</Badge>}
                {d.size !== null && <span className="shrink-0 text-micro tabular-nums text-muted-foreground">{sizeText(d.size)}</span>}
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Номер закупки в ЕИС: из ссылки на карточку или сам номер, если он настоящий (19 цифр у 44-ФЗ, 11 у 223-ФЗ). */
const eisNumberOf = (l: TenderListing): string | null => /(?:regNumber|reestrNumber)=(\d{11,19})/.exec(l.url ?? '')?.[1] ?? (/^(?:\d{19}|3\d{10})$/.test(l.id) ? l.id : null);

const leftText = (left: number | null) => (left === null ? '' : left < 0 ? ' · приём закончился' : left === 0 ? ' · сегодня последний день' : ` · осталось ${left} ${plural(left, 'день', 'дня', 'дней')}`);

/** Закупка в списке — компактная карточка: главное в три строки; всё остальное — в окне по нажатию. */
function Row({ l, today, onOpen }: { l: TenderListing; today: string; onOpen: () => void }) {
  const left = l.deadline ? dayDiff(l.deadline, today) : null;
  const docs = l.docs?.length ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Открыть закупку: ${l.title}`}
        className="block w-full space-y-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-start justify-between gap-x-4">
          <span className="min-w-0 flex-1 break-words text-subtitle font-semibold">{l.title}</span>
          <span className={l.price !== null ? 'shrink-0 text-right text-lg font-bold tabular-nums' : 'shrink-0 text-right text-caption text-muted-foreground'}>{l.price !== null ? rub(l.price) : 'цена не указана'}</span>
        </span>
        {(l.law || l.smp || l.method) && (
          <span className="flex flex-wrap items-center gap-1.5">
            {l.law && <Badge tone="neutral">{l.law}</Badge>}
            {l.smp && <Badge tone="success">для МСП</Badge>}
            {l.method && <Badge tone="neutral" wrap>{l.method}</Badge>}
          </span>
        )}
        {l.customer && <span className="line-clamp-1 block break-words text-caption text-muted-foreground">{l.customer}</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
          {l.deadline && (
            <span className={left !== null && left >= 0 && left <= 3 ? 'font-medium text-warn-foreground' : ''}>
              заявки до {ruDate(l.deadline)}
              {leftText(left)}
            </span>
          )}
          {l.region && <span>{l.region}</span>}
          {docs > 0 && <span>{docs} {plural(docs, 'документ', 'документа', 'документов')}</span>}
        </span>
      </button>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-micro text-muted-foreground">{label}</dt>
      <dd className="break-words text-ui">{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Закупка целиком, в окне: шапка как в списке, сроки, заказчик и контакты, место, позиции, документы со ссылками. Показано только то, что есть в выгрузке. */
export function TenderDetails({ l, today }: { l: TenderListing; today: string }) {
  const left = l.deadline ? dayDiff(l.deadline, today) : null;
  const positions = l.positions ?? [];
  const more = (l.positionsTotal ?? positions.length) - positions.length;
  const place = [l.city, l.place].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');
  return (
    <div className="space-y-5 px-5 py-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-x-4">
            <p className="min-w-0 flex-1 break-words text-xl font-semibold">{l.title}</p>
            <span className={l.price !== null ? 'shrink-0 text-right text-xl font-bold tabular-nums' : 'shrink-0 text-right text-caption text-muted-foreground'}>{l.price !== null ? rub(l.price) : 'цена не указана'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {l.law && <Badge tone="neutral">{l.law}</Badge>}
            {l.method && <Badge tone="neutral" wrap>{l.method}</Badge>}
            {l.smp && <Badge tone="success">для МСП</Badge>}
            {l.platform && <Badge tone="info">{l.platform}</Badge>}
            {l.stage && <Badge tone="neutral" dot>{l.stage}</Badge>}
            {l.plan && <Badge tone="warn">план-график</Badge>}
          </div>
          {l.customer && (
            <p className="break-words text-ui text-muted-foreground">
              {l.customer}
              {l.customerInn && <span className="tabular-nums"> · ИНН {l.customerInn}</span>}
            </p>
          )}
        </div>

        <Block title="Сроки">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {l.deadline && (
              <Fact label="Подача заявок до">
                <span className={left !== null && left >= 0 && left <= 3 ? 'font-medium text-warn-foreground' : ''}>
                  {ruDate(l.deadline)}
                  {l.deadlineTime && `, ${l.deadlineTime} (МСК)`}
                  {leftText(left)}
                </span>
              </Fact>
            )}
            {l.publishedAt && <Fact label="Размещено">{ruDate(l.publishedAt)}</Fact>}
          </dl>
        </Block>

        {(place || l.region || (l.branches && l.branches.length > 0)) && (
          <Block title="Где и что">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {l.region && <Fact label="Регион">{l.region}</Fact>}
              {place && <Fact label="Место поставки">{place}</Fact>}
              {l.branches && l.branches.length > 0 && <Fact label="Отрасль">{l.branches.join('; ')}</Fact>}
            </dl>
          </Block>
        )}

        {l.contact && (
          <Block title="Контакты заказчика">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui">
              {l.contact.person && <span>{l.contact.person}</span>}
              {l.contact.phone && (
                <a href={`tel:${l.contact.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:underline">
                  <Phone className="size-3.5 text-muted-foreground" /> <span className="tabular-nums">{l.contact.phone}</span>
                </a>
              )}
              {l.contact.email && (
                <a href={`mailto:${l.contact.email}`} className="inline-flex items-center gap-1 break-all hover:underline">
                  <Mail className="size-3.5 text-muted-foreground" /> {l.contact.email}
                </a>
              )}
            </div>
          </Block>
        )}

        {positions.length > 0 && (
          <Block title={`Позиции · ${l.positionsTotal ?? positions.length}`}>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {positions.map((p, i) => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-ui">{p.name}</span>
                  <span className="shrink-0 text-right text-caption tabular-nums text-muted-foreground">
                    {p.quantity !== null && p.quantity !== undefined && `${new Intl.NumberFormat('ru-RU').format(p.quantity)}${p.unit ? ` ${p.unit}` : ''}`}
                    {(p.quantity === null || p.quantity === undefined) && p.unit && p.unit}
                    {p.price !== null && ` · ${rub(p.price)}`}
                  </span>
                  {(p.okpd2 || p.ktru) && (
                    <span className="basis-full font-mono text-micro text-muted-foreground">
                      {p.okpd2 && `ОКПД2 ${p.okpd2}`}
                      {p.okpd2 && p.ktru && ' · '}
                      {p.ktru && `КТРУ ${p.ktru}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {more > 0 && <p className="text-caption text-muted-foreground">и ещё {more} — полный список в документах закупки</p>}
          </Block>
        )}

        {((l.docs?.length ?? 0) > 0 || l.archive) && (
          <Block title="Документы">
            <Docs l={l} defaultOpen />
          </Block>
        )}
      </div>
  );
}

function TenderModal({ l, today, onClose }: { l: TenderListing; today: string; onClose: () => void }) {
  const eis = eisNumberOf(l);
  const link = l.url ?? eisNumberUrl(l.id);
  const host = hostOf(link);
  return (
    <Modal
      open
      onClose={onClose}
      title="Закупка"
      subtitle={eis ? `№ ${eis}` : l.rostenderId ? `Ростендер № ${l.rostenderId}` : `№ ${l.id}`}
      footer={
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-ui font-medium hover:bg-secondary">
                {host.includes('rostender') ? 'Открыть на Ростендере' : 'Открыть в ЕИС'} <ArrowUpRight className="size-3.5" />
              </a>
      }
    >
      <TenderDetails l={l} today={today} />
    </Modal>
  );
}

export type RostenderUi = {
  /** Задан ли ключ Ростендера на сервере (без него список не обновляется). null — ещё не спрашивали. */
  configured: boolean | null;
  /** Когда сервер последний раз обновлял список (ISO); null — ещё ни разу. */
  updatedAt: string | null;
  /** Сколько действующих закупок на сервере. */
  total: number;
  /** Сколько места занимает то, что загружено: карточки — текст на сервере, документы — размеры файлов из карточек (сами файлы не хранятся). */
  totals?: { cards: number; cardsBytes: number; docs: number; docsBytes: number; docsNoSize: number };
};

const bytesText = (bytes: number) => (bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(2).replace('.', ',')} ГБ` : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);

/** Закупки сервера (Ростендер): обновляются сами раз в сутки, участник ничего не загружает — только строка о состоянии. */
function RostenderLine({ r }: { r: RostenderUi }) {
  if (r.configured === false && r.total === 0) {
    return (
      <Alert tone="info" title="Автообновление закупок не настроено">
        Ключ Ростендера нужен только владельцу сервера: строка <span className="font-mono">ROSTENDER_API_KEY=ключ</span> в <span className="font-mono">web/.env.local</span>, затем перезапуск продукта.
      </Alert>
    );
  }
  if (r.total === 0) {
    return <p className="text-caption text-muted-foreground">Закупки загружаются автоматически и обновляются раз в сутки — первая загрузка ещё идёт, загляните позже.</p>;
  }
  return (
    <p className="text-caption text-muted-foreground">
      Закупки обновляются автоматически раз в сутки
      {r.updatedAt && ` · обновлено ${new Date(r.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
      {' · '}
      <span className="font-medium tabular-nums text-foreground">{r.total}</span> {plural(r.total, 'действующая закупка', 'действующие закупки', 'действующих закупок')}
      {r.totals && r.totals.cards > 0 && (
        <>
          {' · документов '}
          <span className="tabular-nums">{r.totals.docs}</span>
          {r.totals.docsBytes > 0 && (
            <>
              {' ('}
              <span className="tabular-nums">{bytesText(r.totals.docsBytes)}</span>
              {r.totals.docsNoSize > 0 && `, у ${r.totals.docsNoSize} размер не назван`}
              {')'}
            </>
          )}
          {' — ссылки, сами файлы не скачиваются, пока вы их не откроете'}
        </>
      )}
    </p>
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
  importNote,
  onClear,
  extension,
  facets,
  hasRostender = false,
  rostender,
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
  /** Адрес закладки «Скопировать закупки» — загрузка из ЕИС скрыта с экрана 05.11.2026 по просьбе владельца, код остался. */
  bookmarklet?: string;
  /** Текст таблицы: вставка или файл. Возвращает сообщение об итоге в importNote. */
  onImport?: (text: string) => void;
  importNote: { tone: 'info' | 'danger'; text: string } | null;
  /** Очистить выгрузку из ЕИС (она в браузере). Нет — кнопки нет: закупки сервера очистить нельзя, он их обновляет сам. */
  onClear?: () => void;
  /** Больше не используется: кнопки «Загрузить документы» в списке нет (05.11.2026). */
  onNew?: () => void;
  /** Расширение Chrome «поиск закупок в ЕИС»: стоит ли оно, идёт ли поиск, запуск. Нет — прежний путь через закладку. */
  extension?: { available: boolean; busy: boolean; onSearch: () => void };
  /** Что есть в выгрузке: регионы, способы, площадки — для выпадающих списков. */
  facets?: Facets;
  /** В выгрузке есть закупки из Ростендера: тогда показываются фильтры «МСП», «с документами», «площадка», «срок». */
  hasRostender?: boolean;
  /** Закупки сервера (Ростендер): строка о состоянии автообновления. Нет — строки нет. */
  rostender?: RostenderUi;
}) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState<TenderListing | null>(null);
  const has = result.total > 0;

  // Итог фильтров в одну строку — виден, когда карточка свёрнута.
  const filterBrief =
    [filters.query.trim() && `«${filters.query.trim()}»`, filters.customer.trim() && `заказчик: ${filters.customer.trim()}`, filters.law !== 'any' && (filters.law === 'commercial' ? 'коммерческие' : `${filters.law}-ФЗ`), filters.region && filters.region, filters.method && filters.method, filters.platform && filters.platform, filters.smp && 'для МСП', filters.withDocs && 'с документами', filters.daysLeft !== null && (filters.daysLeft === 1 ? 'последний день' : `ещё ${filters.daysLeft} дн.`), filters.activeOnly && 'приём заявок идёт'].filter(Boolean).join(' · ') || 'Фильтры не заданы';

  return (
    <div className="animate-fade-up space-y-4">
      <ScreenHeader
        icon="search"
        title="Поиск закупок"
        hint={
          has ? (hasRostender ? `Закупок в списке: ${result.total}` : `В выгрузке ${result.total} ${plural(result.total, 'закупка', 'закупки', 'закупок')}${loadedAt ? ` · загружена ${new Date(loadedAt).toLocaleDateString('ru-RU')}` : ''}`) : rostender ? 'Закупки загружаются автоматически и обновляются раз в сутки.' : 'Задайте фильтры, найдите закупки в ЕИС и загрузите их сюда.'
        }
        aside={
          has && onClear && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              <Trash2 className="size-3.5" /> Очистить выгрузку
            </Button>
          )
        }
      />

      {rostender && <RostenderLine r={rostender} />}

      <SummaryCard
        lead={<Search className="size-5 shrink-0 text-muted-foreground" />}
        title="Фильтры поиска"
        subtitle={filterBrief}
        defaultOpen
      >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Слова — товар или услуга (минус исключает, фраза — в кавычках)">
            <input type="text" value={filters.query} onChange={(e) => onFilters({ query: e.target.value })} placeholder="уголь поставка -ремонт" className={inputClass} />
          </Field>
          <Field label="Заказчик (часть названия)">
            <input type="text" value={filters.customer} onChange={(e) => onFilters({ customer: e.target.value })} placeholder="Россети" className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Закон">
          <Chip on={filters.law === 'any'} onClick={() => onFilters({ law: 'any' })} label="44-ФЗ и 223-ФЗ" />
          <Chip on={filters.law === '44'} onClick={() => onFilters({ law: '44' })} label="44-ФЗ" />
          <Chip on={filters.law === '223'} onClick={() => onFilters({ law: '223' })} label="223-ФЗ" />
          {hasRostender && <Chip on={filters.law === 'commercial'} onClick={() => onFilters({ law: 'commercial' })} label="Коммерческие" />}
        </div>
        {hasRostender && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Срок подачи заявок">
            <span className="text-micro text-muted-foreground">Заявки принимают:</span>
            <Chip on={filters.daysLeft === null} onClick={() => onFilters({ daysLeft: null })} label="Любой срок" />
            <Chip on={filters.daysLeft === 1} onClick={() => onFilters({ daysLeft: 1 })} label="Сегодня последний день" />
            <Chip on={filters.daysLeft === 3} onClick={() => onFilters({ daysLeft: 3 })} label="Ещё 3 дня" />
            <Chip on={filters.daysLeft === 7} onClick={() => onFilters({ daysLeft: 7 })} label="Ещё неделя" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-ui">
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
        {hasRostender && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-ui">
            <Checkbox checked={filters.smp} onChange={(v) => onFilters({ smp: v })}>
              Только для малого и среднего бизнеса
            </Checkbox>
            <Checkbox checked={filters.withDocs} onChange={(v) => onFilters({ withDocs: v })}>
              Только с документами
            </Checkbox>
          </div>
        )}
        {facets && (facets.regions.length > 1 || facets.methods.length > 1 || facets.platforms.length > 1) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {facets.regions.length > 1 && (
              <Field label="Регион">
                <Select dense value={filters.region} onChange={(e) => onFilters({ region: e.target.value })}>
                  <option value="">Все регионы</option>
                  {facets.regions.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} · {f.count}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {facets.methods.length > 1 && (
              <Field label="Способ закупки">
                <Select dense value={filters.method} onChange={(e) => onFilters({ method: e.target.value })}>
                  <option value="">Любой способ</option>
                  {facets.methods.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} · {f.count}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {hasRostender && facets.platforms.length > 1 && (
              <Field label="Площадка">
                <Select dense value={filters.platform} onChange={(e) => onFilters({ platform: e.target.value })}>
                  <option value="">Все площадки</option>
                  {facets.platforms.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} · {f.count}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Цена от, ₽">
            <input inputMode="numeric" value={filters.priceFrom ?? ''} onChange={(e) => onFilters({ priceFrom: numberOrNull(e.target.value) })} placeholder="0" className={`${inputClass} text-right tabular-nums`} />
          </Field>
          <Field label="Цена до, ₽">
            <input inputMode="numeric" value={filters.priceTo ?? ''} onChange={(e) => onFilters({ priceTo: numberOrNull(e.target.value) })} placeholder="без предела" className={`${inputClass} text-right tabular-nums`} />
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
          <p className="text-micro text-muted-foreground">Расширение ищет в фоне: до трёх страниц ЕИС, до 150 закупок за раз. Список заменяется результатом поиска.</p>
        ) : (
          <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
            Расширение для Chrome ищет прямо здесь, без закладки и вставки.
            <HelpTip align="start" content={'Расширение для Chrome «Тендекс — поиск закупок в ЕИС» ищет прямо здесь, без закладки и вставки. Папка extension/eis-bridge: chrome://extensions → «Режим разработчика» → «Загрузить распакованное». ЕИС открывается не в каждом окне (во встроенном окне приложения — нет).'} />
          </p>
        )}
        {importNote && (
          <p role={importNote.tone === 'danger' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-caption ${importNote.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-info/10 text-info'}`}>
            {importNote.text}
          </p>
        )}
      </div>
      </SummaryCard>

      {has && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-subtitle font-bold">
              Найдено: {result.items.length}
              {result.items.length > 100 && ' · показаны первые 100'}
            </span>
            <label className="flex items-center gap-2 text-caption text-muted-foreground">
              Сначала
              <select value={sort} onChange={(e) => onSort(e.target.value as TenderSort)} className={`${fieldBase} h-8 px-2 text-caption text-foreground`}>
                {(Object.keys(SORT_LABELS) as TenderSort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {result.items.length === 0 ? (
            <Card className="p-6">
              <p className="text-center text-ui text-muted-foreground">По этим фильтрам ничего нет. Ослабьте цену, даты или слова.</p>
            </Card>
          ) : (
            <ul className="space-y-4">
              {result.items.slice(0, 100).map((l) => (
                <Row key={l.id} l={l} today={today} onOpen={() => setOpened(l)} />
              ))}
            </ul>
          )}
          {opened && <TenderModal l={opened} today={today} onClose={() => setOpened(null)} />}
          {(result.hiddenNoPrice > 0 || result.hiddenNoDate > 0) && (
            <p className="text-micro text-muted-foreground">
              {result.hiddenNoPrice > 0 && `Скрыто без цены в выгрузке: ${result.hiddenNoPrice}. `}
              {result.hiddenNoDate > 0 && `Скрыто без даты размещения: ${result.hiddenNoDate}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
