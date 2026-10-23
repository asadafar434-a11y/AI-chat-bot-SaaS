import { errorMessage, errorText } from '@/lib/http-error';
import { parseAmount, type RicPosition } from '@/lib/indicative-price';
import { normalizePrices, type SavedPrices } from '@/lib/price-cache';
import { aiHeaders } from '@/lib/purchase';

// Один поиск закупочных цен в интернете по главным позициям закупки (/api/prices, платная модель под бюджетом ИИ на закупку): общий для кнопки «Открыть аналитику» (цены находятся до открытия экрана)
// и для экрана закупки (поиск при открытии, если цен ещё нет или они старше недели). Запрос идёт через aiHeaders: выключенный переключатель «ИИ» его не пускает.
// Никогда не бросает ошибку: неудача возвращается записью с причиной (повтор не раньше чем через час — lib/price-cache.ts).
// По скольким самым крупным позициям ищем цены (остальные не ищутся: каждая позиция — несколько платных вызовов модели).
export const MAX_SEARCH_POSITIONS = 3;

export async function searchLivePrices(purchaseId: string, picks: RicPosition[], region: string | null, signature: string): Promise<SavedPrices> {
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
    return { at, signature, results: parsed?.results ?? [], spentRub: parsed?.spentRub ?? 0, ...(!found && errors.length > 0 && { error: errors.join('; ') }) };
  } catch (e) {
    return { at, signature, results: [], spentRub: 0, error: errorMessage(e) };
  }
}
