-- T34: environmental monitoring and calibration only.
-- No environmental measurements or real equipment data are seeded.

CREATE TYPE "MonitoringPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "MonitoringDataQualityFlag" AS ENUM ('VALIDATED', 'ESTIMATED', 'SUSPECT', 'REJECTED');
CREATE TYPE "MonitoringReviewStatus" AS ENUM ('PENDING', 'REVIEWED', 'EXCEPTION_REVIEW_REQUIRED');
CREATE TYPE "MonitoringValidityDecision" AS ENUM ('VALID', 'PARTIALLY_VALID', 'INVALID');
CREATE TYPE "MonitoringEquipmentStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED');
CREATE TYPE "EquipmentCalibrationResult" AS ENUM ('PASS', 'FAIL', 'OUT_OF_TOLERANCE');

CREATE TABLE "MonitoringEquipment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "calibrationFrequency" TEXT NOT NULL,
  "status" "MonitoringEquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "calibrationDueDate" TIMESTAMP(3) NOT NULL,
  "ownerMembershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoringEquipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoringPlan" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "planKey" TEXT NOT NULL,
  "parameter" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "acceptanceCriteria" TEXT NOT NULL,
  "status" "MonitoringPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "aspectId" TEXT,
  "controlId" TEXT,
  "obligationReference" TEXT,
  "objectiveReference" TEXT,
  "responsibleMembershipId" TEXT NOT NULL,
  "instrumentRequired" BOOLEAN NOT NULL DEFAULT false,
  "equipmentId" TEXT,
  "reviewDueDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitoringPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonitoringPlan_link_check" CHECK (
    "aspectId" IS NOT NULL OR "controlId" IS NOT NULL OR
    "obligationReference" IS NOT NULL OR "objectiveReference" IS NOT NULL
  ),
  CONSTRAINT "MonitoringPlan_instrument_check" CHECK (NOT "instrumentRequired" OR "equipmentId" IS NOT NULL)
);

CREATE TABLE "MonitoringResult" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "value" DECIMAL(30,12) NOT NULL,
  "unit" TEXT NOT NULL,
  "qualitativeResult" TEXT,
  "dataQualityFlag" "MonitoringDataQualityFlag" NOT NULL,
  "reviewStatus" "MonitoringReviewStatus" NOT NULL DEFAULT 'PENDING',
  "recordedByMembershipId" TEXT NOT NULL,
  "reviewedByMembershipId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonitoringResult_period_check" CHECK (
    "periodStart" IS NULL OR "periodEnd" IS NULL OR "periodEnd" >= "periodStart"
  )
);

CREATE TABLE "EquipmentCalibration" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL,
  "provider" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "result" "EquipmentCalibrationResult" NOT NULL,
  "nextDueDate" TIMESTAMP(3) NOT NULL,
  "outOfTolerance" BOOLEAN NOT NULL,
  "responseReference" TEXT,
  "recordedByMembershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EquipmentCalibration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EquipmentCalibration_result_check" CHECK (
    "outOfTolerance" = ("result" = 'OUT_OF_TOLERANCE')
  ),
  CONSTRAINT "EquipmentCalibration_next_due_check" CHECK ("nextDueDate" >= "performedAt")
);

CREATE TABLE "MonitoringExceptionReview" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "resultId" TEXT,
  "calibrationId" TEXT,
  "reason" TEXT NOT NULL,
  "validityDecision" "MonitoringValidityDecision" NOT NULL,
  "consequence" TEXT NOT NULL,
  "actionReference" TEXT,
  "reviewedByMembershipId" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringExceptionReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonitoringExceptionReview_target_check" CHECK (
    (("resultId" IS NOT NULL)::integer + ("calibrationId" IS NOT NULL)::integer) = 1
  )
);

CREATE UNIQUE INDEX "MonitoringEquipment_organisationId_id_key" ON "MonitoringEquipment"("organisationId", "id");
CREATE UNIQUE INDEX "MonitoringEquipment_organisationId_reference_key" ON "MonitoringEquipment"("organisationId", "reference");
CREATE INDEX "MonitoringEquipment_organisationId_status_calibrationDueDate_idx" ON "MonitoringEquipment"("organisationId", "status", "calibrationDueDate");

CREATE UNIQUE INDEX "MonitoringPlan_organisationId_id_key" ON "MonitoringPlan"("organisationId", "id");
CREATE UNIQUE INDEX "MonitoringPlan_organisationId_planKey_key" ON "MonitoringPlan"("organisationId", "planKey");
CREATE INDEX "MonitoringPlan_organisationId_status_reviewDueDate_idx" ON "MonitoringPlan"("organisationId", "status", "reviewDueDate");
CREATE INDEX "MonitoringPlan_organisationId_aspectId_idx" ON "MonitoringPlan"("organisationId", "aspectId");
CREATE INDEX "MonitoringPlan_organisationId_controlId_idx" ON "MonitoringPlan"("organisationId", "controlId");
CREATE INDEX "MonitoringPlan_organisationId_equipmentId_idx" ON "MonitoringPlan"("organisationId", "equipmentId");

