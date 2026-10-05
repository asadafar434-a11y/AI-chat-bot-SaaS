-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('draft', 'submitted', 'archived');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('started', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailVerified" TIMESTAMPTZ(3),
    "name" VARCHAR(200),
    "image" VARCHAR(1000),
    "passwordHash" VARCHAR(255),
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProfile" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(25) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "createdByUserId" VARCHAR(25),
    "payload" JSONB NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'draft',
    "originalFormatVersion" INTEGER,
    "legacyId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "purchaseId" VARCHAR(25),
    "fileName" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(200),
    "sizeBytes" INTEGER,
    "sha256" VARCHAR(64),
    "storageKey" VARCHAR(500),
    "textKey" VARCHAR(500),
    "pageCount" INTEGER,
    "ocr" BOOLEAN NOT NULL DEFAULT false,
    "readError" VARCHAR(500),
    "legacyId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "measures" JSONB NOT NULL DEFAULT '[]',
    "validity" JSONB NOT NULL DEFAULT '{}',
    "source" JSONB NOT NULL,
    "origin" VARCHAR(20) NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "legacyId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "kinds" JSONB NOT NULL DEFAULT '[]',
    "about" TEXT NOT NULL,
    "textKey" VARCHAR(500),
    "legacyId" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" VARCHAR(25) NOT NULL,
    "actorUserId" VARCHAR(25),
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(100),
    "metadata" JSONB,
    "requestId" VARCHAR(100),
    "ipHash" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyImportBatch" (
    "id" TEXT NOT NULL,
    "batchKey" VARCHAR(200) NOT NULL,
    "backupHash" VARCHAR(64) NOT NULL,
    "backupFormatVersion" INTEGER NOT NULL DEFAULT 1,
    "organizationId" VARCHAR(25) NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'started',
    "counts" JSONB,
    "checksums" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LegacyImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_deletedAt_idx" ON "Organization"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationProfile_organizationId_key" ON "OrganizationProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_updatedAt_idx" ON "Purchase"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_status_idx" ON "Purchase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_createdAt_idx" ON "Purchase"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_legacyId_idx" ON "Purchase"("legacyId");

-- CreateIndex
CREATE INDEX "Purchase_createdByUserId_idx" ON "Purchase"("createdByUserId");

-- CreateIndex
CREATE INDEX "Document_organizationId_purchaseId_idx" ON "Document"("organizationId", "purchaseId");

-- CreateIndex
CREATE INDEX "Document_organizationId_createdAt_idx" ON "Document"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_organizationId_sha256_idx" ON "Document"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "Document_purchaseId_idx" ON "Document"("purchaseId");

-- CreateIndex
CREATE INDEX "Document_legacyId_idx" ON "Document"("legacyId");

-- CreateIndex
CREATE INDEX "Document_storageKey_idx" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Fact_organizationId_kind_idx" ON "Fact"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "Fact_organizationId_confirmed_idx" ON "Fact"("organizationId", "confirmed");

-- CreateIndex
CREATE INDEX "Fact_organizationId_createdAt_idx" ON "Fact"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Fact_organizationId_validity_idx" ON "Fact"("organizationId", "validity");

-- CreateIndex
CREATE INDEX "Fact_legacyId_idx" ON "Fact"("legacyId");

-- CreateIndex
CREATE INDEX "Sample_organizationId_createdAt_idx" ON "Sample"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Sample_organizationId_kinds_idx" ON "Sample"("organizationId", "kinds");

-- CreateIndex
CREATE INDEX "Sample_legacyId_idx" ON "Sample"("legacyId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_idx" ON "AuditEvent"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyImportBatch_batchKey_key" ON "LegacyImportBatch"("batchKey");

-- CreateIndex
CREATE INDEX "LegacyImportBatch_organizationId_startedAt_idx" ON "LegacyImportBatch"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "LegacyImportBatch_organizationId_status_idx" ON "LegacyImportBatch"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyImportBatch_backupHash_organizationId_key" ON "LegacyImportBatch"("backupHash", "organizationId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationProfile" ADD CONSTRAINT "OrganizationProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyImportBatch" ADD CONSTRAINT "LegacyImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
