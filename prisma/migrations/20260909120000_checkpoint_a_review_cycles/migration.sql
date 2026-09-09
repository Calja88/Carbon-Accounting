BEGIN;
-- Fail closed rather than invent cycle assignments for existing review history.
LOCK TABLE "Nonconformity", "EffectivenessReview" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EffectivenessReview") OR EXISTS (SELECT 1 FROM "Nonconformity" WHERE "status" = 'EFFECTIVENESS_REVIEW') THEN
    RAISE EXCEPTION 'Checkpoint A: existing reviews or an in-flight review require an explicitly reviewed cycle backfill. No history was changed.';
  END IF;
END $$;
ALTER TABLE "Nonconformity" ADD COLUMN "reviewCycle" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_reviewCycle_check" CHECK ("reviewCycle" >= 0);
ALTER TABLE "EffectivenessReview" ADD COLUMN "reviewCycle" INTEGER NOT NULL;
ALTER TABLE "EffectivenessReview" ADD CONSTRAINT "EffectivenessReview_reviewCycle_check" CHECK ("reviewCycle" > 0);
CREATE UNIQUE INDEX "EffectivenessReview_nc_cycle_key" ON "EffectivenessReview" ("organisationId", "nonconformityId", "reviewCycle");
COMMIT;