CREATE UNIQUE INDEX "MonitoringResult_organisationId_id_key" ON "MonitoringResult"("organisationId", "id");
CREATE INDEX "MonitoringResult_organisationId_planId_measuredAt_idx" ON "MonitoringResult"("organisationId", "planId", "measuredAt");
CREATE INDEX "MonitoringResult_organisationId_reviewStatus_idx" ON "MonitoringResult"("organisationId", "reviewStatus");

CREATE UNIQUE INDEX "EquipmentCalibration_organisationId_id_key" ON "EquipmentCalibration"("organisationId", "id");
CREATE INDEX "EquipmentCalibration_organisationId_equipmentId_performedAt_idx" ON "EquipmentCalibration"("organisationId", "equipmentId", "performedAt");
CREATE INDEX "EquipmentCalibration_organisationId_outOfTolerance_idx" ON "EquipmentCalibration"("organisationId", "outOfTolerance");

CREATE UNIQUE INDEX "MonitoringExceptionReview_organisationId_id_key" ON "MonitoringExceptionReview"("organisationId", "id");
CREATE UNIQUE INDEX "MonitoringExceptionReview_organisationId_resultId_key" ON "MonitoringExceptionReview"("organisationId", "resultId");
CREATE UNIQUE INDEX "MonitoringExceptionReview_organisationId_calibrationId_key" ON "MonitoringExceptionReview"("organisationId", "calibrationId");
CREATE INDEX "MonitoringExceptionReview_organisationId_validityDecision_idx" ON "MonitoringExceptionReview"("organisationId", "validityDecision");

ALTER TABLE "MonitoringEquipment" ADD CONSTRAINT "MonitoringEquipment_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringEquipment" ADD CONSTRAINT "MonitoringEquipment_organisationId_ownerMembershipId_fkey"
  FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MonitoringPlan" ADD CONSTRAINT "MonitoringPlan_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringPlan" ADD CONSTRAINT "MonitoringPlan_organisationId_aspectId_fkey"
  FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringPlan" ADD CONSTRAINT "MonitoringPlan_organisationId_controlId_fkey"
  FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringPlan" ADD CONSTRAINT "MonitoringPlan_organisationId_responsibleMembershipId_fkey"
  FOREIGN KEY ("organisationId", "responsibleMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringPlan" ADD CONSTRAINT "MonitoringPlan_organisationId_equipmentId_fkey"
  FOREIGN KEY ("organisationId", "equipmentId") REFERENCES "MonitoringEquipment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MonitoringResult" ADD CONSTRAINT "MonitoringResult_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringResult" ADD CONSTRAINT "MonitoringResult_organisationId_planId_fkey"
  FOREIGN KEY ("organisationId", "planId") REFERENCES "MonitoringPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringResult" ADD CONSTRAINT "MonitoringResult_organisationId_recordedByMembershipId_fkey"
  FOREIGN KEY ("organisationId", "recordedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringResult" ADD CONSTRAINT "MonitoringResult_organisationId_reviewedByMembershipId_fkey"
  FOREIGN KEY ("organisationId", "reviewedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentCalibration" ADD CONSTRAINT "EquipmentCalibration_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentCalibration" ADD CONSTRAINT "EquipmentCalibration_organisationId_equipmentId_fkey"
  FOREIGN KEY ("organisationId", "equipmentId") REFERENCES "MonitoringEquipment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentCalibration" ADD CONSTRAINT "EquipmentCalibration_organisationId_recordedByMembershipId_fkey"
  FOREIGN KEY ("organisationId", "recordedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MonitoringExceptionReview" ADD CONSTRAINT "MonitoringExceptionReview_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringExceptionReview" ADD CONSTRAINT "MonitoringExceptionReview_organisationId_resultId_fkey"
  FOREIGN KEY ("organisationId", "resultId") REFERENCES "MonitoringResult"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringExceptionReview" ADD CONSTRAINT "MonitoringExceptionReview_organisationId_calibrationId_fkey"
  FOREIGN KEY ("organisationId", "calibrationId") REFERENCES "EquipmentCalibration"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringExceptionReview" ADD CONSTRAINT "MonitoringExceptionReview_organisationId_reviewedByMembershipId_fkey"
  FOREIGN KEY ("organisationId", "reviewedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
