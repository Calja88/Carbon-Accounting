-- Checkpoint B required fixes 4/5/8 (schema conditions on the BD08 fixture
-- infrastructure). Forward corrective migration — the prior migration
-- (20260910080000_add_board_demo_fixture_infrastructure) has already been
-- applied and is never rewritten.

-- Fix 4: DemoDatabaseManifest needs an out-of-band provisioning-provenance
-- token so a bare row's existence can no longer be trusted on its own.
-- Default '' only satisfies the NOT NULL constraint for any pre-existing
-- row; readConnectedIdentity requires a non-empty BOARD_DEMO_PROVISIONING_TOKEN
-- to exactly match this column, so a default/blank token can never pass.
ALTER TABLE "DemoDatabaseManifest" ADD COLUMN "provisioningToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DemoDatabaseManifest" ALTER COLUMN "provisioningToken" DROP DEFAULT;

-- Fix 5: constrain DemoFixtureLease.status to exactly its three valid
-- states instead of an unconstrained string.
CREATE TYPE "DemoFixtureLeaseStatus" AS ENUM ('NONE', 'BUILDING', 'READY');
ALTER TABLE "DemoFixtureLease"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DemoFixtureLeaseStatus" USING "status"::"DemoFixtureLeaseStatus",
  ALTER COLUMN "status" SET DEFAULT 'NONE';

-- Fix 8 (schema condition): trace each obligation's review decision to the
-- real ActivityEntry it reviews, and enforce a compound unique
-- source-period identity alongside the existing externalKey uniqueness.
ALTER TABLE "CarbonSourcePeriodObligation" ADD COLUMN "submittedActivityEntryId" TEXT;
CREATE UNIQUE INDEX "CarbonSourcePeriodObligation_organisationId_siteId_month_sourceKey_key"
  ON "CarbonSourcePeriodObligation"("organisationId", "siteId", "month", "sourceKey");
