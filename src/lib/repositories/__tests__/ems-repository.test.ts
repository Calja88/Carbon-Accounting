/**
 * Two-tenant adversarial tests for the EMS repository (T23-T73), per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md's mandatory-access-matrix pattern
 * applied to every EMS table (T80, Docs/PHASE8_HARDENING_READINESS_SPEC.md
 * §3). Synthetic Aster/Birch fixtures only, no live database.
 *
 * The first section hand-tests the four programme/scope/context resources
 * that predate this file. The second section closes the coverage gap for
 * every other `findTenant*` export in `ems-repository.ts` (T30-T73):
 * every one of those functions follows the exact same
 * `prisma.<model>.findFirst({ where: tenantWhere(ctx, { id }) })` shape, so
 * a single table-driven generator proves the same three properties for all
 * of them — same-tenant read allowed, foreign-tenant id denied (T80: "an
 * explicit negative test per customer-owned root"), and — where the
 * function accepts an `expectedParentId` — a same-tenant row attached to
 * the wrong parent is denied too (nested-parent substitution).
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

const PROGRAMME_A = "programme-aster-1";
const PROGRAMME_B = "programme-birch-1";
const VERSION_A = "scope-version-aster-1";
const VERSION_B = "scope-version-birch-1";
const PARTY_A = "party-aster-1";
const PARTY_B = "party-birch-1";
const REQUIREMENT_A = "requirement-aster-1";

const programmeA = { id: PROGRAMME_A, organisationId: ORG_A, name: "Aster EMS" };
const programmeB = { id: PROGRAMME_B, organisationId: ORG_B, name: "Birch EMS" };

const versionA = { id: VERSION_A, organisationId: ORG_A, programmeId: PROGRAMME_A, versionNumber: 1 };
const versionB = { id: VERSION_B, organisationId: ORG_B, programmeId: PROGRAMME_B, versionNumber: 1 };
const VERSION_A2 = "scope-version-aster-2";
/** A same-tenant Organisation A version belonging to a *different* Organisation A programme — the nested-parent-substitution guard proves this, not just cross-tenant denial. */
const programmeA2 = { id: "programme-aster-2", organisationId: ORG_A, name: "Aster EMS 2" };
const versionAOtherProgramme = { id: VERSION_A2, organisationId: ORG_A, programmeId: programmeA2.id, versionNumber: 1 };

const partyA = { id: PARTY_A, organisationId: ORG_A, name: "Aster regulator" };
const partyB = { id: PARTY_B, organisationId: ORG_B, name: "Birch regulator" };

const requirementA = { id: REQUIREMENT_A, organisationId: ORG_A, interestedPartyId: PARTY_A, summary: "Annual consent" };
const REQUIREMENT_A2 = "requirement-aster-2";
const partyA2 = { id: "party-aster-2", organisationId: ORG_A, name: "Aster council" };
const requirementAOtherParty = { id: REQUIREMENT_A2, organisationId: ORG_A, interestedPartyId: partyA2.id, summary: "Other" };

function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

// ---------------------------------------------------------------------------
// Table-driven fixtures for every other findTenant* export (T30-T73). Every
// one of these functions queries `prisma.<model>.findFirst({ where:
// tenantWhere(ctx, { id }) })` and either `assertOwned`s or (for a
// parent-guarded child) `assertChildOwnership`s the result — a flat
// equality match on `id`/`organisationId` is all `fakeFindFirst` needs.
// ---------------------------------------------------------------------------

interface GenericResourceSpec {
  /** Prisma delegate name, e.g. "environmentalAspect". */
  model: string;
  /** Exported function name in ems-repository.ts. */
  fn: string;
  /** Field name guarded by `expectedParentId`, if this is a child resource. */
  parentField?: string;
}

