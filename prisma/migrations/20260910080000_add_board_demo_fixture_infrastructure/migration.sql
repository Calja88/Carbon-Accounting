-- BD08 board-demo fixture infrastructure.
--
-- Three new, standalone tables supporting scripts/board-demo/live-seed-port.ts.
-- None are tenant domain data and none alter any existing table: a singleton
-- manifest row proving which physical database is actually connected
-- (independent of any environment variable), one exclusive-lease row per
-- fixture key (BUILDING -> READY), and the real, independently-reviewable
-- "192 expected source-period returns" rows the BOARD-1 Overview coverage
-- claim reconciles against.

CREATE TABLE "DemoDatabaseManifest" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "databaseId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoDatabaseManifest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DemoFixtureLease" (
    "id" TEXT NOT NULL,
    "fixtureKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "digest" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoFixtureLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemoFixtureLease_fixtureKey_key" ON "DemoFixtureLease"("fixtureKey");

CREATE TABLE "CarbonSourcePeriodObligation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "reviewedByMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonSourcePeriodObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CarbonSourcePeriodObligation_externalKey_key" ON "CarbonSourcePeriodObligation"("externalKey");

CREATE INDEX "CarbonSourcePeriodObligation_organisationId_siteId_month_idx" ON "CarbonSourcePeriodObligation"("organisationId", "siteId", "month");
