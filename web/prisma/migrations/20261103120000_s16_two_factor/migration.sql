-- Двухфакторный вход: только добавляются столбцы, существующие входы не меняются.
ALTER TABLE "User" ADD COLUMN "totpSecret" VARCHAR(255),
ADD COLUMN "totpEnabledAt" TIMESTAMPTZ(3),
ADD COLUMN "totpLastStep" INTEGER,
ADD COLUMN "recoveryHashes" VARCHAR(1000) NOT NULL DEFAULT '';
