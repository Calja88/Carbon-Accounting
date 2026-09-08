-- Phase 1 tenancy (T19): membership and role administration UI.
-- Stubbed invitation-token lifecycle: no email is ever sent. The admin UI
-- surfaces the plaintext token once, at issue/resend time; only its SHA-256
-- hash and expiry are persisted here.

-- AlterTable
ALTER TABLE "OrganisationMembership" ADD COLUMN     "inviteTokenHash" TEXT;
ALTER TABLE "OrganisationMembership" ADD COLUMN     "inviteTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationMembership_inviteTokenHash_key" ON "OrganisationMembership"("inviteTokenHash");
