import { z } from "zod";

import { runFlow } from "@/lib/core/flow/engine.ts";
import type { FlowInput } from "@/lib/core/flow/types.ts";
import { medicalModule } from "@/lib/core/modules/medical/flow.ts";

import { auditEvent } from "../audit/service.ts";
import type { WriteContext } from "../write/services.ts";
import { InvalidArgumentError } from "../db/errors.ts";
import type { OrgScope } from "../db/org-scope.ts";
import { orgRepositories, requireOrganizationAccess } from "../db/repositories/index.ts";

const MAX_INPUT_BYTES = 512 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/;

const EvidenceSchema = z
  .object({
    value: z.unknown(),
    source: z.string().trim().min(1).max(500),
    quote: z.string().max(2000).optional(),
  })
  .strict();

const FlowInputSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    answers: z.record(z.string(), z.unknown()).optional(),
    evidence: z.record(z.string(), EvidenceSchema).optional(),
  })
  .strict();

export type CoreRunSummary = {
  id: string;
  moduleKey: string;
  moduleVersion: string;
  outcome: string;
  riskScore: number | null;
  createdAt: Date;
};

export type CoreRunCreated = {
  id: string;
  result: ReturnType<typeof runFlow>;
  replayed: boolean;
};

function parseInput(raw: unknown): FlowInput {
  const parsed = FlowInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidArgumentError("core.run: некорректный input");
  }
  const size = Buffer.byteLength(JSON.stringify(parsed.data), "utf8");
  if (size > MAX_INPUT_BYTES) {
    throw new InvalidArgumentError("core.run: input превышает 512 КБ");
  }
  return parsed.data;
}

function normalizeIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new InvalidArgumentError("core.run: некорректный Idempotency-Key");
  }
  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.length > 200 || !IDEMPOTENCY_KEY.test(key)) {
    throw new InvalidArgumentError("core.run: некорректный Idempotency-Key");
  }
  return key;
}

/** Запуск медицинского core-модуля и сохранение снимка в организации пользователя. */
export async function createCoreRun(
  ctx: WriteContext,
  rawInput: unknown,
  rawIdempotencyKey?: unknown,
): Promise<CoreRunCreated> {
  await requireOrganizationAccess(ctx.db, ctx.scope, ctx.userId);
  const key = normalizeIdempotencyKey(rawIdempotencyKey);
  const repo = () => orgRepositories(ctx.db, ctx.scope).coreRun;

  if (key) {
    const existing = await repo().list({ where: { idempotencyKey: key }, take: 1 });
    if (existing[0]) {
      return { id: existing[0].id, result: existing[0].result as ReturnType<typeof runFlow>, replayed: true };
    }
  }

  const input = parseInput(rawInput);
  const result = runFlow(medicalModule, input);
  const riskScore = typeof result.outputs.riskScore === "number" ? result.outputs.riskScore : null;

  try {
    const row = await ctx.run(async (db) => {
      const created = await orgRepositories(db, ctx.scope).coreRun.create({
        createdByUserId: ctx.userId,
        moduleKey: result.moduleKey,
        moduleVersion: result.moduleVersion,
        outcome: result.outcome,
        riskScore,
        idempotencyKey: key,
        input,
        result,
      });
      await auditEvent(db, ctx.scope, {
        actorUserId: ctx.userId,
        action: "core.run.created",
        entityType: "core_run",
        entityId: created.id,
        metadata: {
          moduleKey: result.moduleKey,
          moduleVersion: result.moduleVersion,
          outcome: result.outcome,
        },
      });
      return created;
    });
    return { id: row.id, result, replayed: false };
  } catch (error) {
    if (key) {
      const existing = await repo().list({ where: { idempotencyKey: key }, take: 1 });
      if (existing[0]) {
        return { id: existing[0].id, result: existing[0].result as ReturnType<typeof runFlow>, replayed: true };
      }
    }
    throw error;
  }
}

/** Список последних запусков в скоупе. Полные input/result в список не отдаются. */
export async function listCoreRuns(
  ctx: { db: WriteContext["db"]; scope: OrgScope; userId: string },
  limit = 50,
): Promise<CoreRunSummary[]> {
  await requireOrganizationAccess(ctx.db, ctx.scope, ctx.userId);
  const take = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const rows = await orgRepositories(ctx.db, ctx.scope).coreRun.list({
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    moduleKey: row.moduleKey,
    moduleVersion: row.moduleVersion,
    outcome: row.outcome,
    riskScore: row.riskScore,
    createdAt: row.createdAt,
  }));
}
