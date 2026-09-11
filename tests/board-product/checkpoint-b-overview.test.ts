/**
 * Checkpoint B required fix 1 (Overview/Attention scope): proves, against
 * real Postgres, that:
 *  - a RESTRICTED member's Overview/Attention never surfaces carbon totals,
 *    coverage or EMS attention items outside their own site scope;
 *  - a foreign tenant's data never leaks into another organisation's view;
 *  - an explicit single-site selection actually narrows carbon totals and
 *    coverage, not just the hrefs stamped on each metric.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { loadOverviewForContext } from "@/lib/board/live-overview";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const tag = randomUUID();
const grants = ["carbon.view", "ems.view", "ems.corrective_action.manage"];

async function membership(org: string, name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE" = "ORGANISATION_WIDE") {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: grants.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

let owner: OrganisationContext, restricted: OrganisationContext, foreignOwner: OrganisationContext;
let siteAId: string, siteBId: string, pointId: string, foreignPointId: string, foreignSiteId: string;
const periodFrom = "2026-01", periodTo = "2026-01";
const date = new Date("2026-01-15T00:00:00Z");

beforeAll(async () => {
  for (const code of grants) await prisma.permissionDefinition.upsert({ where: { code }, create: { code, domain: code.split(".")[0], description: "Synthetic CI grant" }, update: {} });

  const orgA = await prisma.organisation.create({ data: { name: "Synthetic Checkpoint B Org", slug: `cb-a-${tag}` } });
  const orgB = await prisma.organisation.create({ data: { name: "Synthetic Checkpoint B Foreign Tenant", slug: `cb-b-${tag}` } });

  owner = await membership(orgA.id, "owner");
  restricted = await membership(orgA.id, "restricted", "RESTRICTED");
  foreignOwner = await membership(orgB.id, "foreign-owner");

  const entityA = await prisma.entity.create({ data: { organisationId: orgA.id, name: "Synthetic Entity A" } });
  const siteA = await prisma.site.create({ data: { organisationId: orgA.id, entityId: entityA.id, name: "Site A" } });
  const siteB = await prisma.site.create({ data: { organisationId: orgA.id, entityId: entityA.id, name: "Site B" } });
  siteAId = siteA.id; siteBId = siteB.id;
  await prisma.membershipSiteScope.create({ data: { organisationId: orgA.id, membershipId: restricted.membershipId, siteId: siteAId } });
  restricted = await resolveOrganisationContext(prisma, { userId: restricted.userId, requestedOrganisation: orgA.id });

  const entityB = await prisma.entity.create({ data: { organisationId: orgB.id, name: "Synthetic Entity B" } });
  const siteC = await prisma.site.create({ data: { organisationId: orgB.id, entityId: entityB.id, name: "Foreign Site" } });
  foreignSiteId = siteC.id;

  pointId = (await prisma.activityDataPoint.create({
    data: { code: `CB-${tag}`, scope: "SCOPE_2", category: "Synthetic electricity", dataPointName: "Synthetic electricity", promptTemplate: "Synthetic", unitOptions: ["kWh"], frequency: "Monthly", defaultTier: "TIER_2", formType: "QUANTITY", buildPriority: "CI", factorCategory: "grid_electricity" },
  })).id;
  foreignPointId = (await prisma.activityDataPoint.create({
    data: { code: `CB-FOREIGN-${tag}`, scope: "SCOPE_2", category: "Synthetic electricity", dataPointName: "Synthetic electricity", promptTemplate: "Synthetic", unitOptions: ["kWh"], frequency: "Monthly", defaultTier: "TIER_2", formType: "QUANTITY", buildPriority: "CI", factorCategory: "grid_electricity" },
  })).id;
  // This test writes its Calculation rows directly (never through the live
  // findFactorSet/resolveFactorMultiSource lookup), so this set's own
  // effectiveFrom is irrelevant to its own correctness — but findFactorSet
  // is a GLOBAL, non-tenant, category-blind "most recent effectiveFrom"
  // lookup other real fixtures (e.g. BOARD-1) DO depend on, so this date
  // must never collide with (or postdate) one of theirs. BOARD-1's own set
  // uses 2024-12-31 specifically to win that race; this uses a distinct,
  // earlier date so it can never shadow it.
  const factorSetId = (await prisma.emissionFactorSet.create({
    data: { name: "Synthetic CB factors", publisher: "Synthetic", vintageYear: 2026, effectiveFrom: new Date("2021-06-01"), isPlaceholder: true },
  })).id;
  const locationFactor = await prisma.emissionFactor.create({ data: { factorSetId, scope: "SCOPE_2", category: "grid_electricity", basis: "LOCATION_BASED", unit: "kWh", co2eFactor: 1 } });
  await prisma.emissionFactor.create({ data: { factorSetId, scope: "SCOPE_2", category: "grid_electricity", basis: "RESIDUAL_MIX", unit: "kWh", co2eFactor: 0.5 } });

  async function entryAndCalc(siteId: string, pointId: string, kg: number, organisationId: string, enteredByUserId: string) {
    const entry = await prisma.activityEntry.create({
      data: { organisationId, activityDataPointId: pointId, siteId, periodStart: date, periodEnd: date, rawValue: kg, rawUnit: "kWh", canonicalValue: kg, canonicalUnit: "kWh", dataQualityTier: "TIER_2", enteredByUserId, status: "SUBMITTED" },
    });
    await prisma.calculation.create({
      data: { organisationId, activityEntryId: entry.id, emissionFactorId: locationFactor.id, scope: "SCOPE_2", basis: "LOCATION_BASED", inputValue: kg, inputUnit: "kWh", factorValueSnapshot: 1, factorUnitSnapshot: "kWh", factorSourceSnapshot: "Synthetic", factorVintageSnapshot: "2026", formulaApplied: "synthetic", resultKgCo2e: kg, dataQualityTier: "TIER_2", calculatedByUserId: enteredByUserId },
    });
  }
  await entryAndCalc(siteAId, pointId, 100, orgA.id, owner.userId);
  await entryAndCalc(siteBId, pointId, 500, orgA.id, owner.userId);
  await entryAndCalc(foreignSiteId, foreignPointId, 9999, orgB.id, foreignOwner.userId);

  // Org-wide EMS attention data with no site/entity attribution (Nonconformity/ActionItem carry none in the schema).
  await prisma.nonconformity.create({
    data: { organisationId: orgA.id, reference: `CB-NC-${tag}`, sourceType: "MANUAL", statement: "Synthetic finding.", requirementReference: "Synthetic requirement", status: "EFFECTIVENESS_REVIEW", createdByUserId: owner.userId },
  });
  const programme = await prisma.actionProgramme.create({ data: { organisationId: orgA.id, title: "Synthetic programme", ownerMembershipId: owner.membershipId } });
  await prisma.actionItem.create({
    data: { organisationId: orgA.id, programmeId: programme.id, title: "Synthetic open action", ownerMembershipId: owner.membershipId, dueDate: new Date("2026-01-01"), status: "OPEN" },
  });
});

describe("Checkpoint B fix 1 — Overview/Attention scope", () => {
  it("a RESTRICTED member's carbon totals and coverage never include an out-of-scope site", async () => {
    const model = await loadOverviewForContext(restricted, { from: periodFrom, to: periodTo });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    expect(model.carbon.data.current.kgCO2e).toBe(100); // site A only, never site B's 500
    expect(model.carbon.data.sites.map((s) => s.id)).toEqual([siteAId]);
  });

  it("a RESTRICTED member sees no organisation-wide EMS attention items (no truthful site attribution to narrow them to)", async () => {
    const model = await loadOverviewForContext(restricted, { from: periodFrom, to: periodTo });
    expect(model.attention.state).toBe("ready");
    if (model.attention.state !== "ready") throw new Error("unreachable");
    expect(model.attention.data.items.some((i) => i.source.kind === "nonconformity")).toBe(false);
    expect(model.attention.data.openActions).toBe(0);
  });

  it("an ORGANISATION_WIDE member (unaffected by the fix) still sees the organisation-wide EMS attention items", async () => {
    const model = await loadOverviewForContext(owner, { from: periodFrom, to: periodTo });
    expect(model.attention.state).toBe("ready");
    if (model.attention.state !== "ready") throw new Error("unreachable");
    expect(model.attention.data.items.some((i) => i.source.kind === "nonconformity")).toBe(true);
    expect(model.attention.data.openActions).toBe(1);
  });

  it("foreign-tenant carbon and EMS data never leaks into another organisation's overview", async () => {
    const model = await loadOverviewForContext(owner, { from: periodFrom, to: periodTo });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    expect(model.carbon.data.current.kgCO2e).toBe(600); // site A (100) + site B (500), never the foreign tenant's 9999
    expect(model.carbon.data.sites.map((s) => s.id).sort()).toEqual([siteAId, siteBId].sort());
  });

  it("selecting a single site narrows carbon totals to that site, and the headline link agrees", async () => {
    const model = await loadOverviewForContext(owner, { from: periodFrom, to: periodTo, siteId: siteBId });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    expect(model.carbon.data.current.kgCO2e).toBe(500); // site B only, never the combined 600
    expect(model.carbon.data.sites.map((s) => s.id)).toEqual([siteBId]);
    expect(model.carbon.data.current.source.href).toContain(`siteId=${siteBId}`);
  });
});
