-- CreateTable
CREATE TABLE "Tender" (
    "id" TEXT NOT NULL,
    "tenderId" VARCHAR(60) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "externalId" VARCHAR(40),
    "deadline" DATE,
    "data" JSONB NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tender_tenderId_key" ON "Tender"("tenderId");

-- CreateIndex
CREATE INDEX "Tender_deadline_idx" ON "Tender"("deadline");

-- CreateIndex
CREATE INDEX "Tender_source_externalId_idx" ON "Tender"("source", "externalId");
