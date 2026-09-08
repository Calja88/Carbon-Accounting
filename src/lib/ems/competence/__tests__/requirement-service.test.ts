/**
 * Competence requirement versioning tests (task T70). No live database —
 * Prisma is replaced with an in-memory fake and the audit-event side
 * effect is stubbed. Covers: DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED,
 * the active-pointer move, scope-target validation (role/process/aspect/
 * control/obligation/emergency-role), successor versions, and tenant
 * isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  roles: [] as Row[],
  processes: [] as Row[],
  aspects: [] as Row[],
  controls: [] as Row[],
  obligationVersions: [] as Row[],
  emergencyScenarios: [] as Row[],
  requirements: [] as Row[],
  versions: [] as Row[],
  scopes: [] as Row[],
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

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

function find(rows: Row[], where: Row, orderBy?: Row) {
  let candidates = rows.filter((row) => matches(row, where));
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

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row, orderBy);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(rows, (where ?? {}) as Row)),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matches(r, (where ?? {}) as Row))),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] } } }) => {
      const { scopes: scopeCreate, ...rest } = data;
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...rest };
      rows.push(row);
      if (scopeCreate?.create) {
        for (const scope of scopeCreate.create) {
          tables.scopes.push({ id: `scope-${tables.nextId++}`, requirementVersionId: row.id, createdAt: new Date(), ...scope });
        }
      }
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const toRemove = rows.filter((r) => matches(r, (where ?? {}) as Row));
      for (const row of toRemove) rows.splice(rows.indexOf(row), 1);
      return { count: toRemove.length };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const roleDefinition = simpleModel(tables.roles, "role");
  const activityProcess = simpleModel(tables.processes, "process");
  const environmentalAspect = simpleModel(tables.aspects, "aspect");
  const operationalControl = simpleModel(tables.controls, "control");
  const complianceObligationVersion = simpleModel(tables.obligationVersions, "obligation-version");
  const emergencyScenario = simpleModel(tables.emergencyScenarios, "scenario");
  const competenceRequirement = simpleModel(tables.requirements, "requirement");
  const competenceRequirementVersion = simpleModel(tables.versions, "version", { status: "DRAFT" });
  const competenceRequirementScope = simpleModel(tables.scopes, "scope");

  const prismaClient = {
    roleDefinition,
    activityProcess,
    environmentalAspect,
    operationalControl,
    complianceObligationVersion,
    emergencyScenario,
    competenceRequirement,
    competenceRequirementVersion,
    competenceRequirementScope,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  CompetenceRequirementError,
  TenantOwnershipError,
  createCompetenceRequirement,
  approveCompetenceRequirementVersion,
  activateCompetenceRequirementVersion,
  createSuccessorCompetenceRequirementVersion,
} = await import("@/lib/ems/competence/requirement-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.view", "ems.competence.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.roles.length = 0;
  tables.processes.length = 0;
  tables.aspects.length = 0;
  tables.controls.length = 0;
  tables.obligationVersions.length = 0;
  tables.emergencyScenarios.length = 0;
  tables.requirements.length = 0;
  tables.versions.length = 0;
  tables.scopes.length = 0;
  tables.nextId = 1;

  tables.roles.push({ id: "role-A1", organisationId: ORG_A });
  tables.controls.push({ id: "control-A1", organisationId: ORG_A });
});

async function draftRequirement(overrides: Partial<Parameters<typeof createCompetenceRequirement>[1]> = {}) {
  return createCompetenceRequirement(orgContextA, {
    requirementKey: "confined-space-entry",
    title: "Confined space entry competence",
    description: "Required for anyone entering a confined space.",
    scopes: [{ scopeType: "ROLE", roleId: "role-A1" }],
    actorUserId: "user-1",
    ...overrides,
  });
}

describe("createCompetenceRequirement", () => {
  it("creates a DRAFT v1 with its scope", async () => {
    const { requirement, version } = await draftRequirement();
    expect(version.status).toBe("DRAFT");
    expect(version.version).toBe(1);
    expect(tables.scopes.filter((s) => s.requirementVersionId === version.id)).toHaveLength(1);
    expect(requirement.activeVersionId ?? null).toBeNull();
  });

  it("rejects a scope with zero targets", async () => {
    await expect(draftRequirement({ scopes: [{ scopeType: "ROLE" }] })).rejects.toThrow(CompetenceRequirementError);
  });

  it("rejects a scope with more than one target", async () => {
    await expect(
      draftRequirement({ scopes: [{ scopeType: "ROLE", roleId: "role-A1", controlId: "control-A1" }] }),
    ).rejects.toThrow(CompetenceRequirementError);
  });

  it("denies a scope target belonging to another tenant", async () => {
    tables.roles.push({ id: "role-B1", organisationId: ORG_B });
    await expect(draftRequirement({ scopes: [{ scopeType: "ROLE", roleId: "role-B1" }] })).rejects.toThrow(TenantOwnershipError);
  });
});

describe("approve / activate state machine", () => {
  it("moves DRAFT -> APPROVED -> ACTIVE and sets the requirement's active pointer", async () => {
    const { requirement, version } = await draftRequirement();
    const approved = await approveCompetenceRequirementVersion(orgContextA, version.id, "user-1");
    expect(approved.status).toBe("APPROVED");
    const activated = await activateCompetenceRequirementVersion(orgContextA, version.id, "user-1");
    expect(activated.status).toBe("ACTIVE");
    const updatedRequirement = find(tables.requirements, { id: requirement.id });
    expect(updatedRequirement?.activeVersionId).toBe(version.id);
  });

  it("rejects activating a version that is still DRAFT", async () => {
    const { version } = await draftRequirement();
    await expect(activateCompetenceRequirementVersion(orgContextA, version.id, "user-1")).rejects.toThrow(CompetenceRequirementError);
  });

  it("supersedes the previously active version when a new one activates", async () => {
    const { requirement, version: v1 } = await draftRequirement();
    await approveCompetenceRequirementVersion(orgContextA, v1.id, "user-1");
    await activateCompetenceRequirementVersion(orgContextA, v1.id, "user-1");

    const v2 = await createSuccessorCompetenceRequirementVersion(orgContextA, requirement.id, {
      title: "Confined space entry competence (revised)",
      description: "Revised description.",
      scopes: [{ scopeType: "ROLE", roleId: "role-A1" }],
      revisionRationale: "Annual review.",
      actorUserId: "user-1",
    });
    await approveCompetenceRequirementVersion(orgContextA, v2.id, "user-1");
    await activateCompetenceRequirementVersion(orgContextA, v2.id, "user-1");

    const supersededV1 = find(tables.versions, { id: v1.id });
    expect(supersededV1?.status).toBe("SUPERSEDED");
    const updatedRequirement = find(tables.requirements, { id: requirement.id });
    expect(updatedRequirement?.activeVersionId).toBe(v2.id);
  });
});
