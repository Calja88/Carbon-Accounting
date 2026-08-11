-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'READ', 'DISMISSED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "reminderRuleId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'ONCE',
    "recipientsPolicy" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_organisationId_recipientMembershipId_status_idx" ON "Notification"("organisationId", "recipientMembershipId", "status");

-- CreateIndex
CREATE INDEX "Notification_organisationId_resourceType_resourceId_idx" ON "Notification"("organisationId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organisationId_recipientMembershipId_dedupeKey_key" ON "Notification"("organisationId", "recipientMembershipId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ReminderRule_organisationId_resourceType_isActive_idx" ON "ReminderRule"("organisationId", "resourceType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderRule_organisationId_resourceType_event_key" ON "ReminderRule"("organisationId", "resourceType", "event");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientMembershipId_fkey" FOREIGN KEY ("recipientMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reminderRuleId_fkey" FOREIGN KEY ("reminderRuleId") REFERENCES "ReminderRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
