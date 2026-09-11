-- Checkpoint B required fix 8: the board-sprint's own frozen management
-- pack (FrozenBoardPack), previously missing entirely — createFrozenManagementPack
-- only ever produced the unrelated, pre-existing T73 ManagementReviewPack.

CREATE TYPE "BoardManagementPackStatus" AS ENUM ('DRAFT', 'ISSUED');

CREATE TABLE "BoardManagementPack" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BoardManagementPackStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshot" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "preparedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardManagementPack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardManagementPack_organisationId_reference_key"
  ON "BoardManagementPack"("organisationId", "reference");
