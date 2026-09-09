-- T33: operational controls and review cycle only.
-- No environmental performance data or reference records are seeded.

CREATE TYPE "OperationalControlType" AS ENUM (
  'ENGINEERING', 'PROCEDURAL', 'MONITORING', 'COMPETENCE',
  'PROCUREMENT', 'EMERGENCY', 'OTHER'
);

CREATE TYPE "OperationalControlStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');
CREATE TYPE "ControlCheckResult" AS ENUM ('PENDING', 'PASS', 'FAIL', 'NOT_APPLICABLE');

CREATE TABLE "OperationalControl" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "controlKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "type" "OperationalControlType" NOT NULL,
  "status" "OperationalControlStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "frequency" TEXT,
  "acceptanceCriteria" TEXT,
  "effectivenessCriteria" TEXT,
  "ownerMembershipId" TEXT NOT NULL,
  "controlledDocumentRevisionId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewDueDate" TIMESTAMP(3) NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "supersedesControlId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalControl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalControlAspect" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "aspectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalControlAspect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ControlApplicability" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "entityId" TEXT,
  "siteId" TEXT,
  "processId" TEXT,
  "externalProviderReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ControlApplicability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ControlCheck" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "performedAt" TIMESTAMP(3),
  "result" "ControlCheckResult" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "exceptionSummary" TEXT,
  "actionReference" TEXT,
  "reviewerMembershipId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ControlCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalControl_organisationId_id_key" ON "OperationalControl"("organisationId", "id");
CREATE UNIQUE INDEX "OperationalControl_organisationId_controlKey_version_key" ON "OperationalControl"("organisationId", "controlKey", "version");
CREATE UNIQUE INDEX "OperationalControl_organisationId_supersedesControlId_key" ON "OperationalControl"("organisationId", "supersedesControlId");
CREATE INDEX "OperationalControl_organisationId_status_reviewDueDate_idx" ON "OperationalControl"("organisationId", "status", "reviewDueDate");
CREATE INDEX "OperationalControl_organisationId_ownerMembershipId_idx" ON "OperationalControl"("organisationId", "ownerMembershipId");

CREATE UNIQUE INDEX "OperationalControlAspect_control_aspect_key" ON "OperationalControlAspect"("organisationId", "controlId", "aspectId");
CREATE INDEX "OperationalControlAspect_organisationId_aspectId_idx" ON "OperationalControlAspect"("organisationId", "aspectId");

CREATE UNIQUE INDEX "ControlApplicability_scope_key"
  ON "ControlApplicability"("organisationId", "controlId", "entityId", "siteId", "processId", "externalProviderReference");
CREATE INDEX "ControlApplicability_organisationId_controlId_idx" ON "ControlApplicability"("organisationId", "controlId");
CREATE INDEX "ControlApplicability_organisationId_entityId_idx" ON "ControlApplicability"("organisationId", "entityId");
CREATE INDEX "ControlApplicability_organisationId_siteId_idx" ON "ControlApplicability"("organisationId", "siteId");
CREATE INDEX "ControlApplicability_organisationId_processId_idx" ON "ControlApplicability"("organisationId", "processId");

CREATE UNIQUE INDEX "ControlCheck_organisationId_id_key" ON "ControlCheck"("organisationId", "id");
CREATE INDEX "ControlCheck_organisationId_controlId_scheduledAt_idx" ON "ControlCheck"("organisationId", "controlId", "scheduledAt");
CREATE INDEX "ControlCheck_organisationId_result_idx" ON "ControlCheck"("organisationId", "result");

ALTER TABLE "OperationalControl" ADD CONSTRAINT "OperationalControl_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalControl" ADD CONSTRAINT "OperationalControl_organisationId_ownerMembershipId_fkey"
  FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalControl" ADD CONSTRAINT "OperationalControl_organisationId_controlledDocumentRevisionId_fkey"
  FOREIGN KEY ("organisationId", "controlledDocumentRevisionId") REFERENCES "ControlledDocumentRevision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalControl" ADD CONSTRAINT "OperationalControl_organisationId_supersedesControlId_fkey"
  FOREIGN KEY ("organisationId", "supersedesControlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalControl" ADD CONSTRAINT "OperationalControl_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperationalControlAspect" ADD CONSTRAINT "OperationalControlAspect_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalControlAspect" ADD CONSTRAINT "OperationalControlAspect_organisationId_controlId_fkey"
  FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalControlAspect" ADD CONSTRAINT "OperationalControlAspect_organisationId_aspectId_fkey"
  FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ControlApplicability" ADD CONSTRAINT "ControlApplicability_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlApplicability" ADD CONSTRAINT "ControlApplicability_organisationId_controlId_fkey"
  FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ControlApplicability" ADD CONSTRAINT "ControlApplicability_organisationId_entityId_fkey"
  FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlApplicability" ADD CONSTRAINT "ControlApplicability_organisationId_siteId_fkey"
  FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlApplicability" ADD CONSTRAINT "ControlApplicability_organisationId_processId_fkey"
  FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ControlCheck" ADD CONSTRAINT "ControlCheck_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlCheck" ADD CONSTRAINT "ControlCheck_organisationId_controlId_fkey"
  FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlCheck" ADD CONSTRAINT "ControlCheck_organisationId_reviewerMembershipId_fkey"
  FOREIGN KEY ("organisationId", "reviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
