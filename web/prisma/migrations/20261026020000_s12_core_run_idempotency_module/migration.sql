-- Phase 1: ключ идемпотентности должен быть уникален в пределах организации И модуля.
-- Иначе один и тот же ключ для разных сфер вернул бы чужой запуск.

DROP INDEX "CoreRun_organizationId_idempotencyKey_key";

CREATE UNIQUE INDEX "CoreRun_organizationId_moduleKey_idempotencyKey_key"
    ON "CoreRun"("organizationId", "moduleKey", "idempotencyKey");
