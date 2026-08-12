-- CreateEnum
CREATE TYPE "ProcessActivityType" AS ENUM ('ACTIVITY', 'PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "EmsLifecycleStage" AS ENUM ('RAW_MATERIAL_ACQUISITION', 'DESIGN', 'PRODUCTION', 'TRANSPORTATION_DELIVERY', 'USE', 'END_OF_LIFE_TREATMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EmsOperatingCondition" AS ENUM ('NORMAL', 'ABNORMAL', 'STARTUP_SHUTDOWN', 'MAINTENANCE', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ActivityProcessStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ProcessProfileTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isStructural" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessProfileTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activityType" "ProcessActivityType" NOT NULL DEFAULT 'ACTIVITY',
    "suggestedLifecycleStage" "EmsLifecycleStage",
    "suggestedOperatingCondition" "EmsOperatingCondition" NOT NULL DEFAULT 'NORMAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProcessTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityProcess" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activityType" "ProcessActivityType" NOT NULL DEFAULT 'ACTIVITY',
    "lifecycleStage" "EmsLifecycleStage",
    "operatingCondition" "EmsOperatingCondition" NOT NULL DEFAULT 'NORMAL',
    "status" "ActivityProcessStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "sourceTemplateId" TEXT,
    "sourceTemplateItemId" TEXT,
    "supersedesProcessId" TEXT,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityProcess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessProfileTemplate_key_key" ON "ProcessProfileTemplate"("key");

-- CreateIndex
CREATE INDEX "ProcessProfileTemplate_isActive_idx" ON "ProcessProfileTemplate"("isActive");

-- CreateIndex
CREATE INDEX "ProcessTemplateItem_templateId_idx" ON "ProcessTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "ProcessTemplateItem_parentId_idx" ON "ProcessTemplateItem"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityProcess_supersedesProcessId_key" ON "ActivityProcess"("supersedesProcessId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityProcess_organisationId_id_key" ON "ActivityProcess"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ActivityProcess_organisationId_programmeId_status_idx" ON "ActivityProcess"("organisationId", "programmeId", "status");

-- CreateIndex
CREATE INDEX "ActivityProcess_organisationId_siteId_idx" ON "ActivityProcess"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "ActivityProcess_organisationId_entityId_idx" ON "ActivityProcess"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "ActivityProcess_organisationId_sourceTemplateItemId_idx" ON "ActivityProcess"("organisationId", "sourceTemplateItemId");

-- AddForeignKey
ALTER TABLE "ProcessTemplateItem" ADD CONSTRAINT "ProcessTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessProfileTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTemplateItem" ADD CONSTRAINT "ProcessTemplateItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProcessTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ActivityProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "ProcessProfileTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_sourceTemplateItemId_fkey" FOREIGN KEY ("sourceTemplateItemId") REFERENCES "ProcessTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_supersedesProcessId_fkey" FOREIGN KEY ("supersedesProcessId") REFERENCES "ActivityProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityProcess" ADD CONSTRAINT "ActivityProcess_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