const GENERIC_RESOURCES: GenericResourceSpec[] = [
  // EMS programme foundation (T23) — remaining roots.
  { model: "standardRequirementMap", fn: "findTenantStandardRequirementMap" },
  { model: "contextIssue", fn: "findTenantContextIssue" },
  { model: "emsRiskOpportunity", fn: "findTenantEmsRiskOpportunity" },
  { model: "changeAssessment", fn: "findTenantChangeAssessment" },
  { model: "environmentalPolicyRecord", fn: "findTenantEnvironmentalPolicyRecord" },
  // Process/activity profiles (T30).
  { model: "activityProcess", fn: "findTenantActivityProcess", parentField: "programmeId" },
  // Aspect/impact register (T31), significance engine (T32).
  { model: "environmentalAspect", fn: "findTenantEnvironmentalAspect" },
  { model: "environmentalImpact", fn: "findTenantEnvironmentalImpact" },
  { model: "significanceMethod", fn: "findTenantSignificanceMethod" },
  { model: "aspectAssessment", fn: "findTenantAspectAssessment" },
  // Operational controls (T33).
  { model: "operationalControl", fn: "findTenantOperationalControl" },
  { model: "controlCheck", fn: "findTenantControlCheck" },
  // External providers, communications, emergency preparedness (T35).
  { model: "externalProviderControl", fn: "findTenantExternalProviderControl" },
  { model: "externalProviderEvaluation", fn: "findTenantExternalProviderEvaluation" },
  { model: "communicationPlan", fn: "findTenantCommunicationPlan" },
  { model: "communicationRecord", fn: "findTenantCommunicationRecord" },
  { model: "emergencyScenario", fn: "findTenantEmergencyScenario" },
  { model: "emergencyPlan", fn: "findTenantEmergencyPlan", parentField: "scenarioId" },
  { model: "emergencyExercise", fn: "findTenantEmergencyExercise" },
  // Legal: applicability (T43), obligation versioning (T44), compliance
  // evaluation (T45), other requirements (T46).
  { model: "applicabilityAssessment", fn: "findTenantApplicabilityAssessment" },
  { model: "complianceObligation", fn: "findTenantComplianceObligation" },
  { model: "complianceObligationVersion", fn: "findTenantComplianceObligationVersion", parentField: "obligationId" },
  { model: "complianceEvaluationProgramme", fn: "findTenantComplianceEvaluationProgramme" },
  { model: "complianceEvaluation", fn: "findTenantComplianceEvaluation", parentField: "programmeId" },
  { model: "complianceEvaluationItem", fn: "findTenantComplianceEvaluationItem", parentField: "evaluationId" },
  { model: "otherRequirementSource", fn: "findTenantOtherRequirementSource" },
  // Objectives/metrics (T50), action programmes (T52).
  { model: "environmentalObjective", fn: "findTenantEnvironmentalObjective" },
  { model: "environmentalObjectiveVersion", fn: "findTenantEnvironmentalObjectiveVersion", parentField: "objectiveId" },
  { model: "objectiveMetricDefinition", fn: "findTenantObjectiveMetricDefinition" },
  { model: "objectiveMetricVersion", fn: "findTenantObjectiveMetricVersion", parentField: "metricDefinitionId" },
  { model: "actionProgramme", fn: "findTenantActionProgramme" },
  { model: "actionItem", fn: "findTenantActionItem", parentField: "programmeId" },
  // Audit programme/execution (T60), checklists/findings (T61).
  { model: "auditProgramme", fn: "findTenantAuditProgramme" },
  { model: "auditProgrammeItem", fn: "findTenantAuditProgrammeItem", parentField: "programmeId" },
  { model: "emsAudit", fn: "findTenantEmsAudit", parentField: "programmeId" },
  { model: "auditTeamMember", fn: "findTenantAuditTeamMember", parentField: "auditId" },
  { model: "auditChecklistVersion", fn: "findTenantAuditChecklistVersion", parentField: "auditId" },
  { model: "auditChecklistItem", fn: "findTenantAuditChecklistItem", parentField: "checklistVersionId" },
  { model: "auditQuestionResponse", fn: "findTenantAuditQuestionResponse", parentField: "checklistItemId" },
  { model: "auditFinding", fn: "findTenantAuditFinding", parentField: "auditId" },
  // Environmental incident intake (T62).
  { model: "incidentSeverityLevel", fn: "findTenantIncidentSeverityLevel" },
  { model: "environmentalIncident", fn: "findTenantEnvironmentalIncident" },
  { model: "incidentCorrection", fn: "findTenantIncidentCorrection", parentField: "incidentId" },
  { model: "incidentNotificationAssessment", fn: "findTenantIncidentNotificationAssessment", parentField: "incidentId" },
  // Nonconformity workflow (T63), root cause/CAPA (T64).
  { model: "nonconformityClassification", fn: "findTenantNonconformityClassification" },
  { model: "nonconformity", fn: "findTenantNonconformity" },
  { model: "containmentRecord", fn: "findTenantContainmentRecord", parentField: "nonconformityId" },
  { model: "rootCauseAnalysis", fn: "findTenantRootCauseAnalysis", parentField: "nonconformityId" },
  { model: "correctiveAction", fn: "findTenantCorrectiveAction", parentField: "nonconformityId" },
  { model: "effectivenessReview", fn: "findTenantEffectivenessReview", parentField: "nonconformityId" },
  // Competence requirements/assignments (T70), evidence/assessment (T71).
  { model: "personProfile", fn: "findTenantPersonProfile" },
  { model: "competenceRequirement", fn: "findTenantCompetenceRequirement" },
  { model: "competenceRequirementVersion", fn: "findTenantCompetenceRequirementVersion", parentField: "requirementId" },
  { model: "competenceAssignment", fn: "findTenantCompetenceAssignment", parentField: "personId" },
  { model: "competenceEvidence", fn: "findTenantCompetenceEvidence", parentField: "assignmentId" },
  { model: "competenceAssessment", fn: "findTenantCompetenceAssessment", parentField: "assignmentId" },
  // Management review agenda (T72), review pack/decisions/minutes (T73).
  { model: "managementReviewAgendaTemplate", fn: "findTenantManagementReviewAgendaTemplate" },
  { model: "managementReviewAgendaTemplateVersion", fn: "findTenantManagementReviewAgendaTemplateVersion", parentField: "templateId" },
  { model: "managementReviewAgendaItemDefinition", fn: "findTenantManagementReviewAgendaItemDefinition", parentField: "templateVersionId" },
  { model: "managementReviewInputDefinition", fn: "findTenantManagementReviewInputDefinition" },
  { model: "managementReview", fn: "findTenantManagementReview" },
  { model: "managementReviewAttendee", fn: "findTenantManagementReviewAttendee", parentField: "reviewId" },
  { model: "managementReviewInputLink", fn: "findTenantManagementReviewInputLink", parentField: "reviewId" },
  { model: "managementReviewPack", fn: "findTenantManagementReviewPack" },
  { model: "managementReviewAiNarrative", fn: "findTenantManagementReviewAiNarrative", parentField: "packId" },
  { model: "managementReviewDecision", fn: "findTenantManagementReviewDecision", parentField: "reviewId" },
  { model: "managementReviewMinuteRevision", fn: "findTenantManagementReviewMinuteRevision", parentField: "reviewId" },
];

