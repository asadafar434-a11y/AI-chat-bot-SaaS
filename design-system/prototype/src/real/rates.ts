import { useEffect, useMemo, useRef, useState } from 'react';
import { getRates, saveRates } from '@/lib/analytics-store';
import { crewCost, type CrewCost } from '@/lib/crew-cost';
import { errorMessage, errorText } from '@/lib/http-error';
import { mergeRates, normalizeRates, pendingItems, RATE_RETRY_AFTER_MS, rateItems, ratesFresh, ratesSignature, type RateResult, type SavedRates } from '@/lib/rate-cache';
import { MAX_RATE_ITEMS, type RateItem } from '@/lib/rates-request';
import { findResourceNeed, type ResourceNeed } from '@/lib/resource-need';
import { aiHeaders } from '@/lib/purchase';
import { useAiEnabled } from '../lib/use-ai-mode';

// Себестоимость по составу работ под капотом, без ввода и кнопок (владелец, 27.10.2026: «расценку работ и зарплаты ищи в интернете, и это везде ко всем тендерам»):
//  1) из документов берётся состав: должности и сколько человек, техника и сколько единиц, срок (lib/resource-need.ts, бесплатно, без ИИ);
//  2) при включённом «ИИ» зарплаты и аренда ищутся в интернете порциями по четыре позиции (/api/rates, платная модель под бюджетом ИИ на закупку и потолком на порцию), найденное с датой хранится у закупки две недели;
//  3) из найденного считается себестоимость за месяц, за срок и за единицу объёма (lib/crew-cost.ts); чего не нашли, то названо. ИИ выключен — ничего не ищется, состав виден.

type Doc = { name: string; text: string };

/** Одна порция поиска: ничего не бросает, неудача — текст ошибки. */
export async function searchLiveRates(purchaseId: string, items: RateItem[]): Promise<{ results: RateResult[]; spentRub: number } | { error: string }> {
  try {
    const res = await fetch('/api/rates', { method: 'POST', headers: aiHeaders(purchaseId), body: JSON.stringify({ items }) });
    if (!res.ok) return { error: await errorText(res, 'Поиск зарплат сейчас недоступен.') };
    const json = (await res.json()) as { results?: unknown; spentRub?: unknown; searchErrors?: unknown };
    const parsed = normalizeRates({ at: new Date().toISOString(), signature: '', results: json.results, spentRub: json.spentRub });
    const errors = Array.isArray(json.searchErrors) ? json.searchErrors.filter((e): e is string => typeof e === 'string') : [];
    const found = parsed?.results.some((r) => r.observations.length > 0) ?? false;
    if (!found && errors.length > 0 && (parsed?.results.every((r) => r.pagesSeen === 0) ?? true)) return { error: errors.join('; ') };
    return { results: parsed?.results ?? [], spentRub: parsed?.spentRub ?? 0 };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export type CrewState = 'none' | 'off' | 'searching' | 'done' | 'failed';

export function useCrewCost(purchaseId: string, docs: Doc[], region: string | null, volumeTotal: number | null) {
  const [aiOn] = useAiEnabled();
  const need: ResourceNeed | null = useMemo(() => findResourceNeed(docs), [docs]);
  const items = useMemo(() => (need ? rateItems(need, region) : []), [need, region]);
  const signature = useMemo(() => ratesSignature(items), [items]);
  // undefined — сохранённое ещё читается; null — у закупки пока ничего нет.
  const [saved, setSaved] = useState<SavedRates | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    getRates(purchaseId).then(
      (v) => alive && setSaved(v ?? null),
      () => alive && setSaved(null),
    );
    return () => {
      alive = false;
    };
  }, [purchaseId]);

  useEffect(() => {
    if (saved === undefined || items.length === 0 || !aiOn || running.current) return;
    const todo = pendingItems(items, saved, new Date());
    if (todo.length === 0) {
      // Молчавший поиск повторится через десять минут: тик разбудит этот эффект.
      const timer = setTimeout(() => setTick((n) => n + 1), RATE_RETRY_AFTER_MS + 1000);
      return () => clearTimeout(timer);
    }
    running.current = true;
    setSearching(true);
    setError(null);
    void (async () => {
      let current = saved;
      for (let from = 0; from < todo.length; from += MAX_RATE_ITEMS) {
        const out = await searchLiveRates(purchaseId, todo.slice(from, from + MAX_RATE_ITEMS));
        if ('error' in out) {
          setError(out.error);
          // Поиск не ответил или отказал: повтор через десять минут, а не по кругу.
          setTimeout(() => setTick((n) => n + 1), RATE_RETRY_AFTER_MS);
          break;
        }
        // Найденное сохраняется после каждой порции: закрыли экран — не потеряется.
        current = mergeRates(current, out.results, signature, out.spentRub, new Date().toISOString());
        setSaved(current);
        void saveRates(purchaseId, current).catch(() => undefined);
      }
      running.current = false;
      setSearching(false);
    })();
  }, [saved, items, signature, aiOn, purchaseId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const usable = saved && saved.signature === signature && ratesFresh(saved, new Date()) ? saved : null;
  const cost: CrewCost | null = useMemo(() => (need ? crewCost({ need, saved: usable, volumeTotal }) : null), [need, usable, volumeTotal]);
  const state: CrewState = !need ? 'none' : searching || saved === undefined ? 'searching' : error && !usable ? 'failed' : !aiOn && !usable ? 'off' : 'done';
  return { need, cost, state, saved: usable, error, aiOn };
}
