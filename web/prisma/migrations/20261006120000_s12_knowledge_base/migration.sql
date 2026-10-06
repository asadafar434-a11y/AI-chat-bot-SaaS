-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('active', 'deleted');

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "ownerKey" VARCHAR(40) NOT NULL,
    "approvedBy" VARCHAR(120),
    "sourceKey" VARCHAR(300) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "source" VARCHAR(300) NOT NULL,
    "meta" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" VARCHAR(64) NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'active',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "sourceText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" VARCHAR(25) NOT NULL,
    "ownerKey" VARCHAR(40) NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "heading" VARCHAR(500),
    "text" TEXT NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddingModel" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_ownerKey_status_idx" ON "KnowledgeDocument"("ownerKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_ownerKey_sourceKey_key" ON "KnowledgeDocument"("ownerKey", "sourceKey");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_ownerKey_hash_embeddingModel_idx" ON "KnowledgeChunk"("ownerKey", "hash", "embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_chunkIndex_key" ON "KnowledgeChunk"("documentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

