-- Phase 2B-i (Carbon Product Reset): the generated data-collection plan.
-- Purely additive: one new enum, one new table, its own indexes and foreign
-- keys. No existing table, column, constraint or row is touched.
--
-- Deliberately a NEW table rather than more rows in
-- CarbonSourcePeriodObligation: that table is counted un-filtered by the
-- dashboard's coverage denominator, so generating into it would have halved
-- the reported completeness of an unrelated fixture without any underlying
-- data changing.

CREATE TYPE "CarbonCollectionDecision" AS ENUM ('PENDING', 'REVIEWED', 'EXCLUDED');

CREATE TABLE "CarbonCollectionRequirement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "activityDataPointId" TEXT NOT NULL,
    "sourceConfigId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodKind" "CarbonSourceFrequency" NOT NULL,
    "decision" "CarbonCollectionDecision" NOT NULL DEFAULT 'PENDING',
    "reviewFingerprint" TEXT,
    "reviewedByMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "excludedByMembershipId" TEXT,
    "excludedAt" TIMESTAMP(3),
    "excludedReason" TEXT,
    "reopenedByMembershipId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarbonCollectionRequirement_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. Regeneration is an insert that skips duplicates, so a
-- rerun can never overwrite a recorded REVIEWED or EXCLUDED decision.
-- Names are mapped explicitly: the generated form of the index below is 65
-- characters, and PostgreSQL truncates identifiers at 63.
CREATE UNIQUE INDEX "CarbonCollectionRequirement_org_site_source_period_key"
  ON "CarbonCollectionRequirement"("organisationId", "siteId", "activityDataPointId", "periodKey");

CREATE INDEX "CarbonCollectionRequirement_org_site_period_idx"
  ON "CarbonCollectionRequirement"("organisationId", "siteId", "periodStart");

CREATE INDEX "CarbonCollectionRequirement_source_config_idx"
  ON "CarbonCollectionRequirement"("sourceConfigId");

-- RESTRICT throughout: a requirement must not outlive the organisation, site,
-- catalogue source or configuration it describes, and a recorded review or
-- exclusion decision must not lose the membership that made it.
ALTER TABLE "CarbonCollectionRequirement"
  ADD CONSTRAINT "CarbonCollectionRequirement_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_activityDataPointId_fkey"
    FOREIGN KEY ("activityDataPointId") REFERENCES "ActivityDataPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_sourceConfigId_fkey"
    FOREIGN KEY ("sourceConfigId") REFERENCES "OrganisationSourceConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_reviewedByMembershipId_fkey"
    FOREIGN KEY ("reviewedByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_excludedByMembershipId_fkey"
    FOREIGN KEY ("excludedByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonCollectionRequirement_reopenedByMembershipId_fkey"
    FOREIGN KEY ("reopenedByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
