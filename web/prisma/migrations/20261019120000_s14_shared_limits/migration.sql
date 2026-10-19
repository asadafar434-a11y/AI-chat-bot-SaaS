-- CreateTable
CREATE TABLE "RateHit" (
    "id" BIGSERIAL NOT NULL,
    "bucket" VARCHAR(40) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSpend" (
    "appId" VARCHAR(100) NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSpend_pkey" PRIMARY KEY ("appId")
);

-- CreateIndex
CREATE INDEX "RateHit_bucket_key_at_idx" ON "RateHit"("bucket", "key", "at");

