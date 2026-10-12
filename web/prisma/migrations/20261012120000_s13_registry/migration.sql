-- CreateEnum
CREATE TYPE "RegistryImportStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RegistryRecordStatus" AS ENUM ('active', 'absent');

-- CreateEnum
CREATE TYPE "RegistryChangeKind" AS ENUM ('changed', 'absent', 'returned');

-- CreateTable
CREATE TABLE "RegistryDataset" (
    "id" TEXT NOT NULL,
    "registryKind" VARCHAR(40) NOT NULL,
    "formatVersion" VARCHAR(40) NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "exportedAt" TIMESTAMPTZ(3),
    "status" "RegistryImportStatus" NOT NULL DEFAULT 'running',
    "importedBy" VARCHAR(120),
    "finishedAt" TIMESTAMPTZ(3),
    "report" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RegistryDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryRecord" (
    "id" TEXT NOT NULL,
    "registryKind" VARCHAR(40) NOT NULL,
    "registryNumber" VARCHAR(40) NOT NULL,
    "status" "RegistryRecordStatus" NOT NULL DEFAULT 'active',
    "enterpriseName" VARCHAR(600) NOT NULL,
    "inn" VARCHAR(12) NOT NULL,
    "ogrn" VARCHAR(15),
    "productName" VARCHAR(1000) NOT NULL,
    "okpd2" VARCHAR(20) NOT NULL,
    "tnved" VARCHAR(300),
    "madeBy" VARCHAR(2000),
    "digitalPassport" VARCHAR(40),
    "primaryNumber" VARCHAR(60),
    "addedAt" DATE,
    "validUntil" DATE,
    "validUntilMin" DATE,
    "terminatedAt" DATE,
    "points" DOUBLE PRECISION,
    "percent" DOUBLE PRECISION,
    "conformity" TEXT,
    "department" VARCHAR(200),
    "flags" JSONB NOT NULL,
    "bases" JSONB NOT NULL,
    "rowHash" VARCHAR(64) NOT NULL,
    "firstSeenDatasetId" TEXT NOT NULL,
    "lastSeenDatasetId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RegistryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryChange" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "kind" "RegistryChangeKind" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistryChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistryDataset_registryKind_status_exportedAt_idx" ON "RegistryDataset"("registryKind", "status", "exportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryDataset_registryKind_fileSha256_key" ON "RegistryDataset"("registryKind", "fileSha256");

-- CreateIndex
CREATE INDEX "RegistryRecord_registryKind_inn_idx" ON "RegistryRecord"("registryKind", "inn");

-- CreateIndex
CREATE INDEX "RegistryRecord_registryKind_okpd2_idx" ON "RegistryRecord"("registryKind", "okpd2");

-- CreateIndex
CREATE INDEX "RegistryRecord_registryKind_status_lastSeenDatasetId_idx" ON "RegistryRecord"("registryKind", "status", "lastSeenDatasetId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryRecord_registryKind_registryNumber_key" ON "RegistryRecord"("registryKind", "registryNumber");

-- CreateIndex
CREATE INDEX "RegistryChange_recordId_createdAt_idx" ON "RegistryChange"("recordId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistryChange_datasetId_kind_idx" ON "RegistryChange"("datasetId", "kind");

-- AddForeignKey
ALTER TABLE "RegistryRecord" ADD CONSTRAINT "RegistryRecord_firstSeenDatasetId_fkey" FOREIGN KEY ("firstSeenDatasetId") REFERENCES "RegistryDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryRecord" ADD CONSTRAINT "RegistryRecord_lastSeenDatasetId_fkey" FOREIGN KEY ("lastSeenDatasetId") REFERENCES "RegistryDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryChange" ADD CONSTRAINT "RegistryChange_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "RegistryRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryChange" ADD CONSTRAINT "RegistryChange_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "RegistryDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Индексы, которые Prisma не описывает схемой (она их не видит и не трогает):
-- русский полнотекстовый поиск по названию продукции (кресло ~ кресла) и поиск по началу кода ОКПД2 («31.01» → все коды ветки).
CREATE INDEX "RegistryRecord_productName_fts_idx" ON "RegistryRecord" USING GIN (to_tsvector('russian', "productName"));

CREATE INDEX "RegistryRecord_okpd2_prefix_idx" ON "RegistryRecord"("registryKind", "okpd2" text_pattern_ops);
