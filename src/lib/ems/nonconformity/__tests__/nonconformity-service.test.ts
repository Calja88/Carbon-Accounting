/**
 * Nonconformity workflow tests (task T63). No live database — Prisma is
 * replaced with an in-memory fake and the audit-event side effect is
 * stubbed. Covers: source linkage and requirement reference required at
 * creation, source FK validation for model-backed source types, duplicate
 * source linking without creating a second Nonconformity, containment
 * capture and the OPEN->CONTAINED transition, mandatory-close-step
 * enforcement, reopen, and tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  auditFindings: [] as Row[],
  incidents: [] as Row[],
  evaluationItems: [] as Row[],
  controlChecks: [] as Row[],
  complianceObligations: [] as Row[],
  operationalControls: [] as Row[],
  classifications: [] as Row[],
  closurePolicies: [] as Row[],
  nonconformities: [] as Row[],
  sourceLinks: [] as Row[],
  containmentRecords: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; not?: unknown };
    if (operators.in) return operators.in.includes(actual);
    if ("not" in operators) return actual !== operators.not;
    return false;
  }
  return actual === expected;
}

function matchesSimple(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

function find(rows: Row[], where: Row) {
  return rows.filter((row) => matchesSimple(row, where))[0] ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(rows, key);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = simpleModel(tables.memberships, "membership");
  const auditFinding = simpleModel(tables.auditFindings, "finding");
  const environmentalIncident = simpleModel(tables.incidents, "incident");
  const complianceEvaluationItem = simpleModel(tables.evaluationItems, "eval-item");
  const controlCheck = simpleModel(tables.controlChecks, "check");
  const complianceObligation = simpleModel(tables.complianceObligations, "obligation");
  const operationalControl = simpleModel(tables.operationalControls, "control");
  const nonconformityClassification = simpleModel(tables.classifications, "classification", { isActive: true });
  const nonconformityClosurePolicy = simpleModel(tables.closurePolicies, "policy");
  const nonconformity = simpleModel(tables.nonconformities, "nc", { status: "OPEN" });
  const nonconformitySourceLink = simpleModel(tables.sourceLinks, "link", { linkedAt: new Date() });
  const containmentRecord = simpleModel(tables.containmentRecords, "containment", { adequacyReviewed: false, adequate: null });

  const prismaClient = {
    organisationMembership,
    auditFinding,
    environmentalIncident,
    complianceEvaluationItem,
    controlCheck,
    complianceObligation,
    operationalControl,
    nonconformityClassification,
    nonconformityClosurePolicy,
    nonconformity,
    nonconformitySourceLink,
    containmentRecord,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  uploadEvidenceObject: vi.fn(async () => ({ id: "evidence-synthetic" })),
  linkEvidence: vi.fn(async () => ({ id: "evidence-link-synthetic" })),
}));

const {
  NonconformityError,
  createNonconformityFromSource,
  linkAdditionalSourceToNonconformity,
  listNonconformitySourceLinks,
  getNonconformity,
  listNonconformities,
  recordContainment,
  reviewContainmentAdequacy,
  closeNonconformity,
  reopenNonconformity,
  upsertNonconformityClosurePolicy,
  createNonconformityClassification,
  assignNonconformityClassification,
} = await import("@/lib/ems/nonconformity/nonconformity-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const MANAGE_PERMS = new Set(["ems.view", "ems.nonconformity.manage"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: MANAGE_PERMS });
const viewerContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });
const managerContextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;

  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-viewer", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE" });

  tables.auditFindings.push({ id: "finding-a1", organisationId: ORG_A, auditId: "audit-a1" });
  tables.auditFindings.push({ id: "finding-b1", organisationId: ORG_B, auditId: "audit-b1" });

  tables.incidents.push({ id: "incident-a1", organisationId: ORG_A });

  tables.evaluationItems.push({ id: "item-a1", organisationId: ORG_A, status: "NONCOMPLIANT" });

  tables.controlChecks.push({ id: "check-a1", organisationId: ORG_A });
});

function createNcInput(overrides: Partial<Parameters<typeof createNonconformityFromSource>[1]> = {}) {
  return {
    reference: `NC-TEST-${tables.nextId}`,
    sourceType: "AUDIT_FINDING" as const,
    sourceId: "finding-a1",
    statement: "A synthetic control was found not operating as documented.",
    requirementReference: "ISO 14001:2015 Clause 9.1 (fictional reference)",
    actorUserId: managerContextA.userId,
    ...overrides,
  };
}

describe("createNonconformityFromSource", () => {
  it("creates an OPEN nonconformity with its primary source link", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput());
    expect(nc.status).toBe("OPEN");
    expect(nc.sourceType).toBe("AUDIT_FINDING");
    expect(nc.sourceId).toBe("finding-a1");
    expect(tables.sourceLinks).toHaveLength(1);
    expect(tables.sourceLinks[0]).toMatchObject({ nonconformityId: nc.id, isPrimary: true, sourceType: "AUDIT_FINDING" });
  });

  it("refuses to create without a requirement reference", async () => {
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ requirementReference: "  " }))).rejects.toThrow(NonconformityError);
  });

  it("refuses a model-backed source type without a sourceId", async () => {
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ sourceId: null }))).rejects.toThrow(NonconformityError);
  });

  it("refuses a foreign-tenant source id", async () => {
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ sourceId: "finding-b1" }))).rejects.toThrow(TenantOwnershipError);
  });

  it("validates INCIDENT, COMPLIANCE_EVALUATION_ITEM and CONTROL_CHECK sources", async () => {
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-INC", sourceType: "INCIDENT", sourceId: "incident-a1" }))).resolves.toMatchObject({
      sourceType: "INCIDENT",
    });
    await expect(
      createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-ITEM", sourceType: "COMPLIANCE_EVALUATION_ITEM", sourceId: "item-a1" })),
    ).resolves.toMatchObject({ sourceType: "COMPLIANCE_EVALUATION_ITEM" });
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CHECK", sourceType: "CONTROL_CHECK", sourceId: "check-a1" }))).resolves.toMatchObject({
      sourceType: "CONTROL_CHECK",
    });
  });

  it("requires a source reference note for COMPLAINT/MANUAL sources with no backing model", async () => {
    await expect(
      createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-COMPLAINT", sourceType: "COMPLAINT", sourceId: null })),
    ).rejects.toThrow(NonconformityError);
    const nc = await createNonconformityFromSource(
      managerContextA,
      createNcInput({ reference: "NC-COMPLAINT-2", sourceType: "COMPLAINT", sourceId: null, sourceReferenceNote: "Fictional customer complaint #42" }),
    );
    expect(nc.sourceType).toBe("COMPLAINT");
    expect(nc.sourceId).toBeNull();
  });

  it("refuses a duplicate reference within the same organisation", async () => {
    await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-DUP" }));
    await expect(createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-DUP", sourceId: "finding-a1" }))).rejects.toThrow(NonconformityError);
  });

  it("denies a caller without ems.nonconformity.manage", async () => {
    await expect(createNonconformityFromSource(viewerContextA, createNcInput())).rejects.toThrow(PermissionDeniedError);
  });

  it("is tenant-isolated: org B cannot see org A nonconformities", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput());
    await expect(getNonconformity(managerContextB, nc.id)).rejects.toThrow(TenantOwnershipError);
    const listB = await listNonconformities(managerContextB);
    expect(listB).toHaveLength(0);
  });
});

describe("linkAdditionalSourceToNonconformity — duplicate linking", () => {
  it("links a second source without creating a second nonconformity, preserving both sources", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-DUPLICATE-SOURCE" }));
    tables.incidents.push({ id: "incident-a2", organisationId: ORG_A });

    await linkAdditionalSourceToNonconformity(managerContextA, nc.id, {
      sourceType: "INCIDENT",
      sourceId: "incident-a2",
      actorUserId: managerContextA.userId,
    });

    expect(tables.nonconformities).toHaveLength(1);
    const links = await listNonconformitySourceLinks(managerContextA, nc.id);
    expect(links).toHaveLength(2);
    expect(links.some((l) => l.isPrimary)).toBe(true);
    expect(links.some((l) => l.sourceType === "INCIDENT" && l.sourceId === "incident-a2")).toBe(true);
    // The nonconformity's own primary source is unchanged.
    const reloaded = await getNonconformity(managerContextA, nc.id);
    expect(reloaded.sourceType).toBe("AUDIT_FINDING");
    expect(reloaded.sourceId).toBe("finding-a1");
  });

  it("refuses to link a foreign-tenant nonconformity id", async () => {
    await expect(
      linkAdditionalSourceToNonconformity(managerContextB, "nc-does-not-exist", { sourceType: "INCIDENT", sourceId: "incident-a1", actorUserId: managerContextB.userId }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("containment", () => {
  it("moves an OPEN nonconformity to CONTAINED on first containment record", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CONTAIN" }));
    const containment = await recordContainment(managerContextA, nc.id, {
      actionTaken: "Fictional spill kit deployed and area isolated.",
      actionTakenAt: new Date("2026-01-01"),
      ownerMembershipId: "membership-manager",
      actorUserId: managerContextA.userId,
    });
    expect(containment.nonconformityId).toBe(nc.id);
    const reloaded = await getNonconformity(managerContextA, nc.id);
    expect(reloaded.status).toBe("CONTAINED");
  });

  it("refuses containment without a description", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-NO-DESC" }));
    await expect(
      recordContainment(managerContextA, nc.id, { actionTaken: "  ", actionTakenAt: new Date(), ownerMembershipId: "membership-manager", actorUserId: managerContextA.userId }),
    ).rejects.toThrow(NonconformityError);
  });

  it("records an adequacy review separately from containment capture", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-ADEQUACY" }));
    const containment = await recordContainment(managerContextA, nc.id, {
      actionTaken: "Fictional containment action.",
      actionTakenAt: new Date(),
      ownerMembershipId: "membership-manager",
      actorUserId: managerContextA.userId,
    });
    expect(containment.adequacyReviewed).toBe(false);
    const reviewed = await reviewContainmentAdequacy(managerContextA, containment.id, { adequate: true, notes: "Fictional review notes.", actorUserId: managerContextA.userId });
    expect(reviewed.adequacyReviewed).toBe(true);
    expect(reviewed.adequate).toBe(true);
    expect(reviewed.adequacyReviewerMembershipId).toBe("membership-manager");
  });
});

describe("closeNonconformity — mandatory step enforcement", () => {
  it("refuses to close without an adequate, reviewed containment record under the default policy", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLOSE-NO-CONTAINMENT" }));
    await expect(closeNonconformity(managerContextA, nc.id, managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("refuses to close when containment exists but has not been reviewed adequate", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLOSE-UNREVIEWED" }));
    await recordContainment(managerContextA, nc.id, { actionTaken: "Action taken.", actionTakenAt: new Date(), ownerMembershipId: "membership-manager", actorUserId: managerContextA.userId });
    await expect(closeNonconformity(managerContextA, nc.id, managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("closes once containment has been reviewed adequate under the default policy", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLOSE-OK" }));
    const containment = await recordContainment(managerContextA, nc.id, {
      actionTaken: "Action taken.",
      actionTakenAt: new Date(),
      ownerMembershipId: "membership-manager",
      actorUserId: managerContextA.userId,
    });
    await reviewContainmentAdequacy(managerContextA, containment.id, { adequate: true, actorUserId: managerContextA.userId });
    const closed = await closeNonconformity(managerContextA, nc.id, managerContextA.userId);
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedByUserId).toBe(managerContextA.userId);
  });

  it("always refuses to close once the policy requires root cause approval, corrective actions, or effectiveness review", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, { requireRootCauseApproval: true, actorUserId: managerContextA.userId });
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLOSE-ROOT-CAUSE" }));
    const containment = await recordContainment(managerContextA, nc.id, {
      actionTaken: "Action taken.",
      actionTakenAt: new Date(),
      ownerMembershipId: "membership-manager",
      actorUserId: managerContextA.userId,
    });
    await reviewContainmentAdequacy(managerContextA, containment.id, { adequate: true, actorUserId: managerContextA.userId });
    // Even with adequate containment, closing must still be refused: T63 has
    // no model to prove root cause approval happened.
    await expect(closeNonconformity(managerContextA, nc.id, managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("closes with no containment requirement when the policy disables it", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, { requireContainment: false, actorUserId: managerContextA.userId });
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLOSE-NO-POLICY" }));
    const closed = await closeNonconformity(managerContextA, nc.id, managerContextA.userId);
    expect(closed.status).toBe("CLOSED");
  });
});

describe("reopen", () => {
  it("reopens a closed nonconformity with a reason, preserving closure fields", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, { requireContainment: false, actorUserId: managerContextA.userId });
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-REOPEN" }));
    const closed = await closeNonconformity(managerContextA, nc.id, managerContextA.userId);
    expect(closed.status).toBe("CLOSED");

    const reopened = await reopenNonconformity(managerContextA, nc.id, "Fictional recurrence identified.", managerContextA.userId);
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.reopenReason).toBe("Fictional recurrence identified.");
    // Closure history is preserved, not erased.
    expect(reopened.closedAt).toBeTruthy();
    expect(reopened.closedByUserId).toBe(managerContextA.userId);
  });

  it("refuses to reopen a nonconformity that is not CLOSED", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-NOT-CLOSED" }));
    await expect(reopenNonconformity(managerContextA, nc.id, "reason", managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("refuses to reopen without a reason", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, { requireContainment: false, actorUserId: managerContextA.userId });
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-NO-REASON" }));
    await closeNonconformity(managerContextA, nc.id, managerContextA.userId);
    await expect(reopenNonconformity(managerContextA, nc.id, "  ", managerContextA.userId)).rejects.toThrow(NonconformityError);
  });
});

describe("classification", () => {
  it("freezes a classification config snapshot when assigned", async () => {
    const classification = await createNonconformityClassification(managerContextA, { key: "major", label: "Major", rank: 1, actorUserId: managerContextA.userId });
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLASSIFY" }));
    const updated = await assignNonconformityClassification(managerContextA, nc.id, classification.id, managerContextA.userId);
    expect(updated.classificationConfigSnapshot).toMatchObject({ key: "major", label: "Major", rank: 1 });
  });

  it("refuses a foreign-tenant classification id", async () => {
    const nc = await createNonconformityFromSource(managerContextA, createNcInput({ reference: "NC-CLASSIFY-FOREIGN" }));
    await expect(assignNonconformityClassification(managerContextA, nc.id, "classification-does-not-exist", managerContextA.userId)).rejects.toThrow(TenantOwnershipError);
  });
});
