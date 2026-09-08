-- T35: external providers, communications and emergency preparedness only.
-- No real emergency contacts or environmental performance data are seeded.

-- CreateEnum
CREATE TYPE "ExternalProviderControlStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ExternalProviderEvaluationResult" AS ENUM ('PASS', 'CONDITIONAL', 'FAIL');

-- CreateEnum
CREATE TYPE "CommunicationAudience" AS ENUM ('INTERNAL', 'EXTERNAL', 'BOTH');

-- CreateEnum
CREATE TYPE "CommunicationPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmergencyScenarioPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EmergencyScenarioStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmergencyPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmergencyExerciseType" AS ENUM ('TABLETOP', 'DRILL', 'FULL_SCALE');

-- CreateEnum
CREATE TYPE "EmergencyExerciseOutcome" AS ENUM ('SUCCESSFUL', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "EmergencyExerciseActionStatus" AS ENUM ('OPEN', 'COMPLETE');

-- CreateTable
CREATE TABLE "ExternalProviderControl" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providedDescription" TEXT NOT NULL,
    "communicatedRequirements" TEXT NOT NULL,
    "evaluationFrequency" TEXT NOT NULL,
    "status" "ExternalProviderControlStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerMembershipId" TEXT NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewDueDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalProviderControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProviderControlAspect" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "providerControlId" TEXT NOT NULL,
    "aspectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalProviderControlAspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProviderEvaluation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "providerControlId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "criteriaSnapshot" JSONB NOT NULL,
    "result" "ExternalProviderEvaluationResult" NOT NULL,
    "notes" TEXT,
    "actionReference" TEXT,
    "reviewerMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalProviderEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "audience" "CommunicationAudience" NOT NULL,
    "triggerFrequency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "sourceRequirements" TEXT,
    "status" "CommunicationPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "audience" "CommunicationAudience" NOT NULL,
    "parties" TEXT NOT NULL,
    "contentSummary" TEXT NOT NULL,
    "approvedContentRevisionId" TEXT,
    "senderMembershipId" TEXT NOT NULL,
    "approverMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "responseFollowUp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyScenario" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "aspectId" TEXT,
    "processId" TEXT,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "triggerDescription" TEXT NOT NULL,
    "receptors" TEXT NOT NULL,
    "credibleConsequence" TEXT NOT NULL,
    "priority" "EmergencyScenarioPriority" NOT NULL,
    "controlsSummary" TEXT,
    "reviewDueDate" TIMESTAMP(3) NOT NULL,
    "status" "EmergencyScenarioStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EmergencyPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "controlledDocumentRevisionId" TEXT NOT NULL,
    "roles" TEXT NOT NULL,
    "resources" TEXT NOT NULL,
    "communicationPlanId" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "reviewDueDate" TIMESTAMP(3) NOT NULL,
    "supersedesPlanId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyExercise" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "type" "EmergencyExerciseType" NOT NULL,
    "exerciseDate" TIMESTAMP(3) NOT NULL,
    "participantMembershipIds" TEXT[],
    "objectives" TEXT NOT NULL,
    "outcome" "EmergencyExerciseOutcome" NOT NULL,
    "observations" TEXT,
    "lessons" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyExerciseAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerMembershipId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "EmergencyExerciseActionStatus" NOT NULL DEFAULT 'OPEN',
    "actionReference" TEXT,
    "incidentReference" TEXT,
    "nonconformityReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyExerciseAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalProviderControl_organisationId_status_nextReviewDue_idx" ON "ExternalProviderControl"("organisationId", "status", "nextReviewDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProviderControl_organisationId_id_key" ON "ExternalProviderControl"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProviderControl_organisationId_providerReference_key" ON "ExternalProviderControl"("organisationId", "providerReference");

-- CreateIndex
CREATE INDEX "ExternalProviderControlAspect_organisationId_aspectId_idx" ON "ExternalProviderControlAspect"("organisationId", "aspectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProviderControlAspect_provider_aspect_key" ON "ExternalProviderControlAspect"("organisationId", "providerControlId", "aspectId");

-- CreateIndex
CREATE INDEX "ExternalProviderEvaluation_organisationId_providerControlId_idx" ON "ExternalProviderEvaluation"("organisationId", "providerControlId", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProviderEvaluation_organisationId_id_key" ON "ExternalProviderEvaluation"("organisationId", "id");

-- CreateIndex
CREATE INDEX "CommunicationPlan_organisationId_status_idx" ON "CommunicationPlan"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPlan_organisationId_id_key" ON "CommunicationPlan"("organisationId", "id");

-- CreateIndex
CREATE INDEX "CommunicationRecord_organisationId_planId_idx" ON "CommunicationRecord"("organisationId", "planId");

-- CreateIndex
CREATE INDEX "CommunicationRecord_organisationId_occurredAt_idx" ON "CommunicationRecord"("organisationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRecord_organisationId_id_key" ON "CommunicationRecord"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmergencyScenario_organisationId_status_reviewDueDate_idx" ON "EmergencyScenario"("organisationId", "status", "reviewDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyScenario_organisationId_id_key" ON "EmergencyScenario"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmergencyPlan_organisationId_status_reviewDueDate_idx" ON "EmergencyPlan"("organisationId", "status", "reviewDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlan_organisationId_id_key" ON "EmergencyPlan"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlan_organisationId_scenarioId_version_key" ON "EmergencyPlan"("organisationId", "scenarioId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlan_organisationId_supersedesPlanId_key" ON "EmergencyPlan"("organisationId", "supersedesPlanId");

-- CreateIndex
CREATE INDEX "EmergencyExercise_organisationId_scenarioId_exerciseDate_idx" ON "EmergencyExercise"("organisationId", "scenarioId", "exerciseDate");

-- CreateIndex
CREATE INDEX "EmergencyExercise_organisationId_planId_idx" ON "EmergencyExercise"("organisationId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyExercise_organisationId_id_key" ON "EmergencyExercise"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmergencyExerciseAction_organisationId_exerciseId_idx" ON "EmergencyExerciseAction"("organisationId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyExerciseAction_organisationId_id_key" ON "EmergencyExerciseAction"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "ExternalProviderControl" ADD CONSTRAINT "ExternalProviderControl_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderControl" ADD CONSTRAINT "ExternalProviderControl_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderControl" ADD CONSTRAINT "ExternalProviderControl_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderControlAspect" ADD CONSTRAINT "ExternalProviderControlAspect_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderControlAspect" ADD CONSTRAINT "ExternalProviderControlAspect_organisationId_providerContr_fkey" FOREIGN KEY ("organisationId", "providerControlId") REFERENCES "ExternalProviderControl"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderControlAspect" ADD CONSTRAINT "ExternalProviderControlAspect_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderEvaluation" ADD CONSTRAINT "ExternalProviderEvaluation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderEvaluation" ADD CONSTRAINT "ExternalProviderEvaluation_organisationId_providerControlI_fkey" FOREIGN KEY ("organisationId", "providerControlId") REFERENCES "ExternalProviderControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProviderEvaluation" ADD CONSTRAINT "ExternalProviderEvaluation_organisationId_reviewerMembersh_fkey" FOREIGN KEY ("organisationId", "reviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationPlan" ADD CONSTRAINT "CommunicationPlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationPlan" ADD CONSTRAINT "CommunicationPlan_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecord" ADD CONSTRAINT "CommunicationRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecord" ADD CONSTRAINT "CommunicationRecord_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "CommunicationPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecord" ADD CONSTRAINT "CommunicationRecord_organisationId_approvedContentRevision_fkey" FOREIGN KEY ("organisationId", "approvedContentRevisionId") REFERENCES "ControlledDocumentRevision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecord" ADD CONSTRAINT "CommunicationRecord_organisationId_senderMembershipId_fkey" FOREIGN KEY ("organisationId", "senderMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationRecord" ADD CONSTRAINT "CommunicationRecord_organisationId_approverMembershipId_fkey" FOREIGN KEY ("organisationId", "approverMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyScenario" ADD CONSTRAINT "EmergencyScenario_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyScenario" ADD CONSTRAINT "EmergencyScenario_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyScenario" ADD CONSTRAINT "EmergencyScenario_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyScenario" ADD CONSTRAINT "EmergencyScenario_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_organisationId_scenarioId_fkey" FOREIGN KEY ("organisationId", "scenarioId") REFERENCES "EmergencyScenario"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_organisationId_controlledDocumentRevisionId_fkey" FOREIGN KEY ("organisationId", "controlledDocumentRevisionId") REFERENCES "ControlledDocumentRevision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_organisationId_communicationPlanId_fkey" FOREIGN KEY ("organisationId", "communicationPlanId") REFERENCES "CommunicationPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_organisationId_supersedesPlanId_fkey" FOREIGN KEY ("organisationId", "supersedesPlanId") REFERENCES "EmergencyPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlan" ADD CONSTRAINT "EmergencyPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExercise" ADD CONSTRAINT "EmergencyExercise_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExercise" ADD CONSTRAINT "EmergencyExercise_organisationId_scenarioId_fkey" FOREIGN KEY ("organisationId", "scenarioId") REFERENCES "EmergencyScenario"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExercise" ADD CONSTRAINT "EmergencyExercise_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "EmergencyPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExercise" ADD CONSTRAINT "EmergencyExercise_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExerciseAction" ADD CONSTRAINT "EmergencyExerciseAction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExerciseAction" ADD CONSTRAINT "EmergencyExerciseAction_organisationId_exerciseId_fkey" FOREIGN KEY ("organisationId", "exerciseId") REFERENCES "EmergencyExercise"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyExerciseAction" ADD CONSTRAINT "EmergencyExerciseAction_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

