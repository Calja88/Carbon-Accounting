/**
 * Compliance obligation versioning and approval tests (task T44). No live
 * database — Prisma is replaced with an in-memory fake, and the audit
 * side-effect (already covered by its own T20 test suite) is stubbed so
 * these tests stay focused on the state machine itself: versioned drafts,
 * the approval transaction (including the active-pointer move and
 * four-eyes self-approval denial), approved-version immutability-by-
 * construction, successor versions, and tenant isolation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[]; take?: number };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  entities: [] as Row[],
  sites: [] as Row[],
  aspects: [] as Row[],
  controls: [] as Row[],
  instruments: [] as Row[],
  provisionReferences: [] as Row[],
  assessments: [] as Row[],
  changeEvents: [] as Row[],
  memberships: [] as Row[],
  obligations: [] as Row[],
  versions: [] as Row[],
  versionScopes: [] as Row[],
  versionControls: [] as Row[],
  approvals: [] as Row[],
  changeReviews: [] as Row[],
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

vi.mock("@/lib/prisma", () => {
  const entity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.entities, where ?? {})) };
  const site = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.sites, where ?? {})) };
  const environmentalAspect = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const row = find(tables.aspects, where ?? {});
      if (!row) return null;
      return { ...row, process: row.process ?? null };
    }),
  };
  const operationalControl = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.controls, where ?? {})) };
  const legalInstrument = { findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.instruments, where ?? {})) };
  const legalProvisionReference = { findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.provisionReferences, where ?? {})) };
  const legalChangeEvent = { findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.changeEvents, where ?? {})) };
  const applicabilityAssessment = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.assessments, where ?? {})) };
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };

  const complianceObligation = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.obligations, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.obligations.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `obligation-${tables.nextId++}`;
      const row: Row = { id, activeVersionId: null, createdAt: new Date(), ...data };
      tables.obligations.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.obligations, key);
      if (!row) throw new Error("obligation not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const complianceObligationVersion = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.versions, key as Row, orderBy as Row);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.versions, where ?? {})),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] }; controlLinks?: { create: Row[] } } }) => {
      const { scopes: scopesEnvelope, controlLinks: controlsEnvelope, ...versionData } = data;
      const id = `version-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "DRAFT",
        provisionReferenceId: null,
        frequency: null,
        triggerDescription: null,
        effectiveFrom: null,
        reviewDueDate: null,
        approvedByUserId: null,
        approvedAt: null,
        supersedesVersionId: null,
        preparedAt: new Date(),
        createdAt: new Date(),
        ...versionData,
      };
      tables.versions.push(row);
      const scopeRows = (scopesEnvelope?.create ?? []).map((scope) => ({ id: `vscope-${tables.nextId++}`, obligationVersionId: id, ...scope }));
      tables.versionScopes.push(...scopeRows);
      const controlRows = (controlsEnvelope?.create ?? []).map((link) => ({ id: `vcontrol-${tables.nextId++}`, obligationVersionId: id, ...link }));
      tables.versionControls.push(...controlRows);
      return { ...row, scopes: scopeRows, controlLinks: controlRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs & { data: Row & { scopes?: { create: Row[] }; controlLinks?: { create: Row[] } } }) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.versions, key);
      if (!row) throw new Error("version not found");
      const { scopes: scopesEnvelope, controlLinks: controlsEnvelope, ...versionData } = data;
      Object.assign(row, versionData);
      if (scopesEnvelope?.create) {
        const scopeRows = scopesEnvelope.create.map((scope) => ({ id: `vscope-${tables.nextId++}`, obligationVersionId: row.id, ...scope }));
        tables.versionScopes.push(...scopeRows);
      }
      if (controlsEnvelope?.create) {
        const controlRows = controlsEnvelope.create.map((link) => ({ id: `vcontrol-${tables.nextId++}`, obligationVersionId: row.id, ...link }));
        tables.versionControls.push(...controlRows);
      }
      return row;
    }),
  };

  const complianceObligationVersionScope = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      const rows = data.map((scope) => ({ id: `vscope-${tables.nextId++}`, ...scope }));
      tables.versionScopes.push(...rows);
      return { count: rows.length };
    }),
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const remaining = tables.versionScopes.filter((row) => !matches(row, where ?? {}));
      const removed = tables.versionScopes.length - remaining.length;
      tables.versionScopes.length = 0;
      tables.versionScopes.push(...remaining);
      return { count: removed };
    }),
  };
  const complianceObligationVersionControl = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      const rows = data.map((link) => ({ id: `vcontrol-${tables.nextId++}`, ...link }));
      tables.versionControls.push(...rows);
      return { count: rows.length };
    }),
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const remaining = tables.versionControls.filter((row) => !matches(row, where ?? {}));
      const removed = tables.versionControls.length - remaining.length;
      tables.versionControls.length = 0;
      tables.versionControls.push(...remaining);
      return { count: removed };
    }),
  };
  const complianceObligationApproval = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `approval-${tables.nextId++}`, decidedAt: new Date(), ...data };
      tables.approvals.push(row);
      return row;
    }),
  };
  const obligationChangeReview = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `review-${tables.nextId++}`, reviewedAt: new Date(), ...data };
      tables.changeReviews.push(row);
      return row;
    }),
  };

  const prismaClient = {
    entity,
    site,
    environmentalAspect,
    operationalControl,
    legalInstrument,
    legalProvisionReference,
    legalChangeEvent,
    applicabilityAssessment,
    organisationMembership,
    complianceObligation,
    complianceObligationVersion,
    complianceObligationVersionScope,
    complianceObligationVersionControl,
    complianceObligationApproval,
    obligationChangeReview,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createComplianceObligation,
  updateComplianceObligationVersionDraft,
  submitComplianceObligationVersionForReview,
  approveComplianceObligationVersion,
  rejectComplianceObligationVersion,
  returnComplianceObligationVersionForRevision,
  retireComplianceObligationVersion,
  createSuccessorComplianceObligationVersion,
  recordObligationChangeReview,
  ComplianceObligationError,
} = await import("@/lib/ems/legal/obligation-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const EDIT_ONLY = new Set(["ems.view", "ems.compliance_obligation.edit"]) as never;
const APPROVE_ONLY = new Set(["ems.view", "ems.compliance_obligation.approve"]) as never;
const BOTH = new Set(["ems.view", "ems.compliance_obligation.edit", "ems.compliance_obligation.approve"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: BOTH });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: BOTH });
const editOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: EDIT_ONLY });
const approverContextA = makeOrganisationContext(ORG_A, { userId: "user-approver", membershipId: "membership-approver", permissions: APPROVE_ONLY });
const authorAsApproverContextA = makeOrganisationContext(ORG_A, {
  userId: "user-drafter",
  membershipId: "membership-drafter",
  permissions: APPROVE_ONLY,
});

beforeEach(() => {
  tables.entities.length = 0;
  tables.sites.length = 0;
  tables.aspects.length = 0;
  tables.controls.length = 0;
  tables.instruments.length = 0;
  tables.provisionReferences.length = 0;
  tables.assessments.length = 0;
  tables.changeEvents.length = 0;
  tables.memberships.length = 0;
  tables.obligations.length = 0;
  tables.versions.length = 0;
  tables.versionScopes.length = 0;
  tables.versionControls.length = 0;
  tables.approvals.length = 0;
  tables.changeReviews.length = 0;
  tables.nextId = 1;

  tables.entities.push({ id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" });
  tables.sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North" });
  tables.instruments.push({ id: "instrument-1", title: "Synthetic Environmental Permitting Order" });
  tables.assessments.push({ id: "assessment-applicable", organisationId: ORG_A, instrumentId: "instrument-1", otherRequirementSourceId: null, status: "APPLICABLE" });
  tables.assessments.push({ id: "assessment-uncertain", organisationId: ORG_A, instrumentId: "instrument-1", otherRequirementSourceId: null, status: "UNCERTAIN" });
  tables.assessments.push({ id: "assessment-b", organisationId: ORG_B, instrumentId: "instrument-1", otherRequirementSourceId: null, status: "APPLICABLE" });
  tables.assessments.push({
    id: "assessment-other-requirement",
    organisationId: ORG_A,
    instrumentId: null,
    otherRequirementSourceId: "other-source-1",
    status: "APPLICABLE",
  });
  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
  tables.changeEvents.push({ id: "event-1", sourceInstrumentId: "instrument-1" });
});

function baseInput(overrides: Partial<Parameters<typeof createComplianceObligation>[1]> = {}) {
  return {
    applicabilityAssessmentId: "assessment-applicable",
    title: "Discharge permit condition 4.2",
    requirementSummary: "Synthetic requirement summary text.",
    ownerMembershipId: "membership-owner",
    scopes: [{ entityId: ENTITY_A }],
    controlIds: [] as string[],
    actorUserId: "user-drafter",
    ...overrides,
  };
}

describe("createComplianceObligation", () => {
  it("creates a DRAFT version 1 from an APPLICABLE assessment", async () => {
    const { obligation, version } = await createComplianceObligation(contextA, baseInput());
    expect(version.status).toBe("DRAFT");
    expect(version.version).toBe(1);
    expect(version.obligationId).toBe(obligation.id);
    expect(tables.versionScopes).toHaveLength(1);
  });

  it("denies a member without ems.compliance_obligation.edit", async () => {
    await expect(createComplianceObligation(approverContextA, baseInput())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects a non-APPLICABLE assessment", async () => {
    await expect(
      createComplianceObligation(contextA, baseInput({ applicabilityAssessmentId: "assessment-uncertain" })),
    ).rejects.toBeInstanceOf(ComplianceObligationError);
  });

  it("does not resolve a foreign-tenant assessment for another organisation", async () => {
    await expect(
      createComplianceObligation(contextB, baseInput({ applicabilityAssessmentId: "assessment-applicable" })),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("rejects an empty title", async () => {
    await expect(createComplianceObligation(contextA, baseInput({ title: "  " }))).rejects.toBeInstanceOf(ComplianceObligationError);
  });
});

describe("createComplianceObligation sourced from a T46 other-requirement source", () => {
  it("carries otherRequirementSourceId, not instrumentId, onto the created version", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput({ applicabilityAssessmentId: "assessment-other-requirement" }));
    expect(version.otherRequirementSourceId).toBe("other-source-1");
    expect(version.instrumentId).toBeFalsy();
  });

  it("createSuccessorComplianceObligationVersion also inherits the manual source", async () => {
    const { obligation, version: v1 } = await createComplianceObligation(
      contextA,
      baseInput({ applicabilityAssessmentId: "assessment-other-requirement" }),
    );
    await submitComplianceObligationVersionForReview(contextA, v1.id as string, "user-drafter");
    await approveComplianceObligationVersion(approverContextA, v1.id as string, { actorUserId: "user-approver" });

    const v2 = await createSuccessorComplianceObligationVersion(
      contextA,
      obligation.id as string,
      baseInput({ applicabilityAssessmentId: "assessment-other-requirement" }),
    );
    expect(v2.otherRequirementSourceId).toBe("other-source-1");
    expect(v2.instrumentId).toBeFalsy();
  });
});

describe("updateComplianceObligationVersionDraft", () => {
  it("replaces scopes while still DRAFT", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    const updated = await updateComplianceObligationVersionDraft(contextA, version.id as string, {
      title: "Revised title",
      requirementSummary: "Revised summary",
      ownerMembershipId: "membership-owner",
      scopes: [{ siteId: SITE_A }],
      controlIds: [],
      actorUserId: "user-drafter",
    });
    expect(updated.title).toBe("Revised title");
    expect(tables.versionScopes.filter((s) => s.obligationVersionId === version.id)).toHaveLength(1);
    expect(tables.versionScopes.find((s) => s.obligationVersionId === version.id)).toMatchObject({ siteId: SITE_A });
  });

  it("refuses to edit a submitted version", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    await expect(
      updateComplianceObligationVersionDraft(contextA, version.id as string, {
        title: "x",
        requirementSummary: "x",
        ownerMembershipId: "membership-owner",
        scopes: [{ entityId: ENTITY_A }],
        controlIds: [],
        actorUserId: "user-drafter",
      }),
    ).rejects.toBeInstanceOf(ComplianceObligationError);
  });
});

describe("approveComplianceObligationVersion", () => {
  async function draftToInReview() {
    const { obligation, version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    return { obligation, version };
  }

  it("denies a member without ems.compliance_obligation.approve", async () => {
    const { version } = await draftToInReview();
    await expect(approveComplianceObligationVersion(editOnlyContextA, version.id as string, { actorUserId: "user-approver" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("denies self-approval when four-eyes is enabled (default)", async () => {
    const { version } = await draftToInReview();
    await expect(
      approveComplianceObligationVersion(authorAsApproverContextA, version.id as string, { actorUserId: "user-drafter" }),
    ).rejects.toThrow();
  });

  it("allows self-approval when four-eyes is explicitly disabled", async () => {
    const { version } = await draftToInReview();
    const approved = await approveComplianceObligationVersion(authorAsApproverContextA, version.id as string, {
      actorUserId: "user-drafter",
      fourEyesEnabled: false,
    });
    expect(approved.status).toBe("ACTIVE");
  });

  it("moves the version to ACTIVE, sets the obligation's active pointer, and records an approval decision", async () => {
    const { obligation, version } = await draftToInReview();
    const approved = await approveComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" });
    expect(approved.status).toBe("ACTIVE");
    expect(approved.approvedByUserId).toBe("user-approver");
    const updatedObligation = tables.obligations.find((o) => o.id === obligation.id);
    expect(updatedObligation?.activeVersionId).toBe(version.id);
    expect(tables.approvals).toHaveLength(1);
    expect(tables.approvals[0]).toMatchObject({
      obligationVersionId: version.id,
      decision: "APPROVED",
      permissionCode: "ems.compliance_obligation.approve",
      approverMembershipId: "membership-approver",
    });
  });

  it("supersedes the previously active version when a successor is approved", async () => {
    const { obligation, version: v1 } = await draftToInReview();
    await approveComplianceObligationVersion(approverContextA, v1.id as string, { actorUserId: "user-approver" });

    const v2 = await createSuccessorComplianceObligationVersion(contextA, obligation.id as string, baseInput());
    await submitComplianceObligationVersionForReview(contextA, v2.id as string, "user-drafter");
    await approveComplianceObligationVersion(approverContextA, v2.id as string, { actorUserId: "user-approver" });

    const supersededV1 = tables.versions.find((v) => v.id === v1.id);
    expect(supersededV1?.status).toBe("SUPERSEDED");
    const updatedObligation = tables.obligations.find((o) => o.id === obligation.id);
    expect(updatedObligation?.activeVersionId).toBe(v2.id);
  });

  it("only accepts an in-review version", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await expect(approveComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" })).rejects.toBeInstanceOf(
      ComplianceObligationError,
    );
  });
});

describe("rejectComplianceObligationVersion and returnComplianceObligationVersionForRevision", () => {
  it("rejects an in-review version and records a REJECTED decision", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    const rejected = await rejectComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" });
    expect(rejected.status).toBe("REJECTED");
    expect(tables.approvals[0]).toMatchObject({ decision: "REJECTED" });
  });

  it("returns an in-review version to DRAFT and records a RETURNED decision", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    const returned = await returnComplianceObligationVersionForRevision(approverContextA, version.id as string, { actorUserId: "user-approver" });
    expect(returned.status).toBe("DRAFT");
    expect(tables.approvals[0]).toMatchObject({ decision: "RETURNED" });
    // A returned version is editable again.
    const edited = await updateComplianceObligationVersionDraft(contextA, version.id as string, {
      title: "Revised after return",
      requirementSummary: "x",
      ownerMembershipId: "membership-owner",
      scopes: [{ entityId: ENTITY_A }],
      controlIds: [],
      actorUserId: "user-drafter",
    });
    expect(edited.title).toBe("Revised after return");
  });
});

describe("retireComplianceObligationVersion", () => {
  it("retires an active version and clears the obligation's active pointer", async () => {
    const { obligation, version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    await approveComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" });

    const retired = await retireComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" });
    expect(retired.status).toBe("RETIRED");
    const updatedObligation = tables.obligations.find((o) => o.id === obligation.id);
    expect(updatedObligation?.activeVersionId).toBeNull();
  });

  it("denies a member without ems.compliance_obligation.approve", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, version.id as string, "user-drafter");
    await approveComplianceObligationVersion(approverContextA, version.id as string, { actorUserId: "user-approver" });
    await expect(retireComplianceObligationVersion(editOnlyContextA, version.id as string, { actorUserId: "user-drafter" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("createSuccessorComplianceObligationVersion", () => {
  it("refuses a successor while the latest version is still DRAFT/IN_REVIEW", async () => {
    const { obligation } = await createComplianceObligation(contextA, baseInput());
    await expect(createSuccessorComplianceObligationVersion(contextA, obligation.id as string, baseInput())).rejects.toBeInstanceOf(
      ComplianceObligationError,
    );
  });

  it("creates version 2 linked to version 1 once version 1 is active", async () => {
    const { obligation, version: v1 } = await createComplianceObligation(contextA, baseInput());
    await submitComplianceObligationVersionForReview(contextA, v1.id as string, "user-drafter");
    await approveComplianceObligationVersion(approverContextA, v1.id as string, { actorUserId: "user-approver" });

    const v2 = await createSuccessorComplianceObligationVersion(contextA, obligation.id as string, baseInput({ title: "Updated condition text" }));
    expect(v2.version).toBe(2);
    expect(v2.supersedesVersionId).toBe(v1.id);
    expect(v2.status).toBe("DRAFT");
  });
});

describe("recordObligationChangeReview", () => {
  it("records a review without editing the obligation version", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    const review = await recordObligationChangeReview(contextA, {
      changeEventId: "event-1",
      obligationVersionId: version.id as string,
      impactAssessment: "Synthetic impact assessment.",
      decision: "REVISE",
      actorUserId: "user-drafter",
    });
    expect(review.decision).toBe("REVISE");
    const unchangedVersion = tables.versions.find((v) => v.id === version.id);
    expect(unchangedVersion?.status).toBe("DRAFT");
    expect(unchangedVersion?.title).toBe("Discharge permit condition 4.2");
  });

  it("denies a member without ems.compliance_obligation.edit", async () => {
    const { version } = await createComplianceObligation(contextA, baseInput());
    await expect(
      recordObligationChangeReview(approverContextA, {
        changeEventId: "event-1",
        obligationVersionId: version.id as string,
        impactAssessment: "x",
        actorUserId: "user-approver",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
