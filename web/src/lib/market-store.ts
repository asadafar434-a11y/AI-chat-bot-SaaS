import type { Observation } from "@/lib/market-observations";

// Хранилище рыночных ценовых наблюдений. Интерфейс общий, чтобы обработчик и импорт проверялись без базы: в продукте — PostgreSQL (lib/market-store-db.ts, таблица PriceObservation),
// в тестах — память. Хранилище только добавляет (повтор по hash пропускается) и отдаёт кандидатов; что сопоставимо и что считать, решает код (lib/market-observations.ts).

export type Candidates = {
  unit: string;
  /** Основы слов названия: берутся записи, у которых есть хотя бы одно общее слово. */
  tokens: string[];
  /** Включительно, ГГГГ-ММ-ДД. */
  since: string;
  until: string;
  limit: number;
};

export type MarketStore = {
  ingest(items: Observation[], importedBy: string | null): Promise<{ added: number; skipped: number }>;
  candidates(input: Candidates): Promise<Observation[]>;
  count(): Promise<number>;
};

/** Хранилище в памяти: для тестов и проверки без базы. */
export function createMemoryMarketStore(): MarketStore {
  const rows = new Map<string, Observation>();
  return {
    async ingest(items) {
      let added = 0;
      for (const o of items) {
        if (rows.has(o.hash)) continue;
        rows.set(o.hash, o);
        added++;
      }
      return { added, skipped: items.length - added };
    },
    async candidates({ unit, tokens, since, until, limit }) {
      return [...rows.values()]
        .filter((o) => o.unit === unit && o.observedAt >= since && o.observedAt <= until && o.tokens.some((t) => tokens.includes(t)))
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
        .slice(0, limit);
    },
    async count() {
      return rows.size;
    },
  };
}
