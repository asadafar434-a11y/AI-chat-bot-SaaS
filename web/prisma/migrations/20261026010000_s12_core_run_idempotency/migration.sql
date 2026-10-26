-- Phase 1: идемпотентность запусков core-модуля по ключу внутри организации.
-- Миграция аддитивная: новая nullable-колонка и уникальный индекс.

ALTER TABLE "CoreRun" ADD COLUMN "idempotencyKey" VARCHAR(200);

CREATE UNIQUE INDEX "CoreRun_organizationId_idempotencyKey_key"
    ON "CoreRun"("organizationId", "idempotencyKey");
