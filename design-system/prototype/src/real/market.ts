import { useEffect, useMemo, useRef, useState } from 'react';
import type { FindingLine } from '@/lib/analytics-summary';
import { getPrices, savePrices } from '@/lib/analytics-store';
import { errorMessage, errorText } from '@/lib/http-error';
import { parseAmount, positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { liveToLite, marketLines, marketRequestOf, withMarketAnalogs, type MarketResultLite } from '@/lib/market-merge';
import { positionPrices } from '@/lib/position-prices';
import { isFresh, normalizePrices, pickPositions, priceSearchFinding, shouldSearch, signatureOf, type PriceState, type SavedPrices } from '@/lib/price-cache';
import { aiHeaders } from '@/lib/purchase';
import { serverReadsEnabled } from '@/lib/server-reads';
import { useAiEnabled } from '../lib/use-ai-mode';

// Расчёт цены относительно рынка под капотом, без ввода и кнопок участника (решения владельца 22.10.2026: «аналитика сама ищет в интернете; цены всегда по факту; рынок — закупочная цена»):
//  1) позиции берутся из бланка заказчика «Спецификация» (если участник свои не вводил);
//  2) к ним добавляются сопоставимые цены из общей базы цен (/api/market) — если она есть и в ней что-то лежит;
//  3) при разборе закупки сама ищется живая закупочная цена в интернете по самым крупным позициям (/api/prices, платная модель под бюджетом ИИ на закупку): результат с датой хранится у закупки,
//     годен неделю, потом ищется заново; ИИ выключен (переключатель «ИИ вкл/выкл») — не ищется вовсе.
// Цены базы и найденные живьём живут только в памяти на время расчёта — в расчёт закупки они не записываются. Нет базы, поиск не ответил, ИИ выключен — расчёт остаётся прежним, без ошибок на экране.

type Doc = { name: string; text: string };

const MAX_SEARCH_POSITIONS = 3;
let counter = 0;
const newId = () => `live-${++counter}`;

export function useMarketBase(data: RicData | null, docs: Doc[], region: string | null, purchaseId: string) {
  const [aiOn] = useAiEnabled();
  const withPositions = useMemo(() => {
    if (!data) return null;
    if (data.positions.length > 0) return data;
    const found = positionsFromDocuments(docs);
    return found && found.positions.length > 0 ? { ...data, positions: found.positions } : data;
  }, [data, docs]);

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
  const picks = useMemo(() => (withPositions ? pickPositions(withPositions.positions, MAX_SEARCH_POSITIONS) : []), [withPositions]);
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
      let next: SavedPrices;
      const at = new Date().toISOString();
      try {
        const res = await fetch('/api/prices', {
          method: 'POST',
          headers: aiHeaders(purchaseId),
          body: JSON.stringify({ positions: picks.map((p) => ({ key: p.id, name: p.name, unit: p.unit, ...(parseAmount(p.qty) ? { quantity: parseAmount(p.qty) } : {}), ...(region ? { region } : {}) })) }),
        });
        if (!res.ok) throw new Error(await errorText(res, 'Поиск цен сейчас недоступен.'));
        const json = (await res.json()) as { results?: unknown; spentRub?: unknown; searchErrors?: unknown };
        const parsed = normalizePrices({ at, signature, results: json.results, spentRub: json.spentRub });
        const found = parsed?.results.some((r) => r.observations.length > 0) ?? false;
        const errors = Array.isArray(json.searchErrors) ? json.searchErrors.filter((e): e is string => typeof e === 'string') : [];
        // Поиск не ответил и ничего не нашлось — это неудача (повторим через час), а не «цен нет».
        next = { at, signature, results: parsed?.results ?? [], spentRub: parsed?.spentRub ?? 0, ...(!found && errors.length > 0 && { error: errors.join('; ') }) };
      } catch (e) {
        next = { at, signature, results: [], spentRub: 0, error: errorMessage(e) };
      }
      setSaved(next);
      void savePrices(purchaseId, next).catch(() => undefined);
      running.current = false;
      setSearching(false);
    })();
  }, [saved, signature, aiOn, purchaseId, region]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toISOString().slice(0, 10);
  const live = useMemo(() => (withPositions && isFresh(saved, new Date()) && saved ? liveToLite(withPositions.positions, saved.results, today, newId) : []), [withPositions, saved, today]);

  const effective = useMemo(() => (withPositions ? withMarketAnalogs(withMarketAnalogs(withPositions, market), live) : null), [withPositions, market, live]);
  const lines = useMemo(() => (withPositions ? marketLines(withPositions, [...market, ...live]) : []), [withPositions, market, live]);

  const state: PriceState = picks.length === 0 ? 'no-positions' : isFresh(saved, new Date()) ? 'done' : !aiOn ? 'off' : searching || saved === undefined ? 'searching' : saved?.error ? 'failed' : 'searching';
  const liveLines = useMemo(() => (withPositions ? marketLines(withPositions, live) : []), [withPositions, live]);
  const finding: FindingLine = priceSearchFinding({ state, saved, note: saved?.error, highlights: liveLines });
  // Товары закупки с найденными закупочными ценами — для блока «Товары и закупочные цены»; нет цен — блок не рисуется.
  const prices = useMemo(() => (withPositions ? positionPrices(withPositions, saved, picks.map((p) => p.id), state, today) : null), [withPositions, saved, picks, state, today]);
  return { data: effective, lines, finding, prices, positionsTotal: withPositions?.positions.length ?? 0 };
}
