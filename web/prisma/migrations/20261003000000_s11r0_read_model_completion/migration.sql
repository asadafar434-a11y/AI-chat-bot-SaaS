-- S11-R0: завершение authoritative server read model.
--
-- Миграция строго аддитивная: ни одного DROP, ни одного ALTER с потерей данных.
-- Добавляются только nullable-колонки (и одна NOT NULL с default — `Sample.scan`),
-- существующие строки остаются валидными, исторические отметки не перезаписываются.
--
-- Что закрывается:
--   * Document.mapKey  — карта документа (DocMap) в S6, не хранилась вовсе;
--   * Sample.name      — имя файла образца (MyDocument.name), не хранилось;
--   * Sample.addedAt   — историческая дата добавления, не хранилась;
--   * Sample.scan      — признак распознавания со скана, не хранился;
--   * Sample.mapKey    — карта образца (DocMap) в S6, не хранилась;
--   * OrganizationProfile.meta — sources/suggestions профиля; до S11-R0 терялись.

-- AlterTable
ALTER TABLE "OrganizationProfile" ADD COLUMN "meta" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "mapKey" VARCHAR(500);

-- AlterTable
ALTER TABLE "Sample" ADD COLUMN "name" VARCHAR(500),
ADD COLUMN "addedAt" TIMESTAMPTZ(3),
ADD COLUMN "scan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mapKey" VARCHAR(500);

-- CreateIndex
CREATE INDEX "Document_mapKey_idx" ON "Document"("mapKey");

-- CreateIndex
CREATE INDEX "Sample_mapKey_idx" ON "Sample"("mapKey");
