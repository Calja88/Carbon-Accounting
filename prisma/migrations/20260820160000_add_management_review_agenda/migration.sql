-- CreateEnum
CREATE TYPE "ManagementReviewStatus" AS ENUM ('PLANNED', 'INPUT_COLLECTION', 'PACK_ISSUED', 'HELD', 'MINUTES_DRAFT', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ManagementReviewAgendaTemplateVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ManagementReviewAttendeeRole" AS ENUM ('CHAIR', 'COORDINATOR', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "ManagementReviewInputSourceType" AS ENUM ('COMPLIANCE_EVALUATION', 'ACTION_PROGRAMME', 'AUDIT_REPORT', 'CORRECTIVE_ACTION', 'COMPETENCE_GAP', 'OTHER');

-- CreateTable
CREATE TABLE "ManagementReviewAgendaTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewAgendaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewAgendaTemplateVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ManagementReviewAgendaTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revisionRationale" TEXT,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewAgendaTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewAgendaItemDefinition" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "inputDefinitionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReviewAgendaItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewInputDefinition" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" "ManagementReviewInputSourceType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "periodRule" TEXT,
    "presentationConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewInputDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cutoffDate" TIMESTAMP(3) NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "heldDate" TIMESTAMP(3),
    "chairMembershipId" TEXT NOT NULL,
    "coordinatorMembershipId" TEXT NOT NULL,
    "agendaTemplateId" TEXT NOT NULL,
    "agendaTemplateVersionId" TEXT NOT NULL,
    "status" "ManagementReviewStatus" NOT NULL DEFAULT 'PLANNED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewAttendee" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "ManagementReviewAttendeeRole" NOT NULL DEFAULT 'MEMBER',
    "invited" BOOLEAN NOT NULL DEFAULT true,
    "attended" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewInputLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "inputDefinitionKey" TEXT NOT NULL,
    "sourceType" "ManagementReviewInputSourceType" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceVersionLabel" TEXT,
    "summary" JSONB,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "linkedByMembershipId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReviewInputLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplate_activeVersionId_key" ON "ManagementReviewAgendaTemplate"("activeVersionId");

-- CreateIndex
CREATE INDEX "ManagementReviewAgendaTemplate_organisationId_idx" ON "ManagementReviewAgendaTemplate"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplate_organisationId_id_key" ON "ManagementReviewAgendaTemplate"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplate_organisationId_templateKey_key" ON "ManagementReviewAgendaTemplate"("organisationId", "templateKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplate_organisationId_activeVersion_key" ON "ManagementReviewAgendaTemplate"("organisationId", "activeVersionId");

-- CreateIndex
CREATE INDEX "ManagementReviewAgendaTemplateVersion_organisationId_templa_idx" ON "ManagementReviewAgendaTemplateVersion"("organisationId", "templateId", "status");

-- CreateIndex
CREATE INDEX "ManagementReviewAgendaTemplateVersion_organisationId_status_idx" ON "ManagementReviewAgendaTemplateVersion"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplateVersion_organisationId_id_key" ON "ManagementReviewAgendaTemplateVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplateVersion_organisationId_templa_key" ON "ManagementReviewAgendaTemplateVersion"("organisationId", "templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaTemplateVersion_organisationId_supers_key" ON "ManagementReviewAgendaTemplateVersion"("organisationId", "supersedesVersionId");

-- CreateIndex
CREATE INDEX "ManagementReviewAgendaItemDefinition_organisationId_templat_idx" ON "ManagementReviewAgendaItemDefinition"("organisationId", "templateVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAgendaItemDefinition_organisationId_templat_key" ON "ManagementReviewAgendaItemDefinition"("organisationId", "templateVersionId", "order");

-- CreateIndex
CREATE INDEX "ManagementReviewInputDefinition_organisationId_isActive_idx" ON "ManagementReviewInputDefinition"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewInputDefinition_organisationId_id_key" ON "ManagementReviewInputDefinition"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewInputDefinition_organisationId_key_key" ON "ManagementReviewInputDefinition"("organisationId", "key");

-- CreateIndex
CREATE INDEX "ManagementReview_organisationId_status_idx" ON "ManagementReview"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ManagementReview_organisationId_scheduledDate_idx" ON "ManagementReview"("organisationId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReview_organisationId_id_key" ON "ManagementReview"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReview_organisationId_reference_key" ON "ManagementReview"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "ManagementReviewAttendee_organisationId_reviewId_idx" ON "ManagementReviewAttendee"("organisationId", "reviewId");

-- CreateIndex
CREATE INDEX "ManagementReviewAttendee_organisationId_personId_idx" ON "ManagementReviewAttendee"("organisationId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAttendee_organisationId_reviewId_personId_key" ON "ManagementReviewAttendee"("organisationId", "reviewId", "personId");

-- CreateIndex
CREATE INDEX "ManagementReviewInputLink_organisationId_reviewId_idx" ON "ManagementReviewInputLink"("organisationId", "reviewId");

-- CreateIndex
CREATE INDEX "ManagementReviewInputLink_organisationId_inputDefinitionKey_idx" ON "ManagementReviewInputLink"("organisationId", "inputDefinitionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewInputLink_unique_source" ON "ManagementReviewInputLink"("organisationId", "reviewId", "inputDefinitionKey", "sourceRecordId");

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaTemplate" ADD CONSTRAINT "ManagementReviewAgendaTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaTemplate" ADD CONSTRAINT "ManagementReviewAgendaTemplate_organisationId_activeVersio_fkey" FOREIGN KEY ("organisationId", "activeVersionId") REFERENCES "ManagementReviewAgendaTemplateVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaTemplateVersion" ADD CONSTRAINT "ManagementReviewAgendaTemplateVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaTemplateVersion" ADD CONSTRAINT "ManagementReviewAgendaTemplateVersion_organisationId_templ_fkey" FOREIGN KEY ("organisationId", "templateId") REFERENCES "ManagementReviewAgendaTemplate"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaTemplateVersion" ADD CONSTRAINT "ManagementReviewAgendaTemplateVersion_organisationId_super_fkey" FOREIGN KEY ("organisationId", "supersedesVersionId") REFERENCES "ManagementReviewAgendaTemplateVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaItemDefinition" ADD CONSTRAINT "ManagementReviewAgendaItemDefinition_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAgendaItemDefinition" ADD CONSTRAINT "ManagementReviewAgendaItemDefinition_organisationId_templa_fkey" FOREIGN KEY ("organisationId", "templateVersionId") REFERENCES "ManagementReviewAgendaTemplateVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputDefinition" ADD CONSTRAINT "ManagementReviewInputDefinition_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_organisationId_chairMembershipId_fkey" FOREIGN KEY ("organisationId", "chairMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_organisationId_coordinatorMembershipId_fkey" FOREIGN KEY ("organisationId", "coordinatorMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_organisationId_agendaTemplateId_fkey" FOREIGN KEY ("organisationId", "agendaTemplateId") REFERENCES "ManagementReviewAgendaTemplate"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReview" ADD CONSTRAINT "ManagementReview_organisationId_agendaTemplateVersionId_fkey" FOREIGN KEY ("organisationId", "agendaTemplateVersionId") REFERENCES "ManagementReviewAgendaTemplateVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAttendee" ADD CONSTRAINT "ManagementReviewAttendee_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAttendee" ADD CONSTRAINT "ManagementReviewAttendee_organisationId_reviewId_fkey" FOREIGN KEY ("organisationId", "reviewId") REFERENCES "ManagementReview"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAttendee" ADD CONSTRAINT "ManagementReviewAttendee_organisationId_personId_fkey" FOREIGN KEY ("organisationId", "personId") REFERENCES "PersonProfile"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputLink" ADD CONSTRAINT "ManagementReviewInputLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputLink" ADD CONSTRAINT "ManagementReviewInputLink_organisationId_reviewId_fkey" FOREIGN KEY ("organisationId", "reviewId") REFERENCES "ManagementReview"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputLink" ADD CONSTRAINT "ManagementReviewInputLink_organisationId_linkedByMembershi_fkey" FOREIGN KEY ("organisationId", "linkedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

