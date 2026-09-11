import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[]; take?: number };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  entities: [] as Row[],
  sites: [] as Row[],
  processes: [] as Row[],
  aspects: [] as Row[],
  instruments: [] as Row[],
  otherRequirementSources: [] as Row[],
  changeEvents: [] as Row[],
  assessments: [] as Row[],
  scopes: [] as Row[],
  evidenceLinks: [] as Row[],
  memberships: [] as Row[],
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

function find(rows: Row[], where: Row) {
  return rows.find((row) => matches(row, where)) ?? null;
}

vi.mock("@/lib/prisma", () => {
  const entity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.entities, where ?? {})) };
  const site = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.sites, where ?? {})) };
  const activityProcess = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.processes, where ?? {})) };
  const environmentalAspect = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const row = find(tables.aspects, where ?? {});
      if (!row) return null;
      const process = tables.processes.find((p) => p.id === row.processId);
      return { ...row, process: process ? { siteId: process.siteId, entityId: process.entityId } : null };
    }),
  };
  const legalInstrument = { findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.instruments, where ?? {})) };
  const otherRequirementSource = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.otherRequirementSources, where ?? {})) };
  const legalChangeEvent = {
    findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.changeEvents, where ?? {})),
    findMany: vi.fn(async ({ where }: FindArgs) => {
      const rows = tables.changeEvents.filter((row) => matches(row, where ?? {}));
      return rows.map((row) => ({
        ...row,
        sourceInstrument: tables.instruments.find((i) => i.id === row.sourceInstrumentId) ?? null,
        affectedInstrument: row.affectedInstrumentId ? tables.instruments.find((i) => i.id === row.affectedInstrumentId) ?? null : null,
      }));
    }),
  };
  const applicabilityAssessment = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const row = find(tables.assessments, key as Row);
      if (!row) return null;
      const successorAssessment = tables.assessments.find((a) => a.supersedesAssessmentId === row.id) ?? null;
      return { ...row, successorAssessment: successorAssessment ? { id: successorAssessment.id } : null };
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.assessments.filter((row) => matches(row, where ?? {}))),
    findUniqueOrThrow: vi.fn(async ({ where }: FindArgs) => {
      const row = find(tables.assessments, where ?? {});
      if (!row) throw new Error("not found");
      return { ...row, scopes: tables.scopes.filter((s) => s.assessmentId === row.id) };
    }),
    create: vi.fn(async ({ data }: { data: Row & { scopes?: { create: Row[] } } }) => {
      const { scopes: scopesEnvelope, ...assessmentData } = data;
      const id = `assessment-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "DRAFT",
        rationale: null,
        proposedDecision: null,
        reviewedByMembershipId: null,
        reviewedAt: null,
        nextReviewAt: null,
        followUpOwnerMembershipId: null,
        supersedesAssessmentId: null,
        changeEventId: null,
        createdAt: new Date(),
        ...assessmentData,
      };
      tables.assessments.push(row);
      const scopeRows = (scopesEnvelope?.create ?? []).map((scope) => ({ id: `scope-${tables.nextId++}`, assessmentId: id, ...scope }));
      tables.scopes.push(...scopeRows);
      return { ...row, scopes: scopeRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs & { data: Row & { scopes?: { create: Row[] } } }) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.assessments, key);
      if (!row) throw new Error("not found");
      const { scopes: scopesEnvelope, ...assessmentData } = data;
      Object.assign(row, assessmentData);
      if (scopesEnvelope?.create) {
        const scopeRows = scopesEnvelope.create.map((scope) => ({ id: `scope-${tables.nextId++}`, assessmentId: row.id, ...scope }));
        tables.scopes.push(...scopeRows);
      }
      return row;
    }),
  };
  const applicabilityAssessmentScope = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      const rows = data.map((scope) => ({ id: `scope-${tables.nextId++}`, ...scope }));
      tables.scopes.push(...rows);
      return { count: rows.length };
    }),
    count: vi.fn(async ({ where }: FindArgs) => tables.scopes.filter((row) => matches(row, where ?? {})).length),
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const remaining = tables.scopes.filter((row) => !matches(row, where ?? {}));
      const removed = tables.scopes.length - remaining.length;
      tables.scopes.length = 0;
      tables.scopes.push(...remaining);
      return { count: removed };
    }),
  };
  const evidenceLink = {
    count: vi.fn(async ({ where }: FindArgs) => tables.evidenceLinks.filter((row) => matches(row, where ?? {})).length),
  };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})),
  };
  const prismaClient = {
    entity,
    site,
    activityProcess,
    environmentalAspect,
    legalInstrument,
    otherRequirementSource,
    legalChangeEvent,
    applicabilityAssessment,
    applicabilityAssessmentScope,
    evidenceLink,
    organisationMembership,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createApplicabilityAssessment,
  decideApplicabilityAssessment,
  listAssessableLegalChangeEvents,
  listApplicabilityAssessments,
  submitApplicabilityAssessmentForReview,
  updateApplicabilityAssessmentDraft,
  ApplicabilityWorkflowError,
} = await import("@/lib/ems/legal/applicability-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const ASSESS_ONLY = new Set(["ems.view", "ems.applicability.assess"]) as never;
const REVIEW_ONLY = new Set(["ems.view", "ems.applicability.review"]) as never;
const BOTH = new Set(["ems.view", "ems.applicability.assess", "ems.applicability.review"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: BOTH });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: BOTH });
const assessOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: ASSESS_ONLY });
const reviewOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: REVIEW_ONLY });
const restrictedContextA = makeOrganisationContext(ORG_A, {
  userId: "user-a",
  membershipId: "membership-a",
  permissions: BOTH,
  access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
});

beforeEach(() => {
  tables.entities.length = 0;
  tables.sites.length = 0;
  tables.processes.length = 0;
  tables.aspects.length = 0;
  tables.instruments.length = 0;
  tables.otherRequirementSources.length = 0;
  tables.changeEvents.length = 0;
  tables.assessments.length = 0;
  tables.scopes.length = 0;
  tables.evidenceLinks.length = 0;
  tables.memberships.length = 0;
  tables.nextId = 1;

  tables.entities.push({ id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" });
  tables.sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North" });
  tables.instruments.push({ id: "instrument-1", title: "Synthetic Environmental Permitting Order" });
  tables.otherRequirementSources.push({ id: "other-source-1", organisationId: ORG_A, title: "Synthetic Site A discharge consent" });
  tables.changeEvents.push({
    id: "event-1",
    sourceInstrumentId: "instrument-1",
    affectedInstrumentId: null,
    eventType: "AMENDMENT",
    detectedAt: new Date("2026-01-01"),
    status: "TRIAGED",
  });
  tables.memberships.push({ id: "membership-a-owner", organisationId: ORG_A, status: "ACTIVE" });
});

function baseInput(overrides: Partial<Parameters<typeof createApplicabilityAssessment>[1]> = {}) {
  return {
    instrumentId: "instrument-1",
    changeEventId: "event-1",
    decision: "APPLICABLE" as const,
    rationale: "Synthetic rationale: this instrument governs Site A's discharge permit.",
    scopes: [{ entityId: ENTITY_A }],
    actorUserId: "user-a",
    ...overrides,
  };
}

function seedEvidence(assessmentId: string, organisationId = ORG_A) {
  tables.evidenceLinks.push({ id: `evidence-link-${tables.nextId++}`, organisationId, resourceType: "applicability_assessment", resourceId: assessmentId });
}

describe("createApplicabilityAssessment", () => {
  it("creates a DRAFT assessment with scopes for a competent assessor", async () => {
    const assessment = await createApplicabilityAssessment(contextA, baseInput());
    expect(assessment.status).toBe("DRAFT");
    expect(assessment.proposedDecision).toBe("APPLICABLE");
    expect(tables.scopes).toHaveLength(1);
    expect(tables.scopes[0]).toMatchObject({ entityId: ENTITY_A, organisationId: ORG_A });
  });

  it("denies a member without ems.applicability.assess", async () => {
    await expect(createApplicabilityAssessment(reviewOnlyContextA, baseInput())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects an empty rationale", async () => {
    await expect(createApplicabilityAssessment(contextA, baseInput({ rationale: "  " }))).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("rejects an unknown instrument", async () => {
    await expect(createApplicabilityAssessment(contextA, baseInput({ instrumentId: "unknown", changeEventId: undefined }))).rejects.toBeInstanceOf(
      ApplicabilityWorkflowError,
    );
  });

  it("rejects a change event that does not reference the given instrument", async () => {
    tables.instruments.push({ id: "instrument-2", title: "Unrelated instrument" });
    await expect(createApplicabilityAssessment(contextA, baseInput({ instrumentId: "instrument-2" }))).rejects.toBeInstanceOf(
      ApplicabilityWorkflowError,
    );
  });

  it("rejects an empty scope list", async () => {
    await expect(createApplicabilityAssessment(contextA, baseInput({ scopes: [] }))).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("rejects a scope row identifying more than one target", async () => {
    await expect(
      createApplicabilityAssessment(contextA, baseInput({ scopes: [{ entityId: ENTITY_A, siteId: SITE_A }] })),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("denies a RESTRICTED member scoping an entity outside their membership scope", async () => {
    await expect(createApplicabilityAssessment(restrictedContextA, baseInput({ scopes: [{ entityId: ENTITY_A }] }))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("allows a RESTRICTED member scoping a site inside their membership scope", async () => {
    const assessment = await createApplicabilityAssessment(restrictedContextA, baseInput({ scopes: [{ siteId: SITE_A }] }));
    expect(assessment.status).toBe("DRAFT");
  });

  it("does not resolve a foreign-tenant entity as a scope for another organisation", async () => {
    // Entity A belongs to ORG_A; a caller authenticated as ORG_B must not be able to scope to it,
    // even though `instrument-1` itself is global platform data both organisations can see.
    await expect(createApplicabilityAssessment(contextB, baseInput({ instrumentId: "instrument-1", changeEventId: undefined }))).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
  });
});

describe("createApplicabilityAssessment sourced from a T46 other-requirement source", () => {
  function otherRequirementInput(overrides: Partial<Parameters<typeof createApplicabilityAssessment>[1]> = {}) {
    return {
      instrumentId: null,
      otherRequirementSourceId: "other-source-1",
      changeEventId: null,
      decision: "APPLICABLE" as const,
      rationale: "Synthetic rationale: this permit governs Site A's discharge activity.",
      scopes: [{ entityId: ENTITY_A }],
      actorUserId: "user-a",
      ...overrides,
    };
  }

  it("creates a DRAFT assessment sourced from the manual source, not an instrument", async () => {
    const assessment = await createApplicabilityAssessment(contextA, otherRequirementInput());
    expect(assessment.status).toBe("DRAFT");
    expect(assessment.otherRequirementSourceId).toBe("other-source-1");
    expect(assessment.instrumentId).toBeFalsy();
  });

  it("rejects supplying both an instrumentId and an otherRequirementSourceId", async () => {
    await expect(
      createApplicabilityAssessment(contextA, otherRequirementInput({ instrumentId: "instrument-1" })),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("rejects supplying neither an instrumentId nor an otherRequirementSourceId", async () => {
    await expect(createApplicabilityAssessment(contextA, otherRequirementInput({ otherRequirementSourceId: null }))).rejects.toBeInstanceOf(
      ApplicabilityWorkflowError,
    );
  });

  it("rejects a manual source paired with a change event", async () => {
    await expect(createApplicabilityAssessment(contextA, otherRequirementInput({ changeEventId: "event-1" }))).rejects.toBeInstanceOf(
      ApplicabilityWorkflowError,
    );
  });

  it("does not resolve a foreign-tenant other-requirement source for another organisation", async () => {
    await expect(createApplicabilityAssessment(contextB, otherRequirementInput())).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("rejects an unknown other-requirement source id", async () => {
    await expect(
      createApplicabilityAssessment(contextA, otherRequirementInput({ otherRequirementSourceId: "unknown-source" })),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("lists a manual-source assessment alongside instrument-sourced ones", async () => {
    await createApplicabilityAssessment(contextA, otherRequirementInput());
    const listed = await listApplicabilityAssessments(contextA);
    expect(listed.some((a) => a.otherRequirementSourceId === "other-source-1")).toBe(true);
  });
});

describe("updateApplicabilityAssessmentDraft", () => {
  it("replaces scopes and rationale while still DRAFT", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    const updated = await updateApplicabilityAssessmentDraft(contextA, created.id as string, {
      decision: "UNCERTAIN",
      rationale: "Revised rationale.",
      scopes: [{ siteId: SITE_A }],
      actorUserId: "user-a",
    });
    expect(updated.proposedDecision).toBe("UNCERTAIN");
    expect(tables.scopes.filter((s) => s.assessmentId === created.id)).toHaveLength(1);
    expect(tables.scopes.find((s) => s.assessmentId === created.id)).toMatchObject({ siteId: SITE_A });
  });

  it("refuses to edit a submitted assessment", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    seedEvidence(created.id as string);
    await submitApplicabilityAssessmentForReview(contextA, created.id as string, "user-a");
    await expect(
      updateApplicabilityAssessmentDraft(contextA, created.id as string, { decision: "APPLICABLE", rationale: "x", scopes: [{ entityId: ENTITY_A }], actorUserId: "user-a" }),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });
});

describe("submitApplicabilityAssessmentForReview", () => {
  it("moves a complete draft to IN_REVIEW", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    seedEvidence(created.id as string);
    const submitted = await submitApplicabilityAssessmentForReview(contextA, created.id as string, "user-a");
    expect(submitted.status).toBe("IN_REVIEW");
  });

  it("refuses submission with no evidence attached", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    await expect(submitApplicabilityAssessmentForReview(contextA, created.id as string, "user-a")).rejects.toBeInstanceOf(
      ApplicabilityWorkflowError,
    );
  });

  it("denies a caller from another organisation", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    seedEvidence(created.id as string);
    await expect(submitApplicabilityAssessmentForReview(contextB, created.id as string, "user-b")).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

describe("decideApplicabilityAssessment", () => {
  async function createSubmitted() {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    seedEvidence(created.id as string);
    await submitApplicabilityAssessmentForReview(contextA, created.id as string, "user-a");
    return created.id as string;
  }

  it("denies a member without ems.applicability.review", async () => {
    const id = await createSubmitted();
    await expect(
      decideApplicabilityAssessment(assessOnlyContextA, id, {
        decision: "APPLICABLE",
        rationale: "Final rationale.",
        nextReviewAt: new Date("2027-01-01"),
        actorUserId: "user-a",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("records a decision, reviewer, and next review date", async () => {
    const id = await createSubmitted();
    const decided = await decideApplicabilityAssessment(contextA, id, {
      decision: "APPLICABLE",
      rationale: "Confirmed applicable to Site A's permitted discharge activity.",
      nextReviewAt: new Date("2027-01-01"),
      actorUserId: "user-a",
    });
    expect(decided.status).toBe("APPLICABLE");
    expect(decided.reviewedByMembershipId).toBe("membership-a");
    expect(decided.reviewedAt).toBeInstanceOf(Date);
    expect(decided.nextReviewAt).toEqual(new Date("2027-01-01"));
  });

  it("keeps a NOT_APPLICABLE decision as a queryable, non-deleted row", async () => {
    const id = await createSubmitted();
    await decideApplicabilityAssessment(contextA, id, {
      decision: "NOT_APPLICABLE",
      rationale: "Does not apply to any current site or process.",
      nextReviewAt: new Date("2027-01-01"),
      actorUserId: "user-a",
    });
    const row = tables.assessments.find((a) => a.id === id);
    expect(row?.status).toBe("NOT_APPLICABLE");
    const listed = await listApplicabilityAssessments(contextA);
    expect(listed.some((a) => a.id === id)).toBe(true);
  });

  it("requires a follow-up owner for an UNCERTAIN decision", async () => {
    const id = await createSubmitted();
    await expect(
      decideApplicabilityAssessment(contextA, id, {
        decision: "UNCERTAIN",
        rationale: "Not yet clear whether this applies.",
        nextReviewAt: new Date("2027-01-01"),
        actorUserId: "user-a",
      }),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("refuses to decide an assessment with no evidence", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    seedEvidence(created.id as string);
    await submitApplicabilityAssessmentForReview(contextA, created.id as string, "user-a");
    tables.evidenceLinks.length = 0; // simulate evidence removed after submission
    await expect(
      decideApplicabilityAssessment(contextA, created.id as string, {
        decision: "APPLICABLE",
        rationale: "x",
        nextReviewAt: new Date("2027-01-01"),
        actorUserId: "user-a",
      }),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });

  it("supersedes the predecessor only once the successor is itself decided", async () => {
    const firstId = await createSubmitted();
    await decideApplicabilityAssessment(contextA, firstId, {
      decision: "NOT_APPLICABLE",
      rationale: "Not applicable at first review.",
      nextReviewAt: new Date("2026-06-01"),
      actorUserId: "user-a",
    });

    const successor = await createApplicabilityAssessment(contextA, baseInput({ supersedesAssessmentId: firstId, decision: "APPLICABLE" }));
    expect(tables.assessments.find((a) => a.id === firstId)?.status).toBe("NOT_APPLICABLE"); // not superseded yet — successor is still a draft
    seedEvidence(successor.id as string);
    await submitApplicabilityAssessmentForReview(contextA, successor.id as string, "user-a");
    await decideApplicabilityAssessment(contextA, successor.id as string, {
      decision: "APPLICABLE",
      rationale: "Now applicable following a legal amendment.",
      nextReviewAt: new Date("2027-06-01"),
      actorUserId: "user-a",
    });

    expect(tables.assessments.find((a) => a.id === firstId)?.status).toBe("SUPERSEDED");
    expect(tables.assessments.find((a) => a.id === (successor.id as string))?.status).toBe("APPLICABLE");
  });

  it("refuses a successor while the predecessor is still DRAFT or IN_REVIEW", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    await expect(
      createApplicabilityAssessment(contextA, baseInput({ supersedesAssessmentId: created.id as string })),
    ).rejects.toBeInstanceOf(ApplicabilityWorkflowError);
  });
});

describe("tenant isolation and read access", () => {
  it("only surfaces this organisation's own assessments against a global change event", async () => {
    const created = await createApplicabilityAssessment(contextA, baseInput());
    const candidates = await listAssessableLegalChangeEvents(contextA);
    const event = candidates.find((c) => c.id === "event-1");
    expect(event?.organisationAssessments.map((a) => a.id)).toEqual([created.id]);

    const candidatesForB = await listAssessableLegalChangeEvents(contextB);
    const eventForB = candidatesForB.find((c) => c.id === "event-1");
    expect(eventForB?.organisationAssessments).toEqual([]);
  });

  it("denies listing without ems.view", async () => {
    const noPermsContext = makeOrganisationContext(ORG_A, { permissions: new Set() as never });
    await expect(listApplicabilityAssessments(noPermsContext)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
