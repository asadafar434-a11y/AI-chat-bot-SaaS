-- Phase 1: журнал запусков core-модулей.
-- Миграция аддитивная: существующие таблицы не изменяются, кроме новых внешних ключей.

CREATE TABLE "CoreRun" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "createdByUserId" VARCHAR(25),
    "moduleKey" VARCHAR(60) NOT NULL,
    "moduleVersion" VARCHAR(20) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "riskScore" INTEGER,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoreRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoreRun_organizationId_createdAt_idx" ON "CoreRun"("organizationId", "createdAt");
CREATE INDEX "CoreRun_organizationId_moduleKey_idx" ON "CoreRun"("organizationId", "moduleKey");
CREATE INDEX "CoreRun_createdByUserId_idx" ON "CoreRun"("createdByUserId");

ALTER TABLE "CoreRun" ADD CONSTRAINT "CoreRun_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoreRun" ADD CONSTRAINT "CoreRun_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
