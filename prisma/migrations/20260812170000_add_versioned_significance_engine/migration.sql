-- T32: organisation-scoped, versioned significance methods and assessment
-- snapshots. No reference/environmental values are seeded by this migration.

CREATE TYPE "SignificanceFormula" AS ENUM ('WEIGHTED_SUM', 'MAX_CRITERION', 'RULE_SET');
CREATE TYPE "SignificanceMethodStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');
CREATE TYPE "AspectAssessmentStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

CREATE TABLE "SignificanceMethod" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "methodKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "SignificanceMethodStatus" NOT NULL DEFAULT 'DRAFT',
  "formula" "SignificanceFormula" NOT NULL,
  "formulaConfig" JSONB NOT NULL,
  "threshold" DECIMAL(24,10) NOT NULL,
  "preparedByMembershipId" TEXT NOT NULL,
  "approvedByMembershipId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "supersedesMethodId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignificanceMethod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignificanceCriterion" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "methodId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "scaleConfig" JSONB NOT NULL,
  "weight" DECIMAL(24,10),
  "required" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignificanceCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AspectAssessment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "aspectId" TEXT NOT NULL,
  "methodId" TEXT NOT NULL,
  "assessmentVersion" INTEGER NOT NULL,
  "status" "AspectAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
  "methodKeySnapshot" TEXT NOT NULL,
  "methodVersionSnapshot" INTEGER NOT NULL,
  "formulaSnapshot" "SignificanceFormula" NOT NULL,
  "formulaConfigSnapshot" JSONB NOT NULL,
  "thresholdSnapshot" DECIMAL(24,10) NOT NULL,
  "criteriaSnapshot" JSONB NOT NULL,
  "criterionInputs" JSONB NOT NULL,
  "calculatedScore" DECIMAL(24,10) NOT NULL,
  "calculatedSignificant" BOOLEAN NOT NULL,
  "calculationTrace" JSONB NOT NULL,
  "overrideSignificant" BOOLEAN,
  "overrideRationale" TEXT,
  "finalSignificant" BOOLEAN NOT NULL,
  "assessedByMembershipId" TEXT NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByMembershipId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "supersedesAssessmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AspectAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignificanceMethod_organisationId_id_key" ON "SignificanceMethod"("organisationId", "id");
CREATE UNIQUE INDEX "SignificanceMethod_organisationId_methodKey_version_key" ON "SignificanceMethod"("organisationId", "methodKey", "version");
CREATE UNIQUE INDEX "SignificanceMethod_organisationId_supersedesMethodId_key" ON "SignificanceMethod"("organisationId", "supersedesMethodId");
CREATE INDEX "SignificanceMethod_organisationId_programmeId_status_idx" ON "SignificanceMethod"("organisationId", "programmeId", "status");
CREATE UNIQUE INDEX "SignificanceCriterion_organisationId_methodId_key_key" ON "SignificanceCriterion"("organisationId", "methodId", "key");
CREATE INDEX "SignificanceCriterion_organisationId_methodId_sortOrder_idx" ON "SignificanceCriterion"("organisationId", "methodId", "sortOrder");
CREATE UNIQUE INDEX "AspectAssessment_organisationId_id_key" ON "AspectAssessment"("organisationId", "id");
CREATE UNIQUE INDEX "AspectAssessment_organisationId_aspectId_assessmentVersion_key" ON "AspectAssessment"("organisationId", "aspectId", "assessmentVersion");
CREATE UNIQUE INDEX "AspectAssessment_organisationId_supersedesAssessmentId_key" ON "AspectAssessment"("organisationId", "supersedesAssessmentId");
CREATE INDEX "AspectAssessment_organisationId_aspectId_status_idx" ON "AspectAssessment"("organisationId", "aspectId", "status");
CREATE INDEX "AspectAssessment_organisationId_methodId_idx" ON "AspectAssessment"("organisationId", "methodId");

