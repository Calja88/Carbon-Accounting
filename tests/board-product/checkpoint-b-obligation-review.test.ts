/**
 * Checkpoint B corrective handoff §1 — proves, against real Postgres, that
 * a CarbonSourcePeriodObligation's REVIEWED/EXCLUDED status can only be
 * reached through the explicit reviewSourcePeriodObligation/
 * excludeSourcePeriodObligation services (never stamped merely because a
 * submission exists), that the CAS guards a concurrent duplicate decision,
 * that an unresolved submission cannot be reviewed, and that a stale
 * review fingerprint (the submission's calculations changed after review)
 * is no longer counted as reviewed by the live coverage read.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import {
  reviewSourcePeriodObligation,
  excludeSourcePeriodObligation,
  SourcePeriodObligationError,
} from "@/lib/carbon/source-period-obligation-service";
import { loadOverviewForContext } from "@/lib/board/live-overview";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const tag = randomUUID();

async function membership(org: string, name: string, permissionCodes: string[]) {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: permissionCodes.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

let reviewer: OrganisationContext, noPermission: OrganisationContext, approver: OrganisationContext;
let orgId: string, siteId: string, pointId: string, factorId: string;
const month = "2026-03";
const periodStart = new Date("2026-03-01T00:00:00Z");
const periodEnd = new Date("2026-03-31T00:00:00Z");

beforeAll(async () => {
  for (const code of ["carbon.view", "carbon.entry.review", "carbon.entry.approve"]) {
    await prisma.permissionDefinition.upsert({ where: { code }, create: { code, domain: "carbon", description: "Synthetic CI grant" }, update: {} });
  }
  const org = await prisma.organisation.create({ data: { name: "Synthetic Obligation Review Org", slug: `cb-review-${tag}` } });
  orgId = org.id;
  reviewer = await membership(org.id, "reviewer", ["carbon.view", "carbon.entry.review"]);
  approver = await membership(org.id, "approver", ["carbon.view", "carbon.entry.approve"]);
  noPermission = await membership(org.id, "no-permission", ["carbon.view"]);

  const entity = await prisma.entity.create({ data: { organisationId: org.id, name: "Synthetic Entity" } });
  const site = await prisma.site.create({ data: { organisationId: org.id, entityId: entity.id, name: "Synthetic Site" } });
  siteId = site.id;

  pointId = (await prisma.activityDataPoint.create({
    data: { code: `CB-REVIEW-${tag}`, scope: "SCOPE_2", category: "Synthetic electricity", dataPointName: "Synthetic electricity", promptTemplate: "Synthetic", unitOptions: ["kWh"], frequency: "Monthly", defaultTier: "TIER_2", formType: "QUANTITY", buildPriority: "CI", factorCategory: "grid_electricity" },
  })).id;
  const factorSetId = (await prisma.emissionFactorSet.create({
    data: { name: "Synthetic CB review factors", publisher: "Synthetic", vintageYear: 2026, effectiveFrom: new Date("2021-07-01"), isPlaceholder: true },
  })).id;
  factorId = (await prisma.emissionFactor.create({ data: { factorSetId, scope: "SCOPE_2", category: "grid_electricity", basis: "LOCATION_BASED", unit: "kWh", co2eFactor: 1 } })).id;
});

async function entryWithCalc(rawValue: number) {
  const entry = await prisma.activityEntry.create({
    data: { organisationId: orgId, activityDataPointId: pointId, siteId, periodStart, periodEnd, rawValue, rawUnit: "kWh", canonicalValue: rawValue, canonicalUnit: "kWh", dataQualityTier: "TIER_2", enteredByUserId: reviewer.userId, status: "SUBMITTED" },
  });
  const calc = await prisma.calculation.create({
    data: { organisationId: orgId, activityEntryId: entry.id, emissionFactorId: factorId, scope: "SCOPE_2", basis: "LOCATION_BASED", inputValue: rawValue, inputUnit: "kWh", factorValueSnapshot: 1, factorUnitSnapshot: "kWh", factorSourceSnapshot: "Synthetic", factorVintageSnapshot: "2026", formulaApplied: "synthetic", resultKgCo2e: rawValue, dataQualityTier: "TIER_2", calculatedByUserId: reviewer.userId },
  });
  return { entry, calc };
}

async function obligation(sourceKey: string, submittedActivityEntryId: string | null) {
  return prisma.carbonSourcePeriodObligation.create({
    data: { organisationId: orgId, siteId, month, sourceKey, externalKey: `${tag}:${sourceKey}`, status: "REVIEW_REQUIRED", submittedActivityEntryId },
  });
}

describe("Checkpoint B corrective handoff §1 — explicit obligation review/exclusion", () => {
  it("denies review without carbon.entry.review", async () => {
    const { entry } = await entryWithCalc(100);
    const ob = await obligation("no-perm", entry.id);
    await expect(reviewSourcePeriodObligation(noPermission, ob.id, {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses to review an obligation with no bound submission", async () => {
    const ob = await obligation("unbound", null);
    await expect(reviewSourcePeriodObligation(reviewer, ob.id, {})).rejects.toBeInstanceOf(SourcePeriodObligationError);
  });

  it("refuses to review a submission that is FLAGGED", async () => {
    const { entry } = await entryWithCalc(50);
    await prisma.activityEntry.update({ where: { id: entry.id }, data: { status: "FLAGGED" } });
    const ob = await obligation("flagged", entry.id);
    await expect(reviewSourcePeriodObligation(reviewer, ob.id, {})).rejects.toBeInstanceOf(SourcePeriodObligationError);
  });

  it("reviews a genuine submission and records reviewer/timestamp/fingerprint", async () => {
    const { entry } = await entryWithCalc(200);
    const ob = await obligation("genuine", entry.id);
    const reviewed = await reviewSourcePeriodObligation(reviewer, ob.id, { note: "test" });
    expect(reviewed.status).toBe("REVIEWED");
    expect(reviewed.reviewedByMembershipId).toBe(reviewer.membershipId);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(reviewed.reviewFingerprint).not.toBeNull();
  });

  it("a duplicate concurrent review only succeeds once (CAS)", async () => {
    const { entry } = await entryWithCalc(75);
    const ob = await obligation("race", entry.id);
    const results = await Promise.allSettled([
      reviewSourcePeriodObligation(reviewer, ob.id, {}),
      reviewSourcePeriodObligation(reviewer, ob.id, {}),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("excluding requires carbon.entry.approve, not carbon.entry.review alone", async () => {
    const ob = await obligation("exclude-denied", null);
    await expect(excludeSourcePeriodObligation(reviewer, ob.id, { reason: "test" })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("excludes an obligation with a recorded reason and decision", async () => {
    const ob = await obligation("exclude-ok", null);
    const excluded = await excludeSourcePeriodObligation(approver, ob.id, { reason: "Out of scope for this reporting boundary." });
    expect(excluded.status).toBe("EXCLUDED");
    expect(excluded.excludedByMembershipId).toBe(approver.membershipId);
    expect(excluded.excludedReason).toBe("Out of scope for this reporting boundary.");
  });

  it("refuses exclusion with a blank reason", async () => {
    const ob = await obligation("exclude-blank-reason", null);
    await expect(excludeSourcePeriodObligation(approver, ob.id, { reason: "   " })).rejects.toBeInstanceOf(SourcePeriodObligationError);
  });

  it("a stale fingerprint (calculation changed after review) is no longer counted as reviewed by the live coverage read", async () => {
    const { entry, calc } = await entryWithCalc(300);
    const ob = await obligation("stale", entry.id);
    await reviewSourcePeriodObligation(reviewer, ob.id, {});

    // Simulate a genuine post-review change to the reviewed submission's
    // own calculation result — never something reviewSourcePeriodObligation
    // itself would do; this proves the READ side, not the write side.
    await prisma.calculation.update({ where: { id: calc.id }, data: { resultKgCo2e: 999 } });

    const model = await loadOverviewForContext(reviewer, { from: month, to: month });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    // The obligation's own status column still literally says REVIEWED,
    // but the live read must not count it once its fingerprint is stale.
    const stored = await prisma.carbonSourcePeriodObligation.findUniqueOrThrow({ where: { id: ob.id } });
    expect(stored.status).toBe("REVIEWED");
    expect(model.carbon.data.current.coverage.reviewed).toBeLessThan(model.carbon.data.current.coverage.received);
  });
});
