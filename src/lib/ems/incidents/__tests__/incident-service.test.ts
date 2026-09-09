/**
 * Environmental incident intake tests (task T62). No live database — Prisma
 * is replaced with an in-memory fake and the audit-event side effect is
 * stubbed. Covers: intake never sets severity/notification/status past
 * REPORTED, restricted-incident access (reporter vs. unauthorised member vs.
 * restricted-view member), append-only corrections preserving the original,
 * severity assignment freezing a config snapshot, the incident status
 * machine, configurable escalation rules, and tenant isolation. All
 * fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  entities: [] as Row[],
  sites: [] as Row[],
  processes: [] as Row[],
  aspects: [] as Row[],
  memberships: [] as Row[],
  severityLevels: [] as Row[],
  escalationRules: [] as Row[],
  incidents: [] as Row[],
  corrections: [] as Row[],
  notificationAssessments: [] as Row[],
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
  const entity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.entities, where ?? {})) };
  const site = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.sites, where ?? {})) };
  const activityProcess = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.processes, where ?? {})) };
  const environmentalAspect = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.aspects, where ?? {})) };
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };

  const incidentSeverityLevel = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.severityLevels, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.severityLevels.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `severity-${tables.nextId++}`, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.severityLevels.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.severityLevels, key);
      if (!row) throw new Error("severity level not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const incidentEscalationRule = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.escalationRules, where ?? {})),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.escalationRules.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `rule-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.escalationRules.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.escalationRules, key);
      if (!row) throw new Error("escalation rule not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const environmentalIncident = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.incidents, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.incidents.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = {
        id: `incident-${tables.nextId++}`,
        status: "REPORTED",
        restricted: false,
        severityLevelId: null,
        severityConfigSnapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        reportedAt: new Date(),
        ...data,
      };
      tables.incidents.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.incidents, key);
      if (!row) throw new Error("incident not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const incidentCorrection = {
    findMany: vi.fn(async ({ where }: FindArgs) => tables.corrections.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `correction-${tables.nextId++}`, correctedAt: new Date(), ...data };
      tables.corrections.push(row);
      return row;
    }),
  };

  const incidentNotificationAssessment = {
    findMany: vi.fn(async ({ where }: FindArgs) => tables.notificationAssessments.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `assessment-${tables.nextId++}`, assessedAt: new Date(), createdAt: new Date(), ...data };
      tables.notificationAssessments.push(row);
      return row;
    }),
  };

  const prismaClient = {
    entity,
    site,
    activityProcess,
    environmentalAspect,
    organisationMembership,
    incidentSeverityLevel,
    incidentEscalationRule,
    environmentalIncident,
    incidentCorrection,
    incidentNotificationAssessment,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  uploadEvidenceObject: vi.fn(async () => ({ id: "evidence-synthetic" })),
  linkEvidence: vi.fn(async () => ({ id: "evidence-link-synthetic" })),
  listEvidenceForResource: vi.fn(async () => []),
}));

const {
  IncidentError,
  createEnvironmentalIncident,
  getEnvironmentalIncident,
  listEnvironmentalIncidents,
  recordIncidentCorrection,
  createIncidentSeverityLevel,
  upsertIncidentEscalationRule,
  assignIncidentSeverity,
  startIncidentInvestigation,
  completeIncidentResponse,
  closeEnvironmentalIncident,
  reopenEnvironmentalIncident,
} = await import("@/lib/ems/incidents/incident-service");
const { recordIncidentNotificationAssessment } = await import("@/lib/ems/incidents/notification-assessment-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const REPORT_ONLY = new Set(["ems.view", "ems.incident.report"]) as never;
const MANAGE_PERMS = new Set(["ems.view", "ems.incident.report", "ems.incident.manage"]) as never;
const RESTRICTED_VIEW_PERMS = new Set(["ems.view", "ems.incident.report", "ems.incident.manage", "ems.incident.restricted.view"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const reporterContextA = makeOrganisationContext(ORG_A, { userId: "user-reporter", membershipId: "membership-reporter", permissions: REPORT_ONLY });
const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: MANAGE_PERMS });
const restrictedViewerContextA = makeOrganisationContext(ORG_A, { userId: "user-restricted-viewer", membershipId: "membership-restricted-viewer", permissions: RESTRICTED_VIEW_PERMS });
const outsiderContextA = makeOrganisationContext(ORG_A, { userId: "user-outsider", membershipId: "membership-outsider", permissions: VIEW_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;

  tables.memberships.push({ id: "membership-reporter", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-restricted-viewer", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-outsider", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE" });
});

async function reportIncident(context = reporterContextA, restricted = false, reference = `INC-TEST-${tables.nextId}`) {
  return createEnvironmentalIncident(context, {
    reference,
    type: "Spill",
    factualDescription: "A synthetic drum of test fluid tipped over in the fictional yard.",
    immediateResponse: "Absorbent applied and area cordoned.",
    potentialReceptors: "Fictional surface drain.",
    restricted,
    actorUserId: context.userId,
  });
}

describe("incident intake", () => {
  it("reports an incident in REPORTED status with no severity or notification decision", async () => {
    const incident = await reportIncident();
    expect(incident.status).toBe("REPORTED");
    expect(incident.severityLevelId).toBeNull();
    expect(tables.notificationAssessments.length).toBe(0);
  });

  it("refuses to create without a factual description", async () => {
    await expect(
      createEnvironmentalIncident(reporterContextA, {
        reference: "INC-BAD",
        type: "Spill",
        factualDescription: "   ",
        actorUserId: "user-reporter",
      }),
    ).rejects.toThrow(IncidentError);
  });

  it("denies reporting to a caller without ems.incident.report", async () => {
    await expect(
      createEnvironmentalIncident(outsiderContextA, {
        reference: "INC-DENY",
        type: "Spill",
        factualDescription: "Fact.",
        actorUserId: "user-outsider",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a duplicate reference within the same organisation", async () => {
    await reportIncident(reporterContextA, false, "INC-DUPLICATE");
    await expect(reportIncident(reporterContextA, false, "INC-DUPLICATE")).rejects.toThrow(IncidentError);
  });
});

describe("restricted-incident access", () => {
  it("lets the reporter read their own restricted report", async () => {
    const incident = await reportIncident(reporterContextA, true);
    const read = await getEnvironmentalIncident(reporterContextA, incident.id as string);
    expect(read.id).toBe(incident.id);
  });

  it("denies a plain member without restricted-view access, identically to not-found", async () => {
    const incident = await reportIncident(reporterContextA, true);
    await expect(getEnvironmentalIncident(outsiderContextA, incident.id as string)).rejects.toThrow(TenantOwnershipError);
  });

  it("allows a member with ems.incident.restricted.view", async () => {
    const incident = await reportIncident(reporterContextA, true);
    const read = await getEnvironmentalIncident(restrictedViewerContextA, incident.id as string);
    expect(read.id).toBe(incident.id);
  });

  it("excludes restricted incidents from the list for members without restricted-view access", async () => {
    await reportIncident(reporterContextA, true);
    await reportIncident(managerContextA, false);
    const listForOutsider = await listEnvironmentalIncidents(outsiderContextA);
    expect(listForOutsider.length).toBe(1);
    expect(listForOutsider[0].restricted).toBe(false);

    const listForRestrictedViewer = await listEnvironmentalIncidents(restrictedViewerContextA);
    expect(listForRestrictedViewer.length).toBe(2);
  });
});

describe("corrections preserve the original report", () => {
  it("keeps the original factual description readable after a correction", async () => {
    const incident = await reportIncident();
    await recordIncidentCorrection(managerContextA, incident.id as string, {
      correctedFactualDescription: "Corrected: two synthetic drums tipped over, not one.",
      reason: "Second drum discovered during walkdown.",
      actorUserId: "user-manager",
    });
    const read = await getEnvironmentalIncident(managerContextA, incident.id as string);
    expect(read.factualDescription).toBe("A synthetic drum of test fluid tipped over in the fictional yard.");
    expect(read.currentFactualDescription).toBe("Corrected: two synthetic drums tipped over, not one.");
    expect(read.corrections.length).toBe(1);
  });

  it("requires a reason and at least one corrected field", async () => {
    const incident = await reportIncident();
    await expect(
      recordIncidentCorrection(managerContextA, incident.id as string, { reason: "", actorUserId: "user-manager" }),
    ).rejects.toThrow(IncidentError);
    await expect(
      recordIncidentCorrection(managerContextA, incident.id as string, { reason: "Some reason", actorUserId: "user-manager" }),
    ).rejects.toThrow(IncidentError);
  });
});

describe("severity configuration and assignment", () => {
  it("assigns severity, moves to TRIAGED, and freezes a config snapshot", async () => {
    const level = await createIncidentSeverityLevel(managerContextA, { key: "major", label: "Major", rank: 3, requiresEscalation: true, actorUserId: "user-manager" });
    const incident = await reportIncident();
    const updated = await assignIncidentSeverity(managerContextA, incident.id as string, level.id as string, "user-manager");
    expect(updated.status).toBe("TRIAGED");
    expect((updated.severityConfigSnapshot as { label: string }).label).toBe("Major");

    // Later edits to the level never rewrite the incident's frozen snapshot.
    await createIncidentSeverityLevel(managerContextA, { key: "minor", label: "Minor", rank: 1, actorUserId: "user-manager" });
    tables.severityLevels[0].label = "Renamed after the fact";
    const reread = await getEnvironmentalIncident(managerContextA, incident.id as string);
    expect((reread.severityConfigSnapshot as { label: string }).label).toBe("Major");
  });

  it("configures an escalation rule for a severity level", async () => {
    const level = await createIncidentSeverityLevel(managerContextA, { key: "critical", label: "Critical", rank: 5, requiresEscalation: true, actorUserId: "user-manager" });
    const rule = await upsertIncidentEscalationRule(managerContextA, {
      severityLevelId: level.id as string,
      recipientsPolicy: { kind: "permission", permission: "ems.incident.restricted.view" },
      actorUserId: "user-manager",
    });
    expect(rule.severityLevelId).toBe(level.id);
    expect((rule.recipientsPolicy as { permission: string }).permission).toBe("ems.incident.restricted.view");
  });
});

describe("incident status machine", () => {
  async function triagedIncident() {
    const level = await createIncidentSeverityLevel(managerContextA, { key: "moderate", label: "Moderate", rank: 2, actorUserId: "user-manager" });
    const incident = await reportIncident();
    return assignIncidentSeverity(managerContextA, incident.id as string, level.id as string, "user-manager");
  }

  it("walks REPORTED -> TRIAGED -> INVESTIGATING -> RESPONSE_COMPLETE -> CLOSED -> REOPENED", async () => {
    const triaged = await triagedIncident();
    const investigating = await startIncidentInvestigation(managerContextA, triaged.id as string, "user-manager");
    expect(investigating.status).toBe("INVESTIGATING");
    const responseComplete = await completeIncidentResponse(managerContextA, triaged.id as string, "user-manager");
    expect(responseComplete.status).toBe("RESPONSE_COMPLETE");
    const closed = await closeEnvironmentalIncident(managerContextA, triaged.id as string, "user-manager");
    expect(closed.status).toBe("CLOSED");
    const reopened = await reopenEnvironmentalIncident(managerContextA, triaged.id as string, "New evidence surfaced.", "user-manager");
    expect(reopened.status).toBe("REOPENED");
  });

  it("refuses an out-of-order transition", async () => {
    const incident = await reportIncident();
    await expect(startIncidentInvestigation(managerContextA, incident.id as string, "user-manager")).rejects.toThrow(IncidentError);
  });

  it("refuses to close before response is complete", async () => {
    const triaged = await triagedIncident();
    await startIncidentInvestigation(managerContextA, triaged.id as string, "user-manager");
    await expect(closeEnvironmentalIncident(managerContextA, triaged.id as string, "user-manager")).rejects.toThrow(IncidentError);
  });
});

describe("notification assessment — no automatic legal-reportability conclusion", () => {
  it("records a decision only when a competent reviewer and rationale are supplied", async () => {
    const incident = await reportIncident();
    await expect(
      recordIncidentNotificationAssessment(managerContextA, incident.id as string, {
        authorityOrParty: "Fictional Environment Agency",
        decision: "REQUIRED",
        rationale: "",
        reviewerMembershipId: "membership-manager",
        actorUserId: "user-manager",
      }),
    ).rejects.toThrow(IncidentError);

    const assessment = await recordIncidentNotificationAssessment(managerContextA, incident.id as string, {
      authorityOrParty: "Fictional Environment Agency",
      decision: "UNCERTAIN",
      rationale: "Awaiting lab results on the fictional spill volume.",
      reviewerMembershipId: "membership-manager",
      actorUserId: "user-manager",
    });
    expect(assessment.decision).toBe("UNCERTAIN");

    // Creating the incident itself never produced a decision — this is the
    // only place `decision` is ever written, and always by the caller.
    const freshIncident = await reportIncident();
    expect(tables.notificationAssessments.filter((a) => a.incidentId === freshIncident.id).length).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("does not resolve a foreign-tenant incident for reads, corrections, or transitions", async () => {
    const incident = await reportIncident();
    await expect(getEnvironmentalIncident(contextB, incident.id as string)).rejects.toThrow(TenantOwnershipError);
    await expect(
      recordIncidentCorrection(contextB, incident.id as string, { reason: "x", correctedFactualDescription: "y", actorUserId: "user-b" }),
    ).rejects.toThrow(TenantOwnershipError);
    await expect(startIncidentInvestigation(contextB, incident.id as string, "user-b")).rejects.toThrow(TenantOwnershipError);
  });

  it("does not include an organisation A incident in organisation B's list", async () => {
    await reportIncident(reporterContextA, false);
    const listB = await listEnvironmentalIncidents(contextB);
    expect(listB.length).toBe(0);
  });
});