ALTER TABLE "SignificanceMethod" ADD CONSTRAINT "SignificanceMethod_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceMethod" ADD CONSTRAINT "SignificanceMethod_organisationId_programmeId_fkey" FOREIGN KEY ("organisationId", "programmeId") REFERENCES "EmsProgramme"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceMethod" ADD CONSTRAINT "SignificanceMethod_preparedBy_fkey" FOREIGN KEY ("organisationId", "preparedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceMethod" ADD CONSTRAINT "SignificanceMethod_approvedBy_fkey" FOREIGN KEY ("organisationId", "approvedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceMethod" ADD CONSTRAINT "SignificanceMethod_supersedes_fkey" FOREIGN KEY ("organisationId", "supersedesMethodId") REFERENCES "SignificanceMethod"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceCriterion" ADD CONSTRAINT "SignificanceCriterion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignificanceCriterion" ADD CONSTRAINT "SignificanceCriterion_method_fkey" FOREIGN KEY ("organisationId", "methodId") REFERENCES "SignificanceMethod"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_aspect_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_method_fkey" FOREIGN KEY ("organisationId", "methodId") REFERENCES "SignificanceMethod"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_assessedBy_fkey" FOREIGN KEY ("organisationId", "assessedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_approvedBy_fkey" FOREIGN KEY ("organisationId", "approvedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AspectAssessment" ADD CONSTRAINT "AspectAssessment_supersedes_fkey" FOREIGN KEY ("organisationId", "supersedesAssessmentId") REFERENCES "AspectAssessment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defence in depth: services expose successor operations rather than generic
-- mutation, and these triggers prevent direct writes from rewriting history.
CREATE FUNCTION significance_method_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'SignificanceMethod % is % and is immutable', OLD."id", OLD."status";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."organisationId" IS DISTINCT FROM OLD."organisationId" OR
    NEW."programmeId" IS DISTINCT FROM OLD."programmeId" OR
    NEW."methodKey" IS DISTINCT FROM OLD."methodKey" OR
    NEW."name" IS DISTINCT FROM OLD."name" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."formula" IS DISTINCT FROM OLD."formula" OR
    NEW."formulaConfig" IS DISTINCT FROM OLD."formulaConfig" OR
    NEW."threshold" IS DISTINCT FROM OLD."threshold" OR
    NEW."preparedByMembershipId" IS DISTINCT FROM OLD."preparedByMembershipId" OR
    NEW."approvedByMembershipId" IS DISTINCT FROM OLD."approvedByMembershipId" OR
    NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR
    NEW."supersedesMethodId" IS DISTINCT FROM OLD."supersedesMethodId" OR
    NEW."status" NOT IN (OLD."status", 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'SignificanceMethod % is % and is immutable', OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER significance_method_immutable
  BEFORE UPDATE OR DELETE ON "SignificanceMethod"
  FOR EACH ROW EXECUTE FUNCTION significance_method_immutable_once_approved();

CREATE FUNCTION significance_criterion_immutable_with_approved_method() RETURNS trigger AS $$
DECLARE method_status "SignificanceMethodStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "status" INTO method_status FROM "SignificanceMethod"
      WHERE "organisationId" = OLD."organisationId" AND "id" = OLD."methodId";
  ELSE
    SELECT "status" INTO method_status FROM "SignificanceMethod"
      WHERE "organisationId" = NEW."organisationId" AND "id" = NEW."methodId";
  END IF;
  IF method_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Criteria for approved SignificanceMethod are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER significance_criterion_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "SignificanceCriterion"
  FOR EACH ROW EXECUTE FUNCTION significance_criterion_immutable_with_approved_method();

CREATE FUNCTION aspect_assessment_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'AspectAssessment % is % and is immutable', OLD."id", OLD."status";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."organisationId" IS DISTINCT FROM OLD."organisationId" OR
    NEW."aspectId" IS DISTINCT FROM OLD."aspectId" OR
    NEW."methodId" IS DISTINCT FROM OLD."methodId" OR
    NEW."assessmentVersion" IS DISTINCT FROM OLD."assessmentVersion" OR
    NEW."methodKeySnapshot" IS DISTINCT FROM OLD."methodKeySnapshot" OR
    NEW."methodVersionSnapshot" IS DISTINCT FROM OLD."methodVersionSnapshot" OR
    NEW."formulaSnapshot" IS DISTINCT FROM OLD."formulaSnapshot" OR
    NEW."formulaConfigSnapshot" IS DISTINCT FROM OLD."formulaConfigSnapshot" OR
    NEW."thresholdSnapshot" IS DISTINCT FROM OLD."thresholdSnapshot" OR
    NEW."criteriaSnapshot" IS DISTINCT FROM OLD."criteriaSnapshot" OR
    NEW."criterionInputs" IS DISTINCT FROM OLD."criterionInputs" OR
    NEW."calculatedScore" IS DISTINCT FROM OLD."calculatedScore" OR
    NEW."calculatedSignificant" IS DISTINCT FROM OLD."calculatedSignificant" OR
    NEW."calculationTrace" IS DISTINCT FROM OLD."calculationTrace" OR
    NEW."overrideSignificant" IS DISTINCT FROM OLD."overrideSignificant" OR
    NEW."overrideRationale" IS DISTINCT FROM OLD."overrideRationale" OR
    NEW."finalSignificant" IS DISTINCT FROM OLD."finalSignificant" OR
    NEW."assessedByMembershipId" IS DISTINCT FROM OLD."assessedByMembershipId" OR
    NEW."assessedAt" IS DISTINCT FROM OLD."assessedAt" OR
    NEW."approvedByMembershipId" IS DISTINCT FROM OLD."approvedByMembershipId" OR
    NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR
    NEW."supersedesAssessmentId" IS DISTINCT FROM OLD."supersedesAssessmentId" OR
    NEW."status" NOT IN (OLD."status", 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'AspectAssessment % is % and is immutable', OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aspect_assessment_immutable
  BEFORE UPDATE OR DELETE ON "AspectAssessment"
  FOR EACH ROW EXECUTE FUNCTION aspect_assessment_immutable_once_approved();
