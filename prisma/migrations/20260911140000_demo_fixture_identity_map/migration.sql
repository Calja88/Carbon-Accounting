-- Checkpoint B corrective handoff §5: a schema-versioned, atomically-written
-- identity map (every id needed to re-derive the fixture's full persisted
-- state on replay) plus an implementation revision independent of the
-- public BOARD-1 fixture label, so an old READY fixture from a prior
-- verification contract is never silently reinterpreted as one this code
-- version actually knows how to verify.

ALTER TABLE "DemoFixtureLease"
  ADD COLUMN "identityMap" JSONB,
  ADD COLUMN "implementationRevision" INTEGER NOT NULL DEFAULT 0;
