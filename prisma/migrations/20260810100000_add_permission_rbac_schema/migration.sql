
-- CreateEnum
CREATE TYPE "RoleTemplateKey" AS ENUM ('SUSTAINABILITY_LEAD', 'EMS_CONTRIBUTOR', 'SITE_MANAGER', 'AUDITOR', 'FINANCE_READ_ONLY', 'ORGANISATION_ADMINISTRATOR');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "organisationId" TEXT;

-- CreateTable
CREATE TABLE "PermissionDefinition" (
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateKey" "RoleTemplateKey",
    "isSystemSeeded" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "organisationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" TEXT,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "organisationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "MembershipEntityScope" (
    "organisationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "MembershipEntityScope_pkey" PRIMARY KEY ("membershipId","entityId")
);

-- CreateTable
CREATE TABLE "MembershipSiteScope" (
    "organisationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "MembershipSiteScope_pkey" PRIMARY KEY ("membershipId","siteId")
);

-- CreateIndex
CREATE INDEX "PermissionDefinition_domain_idx" ON "PermissionDefinition"("domain");

-- CreateIndex
CREATE INDEX "RoleDefinition_organisationId_isActive_idx" ON "RoleDefinition"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_organisationId_name_key" ON "RoleDefinition"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_organisationId_id_key" ON "RoleDefinition"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_organisationId_templateKey_key" ON "RoleDefinition"("organisationId", "templateKey");

-- CreateIndex
CREATE INDEX "RolePermission_organisationId_permissionCode_idx" ON "RolePermission"("organisationId", "permissionCode");

-- CreateIndex
CREATE INDEX "MembershipRole_organisationId_roleId_idx" ON "MembershipRole"("organisationId", "roleId");

-- CreateIndex
CREATE INDEX "MembershipEntityScope_organisationId_entityId_idx" ON "MembershipEntityScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "MembershipSiteScope_organisationId_siteId_idx" ON "MembershipSiteScope"("organisationId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Entity_organisationId_id_key" ON "Entity"("organisationId", "id");

-- CreateIndex
CREATE INDEX "Site_organisationId_idx" ON "Site"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_organisationId_id_key" ON "Site"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_organisationId_roleId_fkey" FOREIGN KEY ("organisationId", "roleId") REFERENCES "RoleDefinition"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "PermissionDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_organisationId_membershipId_fkey" FOREIGN KEY ("organisationId", "membershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_organisationId_roleId_fkey" FOREIGN KEY ("organisationId", "roleId") REFERENCES "RoleDefinition"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipEntityScope" ADD CONSTRAINT "MembershipEntityScope_organisationId_membershipId_fkey" FOREIGN KEY ("organisationId", "membershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipEntityScope" ADD CONSTRAINT "MembershipEntityScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipSiteScope" ADD CONSTRAINT "MembershipSiteScope_organisationId_membershipId_fkey" FOREIGN KEY ("organisationId", "membershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipSiteScope" ADD CONSTRAINT "MembershipSiteScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

