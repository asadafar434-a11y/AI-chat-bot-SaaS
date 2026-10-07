import { useMemo, useState } from 'react';
import { Calendar, Check, ChevronLeft, ChevronRight, ExternalLink, Plus, Search, Sparkles, X } from '../lib/icons';
import { Button, Card, Badge, Soon, Tooltip } from './ui';
import { foundTenders, procedureMeta, rub, type FoundTender, type Procedure } from '../lib/data';

const REGIONS = [
  'Москва', 'Московская область', 'Санкт-Петербург', 'Краснодарский край',
  'Татарстан', 'Новосибирская область', 'Свердловская область', 'Ростовская область',
  'Башкортостан', 'Нижегородская область', 'Самарская область', 'Красноярский край',
  'Воронежская область', 'Пермский край',
];

const PAGE_SIZE = 8;

type Filters = {
  law: 'all' | '44-ФЗ' | '223-ФЗ';
  procedure: 'all' | Procedure;
  priceMin: string;
  priceMax: string;
  region: string;
  okpd: string;
};

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'deadline';

const EMPTY: Filters = { law: 'all', procedure: 'all', priceMin: '', priceMax: '', region: '', okpd: '' };

function hasFilters(f: Filters) {
  return f.law !== 'all' || f.procedure !== 'all' || f.priceMin || f.priceMax || f.region || f.okpd;
}

function fmtDate(iso: string) {
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}

function daysLeft(iso: string): string | null {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return null;
  if (diff === 0) return 'сегодня';
  if (diff <= 3) return `${diff} дн.`;
  return `${diff} дней`;
}

function matchText(text: string, term: string): boolean {
  if (text.includes(term)) return true;
  // Простой стемминг для русских слов: сравниваем первые (len-2) символа для слов длиннее 4 букв.
  // Позволяет "серверы" находить "серверов", "серверного", "серверных".
  if (term.length > 4) return text.includes(term.slice(0, term.length - 2));
  return false;
}

function applyFilters(list: FoundTender[], q: string, f: Filters): FoundTender[] {
  const lower = q.toLowerCase().trim();
  return list.filter((t) => {
    if (lower && !matchText(t.title.toLowerCase(), lower) &&
        !matchText(t.customer.toLowerCase(), lower) &&
        !t.id.includes(lower) &&
        !t.okpd.startsWith(lower)) return false;
    if (f.law !== 'all' && t.law !== f.law) return false;
    if (f.procedure !== 'all' && t.procedure !== f.procedure) return false;
    if (f.priceMin) { const n = Number(f.priceMin.replace(/\D/g, '')); if (n && t.nmck < n) return false; }
    if (f.priceMax) { const n = Number(f.priceMax.replace(/\D/g, '')); if (n && t.nmck > n) return false; }
    if (f.region && t.region !== f.region) return false;
    if (f.okpd && !t.okpd.startsWith(f.okpd)) return false;
    return true;
  });
}

function applySort(list: FoundTender[], sort: Sort): FoundTender[] {
  const r = [...list];
  if (sort === 'price_asc') r.sort((a, b) => a.nmck - b.nmck);
  else if (sort === 'price_desc') r.sort((a, b) => b.nmck - a.nmck);
  else if (sort === 'deadline') r.sort((a, b) => a.deadline.localeCompare(b.deadline));
  else r.sort((a, b) => b.relevance - a.relevance);
  return r;
}

