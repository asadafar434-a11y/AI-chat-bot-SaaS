import { useEffect, useMemo, useRef, useState } from 'react';
import type { FindingLine } from '@/lib/analytics-summary';
import { getPrices, savePrices } from '@/lib/analytics-store';
import { positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { liveToLite, marketLines, marketRequestOf, withMarketAnalogs, type MarketResultLite } from '@/lib/market-merge';
import { findCustomerPriceTable } from '@/lib/customer-price-table';
import { missingSpecNote, positionPrices, priceLines } from '@/lib/position-prices';
import { isFresh, mergeRetry, nextRetryAt, priceSearchFinding, retryKeys, shouldSearch, signatureOf, type PriceState, type SavedPrices } from '@/lib/price-cache';
import { dropImplausible, tableBounds, withTablePrices } from '@/lib/price-compare';
import { expandSaved, planSearch } from '@/lib/price-families';
import { serverReadsEnabled } from '@/lib/server-reads';
import { useAiEnabled } from '../lib/use-ai-mode';
import { MAX_SEARCH_POSITIONS, searchLivePrices } from './market-search';

// Расчёт цены относительно рынка под капотом, без ввода и кнопок участника (решения владельца 22.10.2026: «аналитика сама ищет в интернете; цены всегда по факту; рынок — закупочная цена»):
//  1) позиции берутся из бланка заказчика «Спецификация» (если участник свои не вводил);
//  2) к ним добавляются сопоставимые цены из общей базы цен (/api/market) — если она есть и в ней что-то лежит;
//  3) при разборе закупки сама ищется живая закупочная цена в интернете по самым крупным позициям (/api/prices, платная модель под бюджетом ИИ на закупку): результат с датой хранится у закупки,
//     годен неделю, потом ищется заново; ИИ выключен (переключатель «ИИ вкл/выкл») — не ищется вовсе.
// Цены базы и найденные живьём живут только в памяти на время расчёта — в расчёт закупки они не записываются. Нет базы, поиск не ответил, ИИ выключен — расчёт остаётся прежним, без ошибок на экране.

type Doc = { name: string; text: string };

let counter = 0;
const newId = () => `live-${++counter}`;

export function useMarketBase(data: RicData | null, docs: Doc[], region: string | null, purchaseId: string) {
  const [aiOn] = useAiEnabled();
  // Таблица обоснования цены у заказчика: цена за единицу у позиций без своей — поиск в интернете начинается с самых дорогих видов товара, на экране видно отличие от закупки.
  const table = useMemo(() => findCustomerPriceTable(docs), [docs]);
  const withPositions = useMemo(() => {
    if (!data) return null;
    const own = data.positions.length > 0 ? data.positions : (positionsFromDocuments(docs)?.positions ?? []);
    return own.length > 0 ? { ...data, positions: withTablePrices(own, table) } : data;
  }, [data, docs, table]);

  // ——— База цен (если есть) ———
  const request = useMemo(() => (withPositions && withPositions.positions.length > 0 ? marketRequestOf(withPositions, region) : null), [withPositions, region]);
  const requestKey = request ? JSON.stringify(request) : '';
  const [market, setMarket] = useState<MarketResultLite[]>([]);

  useEffect(() => {
    if (!request || request.positions.length === 0 || !serverReadsEnabled()) {
      setMarket([]);
      return;
    }
    let alive = true;
    fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      .then((res) => (res.ok ? (res.json() as Promise<{ results?: MarketResultLite[] }>) : null))
      .then((json) => alive && setMarket(Array.isArray(json?.results) ? json.results : []))
      .catch(() => alive && setMarket([]));
    return () => {
      alive = false;
    };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ——— Живой поиск закупочных цен в интернете ———
  // Ищем по виду товара (Стол, Кресло), а не по каждой позиции: найденное достаётся всем позициям вида (lib/price-families.ts).
  const plan = useMemo(() => (withPositions ? planSearch(withPositions.positions, MAX_SEARCH_POSITIONS) : null), [withPositions]);
  // Поиск в интернете идёт всегда, и когда у заказчика есть таблица цен поставщиков: цены сравниваются (владелец, 29.10.2026: «поиск в интернете нужен обязательно! и сопоставление цен»).
  const picks = useMemo(() => plan?.picks ?? [], [plan]);
  const signature = useMemo(() => signatureOf(picks), [picks]);
  // undefined — сохранённое ещё читается; null — у закупки пока ничего нет.
  const [saved, setSaved] = useState<SavedPrices | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let alive = true;
    getPrices(purchaseId).then(
      (v) => alive && setSaved(v ?? null),
      () => alive && setSaved(null),
    );
    return () => {
      alive = false;
    };
  }, [purchaseId]);

  useEffect(() => {
    if (saved === undefined || picks.length === 0 || !aiOn || running.current) return;
    if (!shouldSearch(saved, signature, new Date())) return;
    running.current = true;
    setSearching(true);
    void (async () => {
      const next = await searchLivePrices(purchaseId, picks, region, signature);
      setSaved(next);
      void savePrices(purchaseId, next).catch(() => undefined);
      running.current = false;
      setSearching(false);
    })();
  }, [saved, signature, aiOn, purchaseId, region]); // eslint-disable-line react-hooks/exhaustive-deps

  // Повтор поиска по позициям, по которым он ничего не вернул (бесплатный поиск часто блокирует запрос): через десять минут, не больше трёх попыток; найденные цены не трогаются (lib/price-cache.ts, mergeRetry).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!saved || picks.length === 0 || !aiOn || running.current || saved.signature !== signature) return;
    const now = new Date();
    const keys = retryKeys(saved, now);
    if (keys.length === 0) {
      const due = nextRetryAt(saved, now);
      if (due === null) return;
      const timer = setTimeout(() => setTick((n) => n + 1), Math.max(1000, due - now.getTime()));
      return () => clearTimeout(timer);
    }
    running.current = true;
    void (async () => {
      const fresh = await searchLivePrices(purchaseId, picks.filter((p) => keys.includes(p.id)), region, signature);
      const merged = mergeRetry(saved, fresh, keys, new Date().toISOString());
      setSaved(merged);
      void savePrices(purchaseId, merged).catch(() => undefined);
      running.current = false;
    })();
  }, [saved, signature, aiOn, purchaseId, region, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toISOString().slice(0, 10);
  // Сохранено по представителям видов; для расчёта и экрана — по позициям.
  // Цены из интернета в 3 раза ниже или выше цен поставщиков заказчика — не тот товар: в расчёт и сравнение не идут (lib/price-compare.ts, dropImplausible).
  const bounds = useMemo(() => (withPositions ? tableBounds(withPositions.positions, table) : new Map()), [withPositions, table]);
  const vatFactor = withPositions?.settings.nmckVat === 'with' ? 1 + withPositions.settings.vatRate / 100 : 1;
  const checked = useMemo(() => {
    const expanded = plan ? expandSaved(saved, plan) : saved;
    return expanded && bounds.size > 0 ? dropImplausible(expanded, bounds, vatFactor) : expanded ? { ...expanded, dropped: 0 } : expanded;
  }, [saved, plan, bounds, vatFactor]);
  const savedByPosition = checked;
  const live = useMemo(() => (withPositions && isFresh(saved, new Date()) && savedByPosition ? liveToLite(withPositions.positions, savedByPosition.results, today, newId) : []), [withPositions, saved, savedByPosition, today]);

  const effective = useMemo(() => (withPositions ? withMarketAnalogs(withMarketAnalogs(withPositions, market), live) : null), [withPositions, market, live]);
  const state: PriceState = picks.length === 0 ? 'no-positions' : isFresh(saved, new Date()) ? 'done' : !aiOn ? 'off' : searching || saved === undefined ? 'searching' : saved?.error ? 'failed' : 'searching';
  // Заказчик пишет, что список товаров — в отдельном файле технических требований, а файла в закупке нет: об этом говорит строка «Закупочные цены» и рейтинг.
  const specNote = useMemo(() => (picks.length === 0 ? missingSpecNote(docs) : null), [picks.length, docs]);
  // Товары закупки с найденными закупочными ценами — для блока «Товары и закупочные цены»; нет цен — блок не рисуется.
  const prices = useMemo(() => (withPositions ? positionPrices(withPositions, savedByPosition, plan?.searchedIds ?? [], state, today) : null), [withPositions, savedByPosition, plan, state, today]);
  // Найденные цены строками — для подписи внизу и подсказки бейджа; даже одна цена называется целиком (владелец, 23.10.2026: «если только одна цена — всё равно показывай»).
  const found = useMemo(() => (prices ? priceLines(prices) : []), [prices]);
  const lines = useMemo(() => [...(withPositions ? marketLines(withPositions, market) : []), ...found], [withPositions, market, found]);
  const finding: FindingLine = priceSearchFinding({ state, saved, note: state === 'no-positions' ? (specNote ?? `проверила все файлы (${docs.length}): таблицы товаров с количеством нет — искать цены не по чему`) : saved?.error, highlights: found });
  return { data: effective, lines, finding, prices, positionsTotal: withPositions?.positions.length ?? 0, specNote, dropped: checked?.dropped ?? 0 };
}
