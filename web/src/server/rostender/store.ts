import "server-only";
import { CARD_REV } from "@/lib/rostender";
import { normalizeListing } from "@/lib/tender-normalize";
import type { TenderListing } from "@/lib/tender-search";
import type { BatchResult, ModelDelegate, QueryArgs } from "@/server/db/db-client";

// Закупки «Поиска закупок» в базе (таблица Tender, миграция S18): общий список для всех пользователей. Его раз в сутки обновляет сервер из Ростендера (sync.ts):
// новые закупки добавляются карточкой с документами (ссылками), закончившиеся по сроку удаляются. Одна закупка — одна строка; повторная запись обновляет карточку.

type Upserting = ModelDelegate & { upsert(args: QueryArgs): Promise<unknown> };
export type TenderDb = { tender: Upserting };

export type TenderList = {
  listings: TenderListing[];
  /** Сколько действующих закупок всего (может быть больше, чем вернули). */
  total: number;
  /** Когда сервер последний раз обновлял список (ISO); null — ещё ни разу. */
  updatedAt: string | null;
};

export type TenderStore = {
  /** Номера Ростендера у закупок, которые уже в базе: `fresh` — карточка с актуальным набором полей, `stale` — загружена раньше, полей меньше. */
  known(): Promise<{ fresh: Set<string>; stale: Set<string> }>;
  /** Сохранить или обновить закупки; возвращает, сколько принято (испорченные и без номера отбрасываются). */
  save(listings: unknown[]): Promise<number>;
  /** Отметить, что закупки снова видны в списках Ростендера. */
  touch(externalIds: string[]): Promise<void>;
  /** Убрать закупки, у которых срок подачи заявок вышел раньше этого дня (ГГГГ-ММ-ДД). */
  expire(today: string): Promise<number>;
  /** Действующие закупки: срок не вышел или не назван; сначала те, где срок ближе. */
  list(today: string, limit: number): Promise<TenderList>;
  /** Когда было последнее обновление списка. */
  lastSyncAt(): Promise<Date | null>;
};

const ID_MAX = 60;
const dayOf = (iso: string | null): Date | null => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00.000Z`) : null);

export function createTenderStore(db: TenderDb): TenderStore {
  const active = (today: string): QueryArgs => ({ OR: [{ deadline: null }, { deadline: { gte: dayOf(today) } }] });
  return {
    async known() {
      const rows = (await db.tender.findMany({ where: { source: "rostender", externalId: { not: null } }, select: { externalId: true, rev: true } })) as { externalId: string | null; rev: number }[];
      const fresh = new Set<string>();
      const stale = new Set<string>();
      for (const r of rows) if (r.externalId) (r.rev >= CARD_REV ? fresh : stale).add(r.externalId);
      return { fresh, stale };
    },
    async save(listings) {
      let saved = 0;
      for (const raw of listings) {
        const listing = normalizeListing(raw);
        if (!listing || listing.id.length > ID_MAX) continue;
        const data = JSON.parse(JSON.stringify(listing)) as Record<string, unknown>;
        const source = listing.source ?? "other";
        const fields = { source, externalId: listing.rostenderId ?? null, deadline: dayOf(listing.deadline), data, rev: listing.rev ?? 1, lastSeenAt: new Date() };
        await db.tender.upsert({ where: { tenderId: listing.id }, create: { tenderId: listing.id, ...fields }, update: fields });
        saved++;
      }
      return saved;
    },
    async touch(externalIds) {
      if (externalIds.length === 0) return;
      await db.tender.updateMany({ where: { source: "rostender", externalId: { in: externalIds } }, data: { lastSeenAt: new Date() } });
    },
    async expire(today) {
      const r: BatchResult = await db.tender.deleteMany({ where: { deadline: { lt: dayOf(today) } } });
      return r.count;
    },
    async list(today, limit) {
      const where = active(today);
      const [rows, total, last] = await Promise.all([
        db.tender.findMany({ where, orderBy: [{ deadline: "asc" }, { updatedAt: "desc" }], take: limit }) as Promise<{ data: unknown }[]>,
        db.tender.count({ where }),
        db.tender.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }) as Promise<{ lastSeenAt: Date } | null>,
      ]);
      return { listings: rows.flatMap((r) => normalizeListing(r.data) ?? []), total, updatedAt: last ? last.lastSeenAt.toISOString() : null };
    },
    async lastSyncAt() {
      const last = (await db.tender.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } })) as { lastSeenAt: Date } | null;
      return last ? last.lastSeenAt : null;
    },
  };
}
