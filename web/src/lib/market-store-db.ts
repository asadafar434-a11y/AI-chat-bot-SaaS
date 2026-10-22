import "server-only";
import type { BatchResult, ModelDelegate, QueryArgs } from "../server/db/db-client.ts";
import type { Observation, SourceKind } from "./market-observations.ts";
import type { Candidates, MarketStore } from "./market-store.ts";

// Наблюдения в PostgreSQL (таблица PriceObservation, миграция S15). Обращения идут через делегат Prisma; повторы отсекает уникальный hash.

type Creating = ModelDelegate & { createMany(args: QueryArgs): Promise<BatchResult> };

export type MarketDb = { priceObservation: Creating };

const BATCH = 1000;
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const fromDate = (value: unknown): string => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

type Row = Record<string, unknown>;

const observationOf = (row: Row): Observation => ({
  key: String(row.key),
  name: String(row.name),
  unit: String(row.unit),
  okpd2: (row.okpd2 as string | null) ?? null,
  tokens: (row.tokens as string[]) ?? [],
  priceNoVat: Number(row.priceNoVat),
  observedAt: fromDate(row.observedAt),
  region: (row.region as string | null) ?? null,
  quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
  source: String(row.source),
  sourceKind: row.sourceKind as SourceKind,
  hash: String(row.hash),
});

export function createDbMarketStore(db: MarketDb): MarketStore {
  return {
    async ingest(items, importedBy) {
      let added = 0;
      for (let i = 0; i < items.length; i += BATCH) {
        const data = items.slice(i, i + BATCH).map((o) => ({
          key: o.key,
          name: o.name,
          unit: o.unit,
          okpd2: o.okpd2,
          tokens: o.tokens,
          priceNoVat: o.priceNoVat,
          observedAt: toDate(o.observedAt),
          region: o.region,
          quantity: o.quantity,
          source: o.source,
          sourceKind: o.sourceKind,
          hash: o.hash,
          importedBy,
        }));
        const result = await db.priceObservation.createMany({ data, skipDuplicates: true });
        added += result.count;
      }
      return { added, skipped: items.length - added };
    },
    async candidates({ unit, tokens, since, until, limit }: Candidates) {
      if (tokens.length === 0) return [];
      const rows = await db.priceObservation.findMany({
        where: { unit, tokens: { hasSome: tokens }, observedAt: { gte: toDate(since), lte: toDate(until) } },
        orderBy: { observedAt: "desc" },
        take: limit,
      });
      return (rows as Row[]).map(observationOf);
    },
    async count() {
      return db.priceObservation.count();
    },
  };
}
