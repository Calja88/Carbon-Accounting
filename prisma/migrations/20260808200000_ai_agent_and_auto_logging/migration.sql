-- CreateEnum
CREATE TYPE "AiDataEntryMode" AS ENUM ('REVIEW_ALL', 'AUTO_LOG_HIGH_CONFIDENCE');

-- AlterEnum
ALTER TYPE "DataOrigin" ADD VALUE 'AI_CHAT';

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "autoExtractAttachments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dataEntryMode" "AiDataEntryMode" NOT NULL DEFAULT 'AUTO_LOG_HIGH_CONFIDENCE';

-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "aiIdempotencyKey" TEXT,
ADD COLUMN     "aiInteractionId" TEXT,
ADD COLUMN     "autoLogged" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEntry_aiIdempotencyKey_key" ON "ActivityEntry"("aiIdempotencyKey");
