/**
 * Audit programme and audit execution tests (task T60). No live database —
 * Prisma is replaced with an in-memory fake and the audit-event side effect
 * is stubbed, so these tests stay focused on: programme/item creation,
 * coverage-scope validation, audit scheduling, schedule-change auditing,
 * independence-conflict blocking on team assignment, auditor-scope
 * validation before execution starts, and tenant isolation. All fixtures
 * are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  entities: [] as Row[],
  sites: [] as Row[],
  processes: [] as Row[],
  aspects: [] as Row[],
  obligations: [] as Row[],
  requirementMaps: [] as Row[],
  memberships: [] as Row[],
  programmes: [] as Row[],
  items: [] as Row[],
  itemScopes: [] as Row[],
  audits: [] as Row[],
  auditScopes: [] as Row[],
  teamMembers: [] as Row[],
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
  return Object.entries(where).every(([key, value]) => {
    if (key === "item" || key === "audit") return true; // relation filters resolved separately below
    return matchValue(row[key], value);
  });
}

function find(rows: Row[], where: Row) {
  return rows.filter((row) => matchesSimple(row, where))[0] ?? null;
}

vi.mock("@/lib/prisma", () => {
  const entity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.entities, where ?? {})) };
  const site = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.sites, where ?? {})), findMany: vi.fn(async ({ where }: FindArgs) => tables.sites.filter((r) => matchesSimple(r, where ?? {}))) };
  const activityProcess = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.processes, where ?? {})), findMany: vi.fn(async ({ where }: FindArgs) => tables.processes.filter((r) => matchesSimple(r, where ?? {}))) };
  const environmentalAspect = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.aspects, where ?? {})), findMany: vi.fn(async ({ where }: FindArgs) => tables.aspects.filter((r) => matchesSimple(r, where ?? {}))) };
  const complianceObligation = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.obligations, where ?? {})), findMany: vi.fn(async ({ where }: FindArgs) => tables.obligations.filter((r) => matchesSimple(r, where ?? {}))) };
  const standardRequirementMap = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.requirementMaps, where ?? {})), findMany: vi.fn(async ({ where }: FindArgs) => tables.requirementMaps.filter((r) => matchesSimple(r, where ?? {}))) };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})),
  };

  const auditProgramme = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.programmes, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.programmes.filter((row) => matchesSimple(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `programme-${tables.nextId++}`;
      const row: Row = { id, status: "DRAFT", version: 1, supersedesProgrammeId: null, approvedAt: null, approvedByUserId: null, createdAt: new Date(), updatedAt: new Date(), ...data };
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

  const auditProgrammeItem = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.items, key as Row);
    }),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] } } }) => {
      const { scopes: scopesEnvelope, ...itemData } = data;
      const id = `item-${tables.nextId++}`;
      const row: Row = { id, createdAt: new Date(), updatedAt: new Date(), ...itemData };
      tables.items.push(row);
      const scopeRows = (scopesEnvelope?.create ?? []).map((s) => ({ id: `iscope-${tables.nextId++}`, itemId: id, ...s }));
      tables.itemScopes.push(...scopeRows);
      return { ...row, scopes: scopeRows };
    }),
  };

  const auditProgrammeItemScope = {
    findMany: vi.fn(async ({ where }: FindArgs) => {
      const w = (where ?? {}) as Row & { item?: { programmeId?: string } };
      return tables.itemScopes.filter((row) => {
        if (w.organisationId && row.organisationId !== w.organisationId) return false;
        if (w.item?.programmeId) {
          const item = tables.items.find((i) => i.id === row.itemId);
          if (!item || item.programmeId !== w.item.programmeId) return false;
        }
        return true;
      });
    }),
  };

  const emsAudit = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.audits, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.audits.filter((row) => matchesSimple(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] } } }) => {
      const { scopes: scopesEnvelope, ...auditData } = data;
      const id = `audit-${tables.nextId++}`;
      const row: Row = { id, status: "PLANNED", createdAt: new Date(), updatedAt: new Date(), ...auditData };
      tables.audits.push(row);
      const scopeRows = (scopesEnvelope?.create ?? []).map((s) => ({ id: `ascope-${tables.nextId++}`, auditId: id, ...s }));
      tables.auditScopes.push(...scopeRows);
      return { ...row, scopes: scopeRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.audits, key);
      if (!row) throw new Error("audit not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const emsAuditScope = {
    findMany: vi.fn(async ({ where }: FindArgs) => {
      const w = (where ?? {}) as Row & { audit?: { programmeId?: string } };
      return tables.auditScopes.filter((row) => {
        if (w.organisationId && row.organisationId !== w.organisationId) return false;
        if (w.auditId && row.auditId !== w.auditId) return false;
        if (w.audit?.programmeId) {
          const audit = tables.audits.find((a) => a.id === row.auditId);
          if (!audit || audit.programmeId !== w.audit.programmeId) return false;
        }
        return true;
      });
    }),
  };

  const auditTeamMember = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.teamMembers, where ?? {})),
    findMany: vi.fn(async ({ where, include }: FindArgs & { include?: Row }) => {
      const rows = tables.teamMembers.filter((row) => matchesSimple(row, where ?? {}));
      if (!include?.membership) return rows;
      return rows.map((row) => {
        const membership = tables.memberships.find((m) => m.id === row.membershipId) ?? {};
        return {
          ...row,
          membership: {
            ...membership,
            entityScopes: ((membership.entityScopes as Row[]) ?? []).map((s) => ({ entityId: s.entityId ?? s })),
            siteScopes: ((membership.siteScopes as Row[]) ?? []).map((s) => ({ siteId: s.siteId ?? s })),
          },
        };
      });
    }),
    count: vi.fn(async ({ where }: FindArgs) => tables.teamMembers.filter((row) => matchesSimple(row, where ?? {})).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `member-${tables.nextId++}`, createdAt: new Date(), ...data };
      tables.teamMembers.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row & { organisationId_auditId_membershipId?: Row } }) => {
      const key = where.organisationId_auditId_membershipId ?? where;
      const idx = tables.teamMembers.findIndex((row) => matchesSimple(row, key as Row));
      if (idx === -1) throw new Error("member not found");
      const [removed] = tables.teamMembers.splice(idx, 1);
      return removed;
    }),
  };

  // T61 startAuditExecution freezes any DRAFT checklist in the same
  // transaction; these T60 tests never create one, so a stub returning "no
  // checklist" is enough to keep freezeActiveChecklistVersionInTransaction
  // a no-op here (see checklist-finding-report.test.ts for T61 coverage).
  const auditChecklistVersion = { findFirst: vi.fn(async () => null) };

  const prismaClient = {
    entity,
    site,
    activityProcess,
    environmentalAspect,
    complianceObligation,
    standardRequirementMap,
    organisationMembership,
    auditProgramme,
    auditProgrammeItem,
    auditProgrammeItemScope,
    emsAudit,
    emsAuditScope,
    auditTeamMember,
    auditChecklistVersion,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  createAuditProgramme,
  approveAuditProgramme,
  activateAuditProgramme,
  createAuditProgrammeItem,
  getAuditProgrammeCoverageReport,
  AuditProgrammeError,
} = await import("@/lib/ems/audits/programme-service");
const {
  createEmsAudit,
  rescheduleEmsAudit,
  assignAuditTeamMember,
  startAuditPreparation,
  startAuditExecution,
} = await import("@/lib/ems/audits/audit-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");
const { recordAuditEvent } = await import("@/lib/repositories/audit-repository");

const MANAGE_ONLY = new Set(["ems.view", "ems.audit_programme.manage"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-lead", membershipId: "membership-lead", permissions: MANAGE_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_ONLY });
const viewOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;

  tables.entities.push({ id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" });
  tables.sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North", isActive: true });
  tables.memberships.push({ id: "membership-lead", organisationId: ORG_A, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" });
  tables.memberships.push({ id: "membership-auditor", organisationId: ORG_A, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" });

  vi.mocked(recordAuditEvent).mockClear();
});

function programmeInput(overrides: Partial<Parameters<typeof createAuditProgramme>[1]> = {}) {
  return {
    name: "2026 Internal Audit Programme",
    riskBasis: "Prioritised by significance-assessment output and prior nonconformity history.",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-12-31"),
    ownerMembershipId: "membership-lead",
    actorUserId: "user-lead",
    ...overrides,
  };
}

async function createActiveProgramme(context = contextA) {
  const programme = await createAuditProgramme(context, programmeInput());
  await approveAuditProgramme(context, programme.id as string, "user-lead");
  await activateAuditProgramme(context, programme.id as string, "user-lead");
  return programme;
}

function auditInput(programmeId: string, overrides: Partial<Parameters<typeof createEmsAudit>[1]> = {}) {
  return {
    programmeId,
    type: "INTERNAL" as const,
    title: "Site North internal audit",
    criteriaSummary: "ISO 14001:2015 clause 9.2, controlled procedure PROC-04.",
    leadMembershipId: "membership-lead",
    scheduledStart: new Date("2026-03-01"),
    scheduledEnd: new Date("2026-03-02"),
    scopes: [{ siteId: SITE_A }],
    actorUserId: "user-lead",
    ...overrides,
  };
}

describe("createAuditProgramme", () => {
  it("creates a draft programme", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    expect(programme.status).toBe("DRAFT");
    expect(programme.organisationId).toBe(ORG_A);
  });

  it("denies a caller without the manage permission", async () => {
    await expect(createAuditProgramme(viewOnlyContextA, programmeInput())).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      createAuditProgramme(contextA, programmeInput({ periodStart: new Date("2026-12-31"), periodEnd: new Date("2026-01-01") })),
    ).rejects.toThrow(AuditProgrammeError);
  });
});

describe("programme lifecycle", () => {
  it("moves DRAFT -> APPROVED -> ACTIVE", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    const approved = await approveAuditProgramme(contextA, programme.id as string, "user-lead");
    expect(approved.status).toBe("APPROVED");
    const activated = await activateAuditProgramme(contextA, programme.id as string, "user-lead");
    expect(activated.status).toBe("ACTIVE");
  });

  it("refuses to approve a non-draft programme", async () => {
    const programme = await createActiveProgramme();
    await expect(approveAuditProgramme(contextA, programme.id as string, "user-lead")).rejects.toThrow(AuditProgrammeError);
  });

  it("does not resolve a foreign-tenant programme for another organisation", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    await expect(approveAuditProgramme(contextB, programme.id as string, "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("createAuditProgrammeItem coverage scope", () => {
  it("creates a planned item with a valid site scope row", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    const item = await createAuditProgrammeItem(contextA, programme.id as string, {
      title: "North site audit",
      plannedStart: new Date("2026-02-01"),
      plannedEnd: new Date("2026-02-28"),
      scopes: [{ siteId: SITE_A }],
      actorUserId: "user-lead",
    });
    expect((item.scopes as Row[]).length).toBe(1);
  });

  it("rejects a scope row with no dimension set", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    await expect(
      createAuditProgrammeItem(contextA, programme.id as string, {
        title: "Invalid scope",
        plannedStart: new Date("2026-02-01"),
        plannedEnd: new Date("2026-02-28"),
        scopes: [{}],
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(AuditProgrammeError);
  });

  it("rejects a scope row with two dimensions set", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    await expect(
      createAuditProgrammeItem(contextA, programme.id as string, {
        title: "Ambiguous scope",
        plannedStart: new Date("2026-02-01"),
        plannedEnd: new Date("2026-02-28"),
        scopes: [{ siteId: SITE_A, entityId: ENTITY_A }],
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(AuditProgrammeError);
  });

  it("rejects a foreign-tenant site id", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    tables.sites.push({ id: "site-foreign", organisationId: ORG_B, entityId: "entity-foreign", name: "Foreign", isActive: true });
    await expect(
      createAuditProgrammeItem(contextA, programme.id as string, {
        title: "Foreign scope",
        plannedStart: new Date("2026-02-01"),
        plannedEnd: new Date("2026-02-28"),
        scopes: [{ siteId: "site-foreign" }],
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("coverage report", () => {
  it("reports the site covered by a programme item's scope", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    await createAuditProgrammeItem(contextA, programme.id as string, {
      title: "North site audit",
      plannedStart: new Date("2026-02-01"),
      plannedEnd: new Date("2026-02-28"),
      scopes: [{ siteId: SITE_A }],
      actorUserId: "user-lead",
    });
    const report = await getAuditProgrammeCoverageReport(contextA, programme.id as string);
    expect(report.sites.totalCount).toBe(1);
    expect(report.sites.coveredCount).toBe(1);
    expect(report.sites.coveredIds).toEqual([SITE_A]);
    expect(report.processes.totalCount).toBe(0);
  });
});

describe("createEmsAudit", () => {
  it("schedules an audit under an active programme", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    expect(audit.status).toBe("PLANNED");
  });

  it("refuses to schedule under a draft programme", async () => {
    const programme = await createAuditProgramme(contextA, programmeInput());
    await expect(createEmsAudit(contextA, auditInput(programme.id as string))).rejects.toThrow(AuditProgrammeError);
  });
});

describe("rescheduleEmsAudit", () => {
  it("changes the schedule and records an audit event", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    const before = vi.mocked(recordAuditEvent).mock.calls.length;

    const updated = await rescheduleEmsAudit(contextA, audit.id as string, {
      scheduledStart: new Date("2026-04-01"),
      scheduledEnd: new Date("2026-04-02"),
      reason: "Lead auditor unavailable in March",
      actorUserId: "user-lead",
    });

    expect((updated.scheduledStart as Date).toISOString()).toBe(new Date("2026-04-01").toISOString());
    expect(vi.mocked(recordAuditEvent).mock.calls.length).toBe(before + 1);
    const [, , event] = vi.mocked(recordAuditEvent).mock.calls[before];
    expect((event as { eventType: string }).eventType).toBe("ems_audit.rescheduled");
  });
});

describe("assignAuditTeamMember independence", () => {
  it("assigns a lead auditor with a clean independence declaration", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    const member = await assignAuditTeamMember(contextA, audit.id as string, {
      membershipId: "membership-lead",
      role: "LEAD_AUDITOR",
      independenceDeclared: true,
      conflictDeclared: false,
      actorUserId: "user-lead",
    });
    expect(member.role).toBe("LEAD_AUDITOR");
    expect(member.independenceDeclared).toBe(true);
  });

  it("blocks a declared conflict from an AUDITOR assignment", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    await expect(
      assignAuditTeamMember(contextA, audit.id as string, {
        membershipId: "membership-auditor",
        role: "AUDITOR",
        independenceDeclared: false,
        conflictDeclared: true,
        conflictNotes: "Reviewed this site's operations last quarter.",
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(AuditProgrammeError);
  });

  it("allows a declared conflict for an OBSERVER role", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    const member = await assignAuditTeamMember(contextA, audit.id as string, {
      membershipId: "membership-auditor",
      role: "OBSERVER",
      independenceDeclared: false,
      conflictDeclared: true,
      conflictNotes: "Site manager observing for training purposes.",
      actorUserId: "user-lead",
    });
    expect(member.role).toBe("OBSERVER");
  });

  it("requires conflict notes when a conflict is declared", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    await expect(
      assignAuditTeamMember(contextA, audit.id as string, {
        membershipId: "membership-auditor",
        role: "OBSERVER",
        independenceDeclared: false,
        conflictDeclared: true,
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(AuditProgrammeError);
  });
});

describe("audit preparation and execution", () => {
  it("requires a lead auditor before starting preparation", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    await expect(startAuditPreparation(contextA, audit.id as string, "user-lead")).rejects.toThrow(AuditProgrammeError);
  });

  it("requires every auditor's independence declaration before execution starts", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    await assignAuditTeamMember(contextA, audit.id as string, {
      membershipId: "membership-lead",
      role: "LEAD_AUDITOR",
      independenceDeclared: false,
      conflictDeclared: false,
      actorUserId: "user-lead",
    });
    await startAuditPreparation(contextA, audit.id as string, "user-lead");
    await expect(startAuditExecution(contextA, audit.id as string, "user-lead")).rejects.toThrow(AuditProgrammeError);
  });

  it("validates a restricted auditor's site access covers the audit scope before execution starts", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    tables.memberships.push({
      id: "membership-restricted",
      organisationId: ORG_A,
      status: "ACTIVE",
      accessMode: "RESTRICTED",
      entityScopes: [],
      siteScopes: [], // no site access at all — does not cover SITE_A
    });
    await assignAuditTeamMember(contextA, audit.id as string, {
      membershipId: "membership-restricted",
      role: "LEAD_AUDITOR",
      independenceDeclared: true,
      conflictDeclared: false,
      actorUserId: "user-lead",
    });
    await startAuditPreparation(contextA, audit.id as string, "user-lead");
    await expect(startAuditExecution(contextA, audit.id as string, "user-lead")).rejects.toThrow(AuditProgrammeError);
  });

  it("starts execution once a lead auditor with clean independence and matching scope is assigned", async () => {
    const programme = await createActiveProgramme();
    const audit = await createEmsAudit(contextA, auditInput(programme.id as string));
    await assignAuditTeamMember(contextA, audit.id as string, {
      membershipId: "membership-lead",
      role: "LEAD_AUDITOR",
      independenceDeclared: true,
      conflictDeclared: false,
      actorUserId: "user-lead",
    });
    await startAuditPreparation(contextA, audit.id as string, "user-lead");
    const started = await startAuditExecution(contextA, audit.id as string, "user-lead");
    expect(started.status).toBe("IN_PROGRESS");
  });
});
