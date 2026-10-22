import { useEffect, useMemo, useState } from 'react';
import { positionsFromDocuments, type RicData } from '@/lib/indicative-price';
import { marketLines, marketRequestOf, withMarketAnalogs, type MarketResultLite } from '@/lib/market-merge';
import { serverReadsEnabled } from '@/lib/server-reads';

// Расчёт цены относительно рынка под капотом, без ввода участника: позиции берутся из бланка заказчика «Спецификация» (если участник свои не вводил),
// а к ним добавляются сопоставимые цены из общей базы цен (/api/market). Цены базы живут только в памяти на время расчёта — в закупку они не записываются.
// Базы нет (закупки лежат в браузере, на сервере нет таблицы), она пуста или недоступна — расчёт остаётся прежним, без ошибок на экране.

type Doc = { name: string; text: string };

export function useMarketBase(data: RicData | null, docs: Doc[], region: string | null) {
  const withPositions = useMemo(() => {
    if (!data) return null;
    if (data.positions.length > 0) return data;
    const found = positionsFromDocuments(docs);
    return found && found.positions.length > 0 ? { ...data, positions: found.positions } : data;
  }, [data, docs]);

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

  const effective = useMemo(() => (withPositions ? withMarketAnalogs(withPositions, market) : null), [withPositions, market]);
  const lines = useMemo(() => (withPositions ? marketLines(withPositions, market) : []), [withPositions, market]);
  return { data: effective, lines };
}
