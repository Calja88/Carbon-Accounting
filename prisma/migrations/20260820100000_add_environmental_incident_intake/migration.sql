-- CreateEnum
CREATE TYPE "EnvironmentalIncidentStatus" AS ENUM ('REPORTED', 'TRIAGED', 'INVESTIGATING', 'RESPONSE_COMPLETE', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "IncidentNotificationDecision" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "IncidentSeverityLevel" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "requiresEscalation" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentSeverityLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEscalationRule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "severityLevelId" TEXT NOT NULL,
    "recipientsPolicy" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentEscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalIncident" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3),
    "entityId" TEXT,
    "siteId" TEXT,
    "processId" TEXT,
    "aspectId" TEXT,
    "type" TEXT NOT NULL,
    "factualDescription" TEXT NOT NULL,
    "immediateResponse" TEXT,
    "potentialReceptors" TEXT,
    "severityLevelId" TEXT,
    "severityConfigSnapshot" JSONB,
    "status" "EnvironmentalIncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "reporterMembershipId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCorrection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "correctedFactualDescription" TEXT,
    "correctedImmediateResponse" TEXT,
    "correctedPotentialReceptors" TEXT,
    "reason" TEXT NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentNotificationAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorityOrParty" TEXT NOT NULL,
    "dueTrigger" TEXT,
    "decision" "IncidentNotificationDecision" NOT NULL,
    "rationale" TEXT NOT NULL,
    "reviewerMembershipId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNotificationAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentSeverityLevel_organisationId_id_key" ON "IncidentSeverityLevel"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentSeverityLevel_organisationId_key_key" ON "IncidentSeverityLevel"("organisationId", "key");

-- CreateIndex
CREATE INDEX "IncidentSeverityLevel_organisationId_isActive_idx" ON "IncidentSeverityLevel"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentEscalationRule_organisationId_id_key" ON "IncidentEscalationRule"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentEscalationRule_organisationId_severityLevelId_key" ON "IncidentEscalationRule"("organisationId", "severityLevelId");

-- CreateIndex
CREATE INDEX "IncidentEscalationRule_organisationId_isActive_idx" ON "IncidentEscalationRule"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalIncident_organisationId_id_key" ON "EnvironmentalIncident"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalIncident_organisationId_reference_key" ON "EnvironmentalIncident"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_status_idx" ON "EnvironmentalIncident"("organisationId", "status");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_restricted_idx" ON "EnvironmentalIncident"("organisationId", "restricted");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_entityId_idx" ON "EnvironmentalIncident"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_siteId_idx" ON "EnvironmentalIncident"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_processId_idx" ON "EnvironmentalIncident"("organisationId", "processId");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_aspectId_idx" ON "EnvironmentalIncident"("organisationId", "aspectId");

-- CreateIndex
CREATE INDEX "EnvironmentalIncident_organisationId_severityLevelId_idx" ON "EnvironmentalIncident"("organisationId", "severityLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentCorrection_organisationId_id_key" ON "IncidentCorrection"("organisationId", "id");

-- CreateIndex
CREATE INDEX "IncidentCorrection_organisationId_incidentId_idx" ON "IncidentCorrection"("organisationId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentNotificationAssessment_organisationId_id_key" ON "IncidentNotificationAssessment"("organisationId", "id");

-- CreateIndex
CREATE INDEX "IncidentNotificationAssessment_organisationId_incidentId_idx" ON "IncidentNotificationAssessment"("organisationId", "incidentId");

-- AddForeignKey
ALTER TABLE "IncidentSeverityLevel" ADD CONSTRAINT "IncidentSeverityLevel_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEscalationRule" ADD CONSTRAINT "IncidentEscalationRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEscalationRule" ADD CONSTRAINT "IncidentEscalationRule_organisationId_severityLevelId_fkey" FOREIGN KEY ("organisationId", "severityLevelId") REFERENCES "IncidentSeverityLevel"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_severityLevelId_fkey" FOREIGN KEY ("organisationId", "severityLevelId") REFERENCES "IncidentSeverityLevel"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalIncident" ADD CONSTRAINT "EnvironmentalIncident_organisationId_reporterMembershipId_fkey" FOREIGN KEY ("organisationId", "reporterMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCorrection" ADD CONSTRAINT "IncidentCorrection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCorrection" ADD CONSTRAINT "IncidentCorrection_organisationId_incidentId_fkey" FOREIGN KEY ("organisationId", "incidentId") REFERENCES "EnvironmentalIncident"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNotificationAssessment" ADD CONSTRAINT "IncidentNotificationAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNotificationAssessment" ADD CONSTRAINT "IncidentNotificationAssessment_organisationId_incidentId_fkey" FOREIGN KEY ("organisationId", "incidentId") REFERENCES "EnvironmentalIncident"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNotificationAssessment" ADD CONSTRAINT "IncidentNotificationAssessment_organisationId_reviewerMembershipId_fkey" FOREIGN KEY ("organisationId", "reviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