/** `<model>-a-1` / `<model>-b-1` style ids, distinct per model so cross-model id collisions can't hide a bug. */
function ids(model: string) {
  return {
    a: `${model}-aster-1`,
    a2: `${model}-aster-2`,
    b: `${model}-birch-1`,
    parentA: `${model}-parent-aster-1`,
    parentA2: `${model}-parent-aster-2`,
    parentB: `${model}-parent-birch-1`,
  };
}

function buildRows(spec: GenericResourceSpec) {
  const { a, a2, b, parentA, parentA2, parentB } = ids(spec.model);
  const rowA: Record<string, unknown> = { id: a, organisationId: ORG_A };
  const rowB: Record<string, unknown> = { id: b, organisationId: ORG_B };
  if (spec.parentField) {
    rowA[spec.parentField] = parentA;
    rowB[spec.parentField] = parentB;
  }
  const rows = [rowA, rowB];
  let rowAOtherParent: Record<string, unknown> | undefined;
  if (spec.parentField) {
    rowAOtherParent = { id: a2, organisationId: ORG_A, [spec.parentField]: parentA2 };
    rows.push(rowAOtherParent);
  }
  return { rowA, rowB, rowAOtherParent, parentA, parentB };
}

const genericFixtures = new Map(GENERIC_RESOURCES.map((spec) => [spec.model, buildRows(spec)]));

