/**
 * Checklists, evidence, findings and frozen report tests (task T61). No live
 * database — Prisma is replaced with an in-memory fake and the audit-event
 * side effect is stubbed. Covers: checklist freeze locking further edits,
 * responses only against a frozen checklist, finding state-machine
 * transitions and confirmation authority, report draft/issue and the
 * immutability it locks in, and tenant isolation. All fixtures are
 * fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  audits: [] as Row[],
  auditScopes: [] as Row[],
  teamMembers: [] as Row[],
  checklistVersions: [] as Row[],
  checklistItems: [] as Row[],
  questionResponses: [] as Row[],
  findings: [] as Row[],
  reportRevisions: [] as Row[],
  coverageSnapshots: [] as Row[],
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

vi.mock("@/lib/prisma", () => {
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };

  const emsAudit = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.audits, key as Row);
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.audits, key);
      if (!row) throw new Error("audit not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const emsAuditScope = { findMany: vi.fn(async ({ where }: FindArgs) => tables.auditScopes.filter((r) => matchesSimple(r, where ?? {}))) };

  const auditTeamMember = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.teamMembers, where ?? {})),
  };

  const auditChecklistVersion = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs & { orderBy?: { version?: string } }) => {
      const rows = tables.checklistVersions.filter((r) => matchesSimple(r, (where as Row) ?? {}));
      if (orderBy?.version === "desc") rows.sort((a, b) => (b.version as number) - (a.version as number));
      return rows[0] ?? null;
    }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => find(tables.checklistVersions, where)),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `checklist-${tables.nextId++}`, status: "DRAFT", createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.checklistVersions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.checklistVersions, key);
      if (!row) throw new Error("checklist version not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const auditChecklistItem = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.checklistItems, where ?? {})),
    count: vi.fn(async ({ where }: FindArgs) => tables.checklistItems.filter((r) => matchesSimple(r, where ?? {})).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `item-${tables.nextId++}`, createdAt: new Date(), ...data };
      tables.checklistItems.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row & { organisationId_checklistVersionId_sortOrder?: Row } }) => {
      const key = where.organisationId_checklistVersionId_sortOrder ?? where;
      const idx = tables.checklistItems.findIndex((row) => matchesSimple(row, key as Row));
      if (idx === -1) throw new Error("item not found");
      const [removed] = tables.checklistItems.splice(idx, 1);
      return removed;
    }),
  };

  const auditQuestionResponse = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.questionResponses, where ?? {})),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `response-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.questionResponses.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row & { organisationId_checklistItemId?: Row }; data: Row }) => {
      const key = where.organisationId_checklistItemId ?? where;
      const row = find(tables.questionResponses, key);
      if (!row) throw new Error("response not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const auditFinding = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.findings, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.findings.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `finding-${tables.nextId++}`, status: "DRAFT", createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.findings.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.findings, key);
      if (!row) throw new Error("finding not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const auditReportRevision = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.reportRevisions, key as Row);
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `report-${tables.nextId++}`, status: "DRAFT", createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.reportRevisions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.reportRevisions, key);
      if (!row) throw new Error("report not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const auditCoverageSnapshot = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `coverage-${tables.nextId++}`, createdAt: new Date(), ...data };
      tables.coverageSnapshots.push(row);
      return row;
    }),
  };

  const prismaClient = {
    organisationMembership,
    emsAudit,
    emsAuditScope,
    auditTeamMember,
    auditChecklistVersion,
    auditChecklistItem,
    auditQuestionResponse,
    auditFinding,
    auditReportRevision,
    auditCoverageSnapshot,
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
  AuditChecklistError,
  ensureDraftChecklistVersion,
  addChecklistItem,
  freezeChecklistVersion,
  recordQuestionResponse,
} = await import("@/lib/ems/audits/checklist-service");
const {
  AuditFindingError,
  createAuditFinding,
  confirmAuditFinding,
  requireActionOnAuditFinding,
  closeAuditFinding,
} = await import("@/lib/ems/audits/finding-service");
const {
  AuditReportError,
  createAuditReportDraft,
  issueAuditReport,
  getIssuedAuditReport,
} = await import("@/lib/ems/audits/report-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const LEAD_PERMS = new Set(["ems.view", "ems.audit.perform"]) as never;
const MANAGE_PERMS = new Set(["ems.view", "ems.audit_programme.manage", "ems.audit.perform", "ems.audit_report.issue"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const leadContextA = makeOrganisationContext(ORG_A, { userId: "user-lead", membershipId: "membership-lead", permissions: LEAD_PERMS });
const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: MANAGE_PERMS });
const auditorContextA = makeOrganisationContext(ORG_A, { userId: "user-auditor", membershipId: "membership-auditor", permissions: LEAD_PERMS });
const outsiderContextA = makeOrganisationContext(ORG_A, { userId: "user-outsider", membershipId: "membership-outsider", permissions: VIEW_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_PERMS });

const AUDIT_ID = "audit-1";

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;

  tables.memberships.push({ id: "membership-lead", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-auditor", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE" });

  tables.audits.push({ id: AUDIT_ID, organisationId: ORG_A, status: "PREPARATION", title: "Site North internal audit", type: "INTERNAL", criteriaSummary: "ISO 14001:2015 clause 9.2.", scheduledStart: new Date("2026-03-01"), scheduledEnd: new Date("2026-03-02") });
  tables.teamMembers.push({ id: "team-lead", organisationId: ORG_A, auditId: AUDIT_ID, membershipId: "membership-lead", role: "LEAD_AUDITOR" });
  tables.teamMembers.push({ id: "team-auditor", organisationId: ORG_A, auditId: AUDIT_ID, membershipId: "membership-auditor", role: "AUDITOR" });
});

async function addFrozenChecklistWithOneItem() {
  const version = await ensureDraftChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
  await addChecklistItem(leadContextA, version.id as string, { question: "Is waste segregated correctly?", actorUserId: "user-lead" });
  return freezeChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
}

describe("checklist versioning", () => {
  it("starts a draft checklist and adds items", async () => {
    const version = await ensureDraftChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
    expect(version.status).toBe("DRAFT");
    const item = await addChecklistItem(leadContextA, version.id as string, { question: "Q1", actorUserId: "user-lead" });
    expect(item.question).toBe("Q1");
  });

  it("denies checklist work to a caller with no execution access", async () => {
    await expect(ensureDraftChecklistVersion(outsiderContextA, AUDIT_ID, "user-outsider")).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses to freeze a checklist with no items", async () => {
    await ensureDraftChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
    await expect(freezeChecklistVersion(leadContextA, AUDIT_ID, "user-lead")).rejects.toThrow(AuditChecklistError);
  });

  it("freezes the checklist and blocks further item edits", async () => {
    const frozen = await addFrozenChecklistWithOneItem();
    expect(frozen?.status).toBe("FROZEN");
    await expect(addChecklistItem(leadContextA, frozen!.id as string, { question: "Too late", actorUserId: "user-lead" })).rejects.toThrow(AuditChecklistError);
  });

  it("does not resolve a foreign-tenant checklist version", async () => {
    const version = await ensureDraftChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
    await expect(addChecklistItem(contextB, version.id as string, { question: "Foreign", actorUserId: "user-b" })).rejects.toThrow(TenantOwnershipError);
  });
});

describe("question responses", () => {
  it("refuses a response against a draft (unfrozen) checklist", async () => {
    const version = await ensureDraftChecklistVersion(leadContextA, AUDIT_ID, "user-lead");
    const item = await addChecklistItem(leadContextA, version.id as string, { question: "Q1", actorUserId: "user-lead" });
    await expect(
      recordQuestionResponse(leadContextA, item.id as string, { result: "CONFORMS", auditorMembershipId: "membership-lead", actorUserId: "user-lead" }),
    ).rejects.toThrow(AuditChecklistError);
  });

  it("records a response once the checklist is frozen", async () => {
    const frozen = await addFrozenChecklistWithOneItem();
    const item = tables.checklistItems[0];
    const response = await recordQuestionResponse(leadContextA, item.id as string, {
      result: "NONCONFORMANCE",
      notes: "Bins mixed at the loading dock.",
      auditorMembershipId: "membership-auditor",
      actorUserId: "user-auditor",
    });
    expect(response.result).toBe("NONCONFORMANCE");
    void frozen;
  });

  it("blocks new responses once the report has been issued", async () => {
    await addFrozenChecklistWithOneItem();
    const item = tables.checklistItems[0];
    Object.assign(tables.audits[0], { status: "IN_PROGRESS" });
    await createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead");
    tables.reportRevisions[0].status = "ISSUED";
    await expect(
      recordQuestionResponse(leadContextA, item.id as string, { result: "CONFORMS", auditorMembershipId: "membership-lead", actorUserId: "user-lead" }),
    ).rejects.toThrow(AuditChecklistError);
  });
});

describe("audit findings", () => {
  it("creates a finding with an explicit classification", async () => {
    const finding = await createAuditFinding(leadContextA, AUDIT_ID, {
      classification: "MINOR_NONCONFORMITY",
      statement: "Waste segregation procedure not followed at the loading dock.",
      actorUserId: "user-lead",
    });
    expect(finding.classification).toBe("MINOR_NONCONFORMITY");
    expect(finding.status).toBe("DRAFT");
  });

  it("walks the full DRAFT -> CONFIRMED -> ACTION_REQUIRED -> CLOSED chain for the lead auditor", async () => {
    const finding = await createAuditFinding(leadContextA, AUDIT_ID, {
      classification: "MAJOR_NONCONFORMITY",
      statement: "Statement.",
      actorUserId: "user-lead",
    });
    const confirmed = await confirmAuditFinding(leadContextA, finding.id as string, "user-lead");
    expect(confirmed.status).toBe("CONFIRMED");
    const actionRequired = await requireActionOnAuditFinding(leadContextA, finding.id as string, "user-lead");
    expect(actionRequired.status).toBe("ACTION_REQUIRED");
    const closed = await closeAuditFinding(leadContextA, finding.id as string, "user-lead");
    expect(closed.status).toBe("CLOSED");
  });

  it("refuses an out-of-order transition", async () => {
    const finding = await createAuditFinding(leadContextA, AUDIT_ID, { classification: "OBSERVATION", statement: "S.", actorUserId: "user-lead" });
    await expect(requireActionOnAuditFinding(leadContextA, finding.id as string, "user-lead")).rejects.toThrow(AuditFindingError);
  });

  it("refuses confirmation from a team member who is not the lead auditor", async () => {
    const finding = await createAuditFinding(leadContextA, AUDIT_ID, { classification: "OBSERVATION", statement: "S.", actorUserId: "user-lead" });
    await expect(confirmAuditFinding(auditorContextA, finding.id as string, "user-auditor")).rejects.toThrow(AuditFindingError);
  });

  it("does not resolve a foreign-tenant finding", async () => {
    const finding = await createAuditFinding(leadContextA, AUDIT_ID, { classification: "OBSERVATION", statement: "S.", actorUserId: "user-lead" });
    await expect(confirmAuditFinding(contextB, finding.id as string, "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("audit report issuance", () => {
  it("refuses to draft a report before the audit is in progress", async () => {
    await expect(createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead")).rejects.toThrow(AuditReportError);
  });

  it("issues the report, freezes the payload with a checksum, and locks the audit as REPORT_ISSUED", async () => {
    Object.assign(tables.audits[0], { status: "IN_PROGRESS" });
    await createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead");
    const issued = await issueAuditReport(managerContextA, AUDIT_ID, "user-manager");
    expect(issued.status).toBe("ISSUED");
    expect(issued.checksumSha256).toBeTruthy();
    expect(issued.frozenPayload).toBeTruthy();
    expect(tables.audits[0].status).toBe("REPORT_ISSUED");
    expect(tables.coverageSnapshots.length).toBe(1);
  });

  it("denies issuing to a caller without the sensitive issue permission", async () => {
    Object.assign(tables.audits[0], { status: "IN_PROGRESS" });
    await createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead");
    await expect(issueAuditReport(leadContextA, AUDIT_ID, "user-lead")).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses to issue the same report twice", async () => {
    Object.assign(tables.audits[0], { status: "IN_PROGRESS" });
    await createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead");
    await issueAuditReport(managerContextA, AUDIT_ID, "user-manager");
    await expect(issueAuditReport(managerContextA, AUDIT_ID, "user-manager")).rejects.toThrow(AuditReportError);
  });

  it("non-disclosing: returns null for a foreign-tenant or not-yet-issued report", async () => {
    Object.assign(tables.audits[0], { status: "IN_PROGRESS" });
    await createAuditReportDraft(leadContextA, AUDIT_ID, "user-lead");
    expect(await getIssuedAuditReport(leadContextA, AUDIT_ID)).toBeNull();
    expect(await getIssuedAuditReport(contextB, AUDIT_ID)).toBeNull();
    expect(await getIssuedAuditReport(leadContextA, "audit-does-not-exist")).toBeNull();

    await issueAuditReport(managerContextA, AUDIT_ID, "user-manager");
    expect(await getIssuedAuditReport(leadContextA, AUDIT_ID)).not.toBeNull();
    expect(await getIssuedAuditReport(contextB, AUDIT_ID)).toBeNull();
  });
});
