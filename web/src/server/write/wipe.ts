/**
 * P1: «Удалить все мои данные» на сервере.
 *
 * Контракт (data-model.md §7):
 * - данные tenant-скоупированы и удаление аудируется (S7);
 * - полное стирание данных организации — только `owner`;
 * - участник (`member`) удаляет только свои персональные данные, не трогая общие
 *   данные организации;
 * - удаление никогда не выходит за пределы организации вызывающего и не удаляет
 *   журнал аудита (append-only), членство, приглашения и учёт переноса.
 *
 * Сервер — источник истины: клиент после успешного ответа очищает локальное
 * зеркало IndexedDB, но не наоборот.
 */

import { auditEvent } from "../audit/service.ts";
import { NotFoundInScopeError } from "../db/errors.ts";
import { findMembership, orgRepositories } from "../db/repositories/index.ts";
import { deleteRowObjects } from "../storage/objects.ts";
import type { WriteContext } from "./services.ts";

type Row = Record<string, unknown>;

export type WipeScope = "organization" | "user";

export type WipeResult = {
  scope: WipeScope;
  purchases: number;
  documents: number;
  samples: number;
  facts: number;
  organizationProfile: boolean;
  personalProfile: boolean;
};

/**
 * Удаляет данные в пределах организации вызывающего. Выполняется в одной транзакции:
 * либо состояние согласовано, либо не изменено. Объекты S6 удаляются до строк, чтобы
 * не оставалось «строк без объекта» (сироты-объекты безопасны и убираются сверкой S8).
 */
export async function wipeTenantData(ctx: WriteContext): Promise<WipeResult> {
  return ctx.run(async (db) => {
    const membership = await findMembership(db, ctx.scope, ctx.userId);
    if (!membership) {
      throw new NotFoundInScopeError("write.wipeTenantData");
    }
    const isOwner = membership.role === "owner";
    const repos = orgRepositories(db, ctx.scope);

    // Персональные данные вызывающего удаляются всегда: профиль человека и его настройки.
    const personal = await db.userProfile.deleteMany({ where: { userId: ctx.userId } });
    await db.user.updateMany({ where: { id: ctx.userId }, data: { preferences: {} } });

    let purchases = 0;
    let documents = 0;
    let samples = 0;
    let facts = 0;
    let organizationProfile = false;

    if (isOwner) {
      // Документы и образцы — вместе с объектами S6, до удаления ссылающихся строк.
      const documentRows = (await repos.document.list()) as Row[];
      for (const row of documentRows) {
        await deleteRowObjects(ctx.storage, row);
        await repos.document.remove(row.id as string);
        documents += 1;
      }
      const sampleRows = (await repos.sample.list()) as Row[];
      for (const row of sampleRows) {
        await deleteRowObjects(ctx.storage, row);
        await repos.sample.remove(row.id as string);
        samples += 1;
      }
      const purchaseRows = (await repos.purchase.list()) as Row[];
      for (const row of purchaseRows) {
        await repos.purchase.remove(row.id as string);
        purchases += 1;
      }
      const factRows = (await repos.fact.list()) as Row[];
      for (const row of factRows) {
        await repos.fact.remove(row.id as string);
        facts += 1;
      }
      const profileRows = (await repos.organizationProfile.list()) as Row[];
      for (const row of profileRows) {
        await repos.organizationProfile.remove(row.id as string);
        organizationProfile = true;
      }
    }

    await auditEvent(db, ctx.scope, {
      actorUserId: ctx.userId,
      action: isOwner ? "organization.wiped" : "user.data_wiped",
      entityType: isOwner ? "organization" : "user",
      entityId: isOwner ? ctx.scope.organizationId : ctx.userId,
      metadata: {
        scope: isOwner ? "organization" : "user",
        purchases,
        documents,
        samples,
        facts,
        organizationProfile,
        personalProfile: personal.count > 0,
      },
    });

    return {
      scope: isOwner ? "organization" : "user",
      purchases,
      documents,
      samples,
      facts,
      organizationProfile,
      personalProfile: personal.count > 0,
    };
  });
}
