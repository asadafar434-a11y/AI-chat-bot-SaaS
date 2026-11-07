import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EIS_BOOKMARKLET } from '@/lib/eis-copy-script';
import { extensionVersion, searchViaExtension } from '@/lib/eis-extension';
import { importTenders } from '@/lib/tender-import';
import { EMPTY_FILTERS, eisOrdersUrl, facetsOf, searchTenders, type TenderFilters, type TenderListing, type TenderSort } from '@/lib/tender-search';
import { clearTenders, getTenders, saveTenders } from '@/lib/tender-store';
import { plural } from '@/lib/plural';
import { TenderSearch, type RostenderUi } from '../components/TenderSearch';
import { useFavorites } from './favorites';

// «Поиск закупок» с настоящими данными: выгрузка и фильтры живут в браузере (lib/tender-store.ts), отбор — lib/tender-search.ts, чтение таблицы — lib/tender-import.ts.

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type ServerList = { configured: boolean; listings: TenderListing[]; total: number; updatedAt: string | null };

// Список закупок с нашего сервера (/api/rostender, действие list): его раз в сутки сам обновляет сервер, ключ Ростендера сюда не приходит.
async function serverList(): Promise<ServerList | null> {
  try {
    const res = await fetch('/api/rostender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ServerList>;
    return { configured: body.configured === true, listings: Array.isArray(body.listings) ? body.listings : [], total: typeof body.total === 'number' ? body.total : 0, updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null };
  } catch {
    return null;
  }
}

export function RealTenderSearch({ onNew }: { onNew: () => void }) {
  const [listings, setListings] = useState<TenderListing[]>([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [filters, setFilters] = useState<TenderFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<TenderSort>('deadline');
  const [note, setNote] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  // Расширение Chrome ставит атрибут на <html> при загрузке страницы; проверяем сразу и ещё раз чуть позже (скрипт расширения мог отстать от первой отрисовки).
  const [extension, setExtension] = useState<string | null>(() => extensionVersion());
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (extension) return;
    const t = window.setTimeout(() => setExtension(extensionVersion()), 1500);
    return () => window.clearTimeout(t);
  }, [extension]);
  const today = useMemo(todayIso, []);
  const fav = useFavorites();

  // Закупки сервера: при открытии экрана читаем общий список из базы. Не получилось (нет входа, сервер недоступен) — остальной поиск работает как раньше.
  const [server, setServer] = useState<ServerList | null>(null);
  useEffect(() => {
    let alive = true;
    void serverList().then((r) => alive && setServer(r));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getTenders()
      .then((saved) => {
        if (!alive || !saved) return;
        // Закупки сервера в браузере не храним — они приходят свежими с сервера; здесь остаётся только выгрузка из ЕИС.
        setListings(saved.listings.filter((l) => l.source !== 'rostender'));
        setLoadedAt(saved.loadedAt);
        setFilters(saved.filters);
        setSort(saved.sort);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Сохраняем при каждом изменении, но только после первого чтения, чтобы не затереть сохранённое пустым.
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    void saveTenders({ listings: listings.filter((l) => l.source !== 'rostender'), loadedAt, filters, sort }).catch(() => {});
  }, [ready, listings, loadedAt, filters, sort]);

  const onImport = useCallback((text: string, replace = false) => {
    const r = importTenders(text);
    if (r.error) {
      setNote({ tone: 'danger', text: r.error });
      return;
    }
    if (r.listings.length === 0) {
      setNote({ tone: 'danger', text: 'Закупок в таблице не нашёл.' });
      return;
    }
    // Вставка из закладки дополняет прежнюю выгрузку: та же закупка обновляется, новые добавляются. Поиск через расширение заменяет её результатом этого поиска.
    setListings((prev) => {
      const map = new Map((replace ? [] : prev).map((l) => [l.id, l]));
      for (const l of r.listings) map.set(l.id, l);
      return Array.from(map.values());
    });
    setLoadedAt(new Date().toISOString());
    const bits = [`Загружено: ${r.listings.length} ${plural(r.listings.length, 'закупка', 'закупки', 'закупок')}.`];
    if (r.skipped.length > 0) bits.push(`Пропущено строк: ${r.skipped.length}.`);
    if (r.truncated > 0) bits.push(`Лишние ${r.truncated} не взяты: предел выгрузки.`);
    setNote({ tone: 'info', text: bits.join(' ') });
  }, []);

  const eisUrl = eisOrdersUrl(filters, today);
  const runExtensionSearch = useCallback(async () => {
    setSearching(true);
    setNote(null);
    try {
      const r = await searchViaExtension(eisUrl, 3);
      if (r.count === 0) {
        setListings([]);
        setLoadedAt(new Date().toISOString());
        setNote({ tone: 'info', text: 'В ЕИС по этим фильтрам ничего не найдено.' });
      } else {
        onImport(r.tsv, true);
      }
    } catch (e) {
      setNote({ tone: 'danger', text: e instanceof Error ? e.message : 'Поиск через расширение не удался.' });
    } finally {
      setSearching(false);
    }
  }, [eisUrl, onImport]);

  // Всё, что показываем: закупки сервера и выгрузка из ЕИС (если она есть в браузере). Та же закупка с сервера важнее.
  const all = useMemo(() => {
    const own = server?.listings ?? [];
    const ids = new Set(own.map((l) => l.id));
    return [...own, ...listings.filter((l) => !ids.has(l.id))];
  }, [server, listings]);

  // Сколько места занимают закупки сервера: карточки — текст в базе, документы — размеры файлов из карточек (сами файлы не хранятся).
  const totals = useMemo(() => {
    const own = server?.listings ?? [];
    const docs = own.flatMap((l) => l.docs ?? []);
    return {
      cards: own.length,
      cardsBytes: new TextEncoder().encode(JSON.stringify(own)).length,
      docs: docs.length,
      docsBytes: docs.reduce((sum, d) => sum + (d.size ?? 0), 0),
      docsNoSize: docs.filter((d) => d.size === null).length,
    };
  }, [server]);
  const rostender: RostenderUi | undefined = server ? { configured: server.configured, updatedAt: server.updatedAt, total: server.total, totals } : undefined;

  const result = useMemo(() => searchTenders(all, filters, sort, today), [all, filters, sort, today]);
  const facets = useMemo(() => facetsOf(all), [all]);
  const hasRostender = useMemo(() => all.some((l) => l.source === 'rostender'), [all]);

  return (
    <TenderSearch
      filters={filters}
      onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      sort={sort}
      onSort={setSort}
      result={result}
      loadedAt={loadedAt}
      today={today}
      eisUrl={eisUrl}
      extension={{ available: extension !== null, busy: searching, onSearch: () => void runExtensionSearch() }}
      bookmarklet={EIS_BOOKMARKLET}
      onImport={onImport}
      importNote={note}
      onClear={
        listings.length === 0
          ? undefined
          : () => {
              setListings([]);
              setLoadedAt('');
              setNote(null);
              void clearTenders().catch(() => {});
            }
      }
      onNew={onNew}
      facets={facets}
      hasRostender={hasRostender}
      rostender={rostender}
      favorites={{ has: fav.has, toggle: fav.toggle }}
    />
  );
}
