/**
 * BD08: full end-to-end proof of the BOARD-1 fixture against real
 * PostgreSQL — guard refusal, seed from an empty database, independent
 * persisted reconciliation (never reusing the seed port's own builder as
 * its own validator), replay/idempotency, and frozen-pack invariance
 * across a genuine live state transition.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedBoardDemo } from "../../scripts/board-demo/seed-orchestrator";
import { LiveSeedPort, FIXTURE_ORGANISATION_SLUG_PREFIX } from "../../scripts/board-demo/live-seed-port";
import { BOARD1, buildSubmissionObligations } from "../../scripts/board-demo/board1";
import { getManagementReviewPack } from "@/lib/ems/review/pack-service";
import { createNonconformityFromSource, recordContainment } from "@/lib/ems/nonconformity/nonconformity-service";
import { resolveOrganisationContext } from "@/lib/organisation/context";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const environmentId = `board1-ci-${randomUUID()}`;
const databaseId = `board1-ci-db-${randomUUID()}`;
const provisioningToken = `board1-ci-token-${randomUUID()}`;

const env = {
  dataMode: "synthetic",
  deploymentClass: "private-demo",
  configuredDatabaseId: databaseId,
  allowedDatabaseId: databaseId,
  configuredEnvironmentId: environmentId,
};

beforeAll(async () => {
  // Checkpoint B fix 4: readConnectedIdentity now requires APP_DATA_MODE
  // and a matching BOARD_DEMO_PROVISIONING_TOKEN independently of the
  // manifest row — this disposable CI suite plays the role of a genuinely
  // (and independently) provisioned target by setting both explicitly,
  // the same way a real deployment's own environment would.
  process.env.APP_DATA_MODE = "synthetic";
  process.env.BOARD_DEMO_PROVISIONING_TOKEN = provisioningToken;
  // Independently-pinned identity, written once — the exact thing
  // readConnectedIdentity() must read back on its own, never inferred from
  // an env var or connection string.
  await prisma.demoDatabaseManifest.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", databaseId, environmentId, provisioningToken },
    update: { databaseId, environmentId, provisioningToken },
  });
});

describe("BD08 BOARD-1 guard refusal (real Postgres)", () => {
  it("refuses to write when the configured/allowed database id doesn't match", async () => {
    const before = await prisma.organisation.count({ where: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } });
    await expect(seedBoardDemo(new LiveSeedPort(), { ...env, allowedDatabaseId: "some-other-database" })).rejects.toThrow();
    const after = await prisma.organisation.count({ where: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } });
    expect(after).toBe(before);
  });
});

describe("BD08 BOARD-1 seed (real Postgres, end to end)", () => {
  it(
    "builds the full fixture from an empty state and reconciles independently",
    async () => {
      const result = await seedBoardDemo(new LiveSeedPort(), env);
      expect(result).toBe("created");

      const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
      expect(lease.status).toBe("READY");
      expect(lease.digest).toMatch(/^[a-f0-9]{64}$/);

      const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });

      // Independent reconciliation: read persisted rows directly, never
      // through LiveSeedPort's own instance state.
      const primary = await prisma.calculation.findMany({
        where: { organisationId: org.id, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
      });
      const derived = await prisma.calculation.findMany({
        where: { organisationId: org.id, derivedFromCalculationId: { not: null }, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
      });
      const sum = (rows: { resultKgCo2e: unknown; basis?: unknown }[]) => rows.reduce((s, r) => s + Number(r.resultKgCo2e), 0);
      const lbAndScope13 = primary.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED");
      const marketCompanion = primary.filter((c) => c.basis === "RESIDUAL_MIX" || c.basis === "MARKET_BASED");
      expect(Math.round(sum(lbAndScope13) + sum(derived))).toBeCloseTo(BOARD1.currentKg, -1);
      expect(Math.round(sum(marketCompanion))).toBeCloseTo(BOARD1.marketBasedScope2Kg, -1);

      const prior = await prisma.calculation.findMany({
        where: { organisationId: org.id, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2025-01-01"), lte: new Date("2025-08-31") } }, basis: { notIn: ["RESIDUAL_MIX", "MARKET_BASED"] } },
      });
      expect(Math.round(sum(prior))).toBeCloseTo(BOARD1.previousKg, -1);

      const obligationCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId: org.id, month: { startsWith: "2026" } } });
      const reviewedCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId: org.id, month: { startsWith: "2026" }, status: "REVIEWED" } });
      expect(obligationCount).toBe(192);
      expect(reviewedCount).toBe(192);
      expect(buildSubmissionObligations()).toHaveLength(192); // the fixture builder's own contract, independently

      const evidenceRows = await prisma.evidenceObject.findMany({ where: { organisationId: org.id } });
      expect(evidenceRows.length).toBeGreaterThanOrEqual(8);
      for (const row of evidenceRows) {
        expect(row.byteSize).toBeGreaterThan(0);
        expect(row.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      }

      const nc = await prisma.nonconformity.findFirstOrThrow({ where: { organisationId: org.id, reference: { startsWith: "BOARD1-NC-" } } });
      expect(nc.status).toBe("CLOSED");

      const packs = await prisma.managementReviewPack.findMany({ where: { organisationId: org.id } });
      expect(packs).toHaveLength(1);
      expect(packs[0].status).toBe("ISSUED");
    },
    300_000,
  );

  it(
    "replays without duplicating any record",
    async () => {
      const before = await prisma.organisation.count({ where: { slug: "board-1-northstar-demonstration" } });
      const beforeCalcs = await prisma.calculation.count();
      const result = await seedBoardDemo(new LiveSeedPort(), env);
      expect(result).toBe("verified-existing");
      const after = await prisma.organisation.count({ where: { slug: "board-1-northstar-demonstration" } });
      const afterCalcs = await prisma.calculation.count();
      expect(after).toBe(before);
      expect(afterCalcs).toBe(beforeCalcs);
    },
    60_000,
  );

  it(
    "keeps the issued management pack's payload and checksum unchanged after a genuine live transition",
    async () => {
      const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
      const pack = await prisma.managementReviewPack.findFirstOrThrow({ where: { organisationId: org.id } });
      const before = { payload: pack.payload, checksum: pack.checksumSha256 };

      const owner = await resolveOrganisationContext(prisma, {
        userId: (await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } })).id,
        requestedOrganisation: org.id,
      });

      // A genuine new live transition after the pack was frozen.
      const newNc = await createNonconformityFromSource(owner, {
        reference: `BOARD1-NC-LIVE-${randomUUID().slice(0, 8)}`,
        sourceType: "MANUAL",
        sourceReferenceNote: "Post-freeze live demonstration transition.",
        statement: "Synthetic post-freeze nonconformity to prove the frozen pack does not move.",
        requirementReference: "Monthly containment inspection — internal requirement",
        ownerMembershipId: owner.membershipId,
        actorUserId: owner.userId,
      });
      await recordContainment(owner, newNc.id, { actionTaken: "Synthetic post-freeze containment.", actionTakenAt: new Date(), ownerMembershipId: owner.membershipId, actorUserId: owner.userId });

      const reloaded = await getManagementReviewPack(owner, (await prisma.managementReview.findFirstOrThrow({ where: { organisationId: org.id } })).id);
      expect(reloaded?.checksumSha256).toBe(before.checksum);
      expect(reloaded?.payload).toEqual(before.payload);

      // The live domain state itself did change (proves this wasn't a no-op).
      const liveNc = await prisma.nonconformity.findUniqueOrThrow({ where: { id: newNc.id } });
      expect(liveNc.status).toBe("CONTAINED");
    },
    60_000,
  );
});
