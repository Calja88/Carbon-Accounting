/**
 * EMS context issue / interested party / risk-opportunity / environmental
 * policy tests (task T23). No live database — Prisma is replaced with an
 * in-memory fake, following the T22 pattern.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { programmes, contextIssues, interestedParties, requirements, riskOpportunities, revisions, policyRecords, resetTables, nextIdRef } =
  vi.hoisted(() => {
    type Row = { id: string } & Record<string, unknown>;
    const programmes: { id: string; organisationId: string; name: string }[] = [];
    const contextIssues: Row[] = [];
    const interestedParties: Row[] = [];
    const requirements: Row[] = [];
    const riskOpportunities: Row[] = [];
    const revisions: { id: string; organisationId: string; documentId: string; status: string }[] = [];
    const policyRecords: Row[] = [];
    const nextIdRef = { n: 1 };
    function resetTables() {
      programmes.length = 0;
      contextIssues.length = 0;
      interestedParties.length = 0;
      requirements.length = 0;
      riskOpportunities.length = 0;
      revisions.length = 0;
      policyRecords.length = 0;
      nextIdRef.n = 1;
    }
    return { programmes, contextIssues, interestedParties, requirements, riskOpportunities, revisions, policyRecords, resetTables, nextIdRef };
  });

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

function tableApi<T extends { id: string }>(rows: T[], defaults: Partial<T>) {
  return {
    create: vi.fn(async ({ data }: { data: Partial<T> }) => {
      const row = { id: nextId("row"), ...defaults, ...data } as T;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
  };
}

vi.mock("@/lib/prisma", () => {
  const emsProgramme = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => programmes.find((p) => matches(p, where)) ?? null) };
  const contextIssue = tableApi(contextIssues, { description: null, significance: null, ownerMembershipId: null, reviewDate: null, activeFrom: null, activeUntil: null });
  const interestedParty = tableApi(interestedParties, { influence: null, relationshipOwnerMembershipId: null, isActive: true });
  const interestedPartyRequirement = tableApi(requirements, { sourceReference: null, isMandatory: false, evaluationDate: null, reviewDate: null });
  const emsRiskOpportunity = tableApi(riskOpportunities, { consequence: null, likelihood: null, residualRating: null, status: "OPEN", ownerMembershipId: null, sourceType: null, sourceId: null });
  const controlledDocumentRevision = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => revisions.find((r) => matches(r, where)) ?? null) };
  const environmentalPolicyRecord = tableApi(policyRecords, { approvedByUserId: null, approvedAt: null, effectiveDate: null, reviewDate: null });

  const prismaClient = {
    emsProgramme,
    contextIssue,
    interestedParty,
    interestedPartyRequirement,
    emsRiskOpportunity,
    controlledDocumentRevision,
    environmentalPolicyRecord,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

const {
  createContextIssue,
  updateContextIssue,
  createInterestedParty,
  deactivateInterestedParty,
  createInterestedPartyRequirement,
  createEmsRiskOpportunity,
  recordResidualRating,
  linkEnvironmentalPolicy,
  approveEnvironmentalPolicy,
} = await import("@/lib/ems/foundation/context-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  userId: "user-lead",
  permissions: new Set(["ems.programme.manage", "ems.policy.manage", "ems.controlled_document.approve"]) as unknown as ReturnType<
    typeof makeOrganisationContext
  >["permissions"],
});

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
  programmes.push({ id: "programme-1", organisationId: ORG_A, name: "Group EMS" });
});

describe("ContextIssue", () => {
  it("creates and updates a context issue, each write audited", async () => {
    const issue = await createContextIssue(orgContextA, {
      programmeId: "programme-1",
      type: "EXTERNAL",
      title: "New waste regulation on the horizon",
      direction: "AFFECTS_ORGANISATION",
      actorUserId: "user-lead",
    });
    expect(issue.type).toBe("EXTERNAL");

    const updated = await updateContextIssue(orgContextA, issue.id, { significance: "MEDIUM", actorUserId: "user-lead" });
    expect(updated.significance).toBe("MEDIUM");

    const { recordAuditEvent } = await import("@/lib/repositories/audit-repository");
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
  });
});

describe("InterestedParty and requirements", () => {
  it("creates a party, records a requirement, and can deactivate the party", async () => {
    const party = await createInterestedParty(orgContextA, {
      programmeId: "programme-1",
      name: "Local Environment Agency",
      type: "regulator",
      influence: "HIGH",
      actorUserId: "user-lead",
    });
    expect(party.isActive).toBe(true);

    const requirement = await createInterestedPartyRequirement(orgContextA, {
      interestedPartyId: party.id,
      summary: "Annual discharge consent renewal",
      isMandatory: true,
      actorUserId: "user-lead",
    });
    expect(requirement.isMandatory).toBe(true);

    const deactivated = await deactivateInterestedParty(orgContextA, party.id, { actorUserId: "user-lead" });
    expect(deactivated.isActive).toBe(false);
  });
});

describe("EmsRiskOpportunity", () => {
  it("registers a risk with an initial rating snapshot and records a residual rating", async () => {
    const risk = await createEmsRiskOpportunity(orgContextA, {
      programmeId: "programme-1",
      kind: "RISK",
      category: "Regulatory change",
      description: "Possible tightening of discharge limits",
      ratingScaleVersion: "v1",
      initialRating: { scaleVersion: "v1", values: { likelihood: 3, consequence: 4 }, computedAt: new Date().toISOString() },
      actorUserId: "user-lead",
    });
    expect(risk.status).toBe("OPEN");

    const updated = await recordResidualRating(orgContextA, risk.id, {
      residualRating: { scaleVersion: "v1", values: { likelihood: 1, consequence: 4 }, computedAt: new Date().toISOString() },
      status: "MONITORING",
      actorUserId: "user-lead",
    });
    expect(updated.status).toBe("MONITORING");
  });
});

describe("Environmental policy", () => {
  it("links a policy to a controlled-document revision and approves it with four-eyes enforced", async () => {
    revisions.push({ id: "revision-1", organisationId: ORG_A, documentId: "document-1", status: "APPROVED" });

    const record = await linkEnvironmentalPolicy(orgContextA, {
      programmeId: "programme-1",
      controlledDocumentRevisionId: "revision-1",
      actorUserId: "user-lead",
    });
    expect(record.controlledDocumentRevisionId).toBe("revision-1");

    await expect(
      approveEnvironmentalPolicy(orgContextA, record.id, {
        actorUserId: "user-lead",
        preparedByUserId: "user-lead",
      }),
    ).rejects.toThrow();

    const approved = await approveEnvironmentalPolicy(orgContextA, record.id, {
      actorUserId: "user-lead",
      preparedByUserId: "user-author",
    });
    expect(approved.approvedByUserId).toBe("user-lead");
  });

  it("denies linking a policy to a foreign-tenant controlled-document revision", async () => {
    revisions.push({ id: "revision-birch", organisationId: "org-birch-demo", documentId: "document-birch", status: "APPROVED" });
    await expect(
      linkEnvironmentalPolicy(orgContextA, {
        programmeId: "programme-1",
        controlledDocumentRevisionId: "revision-birch",
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow();
  });
});
