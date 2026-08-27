-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "retractedAt" TIMESTAMP(3),
ADD COLUMN     "retractedByUserId" TEXT,
ADD COLUMN     "retractionReason" TEXT;

-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ActivityEntry_retractedAt_idx" ON "ActivityEntry"("retractedAt");

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_retractedByUserId_fkey" FOREIGN KEY ("retractedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