vi.mock("@/lib/prisma", () => {
  const client: Record<string, unknown> = {
    emsProgramme: { findFirst: fakeFindFirst([programmeA, programmeB]) },
    emsScopeVersion: { findFirst: fakeFindFirst([versionA, versionB, versionAOtherProgramme]) },
    interestedParty: { findFirst: fakeFindFirst([partyA, partyB]) },
    interestedPartyRequirement: { findFirst: fakeFindFirst([requirementA, requirementAOtherParty]) },
  };
  for (const spec of GENERIC_RESOURCES) {
    const fixture = genericFixtures.get(spec.model)!;
    const rows = [fixture.rowA, fixture.rowB, ...(fixture.rowAOtherParent ? [fixture.rowAOtherParent] : [])];
    client[spec.model] = { findFirst: fakeFindFirst(rows) };
  }
  // findTenantAuditReportRevision is keyed by `auditId`, not `id` — it needs
  // its own row shape rather than the generic table's `id`-keyed fixtures.
  client.auditReportRevision = {
    findFirst: fakeFindFirst([
      { id: "report-revision-aster-1", organisationId: ORG_A, auditId: "audit-aster-1" },
      { id: "report-revision-birch-1", organisationId: ORG_B, auditId: "audit-birch-1" },
    ]),
  };
  // findTenantManagementReviewPackByReviewId is keyed by `reviewId`.
  const packRows = [
    { id: "pack-aster-1", organisationId: ORG_A, reviewId: "review-aster-1" },
    { id: "pack-birch-1", organisationId: ORG_B, reviewId: "review-birch-1" },
  ];
  client.managementReviewPack = { findFirst: fakeFindFirst([...packRows, genericFixtures.get("managementReviewPack")!.rowA, genericFixtures.get("managementReviewPack")!.rowB]) };
  return { prisma: client };
});

const ems = await import("@/lib/repositories/ems-repository");
const { TenantOwnershipError } = ems;

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

