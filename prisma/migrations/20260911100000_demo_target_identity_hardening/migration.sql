-- Checkpoint B corrective handoff §4: exact fixture-organisation-id
-- ownership tracking (never a name/slug prefix) and an actual-connection
-- identity check (current_database()/current_user) as part of the
-- provisioning-token trust root.

ALTER TABLE "DemoFixtureLease" ADD COLUMN "fixtureOrganisationId" TEXT;

ALTER TABLE "DemoDatabaseManifest"
  ADD COLUMN "approvedDatabaseName" TEXT,
  ADD COLUMN "approvedRole" TEXT;
