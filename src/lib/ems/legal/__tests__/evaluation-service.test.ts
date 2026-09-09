/**
 * Compliance evaluation tests (task T45). No live database — Prisma is
 * replaced with an in-memory fake, and the audit side-effect (already
 * covered by its own T20 test suite) is stubbed, so these tests stay
 * focused on the state machine itself: programme/evaluation creation with
 * scope-based item auto-population, the IN_PROGRESS-only item-result write
 * path, completion requiring every item decided, issue snapshotting exact
 * obligation-version content, the finding-link request interface, and
 * tenant isolation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[]; take?: number; include?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  entities: [] as Row[],
  sites: [] as Row[],
  memberships: [] as Row[],
  obligationVersions: [] as Row[],
  versionScopes: [] as Row[],
  programmes: [] as Row[],
  evaluations: [] as Row[],
  evaluationScopes: [] as Row[],
  evaluationItems: [] as Row[],
  findingLinks: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[] };
    if (operators.in) return operators.in.includes(actual);
    return false;
  }
  return actual === expected;
}

function matchesSimple(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "scopes") return true; // handled separately for obligationVersions
    return matchValue(row[key], value);
  });
}

function find(rows: Row[], where: Row, orderBy?: Row) {
  let candidates = rows.filter((row) => matchesSimple(row, where));
  if (orderBy) {
    const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
    candidates = [...candidates].sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return direction === "desc" ? bv - av : av - bv;
    });
  }
  return candidates[0] ?? null;
}

function matchesObligationVersionScope(versionId: string, where: Row): boolean {
  const scopesFilter = where.scopes as { some?: { OR?: Row[] } } | undefined;
  if (!scopesFilter?.some?.OR) return true;
  const rows = tables.versionScopes.filter((s) => s.obligationVersionId === versionId);
  return scopesFilter.some.OR.some((clause) => {
    const entityFilter = clause.entityId as { in?: string[] } | undefined;
    const siteFilter = clause.siteId as { in?: string[] } | undefined;
    return rows.some(
      (row) =>
        (entityFilter?.in && row.entityId && entityFilter.in.includes(row.entityId as string)) ||
        (siteFilter?.in && row.siteId && siteFilter.in.includes(row.siteId as string)),
    );
  });
}

vi.mock("@/lib/prisma", () => {
  const entity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.entities, where ?? {})) };
  const site = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.sites, where ?? {})) };
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };

  const complianceObligationVersion = {
    findMany: vi.fn(async ({ where, include }: FindArgs) => {
      const base = tables.obligationVersions.filter((row) => matchesSimple(row, where ?? {}));
      const scoped = base.filter((row) => matchesObligationVersionScope(row.id as string, where ?? {}));
      if (!include?.evaluationItems) return scoped;
      return scoped.map((row) => ({
        ...row,
        evaluationItems: tables.evaluationItems
          .filter((item) => item.obligationVersionId === row.id)
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .slice(0, 1)
          .map((item) => ({ status: item.status })),
      }));
    }),
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.obligationVersions, where ?? {})),
  };

  const complianceEvaluationProgramme = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.programmes, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.programmes.filter((row) => matchesSimple(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `programme-${tables.nextId++}`;
      const row: Row = { id, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.programmes.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.programmes, key);
      if (!row) throw new Error("programme not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const complianceEvaluation = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.evaluations, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.evaluations.filter((row) => matchesSimple(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] }; items?: { create: Row[] } } }) => {
      const { scopes: scopesEnvelope, items: itemsEnvelope, ...evalData } = data;
      const id = `evaluation-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "PLANNED",
        reportPayload: null,
        issuedAt: null,
        issuedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...evalData,
      };
      tables.evaluations.push(row);
      const scopeRows = (scopesEnvelope?.create ?? []).map((s) => ({ id: `escope-${tables.nextId++}`, evaluationId: id, ...s }));
      tables.evaluationScopes.push(...scopeRows);
      const itemRows = (itemsEnvelope?.create ?? []).map((i) => ({
        id: `item-${tables.nextId++}`,
        evaluationId: id,
        status: "NOT_EVALUATED",
        rationale: null,
        evaluatorMembershipId: null,
        evaluatedAt: null,
        followUpDate: null,
        createdAt: new Date(),
        ...i,
      }));
      tables.evaluationItems.push(...itemRows);
      return { ...row, scopes: scopeRows, items: itemRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.evaluations, key);
      if (!row) throw new Error("evaluation not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const complianceEvaluationItem = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.evaluationItems, key as Row);
    }),
    findMany: vi.fn(async ({ where, include }: FindArgs) => {
      const rows = tables.evaluationItems.filter((row) => matchesSimple(row, where ?? {}));
      if (!include?.obligationVersion) return rows;
      return rows.map((row) => ({
        ...row,
        obligationVersion: find(tables.obligationVersions, { id: row.obligationVersionId }),
      }));
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.evaluationItems, key);
      if (!row) throw new Error("item not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const complianceEvaluationFindingLink = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `finding-${tables.nextId++}`, requestedAt: new Date(), ...data };
      tables.findingLinks.push(row);
      return row;
    }),
  };

  const prismaClient = {
    entity,
    site,
    organisationMembership,
    complianceObligationVersion,
    complianceEvaluationProgramme,
    complianceEvaluation,
    complianceEvaluationItem,
    complianceEvaluationFindingLink,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createComplianceEvaluationProgramme,
  createComplianceEvaluation,
  startComplianceEvaluation,
  recordComplianceEvaluationItemResult,
  requestComplianceEvaluationFindingLink,
  completeComplianceEvaluation,
  issueComplianceEvaluation,
  listOverdueOrUnevaluatedObligations,
  ComplianceEvaluationError,
} = await import("@/lib/ems/legal/evaluation-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const PERFORM_ONLY = new Set(["ems.view", "ems.compliance_evaluation.perform"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-lead", membershipId: "membership-lead", permissions: PERFORM_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: PERFORM_ONLY });
const viewOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });

beforeEach(() => {
  tables.entities.length = 0;
  tables.sites.length = 0;
  tables.memberships.length = 0;
  tables.obligationVersions.length = 0;
  tables.versionScopes.length = 0;
  tables.programmes.length = 0;
  tables.evaluations.length = 0;
  tables.evaluationScopes.length = 0;
  tables.evaluationItems.length = 0;
  tables.findingLinks.length = 0;
  tables.nextId = 1;

  tables.entities.push({ id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" });
  tables.sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North" });
  tables.memberships.push({ id: "membership-lead", organisationId: ORG_A, status: "ACTIVE" });

  tables.obligationVersions.push({
    id: "version-1",
    organisationId: ORG_A,
    obligationId: "obligation-1",
    version: 1,
    title: "Discharge permit condition 4.2",
    requirementSummary: "Synthetic requirement text.",
    status: "ACTIVE",
    reviewDueDate: null,
  });
  tables.obligationVersions.push({
    id: "version-2",
    organisationId: ORG_A,
    obligationId: "obligation-2",
    version: 1,
    title: "Waste transfer note retention",
    requirementSummary: "Synthetic requirement text.",
    status: "ACTIVE",
    reviewDueDate: null,
  });
  tables.versionScopes.push({ id: "vscope-1", organisationId: ORG_A, obligationVersionId: "version-1", entityId: ENTITY_A, siteId: null });

  tables.obligationVersions.push({
    id: "version-b",
    organisationId: ORG_B,
    obligationId: "obligation-b",
    version: 1,
    title: "Org B obligation",
    requirementSummary: "Synthetic requirement text.",
    status: "ACTIVE",
    reviewDueDate: null,
  });
});

function programmeInput(overrides: Partial<Parameters<typeof createComplianceEvaluationProgramme>[1]> = {}) {
  return {
    name: "2026 Annual Compliance Evaluation",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-12-31"),
    leadMembershipId: "membership-lead",
    actorUserId: "user-lead",
    ...overrides,
  };
}

async function createProgramme(context = contextA) {
  return createComplianceEvaluationProgramme(context, programmeInput());
}

function evaluationInput(programmeId: string, overrides: Partial<Parameters<typeof createComplianceEvaluation>[1]> = {}) {
  return {
    programmeId,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-03-31"),
    leadMembershipId: "membership-lead",
    scopes: [] as { entityId?: string | null; siteId?: string | null }[],
    actorUserId: "user-lead",
    ...overrides,
  };
}

describe("createComplianceEvaluationProgramme", () => {
  it("creates an ACTIVE programme", async () => {
    const programme = await createProgramme();
    expect(programme.status).toBe("ACTIVE");
    expect(programme.name).toBe("2026 Annual Compliance Evaluation");
  });

  it("denies a member without ems.compliance_evaluation.perform", async () => {
    await expect(createComplianceEvaluationProgramme(viewOnlyContextA, programmeInput())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      createComplianceEvaluationProgramme(contextA, programmeInput({ periodEnd: new Date("2025-01-01") })),
    ).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });
});

describe("createComplianceEvaluation", () => {
  it("auto-populates one item per ACTIVE obligation version when unscoped", async () => {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(contextA, evaluationInput(programme.id as string));
    expect(evaluation.items).toHaveLength(2);
    expect(evaluation.status).toBe("PLANNED");
  });

  it("only includes obligation versions matching the evaluation's scope", async () => {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(
      contextA,
      evaluationInput(programme.id as string, { scopes: [{ entityId: ENTITY_A }] }),
    );
    expect(evaluation.items).toHaveLength(1);
    expect(evaluation.items[0]).toMatchObject({ obligationVersionId: "version-1" });
  });

  it("never includes another organisation's obligation versions", async () => {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(contextA, evaluationInput(programme.id as string));
    const versionIds = (evaluation.items as Row[]).map((item) => item.obligationVersionId);
    expect(versionIds).not.toContain("version-b");
  });

  it("does not resolve a foreign-tenant programme for another organisation", async () => {
    const programme = await createProgramme(contextA);
    await expect(createComplianceEvaluation(contextB, evaluationInput(programme.id as string))).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a member without ems.compliance_evaluation.perform", async () => {
    const programme = await createProgramme();
    await expect(createComplianceEvaluation(viewOnlyContextA, evaluationInput(programme.id as string))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("evaluation lifecycle", () => {
  async function plannedEvaluation() {
    const programme = await createProgramme();
    return createComplianceEvaluation(contextA, evaluationInput(programme.id as string));
  }

  it("starts a planned evaluation", async () => {
    const evaluation = await plannedEvaluation();
    const started = await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("refuses to start a non-planned evaluation", async () => {
    const evaluation = await plannedEvaluation();
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    await expect(startComplianceEvaluation(contextA, evaluation.id as string, "user-lead")).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });

  it("records an item outcome only while the evaluation is in progress", async () => {
    const evaluation = await plannedEvaluation();
    const item = (evaluation.items as Row[])[0];
    await expect(
      recordComplianceEvaluationItemResult(contextA, item.id as string, { status: "COMPLIANT", rationale: "Synthetic evidence review.", actorUserId: "user-lead" }),
    ).rejects.toBeInstanceOf(ComplianceEvaluationError);

    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const recorded = await recordComplianceEvaluationItemResult(contextA, item.id as string, {
      status: "COMPLIANT",
      rationale: "Synthetic evidence review.",
      actorUserId: "user-lead",
    });
    expect(recorded.status).toBe("COMPLIANT");
    expect(recorded.evaluatorMembershipId).toBe("membership-lead");
  });

  it("rejects an empty rationale", async () => {
    const evaluation = await plannedEvaluation();
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const item = (evaluation.items as Row[])[0];
    await expect(
      recordComplianceEvaluationItemResult(contextA, item.id as string, { status: "COMPLIANT", rationale: "  ", actorUserId: "user-lead" }),
    ).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });

  it("denies a member without ems.compliance_evaluation.perform", async () => {
    const evaluation = await plannedEvaluation();
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const item = (evaluation.items as Row[])[0];
    await expect(
      recordComplianceEvaluationItemResult(viewOnlyContextA, item.id as string, {
        status: "COMPLIANT",
        rationale: "Synthetic evidence review.",
        actorUserId: "user-viewer",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses to complete while any item is still NOT_EVALUATED", async () => {
    const evaluation = await plannedEvaluation();
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    await expect(completeComplianceEvaluation(contextA, evaluation.id as string, "user-lead")).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });

  it("completes once every item has a recorded outcome, then issues a frozen report", async () => {
    const evaluation = await plannedEvaluation();
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    for (const item of evaluation.items as Row[]) {
      await recordComplianceEvaluationItemResult(contextA, item.id as string, {
        status: "COMPLIANT",
        rationale: "Synthetic evidence review.",
        actorUserId: "user-lead",
      });
    }
    const completed = await completeComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    expect(completed.status).toBe("COMPLETED");

    const issued = await issueComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedByUserId).toBe("user-lead");
    const payload = issued.reportPayload as { items: Array<{ obligationVersionId: string; obligationVersion: number; status: string }> };
    expect(payload.items).toHaveLength(2);
    expect(payload.items.map((i) => i.obligationVersionId).sort()).toEqual(["version-1", "version-2"]);
    expect(payload.items.every((i) => i.status === "COMPLIANT")).toBe(true);
  });

  it("refuses to issue a non-completed evaluation", async () => {
    const evaluation = await plannedEvaluation();
    await expect(issueComplianceEvaluation(contextA, evaluation.id as string, "user-lead")).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });
});

describe("requestComplianceEvaluationFindingLink", () => {
  async function inProgressEvaluationWithNoncompliantItem() {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(contextA, evaluationInput(programme.id as string, { scopes: [{ entityId: ENTITY_A }] }));
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const item = (evaluation.items as Row[])[0];
    await recordComplianceEvaluationItemResult(contextA, item.id as string, {
      status: "NONCOMPLIANT",
      rationale: "Synthetic evidence review found a gap.",
      actorUserId: "user-lead",
    });
    return item;
  }

  it("requests a nonconformity link for a noncompliant item", async () => {
    const item = await inProgressEvaluationWithNoncompliantItem();
    const link = await requestComplianceEvaluationFindingLink(contextA, item.id as string, {
      linkType: "NONCONFORMITY",
      referenceNote: "Synthetic reference note.",
      actorUserId: "user-lead",
    });
    expect(link.linkType).toBe("NONCONFORMITY");
    expect(tables.findingLinks).toHaveLength(1);
  });

  it("refuses a finding link for a compliant item", async () => {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(contextA, evaluationInput(programme.id as string, { scopes: [{ entityId: ENTITY_A }] }));
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const item = (evaluation.items as Row[])[0];
    await recordComplianceEvaluationItemResult(contextA, item.id as string, {
      status: "COMPLIANT",
      rationale: "Synthetic evidence review.",
      actorUserId: "user-lead",
    });
    await expect(
      requestComplianceEvaluationFindingLink(contextA, item.id as string, {
        linkType: "NONCONFORMITY",
        referenceNote: "Synthetic reference note.",
        actorUserId: "user-lead",
      }),
    ).rejects.toBeInstanceOf(ComplianceEvaluationError);
  });
});

describe("listOverdueOrUnevaluatedObligations", () => {
  it("flags an ACTIVE obligation version with no evaluation item as never evaluated", async () => {
    const rows = await listOverdueOrUnevaluatedObligations(contextA);
    const ids = rows.map((row) => row.obligationVersionId);
    expect(ids).toContain("version-1");
    expect(ids).toContain("version-2");
    expect(rows.find((row) => row.obligationVersionId === "version-1")?.neverEvaluated).toBe(true);
  });

  it("stops flagging an obligation version once it has a decided outcome and is not overdue", async () => {
    const programme = await createProgramme();
    const evaluation = await createComplianceEvaluation(contextA, evaluationInput(programme.id as string, { scopes: [{ entityId: ENTITY_A }] }));
    await startComplianceEvaluation(contextA, evaluation.id as string, "user-lead");
    const item = (evaluation.items as Row[])[0];
    await recordComplianceEvaluationItemResult(contextA, item.id as string, {
      status: "COMPLIANT",
      rationale: "Synthetic evidence review.",
      actorUserId: "user-lead",
    });
    const rows = await listOverdueOrUnevaluatedObligations(contextA);
    expect(rows.map((row) => row.obligationVersionId)).not.toContain("version-1");
  });

  it("flags an obligation version whose review date is in the past even once evaluated", async () => {
    (find(tables.obligationVersions, { id: "version-1" }) as Row).reviewDueDate = new Date("2020-01-01");
    const rows = await listOverdueOrUnevaluatedObligations(contextA);
    expect(rows.find((row) => row.obligationVersionId === "version-1")?.reviewOverdue).toBe(true);
  });

  it("never returns another organisation's obligation versions", async () => {
    const rows = await listOverdueOrUnevaluatedObligations(contextA);
    expect(rows.map((row) => row.obligationVersionId)).not.toContain("version-b");
  });
});