describe("findTenantEmsProgramme", () => {
  it("allows an Organisation A caller reading Programme A", async () => {
    await expect(ems.findTenantEmsProgramme(ctxA, PROGRAMME_A)).resolves.toEqual(programmeA);
  });

  it("denies an Organisation A caller reading Programme B (foreign tenant)", async () => {
    await expect(ems.findTenantEmsProgramme(ctxA, PROGRAMME_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a missing programme id identically to a foreign one", async () => {
    await expect(ems.findTenantEmsProgramme(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantEmsScopeVersion", () => {
  it("allows an Organisation A caller reading Version A", async () => {
    await expect(ems.findTenantEmsScopeVersion(ctxA, VERSION_A)).resolves.toEqual(versionA);
  });

  it("denies an Organisation A caller reading Version B (foreign tenant)", async () => {
    await expect(ems.findTenantEmsScopeVersion(ctxA, VERSION_B)).resolves.toBeNull();
  });

  it("guards against a same-tenant version attached to a different programme id than expected (nested-parent substitution)", async () => {
    await expect(ems.findTenantEmsScopeVersion(ctxA, VERSION_A2, PROGRAMME_A)).rejects.toThrow(TenantOwnershipError);
    await expect(ems.findTenantEmsScopeVersion(ctxA, VERSION_A, PROGRAMME_A)).resolves.toEqual(versionA);
  });
});

describe("findTenantInterestedParty", () => {
  it("allows an Organisation A caller reading Party A", async () => {
    await expect(ems.findTenantInterestedParty(ctxA, PARTY_A)).resolves.toEqual(partyA);
  });

  it("denies an Organisation B caller reading Party A (reverse direction)", async () => {
    await expect(ems.findTenantInterestedParty(ctxB, PARTY_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantInterestedPartyRequirement", () => {
  it("allows an Organisation A caller reading Requirement A", async () => {
    await expect(ems.findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A)).resolves.toEqual(requirementA);
  });

  it("guards against a same-tenant requirement attached to a different interested party id than expected", async () => {
    await expect(ems.findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A2, PARTY_A)).rejects.toThrow(TenantOwnershipError);
    await expect(ems.findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A, PARTY_A)).resolves.toEqual(requirementA);
  });
});

// ---------------------------------------------------------------------------
// T30-T73: every other findTenant* export, generated from GENERIC_RESOURCES.
// ---------------------------------------------------------------------------

describe.each(GENERIC_RESOURCES)("$fn (T80 generic tenant-isolation sweep)", (spec) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (ems as any)[spec.fn] as (ctx: unknown, id: string, expectedParentId?: string) => Promise<unknown>;
  const fixture = genericFixtures.get(spec.model)!;

  it("allows an Organisation A caller reading its own record", async () => {
    await expect(fn(ctxA, fixture.rowA.id as string)).resolves.toEqual(fixture.rowA);
  });

  it("denies an Organisation A caller reading Organisation B's record (foreign tenant)", async () => {
    const result = fn(ctxA, fixture.rowB.id as string);
    // The repository's two safe shapes: throw TenantOwnershipError, or
    // resolve null — either way Organisation B's row must never come back.
    await result.then(
      (value) => expect(value).toBeNull(),
      (error) => expect(error).toBeInstanceOf(TenantOwnershipError),
    );
  });

  it("denies a missing id the same way as a foreign one", async () => {
    const result = fn(ctxA, "does-not-exist");
    await result.then(
      (value) => expect(value).toBeNull(),
      (error) => expect(error).toBeInstanceOf(TenantOwnershipError),
    );
  });

  if (spec.parentField) {
    it("guards against a same-tenant record attached to a different parent id than expected (nested-parent substitution)", async () => {
      await expect(fn(ctxA, fixture.rowAOtherParent!.id as string, fixture.parentA)).rejects.toThrow(TenantOwnershipError);
      await expect(fn(ctxA, fixture.rowA.id as string, fixture.parentA)).resolves.toEqual(fixture.rowA);
    });
  }
});

describe("findTenantAuditReportRevision", () => {
  it("allows an Organisation A caller reading its own audit's report revision", async () => {
    const revision = await ems.findTenantAuditReportRevision(ctxA, "audit-aster-1");
    expect(revision).toMatchObject({ organisationId: ORG_A, auditId: "audit-aster-1" });
  });

  it("denies an Organisation A caller reading Organisation B's audit report revision", async () => {
    await expect(ems.findTenantAuditReportRevision(ctxA, "audit-birch-1")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantManagementReviewPackByReviewId", () => {
  it("allows an Organisation A caller reading its own review's pack", async () => {
    const pack = await ems.findTenantManagementReviewPackByReviewId(ctxA, "review-aster-1");
    expect(pack).toMatchObject({ organisationId: ORG_A, reviewId: "review-aster-1" });
  });

  it("denies an Organisation A caller reading Organisation B's review pack (query itself is tenant-scoped, so this resolves null rather than throwing)", async () => {
    await expect(ems.findTenantManagementReviewPackByReviewId(ctxA, "review-birch-1")).resolves.toBeNull();
  });

  it("returns null for a review with no pack yet", async () => {
    await expect(ems.findTenantManagementReviewPackByReviewId(ctxA, "review-with-no-pack")).resolves.toBeNull();
  });
});
