-- Второй шаг входа «PIN-код из 4 цифр»: только добавляются столбцы, существующие входы не меняются.
ALTER TABLE "User" ADD COLUMN "pinHash" VARCHAR(255),
ADD COLUMN "pinEnabledAt" TIMESTAMPTZ(3),
ADD COLUMN "pinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pinLockedUntil" TIMESTAMPTZ(3);
