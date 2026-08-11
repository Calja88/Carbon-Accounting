/**
 * EMS programme / scope version lifecycle tests (task T23). No live
 * database — Prisma is replaced with an in-memory fake, following the T22
 * document-control-service.test.ts pattern exactly. Focuses on the state
 * machines (programme DRAFT->ACTIVE->SUSPENDED->CLOSED, scope version
 * DRAFT->IN_REVIEW->APPROVED->SUPERSEDED), the one-active-programme
 * constraint, and the "Site must belong to an included Entity" boundary
 * rule.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

interface ProgrammeRow {
  id: string;
  organisationId: string;
  name: string;
  status: string;
  standardsProfile: string;
  standardsProfileVersion: string;
  certificationIntent: string;
  ownerMembershipId: string | null;
  currentScopeVersionId: string | null;
  updatedAt: Date;
}

interface ScopeVersionRow {
  id: string;
  programmeId: string;
  organisationId: string;
  versionNumber: number;
  statement: string;
  status: string;
  exclusions: string | null;
  exclusionsRationale: string | null;
  effectiveDate: Date | null;
  reviewDueDate: Date | null;
  preparedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  supersedesVersionId: string | null;
}

const { programmes, scopeVersions, scopeEntities, scopeSites, entities, sites, resetTables, nextIdRef } = vi.hoisted(() => {
  const programmes: ProgrammeRow[] = [];
  const scopeVersions: ScopeVersionRow[] = [];
  const scopeEntities: { id: string; scopeVersionId: string; organisationId: string; entityId: string }[] = [];
  const scopeSites: { id: string; scopeVersionId: string; organisationId: string; siteId: string }[] = [];
  const entities: { id: string; organisationId: string; name: string }[] = [];
  const sites: { id: string; organisationId: string; entityId: string; name: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    programmes.length = 0;
    scopeVersions.length = 0;
    scopeEntities.length = 0;
    scopeSites.length = 0;
    entities.length = 0;
    sites.length = 0;
    nextIdRef.n = 1;
  }
  return { programmes, scopeVersions, scopeEntities, scopeSites, entities, sites, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "not" in (value as Record<string, unknown>)) {
      return record[key] !== (value as { not: unknown }).not;
    }
    return record[key] === value;
  });
}

class UniqueConstraintError extends Error {
  code = "P2002";
}

vi.mock("@/lib/prisma", () => {
  const emsProgramme = {
    create: vi.fn(async ({ data }: { data: Partial<ProgrammeRow> }) => {
      const row = {
        id: nextId("programme"),
        status: "DRAFT",
        certificationIntent: "NONE",
        ownerMembershipId: null,
        currentScopeVersionId: null,
        updatedAt: new Date(),
        ...data,
      } as ProgrammeRow;
      programmes.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ProgrammeRow> }) => {
      const row = programmes.find((p) => p.id === where.id);
      if (!row) throw new Error("not found");
      if (data.status === "ACTIVE" && row.status !== "ACTIVE") {
        const alreadyActive = programmes.find((p) => p.organisationId === row.organisationId && p.status === "ACTIVE" && p.id !== row.id);
        if (alreadyActive) throw new UniqueConstraintError("duplicate active programme");
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return programmes.find((p) => matches(p, where)) ?? null;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return programmes.find((p) => p.id === where.id) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return programmes.filter((p) => matches(p, where));
    }),
  };

  const emsScopeVersion = {
    create: vi.fn(async ({ data }: { data: Partial<ScopeVersionRow> }) => {
      const row = {
        id: nextId("scope-version"),
        exclusions: null,
        exclusionsRationale: null,
        effectiveDate: null,
        reviewDueDate: null,
        preparedByUserId: null,
        approvedByUserId: null,
        approvedAt: null,
        supersedesVersionId: null,
        status: "DRAFT",
        ...data,
      } as ScopeVersionRow;
      scopeVersions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ScopeVersionRow> }) => {
      const row = scopeVersions.find((v) => v.id === where.id);
      if (!row) throw new Error("not found");
      if (row.status !== "DRAFT" && row.status !== "IN_REVIEW") {
        if (data.status && ["DRAFT", "IN_REVIEW"].includes(data.status)) {
          throw new Error("EmsScopeVersion cannot move back to draft/review once approved");
        }
        const boundaryFields: (keyof ScopeVersionRow)[] = ["statement", "exclusions", "exclusionsRationale"];
        for (const field of boundaryFields) {
          if (field in data && data[field] !== row[field]) {
            throw new Error(`EmsScopeVersion boundary fields are immutable once ${row.status}`);
          }
        }
      }
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { versionNumber: "desc" } }) => {
      let rows = scopeVersions.filter((v) => matches(v, where));
      if (orderBy?.versionNumber === "desc") rows = [...rows].sort((a, b) => b.versionNumber - a.versionNumber);
      return rows[0] ?? null;
    }),
  };

  const emsScopeEntity = {
    upsert: vi.fn(async ({ create }: { create: { scopeVersionId: string; organisationId: string; entityId: string } }) => {
      const existing = scopeEntities.find((e) => e.scopeVersionId === create.scopeVersionId && e.entityId === create.entityId);
      if (existing) return existing;
      const row = { id: nextId("scope-entity"), ...create };
      scopeEntities.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return scopeEntities.find((e) => matches(e, where)) ?? null;
    }),
  };

  const emsScopeSite = {
    upsert: vi.fn(async ({ create }: { create: { scopeVersionId: string; organisationId: string; siteId: string } }) => {
      const existing = scopeSites.find((s) => s.scopeVersionId === create.scopeVersionId && s.siteId === create.siteId);
      if (existing) return existing;
      const row = { id: nextId("scope-site"), ...create };
      scopeSites.push(row);
      return row;
    }),
  };

  const entity = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entities.find((e) => matches(e, where)) ?? null),
  };
  const site = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => sites.find((s) => matches(s, where)) ?? null),
  };

  const prismaClient = {
    emsProgramme,
    emsScopeVersion,
    emsScopeEntity,
    emsScopeSite,
    entity,
    site,
    standardRequirementMap: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: nextId("requirement-map"), ...create })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };

  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

vi.mock("@/lib/jobs/outbox-service", () => ({
  enqueueTenantJob: vi.fn(async () => ({ id: "job-1" })),
}));

const {
  createEmsProgramme,
  activateEmsProgramme,
  suspendEmsProgramme,
  closeEmsProgramme,
  createScopeVersion,
  createSuccessorScopeVersion,
  submitScopeVersionForReview,
  approveScopeVersion,
  addScopeEntity,
  addScopeSite,
  EmsProgrammeError,
} = await import("@/lib/ems/foundation/programme-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  userId: "user-lead",
  permissions: new Set(["ems.programme.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, {
  userId: "user-birch-lead",
  permissions: new Set(["ems.programme.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const noPermissionContext = makeOrganisationContext(ORG_A, { userId: "user-nobody" });

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
  entities.push({ id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" });
  sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North" });
});

describe("createEmsProgramme", () => {
  it("creates a DRAFT programme", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    expect(programme.status).toBe("DRAFT");
    expect(programme.organisationId).toBe(ORG_A);
  });

  it("denies a caller without ems.programme.manage", async () => {
    await expect(
      createEmsProgramme(noPermissionContext, {
        name: "Group EMS",
        standardsProfile: "ISO14001",
        standardsProfileVersion: "2015",
        actorUserId: "user-nobody",
      }),
    ).rejects.toThrow();
  });
});

describe("EmsProgramme status lifecycle", () => {
  it("moves DRAFT -> ACTIVE -> SUSPENDED -> CLOSED", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    const active = await activateEmsProgramme(orgContextA, programme.id, "user-lead");
    expect(active.status).toBe("ACTIVE");
    const suspended = await suspendEmsProgramme(orgContextA, programme.id, "user-lead");
    expect(suspended.status).toBe("SUSPENDED");
    const closed = await closeEmsProgramme(orgContextA, programme.id, "user-lead");
    expect(closed.status).toBe("CLOSED");
  });

  it("refuses to activate a CLOSED programme", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    await activateEmsProgramme(orgContextA, programme.id, "user-lead");
    await closeEmsProgramme(orgContextA, programme.id, "user-lead");
    await expect(activateEmsProgramme(orgContextA, programme.id, "user-lead")).rejects.toThrow(EmsProgrammeError);
  });

  it("refuses a second ACTIVE programme for the same organisation", async () => {
    const first = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    await activateEmsProgramme(orgContextA, first.id, "user-lead");

    const second = await createEmsProgramme(orgContextA, {
      name: "Second EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    await expect(activateEmsProgramme(orgContextA, second.id, "user-lead")).rejects.toThrow(EmsProgrammeError);
  });

  it("allows Organisation B to have its own ACTIVE programme independent of Organisation A", async () => {
    const a = await createEmsProgramme(orgContextA, {
      name: "Aster EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    await activateEmsProgramme(orgContextA, a.id, "user-lead");

    const b = await createEmsProgramme(orgContextB, {
      name: "Birch EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-birch-lead",
    });
    const activeB = await activateEmsProgramme(orgContextB, b.id, "user-birch-lead");
    expect(activeB.status).toBe("ACTIVE");
  });
});

async function draftToApprovedScope() {
  const programme = await createEmsProgramme(orgContextA, {
    name: "Group EMS",
    standardsProfile: "ISO14001",
    standardsProfileVersion: "2015",
    actorUserId: "user-lead",
  });
  const version = await createScopeVersion(orgContextA, {
    programmeId: programme.id,
    statement: "Manufacturing operations at Aster North.",
    actorUserId: "user-lead",
  });
  await submitScopeVersionForReview(orgContextA, version.id, "user-lead");
  const approved = await approveScopeVersion(orgContextA, version.id, { actorUserId: "user-approver" });
  return { programme, version: approved };
}

describe("EmsScopeVersion lifecycle", () => {
  it("moves DRAFT -> IN_REVIEW -> APPROVED and points the programme's currentScopeVersionId at it", async () => {
    const { programme, version } = await draftToApprovedScope();
    expect(version.status).toBe("APPROVED");
    const updatedProgramme = programmes.find((p) => p.id === programme.id);
    expect(updatedProgramme?.currentScopeVersionId).toBe(version.id);
  });

  it("rejects boundary-statement edits once APPROVED (immutability, mirrors T22)", async () => {
    const { version } = await draftToApprovedScope();
    const { prisma } = await import("@/lib/prisma");
    await expect(
      prisma.emsScopeVersion.update({ where: { id: version.id }, data: { statement: "Different statement" } }),
    ).rejects.toThrow(/immutable/);
  });

  it("rejects moving an APPROVED version back to DRAFT", async () => {
    const { version } = await draftToApprovedScope();
    const { prisma } = await import("@/lib/prisma");
    await expect(
      prisma.emsScopeVersion.update({ where: { id: version.id }, data: { status: "DRAFT" } }),
    ).rejects.toThrow();
  });

  it("supersedes the previous approved version when a successor is approved", async () => {
    const { programme, version: first } = await draftToApprovedScope();
    const successor = await createSuccessorScopeVersion(orgContextA, {
      programmeId: programme.id,
      statement: "Manufacturing and warehousing operations at Aster North.",
      actorUserId: "user-lead",
    });
    expect(successor.versionNumber).toBe(2);
    expect(successor.supersedesVersionId).toBe(first.id);

    await submitScopeVersionForReview(orgContextA, successor.id, "user-lead");
    const approvedSuccessor = await approveScopeVersion(orgContextA, successor.id, { actorUserId: "user-approver" });

    expect(approvedSuccessor.status).toBe("APPROVED");
    const supersededFirst = scopeVersions.find((v) => v.id === first.id);
    expect(supersededFirst?.status).toBe("SUPERSEDED");
    const updatedProgramme = programmes.find((p) => p.id === programme.id);
    expect(updatedProgramme?.currentScopeVersionId).toBe(successor.id);
  });

  it("refuses a successor while the current version is still DRAFT/IN_REVIEW", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    await createScopeVersion(orgContextA, { programmeId: programme.id, statement: "Draft scope", actorUserId: "user-lead" });
    await expect(
      createSuccessorScopeVersion(orgContextA, { programmeId: programme.id, statement: "New scope", actorUserId: "user-lead" }),
    ).rejects.toThrow(EmsProgrammeError);
  });
});

describe("scope boundary: Site must belong to an included Entity", () => {
  it("denies adding a Site before its Entity is included", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    const version = await createScopeVersion(orgContextA, { programmeId: programme.id, statement: "Scope", actorUserId: "user-lead" });
    await expect(addScopeSite(orgContextA, version.id, SITE_A)).rejects.toThrow(EmsProgrammeError);
  });

  it("allows adding a Site once its Entity is included", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    const version = await createScopeVersion(orgContextA, { programmeId: programme.id, statement: "Scope", actorUserId: "user-lead" });
    await addScopeEntity(orgContextA, version.id, ENTITY_A);
    const scopeSite = await addScopeSite(orgContextA, version.id, SITE_A);
    expect(scopeSite.siteId).toBe(SITE_A);
  });

  it("allows the documented exception to skip the Entity-first check", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    const version = await createScopeVersion(orgContextA, { programmeId: programme.id, statement: "Scope", actorUserId: "user-lead" });
    const scopeSite = await addScopeSite(orgContextA, version.id, SITE_A, { allowExceptionWithoutEntity: true });
    expect(scopeSite.siteId).toBe(SITE_A);
  });

  it("denies adding an Organisation B Site to an Organisation A scope version (cross-tenant)", async () => {
    const programme = await createEmsProgramme(orgContextA, {
      name: "Group EMS",
      standardsProfile: "ISO14001",
      standardsProfileVersion: "2015",
      actorUserId: "user-lead",
    });
    const version = await createScopeVersion(orgContextA, { programmeId: programme.id, statement: "Scope", actorUserId: "user-lead" });
    sites.push({ id: "site-birch-1", organisationId: ORG_B, entityId: "entity-birch-1", name: "Birch South" });
    await expect(addScopeSite(orgContextA, version.id, "site-birch-1", { allowExceptionWithoutEntity: true })).rejects.toThrow();
  });
});
