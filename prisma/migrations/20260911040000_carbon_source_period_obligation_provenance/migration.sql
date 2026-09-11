-- Checkpoint B corrective handoff §1: real referential integrity and
-- provenance for CarbonSourcePeriodObligation, plus an explicit
-- review/exclude decision trail distinct from mere submission existence.

ALTER TABLE "CarbonSourcePeriodObligation"
  ADD COLUMN "reviewFingerprint" TEXT,
  ADD COLUMN "excludedByMembershipId" TEXT,
  ADD COLUMN "excludedAt" TIMESTAMP(3),
  ADD COLUMN "excludedReason" TEXT;

-- Every prior REVIEWED row was stamped by the old, now-removed logic that
-- treated "a matching ActivityEntry exists" as proof of review, never an
-- actual authorised reviewer decision. That is exactly the completeness
-- claim this handoff says must not be carried forward by inventing missing
-- provenance. Downgrade those rows to REVIEW_REQUIRED rather than certify
-- them: this database only ever holds the disposable BOARD-1 fixture
-- (never real persistent obligations), so nothing besides the seed's own
-- next run is affected, and the seed's own explicit review operation will
-- genuinely re-review every current row it recreates.
UPDATE "CarbonSourcePeriodObligation"
SET "status" = 'REVIEW_REQUIRED', "reviewedByMembershipId" = NULL, "reviewedAt" = NULL
WHERE "status" = 'REVIEWED';

ALTER TABLE "CarbonSourcePeriodObligation"
  ADD CONSTRAINT "CarbonSourcePeriodObligation_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonSourcePeriodObligation_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonSourcePeriodObligation_submittedActivityEntryId_fkey"
    FOREIGN KEY ("submittedActivityEntryId") REFERENCES "ActivityEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonSourcePeriodObligation_reviewedByMembershipId_fkey"
    FOREIGN KEY ("reviewedByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CarbonSourcePeriodObligation_excludedByMembershipId_fkey"
    FOREIGN KEY ("excludedByMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CarbonSourcePeriodObligation_submittedActivityEntryId_idx"
  ON "CarbonSourcePeriodObligation"("submittedActivityEntryId");

-- Status is constrained to the three values the service ever writes.
ALTER TABLE "CarbonSourcePeriodObligation"
  ADD CONSTRAINT "CarbonSourcePeriodObligation_status_check"
    CHECK ("status" IN ('REVIEW_REQUIRED', 'REVIEWED', 'EXCLUDED'));

-- A REVIEWED row must carry every field an actual review produces. Written
-- as explicit IS NOT NULL clauses (never a bare equality/OR that a NULL
-- operand would vacuously satisfy) so a REVIEWED row with any provenance
-- field missing fails the constraint rather than silently passing.
ALTER TABLE "CarbonSourcePeriodObligation"
  ADD CONSTRAINT "CarbonSourcePeriodObligation_reviewed_provenance_check"
    CHECK (
      "status" <> 'REVIEWED'
      OR (
        "submittedActivityEntryId" IS NOT NULL
        AND "reviewedByMembershipId" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reviewFingerprint" IS NOT NULL
      )
    );

-- An EXCLUDED row must carry an authorised decision and reason, never mere
-- absence of a matching submission.
ALTER TABLE "CarbonSourcePeriodObligation"
  ADD CONSTRAINT "CarbonSourcePeriodObligation_excluded_provenance_check"
    CHECK (
      "status" <> 'EXCLUDED'
      OR (
        "excludedByMembershipId" IS NOT NULL
        AND "excludedAt" IS NOT NULL
        AND "excludedReason" IS NOT NULL
      )
    );
