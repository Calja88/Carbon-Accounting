-- Phase 1 tenancy (T18): AI and administration tenant refactor.
-- Ownership decisions per PHASE1_TENANCY_RBAC_SPEC.md §4:
--   EmissionFactorSet: PLATFORM (official/global reference sets, default) or
--     ORGANISATION (supplier-specific/customer-created sets).
--   AiSettings/AiTaskModel: one settings root per Organisation, replacing the
--     old single global "singleton" row.
--   AiModelCatalog: new platform-global table for the provider model cache,
--     split out of AiSettings so it is no longer entangled with a tenant row.
--   AiInteraction/AiSuggestion: nullable, expand-only organisationId, same
--     deferred-to-contract-migration contract as every other Phase 1 column.

-- CreateEnum
CREATE TYPE "FactorVisibility" AS ENUM ('PLATFORM', 'ORGANISATION');

-- AlterTable: EmissionFactorSet visibility + owner
ALTER TABLE "EmissionFactorSet" ADD COLUMN     "visibility" "FactorVisibility" NOT NULL DEFAULT 'PLATFORM';
ALTER TABLE "EmissionFactorSet" ADD COLUMN     "ownerOrganisationId" TEXT;

-- CreateIndex
CREATE INDEX "EmissionFactorSet_visibility_ownerOrganisationId_idx" ON "EmissionFactorSet"("visibility", "ownerOrganisationId");

-- AddForeignKey
ALTER TABLE "EmissionFactorSet" ADD CONSTRAINT "EmissionFactorSet_ownerOrganisationId_fkey" FOREIGN KEY ("ownerOrganisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: platform-global model catalogue, split out of AiSettings
CREATE TABLE "AiModelCatalog" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "catalogJson" JSONB,
    "catalogRefreshedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelCatalog_pkey" PRIMARY KEY ("id")
);

-- Carry over the old singleton row's cached catalogue, if any, before the
-- source columns are dropped below.
INSERT INTO "AiModelCatalog" ("id", "catalogJson", "catalogRefreshedAt", "updatedAt")
SELECT 'platform', "catalogJson", "catalogRefreshedAt", COALESCE("catalogRefreshedAt", CURRENT_TIMESTAMP)
FROM "AiSettings"
WHERE "id" = 'singleton' AND "catalogJson" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- AlterTable: AiSettings becomes one row per Organisation instead of a fixed
-- "singleton" row; the model catalogue moves to AiModelCatalog above.
ALTER TABLE "AiSettings" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "AiSettings" ADD COLUMN     "organisationId" TEXT;
ALTER TABLE "AiSettings" DROP COLUMN "catalogJson";
ALTER TABLE "AiSettings" DROP COLUMN "catalogRefreshedAt";

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_organisationId_key" ON "AiSettings"("organisationId");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: AiInteraction organisation scoping
ALTER TABLE "AiInteraction" ADD COLUMN     "organisationId" TEXT;

-- CreateIndex
CREATE INDEX "AiInteraction_organisationId_createdAt_idx" ON "AiInteraction"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: AiSuggestion organisation scoping
ALTER TABLE "AiSuggestion" ADD COLUMN     "organisationId" TEXT;

-- CreateIndex
CREATE INDEX "AiSuggestion_organisationId_createdAt_idx" ON "AiSuggestion"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
