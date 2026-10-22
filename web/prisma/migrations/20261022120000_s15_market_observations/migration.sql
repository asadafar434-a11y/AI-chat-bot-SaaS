-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(300) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "okpd2" VARCHAR(20),
    "tokens" TEXT[],
    "priceNoVat" DOUBLE PRECISION NOT NULL,
    "observedAt" DATE NOT NULL,
    "region" VARCHAR(120),
    "quantity" DOUBLE PRECISION,
    "source" VARCHAR(500) NOT NULL,
    "sourceKind" VARCHAR(30) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "importedBy" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceObservation_hash_key" ON "PriceObservation"("hash");

-- CreateIndex
CREATE INDEX "PriceObservation_unit_observedAt_idx" ON "PriceObservation"("unit", "observedAt");


-- Индекс, который Prisma не описывает схемой (она его не видит и не трогает): отбор кандидатов по пересечению основ слов названия.
CREATE INDEX "PriceObservation_tokens_idx" ON "PriceObservation" USING GIN ("tokens");
