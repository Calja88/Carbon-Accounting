-- Phase 2A (Carbon Product Reset): the per-organisation/per-site emission
-- source configuration layer over the global ActivityDataPoint catalogue.
-- Purely additive — one new enum, one new table, no change to any existing
-- table, column, constraint or row. Nothing here creates obligations,
-- activity entries or calculations.

CREATE TYPE "CarbonSourceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC');

CREATE TABLE "OrganisationSourceConfig" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "activityDataPointId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "CarbonSourceFrequency" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationSourceConfig_pkey" PRIMARY KEY ("id")
);

-- One configuration per organisation + site + catalogue source. Re-enabling
-- a previously disabled source must reuse this row, never create a second
-- contradictory one.
CREATE UNIQUE INDEX "OrganisationSourceConfig_org_site_source_key"
  ON "OrganisationSourceConfig"("organisationId", "siteId", "activityDataPointId");

CREATE INDEX "OrganisationSourceConfig_organisationId_siteId_idx"
  ON "OrganisationSourceConfig"("organisationId", "siteId");

CREATE INDEX "OrganisationSourceConfig_organisationId_enabled_idx"
  ON "OrganisationSourceConfig"("organisationId", "enabled");

-- RESTRICT throughout: a configuration must not outlive the organisation,
-- site or catalogue source it describes, and deleting any of those three
-- must not silently drop the reporting plan that referenced them.
ALTER TABLE "OrganisationSourceConfig"
  ADD CONSTRAINT "OrganisationSourceConfig_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganisationSourceConfig_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganisationSourceConfig_activityDataPointId_fkey"
    FOREIGN KEY ("activityDataPointId") REFERENCES "ActivityDataPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