export function TenderSearch({ onAdd }: { onAdd: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<Sort>('relevance');
  const [page, setPage] = useState(1);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const runSearch = (q = query) => {
    setActiveQuery(q);
    setPage(1);
  };

  const filtered = useMemo(
    () => applySort(applyFilters(foundTenders, activeQuery, filters), sort),
    [activeQuery, filters, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const addTender = (id: string) => {
    setAdded((p) => ({ ...p, [id]: true }));
    onAdd(id);
  };

  return (
    <div className="animate-fade-up space-y-6">
      {/* Заголовок */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Поиск закупок</h1>
          <Soon />
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Поиск по площадкам — в разработке. Сейчас на экране пример: так будут выглядеть лоты из ЕИС,
          РТС-тендер, Сбербанк-АСТ и Газпромбанка, отсортированные по совпадению с вашими кодами ОКПД и профилем компании.
        </p>
      </div>

      {/* Строка поиска */}
      <Card className="p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(); }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ключевые слова, ОКПД или № закупки"
              aria-label="Поиск закупок"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                aria-label="Очистить"
                onClick={() => { setQuery(''); runSearch(''); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button type="submit">
            <Search className="size-4" /> Найти
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">Быстрый поиск:</span>
          {['компьютерное оборудование', 'МФУ и картриджи', 'серверы', '26.20'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setQuery(p); runSearch(p); }}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      </Card>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Закон */}
        <div className="inline-flex divide-x divide-border rounded-md border border-border bg-card text-[13px]">
          {(['all', '44-ФЗ', '223-ФЗ'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilter('law', v)}
              className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md transition-colors ${
                filters.law === v ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'all' ? 'Все законы' : v}
            </button>
          ))}
        </div>

        {/* Процедура */}
        <select
          value={filters.procedure}
          onChange={(e) => setFilter('procedure', e.target.value as Filters['procedure'])}
          aria-label="Способ закупки"
          className="h-9 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-foreground"
        >
          <option value="all">Все процедуры</option>
          {(Object.entries(procedureMeta) as [Procedure, (typeof procedureMeta)[Procedure]][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* НМЦК */}
        <div className="flex items-center gap-1.5">
          <input
            value={filters.priceMin}
            onChange={(e) => setFilter('priceMin', e.target.value)}
            placeholder="НМЦК от, ₽"
            aria-label="НМЦК от"
            className="h-9 w-[120px] rounded-md border border-border bg-card px-2.5 text-[13px] outline-none focus:border-foreground placeholder:text-muted-foreground"
          />
          <span className="text-muted-foreground">—</span>
          <input
            value={filters.priceMax}
            onChange={(e) => setFilter('priceMax', e.target.value)}
            placeholder="до, ₽"
            aria-label="НМЦК до"
            className="h-9 w-[90px] rounded-md border border-border bg-card px-2.5 text-[13px] outline-none focus:border-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Регион */}
        <select
          value={filters.region}
          onChange={(e) => setFilter('region', e.target.value)}
          aria-label="Регион"
          className="h-9 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-foreground"
        >
          <option value="">Все регионы</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        {/* ОКПД */}
        <input
          value={filters.okpd}
          onChange={(e) => setFilter('okpd', e.target.value)}
          placeholder="ОКПД"
          aria-label="Код ОКПД"
          className="h-9 w-[110px] rounded-md border border-border bg-card px-2.5 font-mono text-[13px] outline-none focus:border-foreground placeholder:text-muted-foreground"
        />

        {hasFilters(filters) && (
          <button
            onClick={() => { setFilters(EMPTY); setPage(1); }}
            className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" /> Сбросить фильтры
          </button>
        )}
      </div>

      {/* Счётчик и сортировка */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {filtered.length === 0 ? 'Ничего не найдено' : `Найдено ${filtered.length} закупок`}
        </p>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Sparkles className="size-3.5" />
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}
            aria-label="Сортировка результатов"
            className="bg-transparent text-[12px] text-muted-foreground outline-none hover:text-foreground focus:text-foreground"
          >
            <option value="relevance">по релевантности</option>
            <option value="price_asc">цена ↑</option>
            <option value="price_desc">цена ↓</option>
            <option value="deadline">срок подачи</option>
          </select>
        </label>
      </div>

      {/* Карточки результатов */}
      <div className="space-y-3">
        {shown.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              По вашему запросу ничего не найдено — попробуйте изменить ключевые слова или фильтры.
            </p>
          </Card>
        ) : (
          shown.map((t) => <TenderCard key={t.id} tender={t} added={!!added[t.id]} onAdd={addTender} />)
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
        <Pagination page={page} total={totalPages} onChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      )}

      {/* Загрузить по номеру ЕИС — скоро, как и такое же поле на шаге «Загрузка» */}
      <Card className="p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          Загрузить по реестровому номеру ЕИС
          <Soon />
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Найдите закупку на zakupki.gov.ru и вставьте её номер — документы загрузятся автоматически.
        </p>
        <div className="mt-3 flex items-center gap-2 opacity-70">
          <input
            disabled
            aria-label="Реестровый номер закупки — скоро"
            placeholder="0173200001326000001"
            className="h-9 min-w-[200px] flex-1 cursor-not-allowed rounded-md border border-border bg-background px-3 font-mono text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <Button type="button" variant="secondary" disabled>
            Загрузить
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TenderCard({ tender: t, added, onAdd }: { tender: FoundTender; added: boolean; onAdd: (id: string) => void }) {
  const left = daysLeft(t.deadline);
  const urgent = left !== null && (left === 'сегодня' || left.endsWith('дн.'));
  const tone = t.relevance >= 90 ? 'success' : t.relevance >= 70 ? 'warn' : 'neutral';
  const meta = procedureMeta[t.procedure];
  const eisUrl =
    t.law === '44-ФЗ'
      ? `https://zakupki.gov.ru/epz/order/notice/ea44/view/common-info.html?regNumber=${t.id}`
      : `https://zakupki.gov.ru/epz/order/notice/notice223/view/common-info.html?regNumber=${t.id}`;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip content="Насколько закупка подходит вашей компании: коды ОКПД, профиль, регион." align="start">
              <Badge tone={tone}>{t.relevance}% совпадение</Badge>
            </Tooltip>
            <Tooltip content={meta.hint} align="start">
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                {meta.short}
              </span>
            </Tooltip>
            <span className="font-mono text-[11px] text-muted-foreground">{t.law}</span>
            <span className="text-[11px] text-muted-foreground">{t.region}</span>
          </div>

          <p className="mt-2 text-sm font-medium leading-snug">{t.title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t.customer}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <Tooltip content="НМЦК — начальная (максимальная) цена контракта." align="start">
              <span className="font-mono tabular-nums text-foreground">{rub(t.nmck)}</span>
            </Tooltip>
            <span className={`inline-flex items-center gap-1 ${urgent ? 'text-warn-foreground' : ''}`}>
              <Calendar className="size-3.5" />
              до {fmtDate(t.deadline)}
              {left && <span className="font-mono text-[10px]">· {left}</span>}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/70">ОКПД {t.okpd}</span>
            <span>{t.platform}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            size="sm"
            variant={added ? 'secondary' : 'primary'}
            disabled={added}
            onClick={() => !added && onAdd(t.id)}
          >
            {added ? <><Check className="size-4" /> Добавлено</> : <><Plus className="size-4" /> В работу</>}
          </Button>
          <a
            href={eisUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            На ЕИС <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </Card>
  );
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  const visible = pages.filter((p) => p === 1 || p === total || Math.abs(p - page) <= 1);

  return (
    <nav aria-label="Страницы результатов" className="flex items-center justify-center gap-1.5">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        aria-label="Предыдущая страница"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="size-4" />
      </button>

      {visible.reduce<(number | '…')[]>((acc, p, i, arr) => {
        if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…');
        acc.push(p);
        return acc;
      }, []).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="flex h-8 w-8 items-center justify-center text-[13px] text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            aria-label={`Страница ${p}`}
            aria-current={page === p ? 'page' : undefined}
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-[13px] transition-colors ${
              page === p ? 'border-foreground bg-secondary font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        onClick={() => onChange(Math.min(total, page + 1))}
        disabled={page === total}
        aria-label="Следующая страница"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
