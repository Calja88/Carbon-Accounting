-- CreateEnum
CREATE TYPE "AspectControlRelationship" AS ENUM ('DIRECT_CONTROL', 'INFLUENCE');

-- CreateEnum
CREATE TYPE "EnvironmentalEffect" AS ENUM ('BENEFICIAL', 'ADVERSE');

-- CreateEnum
CREATE TYPE "EnvironmentalImpactExtent" AS ENUM ('LOCAL', 'GLOBAL', 'LOCAL_AND_GLOBAL');

-- CreateTable
CREATE TABLE "EnvironmentalAspect" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceInputOutput" TEXT,
    "scopeDescription" TEXT,
    "existingControls" TEXT,
    "controlRelationship" "AspectControlRelationship" NOT NULL,
    "lifecycleStage" "EmsLifecycleStage",
    "operatingCondition" "EmsOperatingCondition" NOT NULL,
    "effect" "EnvironmentalEffect" NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalAspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalImpact" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "receptor" TEXT,
    "extent" "EnvironmentalImpactExtent" NOT NULL,
    "effect" "EnvironmentalEffect" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalImpact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AspectImpactLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "aspectId" TEXT NOT NULL,
    "impactId" TEXT NOT NULL,
    "causalDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AspectImpactLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalAspect_organisationId_id_key" ON "EnvironmentalAspect"("organisationId", "id");
CREATE INDEX "EnvironmentalAspect_organisationId_processId_idx" ON "EnvironmentalAspect"("organisationId", "processId");
CREATE INDEX "EnvironmentalAspect_organisationId_operatingCondition_idx" ON "EnvironmentalAspect"("organisationId", "operatingCondition");
CREATE UNIQUE INDEX "EnvironmentalImpact_organisationId_id_key" ON "EnvironmentalImpact"("organisationId", "id");
CREATE UNIQUE INDEX "EnvironmentalImpact_organisationId_name_key" ON "EnvironmentalImpact"("organisationId", "name");
CREATE INDEX "EnvironmentalImpact_organisationId_category_idx" ON "EnvironmentalImpact"("organisationId", "category");
CREATE UNIQUE INDEX "AspectImpactLink_organisationId_aspectId_impactId_key" ON "AspectImpactLink"("organisationId", "aspectId", "impactId");
CREATE INDEX "AspectImpactLink_organisationId_impactId_idx" ON "AspectImpactLink"("organisationId", "impactId");

-- AddForeignKey
ALTER TABLE "EnvironmentalAspect" ADD CONSTRAINT "EnvironmentalAspect_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnvironmentalAspect" ADD CONSTRAINT "EnvironmentalAspect_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnvironmentalImpact" ADD CONSTRAINT "EnvironmentalImpact_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectImpactLink" ADD CONSTRAINT "AspectImpactLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectImpactLink" ADD CONSTRAINT "AspectImpactLink_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AspectImpactLink" ADD CONSTRAINT "AspectImpactLink_organisationId_impactId_fkey" FOREIGN KEY ("organisationId", "impactId") REFERENCES "EnvironmentalImpact"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
