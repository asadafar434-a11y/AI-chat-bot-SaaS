import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EIS_BOOKMARKLET } from '@/lib/eis-copy-script';
import { importTenders } from '@/lib/tender-import';
import { EMPTY_FILTERS, eisOrdersUrl, searchTenders, type TenderFilters, type TenderListing, type TenderSort } from '@/lib/tender-search';
import { clearTenders, getTenders, saveTenders } from '@/lib/tender-store';
import { plural } from '@/lib/plural';
import { TenderSearch } from '../components/TenderSearch';

// «Поиск закупок» с настоящими данными: выгрузка и фильтры живут в браузере (lib/tender-store.ts), отбор — lib/tender-search.ts, чтение таблицы — lib/tender-import.ts.

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function RealTenderSearch({ onNew }: { onNew: () => void }) {
  const [listings, setListings] = useState<TenderListing[]>([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [filters, setFilters] = useState<TenderFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<TenderSort>('deadline');
  const [note, setNote] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const today = useMemo(todayIso, []);

  useEffect(() => {
    let alive = true;
    void getTenders()
      .then((saved) => {
        if (!alive || !saved) return;
        setListings(saved.listings);
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
    void saveTenders({ listings, loadedAt, filters, sort }).catch(() => {});
  }, [ready, listings, loadedAt, filters, sort]);

  const onImport = useCallback((text: string) => {
    const r = importTenders(text);
    if (r.error) {
      setNote({ tone: 'danger', text: r.error });
      return;
    }
    if (r.listings.length === 0) {
      setNote({ tone: 'danger', text: 'Закупок в таблице не нашёл.' });
      return;
    }
    // Новая выгрузка дополняет прежнюю: та же закупка обновляется, новые добавляются.
    setListings((prev) => {
      const map = new Map(prev.map((l) => [l.id, l]));
      for (const l of r.listings) map.set(l.id, l);
      return Array.from(map.values());
    });
    setLoadedAt(new Date().toISOString());
    const bits = [`Загружено: ${r.listings.length} ${plural(r.listings.length, 'закупка', 'закупки', 'закупок')}.`];
    if (r.skipped.length > 0) bits.push(`Пропущено строк: ${r.skipped.length}.`);
    if (r.truncated > 0) bits.push(`Лишние ${r.truncated} не взяты: предел выгрузки.`);
    setNote({ tone: 'info', text: bits.join(' ') });
  }, []);

  const result = useMemo(() => searchTenders(listings, filters, sort, today), [listings, filters, sort, today]);

  return (
    <TenderSearch
      filters={filters}
      onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      sort={sort}
      onSort={setSort}
      result={result}
      loadedAt={loadedAt}
      today={today}
      eisUrl={eisOrdersUrl(filters, today)}
      bookmarklet={EIS_BOOKMARKLET}
      onImport={onImport}
      importNote={note}
      onClear={() => {
        setListings([]);
        setLoadedAt('');
        setNote(null);
        void clearTenders().catch(() => {});
      }}
      onNew={onNew}
    />
  );
}
