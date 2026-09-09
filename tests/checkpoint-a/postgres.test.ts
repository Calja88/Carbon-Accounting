import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext, requireSiteInScope, requireEntityInScope } from "@/lib/repositories/carbon-repository";
import { runCalculationsForEntry } from "@/lib/entries-service";
import { requestEffectivenessReview, performEffectivenessReview } from "@/lib/ems/nonconformity/effectiveness-service";
import { closeNonconformity } from "@/lib/ems/nonconformity/nonconformity-service";
import { reopenCorrectiveAction } from "@/lib/ems/nonconformity/corrective-action-service";
import { getEvidenceObject, listEvidenceObjects, listEvidenceForResource, listLinksForEvidenceObject, readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { getRevision, getControlledDocumentDetail } from "@/lib/documents/document-control-service";
import { requireCarbonView, requireFrozenReportAccess } from "@/lib/rbac/carbon-access";
import { listEnvironmentalAspects } from "@/lib/ems/aspects/aspect-service";
import { assertDisposableDatabase } from "./disposable";
const url = assertDisposableDatabase();
function connection(name: string) { const u = new URL(url); u.searchParams.set("application_name", name); return new PrismaClient({ datasources: { db: { url: u.toString() } } }); }
const gate = connection("ca_gate");
const monitor = connection("ca_monitor");
const tag = randomUUID();
let reviewer: OrganisationContext, owner: OrganisationContext, foreign: OrganisationContext, restricted: OrganisationContext;
let entityId: string, siteId: string, otherSiteId: string, pointId: string, factorSetId: string;
const date = new Date("2026-01-01T00:00:00Z");
const grants = ["carbon.view", "carbon.report.export", "ems.view", "ems.nonconformity.manage", "ems.corrective_action.manage", "ems.corrective_action.effectiveness_review"];
async function membership(org: string, name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE" = "ORGANISATION_WIDE", permissionCodes: string[] = grants) {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: permissionCodes.map(permissionCode => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}
beforeAll(async () => {
  for (const code of [...grants, "ems.controlled_document.manage"]) await prisma.permissionDefinition.upsert({ where: { code }, create: { code, domain: code.split(".")[0], description: "Synthetic CI grant" }, update: {} });
  const a = await prisma.organisation.create({ data: { name: "Synthetic Checkpoint A", slug: `ca-a-${tag}` } });
  const b = await prisma.organisation.create({ data: { name: "Synthetic Other Tenant", slug: `ca-b-${tag}` } });
  reviewer = await membership(a.id, "reviewer"); owner = await membership(a.id, "owner"); foreign = await membership(b.id, "foreign"); restricted = await membership(a.id, "restricted", "RESTRICTED");
  const entity = await prisma.entity.create({ data: { organisationId: a.id, name: "Synthetic Entity" } }); entityId = entity.id;
  const site = await prisma.site.create({ data: { organisationId: a.id, entityId, name: "Synthetic Site" } }); siteId = site.id;
  otherSiteId = (await prisma.site.create({ data: { organisationId: a.id, entityId, name: "Other Synthetic Site" } })).id;
  await prisma.membershipSiteScope.create({ data: { organisationId: a.id, membershipId: restricted.membershipId, siteId } });
  restricted = await resolveOrganisationContext(prisma, { userId: restricted.userId, requestedOrganisation: a.id });
  pointId = (await prisma.activityDataPoint.create({ data: { code: `CA-${tag}`, scope: "SCOPE_2", category: "Synthetic electricity", dataPointName: "Synthetic electricity", promptTemplate: "Synthetic", unitOptions: ["kWh"], frequency: "Monthly", defaultTier: "TIER_2", formType: "QUANTITY", buildPriority: "CI", factorCategory: "grid_electricity" } })).id;
  factorSetId = (await prisma.emissionFactorSet.create({ data: { name: "Synthetic CI factors", publisher: "Synthetic", vintageYear: 2026, effectiveFrom: new Date("2020-01-01"), isPlaceholder: true } })).id;
  for (const basis of ["LOCATION_BASED", "RESIDUAL_MIX"] as const) await prisma.emissionFactor.create({ data: { factorSetId, scope: "SCOPE_2", category: "grid_electricity", basis, unit: "kWh", co2eFactor: basis === "LOCATION_BASED" ? 0.2 : 0.4 } });
  await prisma.nonconformityClosurePolicy.create({ data: { organisationId: a.id, requireContainment: false, requireCorrectiveActionsComplete: true, requireEffectivenessReview: false, updatedByUserId: reviewer.userId } });
});
afterAll(async () => { await Promise.all([prisma.$disconnect(), gate.$disconnect(), monitor.$disconnect()]); });
// The disposable service owns cleanup. Do not delete immutable audit/report history to reset a shared DB.
async function entry() { return prisma.activityEntry.create({ data: { organisationId: reviewer.organisationId, activityDataPointId: pointId, siteId, periodStart: date, periodEnd: date, rawValue: 100, rawUnit: "kWh", canonicalValue: 100, canonicalUnit: "kWh", dataQualityTier: "TIER_2", enteredByUserId: owner.userId } }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
/** Hold a third connection's real row lock until BOTH first requests are blocked in Postgres. */
async function race<T>(kind: "ActivityEntry" | "Nonconformity", id: string, operations: [() => Promise<T>, () => Promise<T>]) {
  const acquired = deferred(), release = deferred();
  const holding = gate.$transaction(async tx => {
    if (kind === "ActivityEntry") await tx.$queryRaw`SELECT "id" FROM "ActivityEntry" WHERE "id" = ${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "Nonconformity" WHERE "id" = ${id} FOR UPDATE`;
    acquired.resolve(); await release.promise;
  }, { timeout: 20000 });
  await acquired.promise;
  const results = Promise.allSettled(operations.map(op => op()));
  try {
    const deadline = Date.now() + 10000; let blocked = 0;
    while (Date.now() < deadline) {
      const rows = await monitor.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%FROM "${kind}"%FOR UPDATE%`}`;
      blocked = Number(rows[0].count); if (blocked >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(blocked, "Both independent first requests must reach the real parent lock").toBeGreaterThanOrEqual(2);
  } finally { release.resolve(); await holding; }
  return results;
}
async function nc() {
  const row = await prisma.nonconformity.create({ data: { organisationId: reviewer.organisationId, reference: `CA-${randomUUID()}`, sourceType: "MANUAL", sourceReferenceNote: "Synthetic CI", statement: "Synthetic nonconformity", requirementReference: "Synthetic requirement", status: "ACTIONS_IN_PROGRESS", createdByUserId: owner.userId } });
  const action = await prisma.correctiveAction.create({ data: { organisationId: reviewer.organisationId, nonconformityId: row.id, description: "Synthetic completed action", dueDate: date, status: "COMPLETED", ownerMembershipId: owner.membershipId, completedByUserId: owner.userId, completedAt: date, createdByUserId: owner.userId } });
  const reviewable = await requestEffectivenessReview(reviewer, row.id, { actorUserId: "spoofed-ignored" });
  return { ...reviewable, actionId: action.id };
}
const decision = (reviewCycle: number, result: "EFFECTIVE" | "INEFFECTIVE" | "PARTIALLY_EFFECTIVE" = "EFFECTIVE") => ({ reviewCycle, criteria: "Synthetic criteria", reviewDate: date, result, decision: "Synthetic decision", actorUserId: "spoofed-ignored" });
describe("real PostgreSQL Checkpoint A pre-merge gate", () => {
  it("two genuinely concurrent first calculations commit exactly one Scope 2 pair", async () => {
    const e = await entry(); const ctx = toTenantRepositoryContext(reviewer);
    expect(await prisma.calculation.count({ where: { activityEntryId: e.id } })).toBe(0);
    const results = await race("ActivityEntry", e.id, [() => runCalculationsForEntry(ctx, e.id), () => runCalculationsForEntry(ctx, e.id)]);
    expect(results.every(r => r.status === "fulfilled")).toBe(true);
    const rows = await prisma.calculation.findMany({ where: { activityEntryId: e.id, derivedFromCalculationId: null } });
    expect(rows.map(r => r.basis).sort()).toEqual(["LOCATION_BASED", "RESIDUAL_MIX"]);
    expect(results.map(r => r.status === "fulfilled" ? r.value.map(c => c.id).sort() : [])).toEqual([rows.map(r => r.id).sort(), rows.map(r => r.id).sort()]);
  });
  it("second Scope 2 insert failure rolls back the first insert and entry state", async () => {
    const e = await entry();
    await prisma.$executeRaw`CREATE TABLE ca_fault (entry_id text PRIMARY KEY)`;
    await prisma.$executeRaw`INSERT INTO ca_fault VALUES (${e.id})`;
    try {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ca_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."basis" <> 'LOCATION_BASED' AND EXISTS (SELECT 1 FROM ca_fault WHERE entry_id = NEW."activityEntryId") THEN RAISE EXCEPTION 'synthetic second insert fault'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ca_second_insert BEFORE INSERT ON "Calculation" FOR EACH ROW EXECUTE FUNCTION ca_fail_second()`);
      await expect(runCalculationsForEntry(toTenantRepositoryContext(reviewer), e.id)).rejects.toThrow();
      expect(await prisma.calculation.count({ where: { activityEntryId: e.id } })).toBe(0);
      expect((await prisma.activityEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe(e.status);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ca_second_insert ON "Calculation"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ca_fail_second()`);
      await prisma.$executeRaw`DROP TABLE IF EXISTS ca_fault`;
    }
  });
  it("two first EFFECTIVE reviews yield one decision; concurrent closes yield one closure/audit", async () => {
    const n = await nc();
    const reviewResults = await race("Nonconformity", n.id, [() => performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle)), () => performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle))]);
    expect(reviewResults.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.effectivenessReview.count({ where: { nonconformityId: n.id } })).toBe(1);
    const closes = await race("Nonconformity", n.id, [() => closeNonconformity(reviewer, n.id, "spoofed-ignored"), () => closeNonconformity(reviewer, n.id, "spoofed-ignored")]);
    expect(closes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const closures = await prisma.nonconformityClosure.findMany({ where: { nonconformityId: n.id } });
    expect(closures).toHaveLength(1); expect(closures[0].closedByUserId).toBe(reviewer.userId);
    expect(await prisma.auditEvent.count({ where: { resourceId: n.id, eventType: "nonconformity.closed" } })).toBe(1);
  });
  it("a close racing action reopening cannot close over an incomplete action", async () => {
    const n = await nc(); await performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle));
    await race<unknown>("Nonconformity", n.id, [() => closeNonconformity(reviewer, n.id, reviewer.userId), () => reopenCorrectiveAction(reviewer, n.actionId, { reopenReason: "Synthetic", actorUserId: reviewer.userId })]);
    const parent = await prisma.nonconformity.findUniqueOrThrow({ where: { id: n.id } });
    const action = await prisma.correctiveAction.findUniqueOrThrow({ where: { id: n.actionId } });
    expect(parent.status === "CLOSED" && action.status === "REOPENED").toBe(false);
    if (action.status === "REOPENED") {
      expect(parent.status).toBe("ACTIONS_IN_PROGRESS");
      await expect(performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle))).rejects.toThrow();
    }
  });
  it("adverse review racing closure never closes a pending or ineffective optional-review cycle", async () => {
    const n = await nc();
    const results = await race<unknown>("Nonconformity", n.id, [
      () => performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle, "INEFFECTIVE")),
      () => closeNonconformity(reviewer, n.id, reviewer.userId),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.nonconformity.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("REOPENED");
    expect(await prisma.nonconformityClosure.count({ where: { nonconformityId: n.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { resourceId: n.id, eventType: "nonconformity.closed" } })).toBe(0);
  });
  it.each(["INEFFECTIVE", "PARTIALLY_EFFECTIVE"] as const)("%s follow-up keeps original unclosable despite optional effectiveness policy", async result => {
    await prisma.nonconformityClosurePolicy.update({ where: { organisationId: reviewer.organisationId }, data: { ineffectiveOutcomePolicy: "CREATE_FOLLOW_UP", requireEffectivenessReview: false } });
    const n = await nc(); const outcome = await performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle, result));
    expect(outcome.followUp).not.toBeNull(); expect(outcome.nonconformity.status).toBe("REOPENED");
    await expect(closeNonconformity(reviewer, n.id, reviewer.userId)).rejects.toThrow();
    expect(await prisma.nonconformityClosure.count({ where: { nonconformityId: n.id } })).toBe(0);
  });
  it("audit failure rolls back review, parent state and all audit writes", async () => {
    const n = await nc();
    const before = await prisma.nonconformity.findUniqueOrThrow({ where: { id: n.id } });
    const countBefore = await prisma.auditEvent.count({ where: { organisationId: reviewer.organisationId } });
    try {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ca_fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'effectiveness_review.recorded' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ca_review_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ca_fail_review_audit()`);
      await expect(performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle, "INEFFECTIVE"))).rejects.toThrow();
      expect(await prisma.effectivenessReview.count({ where: { nonconformityId: n.id } })).toBe(0);
      expect(await prisma.nonconformity.findUniqueOrThrow({ where: { id: n.id } })).toEqual(before);
      expect(await prisma.auditEvent.count({ where: { organisationId: reviewer.organisationId } })).toBe(countBefore);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ca_review_audit ON "AuditEvent"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ca_fail_review_audit()`);
    }
  });
  it("DB uniqueness rejects a second decision for the same NC/cycle", async () => {
    const n = await nc(); const first = await performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle));
    const data = { ...first.review, id: undefined, createdAt: undefined };
    await expect(prisma.effectivenessReview.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
  it("a new cycle rejects old submissions and never reuses the old EFFECTIVE result", async () => {
    const n = await nc(); await performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle));
    await reopenCorrectiveAction(reviewer, n.actionId, { reopenReason: "Synthetic second cycle", actorUserId: reviewer.userId });
    // Fixture completion represents the next completed corrective action; the real request/review services are exercised below.
    await prisma.correctiveAction.update({ where: { id: n.actionId }, data: { status: "COMPLETED" } });
    const next = await requestEffectivenessReview(reviewer, n.id, { actorUserId: reviewer.userId });
    expect(next.reviewCycle).toBe(n.reviewCycle + 1);
    await expect(performEffectivenessReview(reviewer, n.id, decision(n.reviewCycle))).rejects.toThrow();
    await expect(closeNonconformity(reviewer, n.id, reviewer.userId)).rejects.toThrow();
    expect(await prisma.effectivenessReview.count({ where: { nonconformityId: n.id } })).toBe(1);
  });
  it("re-resolves a revoked permission inside the NC transaction", async () => {
    const stale = await membership(reviewer.organisationId, `stale-${randomUUID()}`);
    const n = await nc();
    await prisma.rolePermission.deleteMany({ where: { organisationId: reviewer.organisationId, permissionCode: "ems.corrective_action.effectiveness_review", role: { memberships: { some: { membershipId: stale.membershipId } } } } });
    await expect(performEffectivenessReview(stale, n.id, decision(n.reviewCycle))).rejects.toThrow();
    expect(await prisma.effectivenessReview.count({ where: { nonconformityId: n.id } })).toBe(0);
  });
  it("denies foreign tenant, restricted site/entity, and missing permission", async () => {
    const e = await entry();
    await expect(runCalculationsForEntry(toTenantRepositoryContext(foreign), e.id)).rejects.toThrow();
    await expect(requireSiteInScope(restricted, otherSiteId)).rejects.toThrow();
    await expect(requireEntityInScope(restricted, entityId)).rejects.toThrow();
    expect(() => requireFrozenReportAccess(restricted, true)).toThrow();
    await expect(listEnvironmentalAspects(restricted)).rejects.toThrow();
    expect(() => requireCarbonView({ ...reviewer, permissions: new Set() })).toThrow();
    const n = await nc(); await expect(performEffectivenessReview({ ...reviewer, permissions: new Set() }, n.id, decision(n.reviewCycle))).rejects.toThrow();
    expect(await prisma.effectivenessReview.count({ where: { nonconformityId: n.id } })).toBe(0);
  });
  it("protects metadata, bytes, links, counts and mixed revision parents on real rows", async () => {
    const ev = await prisma.evidenceObject.create({ data: { organisationId: reviewer.organisationId, filename: "synthetic-secret.pdf", mimeType: "application/pdf", byteSize: 4, checksumSha256: "synthetic-hash", classification: "INTERNAL" } });
    const doc = await prisma.controlledDocument.create({ data: { organisationId: reviewer.organisationId, reference: `DOC-${tag}`, title: "Synthetic classified doc", category: "test", classification: "RESTRICTED" } });
    const rev = await prisma.controlledDocumentRevision.create({ data: { organisationId: reviewer.organisationId, documentId: doc.id, revisionNumber: 1, evidenceObjectId: ev.id, classification: "INTERNAL" } });
    await prisma.evidenceLink.create({ data: { organisationId: reviewer.organisationId, evidenceId: ev.id, resourceType: "controlled_document_revision", resourceId: rev.id } });
    expect(await listEvidenceObjects(reviewer)).toHaveLength(0);
    expect(await listEvidenceForResource(reviewer, "controlled_document_revision", rev.id)).toHaveLength(0);
    await expect(getEvidenceObject(reviewer, ev.id)).rejects.toThrow();
    await expect(listLinksForEvidenceObject(reviewer, ev.id)).rejects.toThrow();
    expect(await readEvidenceObjectBytes(reviewer, ev.id)).toBeNull();
    await expect(getControlledDocumentDetail(reviewer, doc.id)).rejects.toThrow();
    const manager = await membership(reviewer.organisationId, "document-manager", "ORGANISATION_WIDE", [...grants, "ems.controlled_document.manage"]);
    await expect(getRevision(manager, rev.id, "wrong-parent")).rejects.toThrow();
    await expect(getRevision(foreign, rev.id, doc.id)).rejects.toThrow();
    expect((await getRevision(manager, rev.id, doc.id))?.id).toBe(rev.id);
  });
  it("issued ReportSnapshot payload and links remain frozen after source/factor changes and recalculation", async () => {
    const e = await entry(); const calculations = await runCalculationsForEntry(toTenantRepositoryContext(reviewer), e.id);
    const snapshot = await prisma.reportSnapshot.create({ data: { organisationId: reviewer.organisationId, periodStart: date, periodEnd: date, generatedByUserId: reviewer.userId,
      payload: { synthetic: true, locationKg: 20, companionKg: 40 }, calculationLinks: { create: calculations.map(c => ({ calculationId: c.id })) } }, include: { calculationLinks: true } });
    await prisma.emissionFactor.updateMany({ where: { factorSetId }, data: { co2eFactor: 0.9 } });
    await prisma.activityEntry.update({ where: { id: e.id }, data: { canonicalValue: 200 } });
    await runCalculationsForEntry(toTenantRepositoryContext(reviewer), e.id);
    const fresh = await prisma.reportSnapshot.findUniqueOrThrow({ where: { id: snapshot.id }, include: { calculationLinks: true } });
    expect(fresh).toEqual(snapshot);
    expect((await prisma.calculation.findMany({ where: { activityEntryId: e.id } })).map(c => c.resultKgCo2e.toString()).sort()).toEqual(["20", "40"]);
  });
});
