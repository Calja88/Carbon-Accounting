/**
 * Applicability workflow (task T43, Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
 * §§1-2,5,7,9). Lets a competent user assess a legal instrument — usually
 * prompted by one T42-triaged `LegalChangeEvent` — against this
 * organisation's Entity/Site/process/aspect scopes, and lets a second
 * (or the same, where role templates allow it) permission holder record the
 * reviewed decision.
 *
 * Fixed decisions this module enforces (spec §§1-2,9):
 *  - `ems.applicability.assess` only ever creates/edits a DRAFT and moves it
 *    to IN_REVIEW; only `ems.applicability.review` can move IN_REVIEW to a
 *    decided status (APPLICABLE/NOT_APPLICABLE/UNCERTAIN) — there is no
 *    function in this module either permission can call to jump straight
 *    from DRAFT to a decided status;
 *  - decision/rationale/reviewer/evidence/review date are all required
 *    before `decideApplicabilityAssessment` can record a decision — the
 *    spec §9 "decision/rationale/reviewer/evidence/review date required"
 *    acceptance item is enforced here, not left to the caller;
 *  - `UNCERTAIN` additionally requires a follow-up owner (spec §2);
 *  - a decided assessment is never edited in place: `finalSignificant`-style
 *    mutation of a decided row does not exist in this module. Re-assessing
 *    an instrument creates a new DRAFT via `supersedesAssessmentId`
 *    (`createApplicabilityAssessment`'s `supersedesAssessmentId` input),
 *    and only `decideApplicabilityAssessment` — deciding the *successor* —
 *    ever flips a predecessor to SUPERSEDED. A NOT_APPLICABLE (or any other
 *    decided) row is therefore never deleted or overwritten, only
 *    superseded once a later assessment is itself decided — "NOT_APPLICABLE
 *    remains reviewable history" (spec §9);
 *  - this module never creates, edits, or reads a compliance obligation —
 *    that model does not exist yet (T44). A `LegalChangeEvent` recorded by
 *    T40/T42 is read-only input here; nothing in this module writes to
 *    `LegalInstrument`/`LegalChangeEvent`, so "source change never directly
 *    changes active obligation" holds by construction (there is no
 *    obligation to change, and no write path back into the legal register);
 *  - only a resolved, permission-checked `OrganisationContext` can reach any
 *    exported function here — there is no AI-callable entry point in this
 *    module, so "AI cannot set decision" holds architecturally, not just by
 *    convention.
 *
 * T46 extension (spec §5 "source/instrument/change/other requirement"):
 * every function above works identically whether an assessment is sourced
 * from a `LegalInstrument` or a manually entered `OtherRequirementSource`
 * (task T46, other-requirement-service.ts) — `validateSource` is the one
 * place that branches on which of `instrumentId`/`otherRequirementSourceId`
 * the caller supplied (exactly one, never both/neither), and a manual
 * source never carries a `changeEventId` (only the T41/T42 provider sync
 * produces `LegalChangeEvent` rows).
 */

import type { ApplicabilityAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import {
  findTenantActivityProcess,
  findTenantApplicabilityAssessment,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";
import { isUnderLegalHold } from "@/lib/retention/legal-hold-service";

export { TenantOwnershipError };

export class ApplicabilityWorkflowError extends Error {}

/** The three "decided" statuses — everything the state machine can settle on other than DRAFT/IN_REVIEW/SUPERSEDED. */
export const APPLICABILITY_DECISIONS = ["APPLICABLE", "NOT_APPLICABLE", "UNCERTAIN"] as const;
export type ApplicabilityDecision = (typeof APPLICABILITY_DECISIONS)[number];

function isApplicabilityDecision(value: string): value is ApplicabilityDecision {
  return (APPLICABILITY_DECISIONS as readonly string[]).includes(value);
}

export interface ApplicabilityScopeInput {
  entityId?: string | null;
  siteId?: string | null;
  processId?: string | null;
  aspectId?: string | null;
}

export interface CreateApplicabilityAssessmentInput {
  /** Exactly one of `instrumentId`/`otherRequirementSourceId` must be set. */
  instrumentId?: string | null;
  otherRequirementSourceId?: string | null;
  changeEventId?: string | null;
  decision: ApplicabilityDecision;
  rationale: string;
  scopes: ApplicabilityScopeInput[];
  /** Assessing this same source again after a prior decided assessment: the id of the assessment being revised. */
  supersedesAssessmentId?: string | null;
  actorUserId: string;
}

export type UpdateApplicabilityAssessmentDraftInput = Omit<
  CreateApplicabilityAssessmentInput,
  "instrumentId" | "otherRequirementSourceId" | "changeEventId" | "supersedesAssessmentId"
>;

export interface DecideApplicabilityAssessmentInput {
  decision: ApplicabilityDecision;
  rationale: string;
  nextReviewAt: Date;
  followUpOwnerMembershipId?: string | null;
  actorUserId: string;
}

/** Read-only lookup of a legal instrument this organisation may want to assess. Platform-global data — no tenant scoping. */
export async function getLegalInstrumentForAssessment(instrumentId: string) {
  const instrument = await prisma.legalInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) throw new ApplicabilityWorkflowError("Unknown legal instrument.");
  return instrument;
}

/**
 * Every T42-triaged (or further along) change event not yet REVIEWED/
 * DISMISSED/CLOSED, with this organisation's own assessment history for
 * that event so the UI can show which candidates already have a draft or
 * decided assessment. Platform-global `LegalChangeEvent`/`LegalInstrument`
 * reads carry no organisationId; the assessments joined in are filtered to
 * this organisation only.
 */
export async function listAssessableLegalChangeEvents(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const events = await prisma.legalChangeEvent.findMany({
    where: { status: { in: ["TRIAGED", "REVIEW_REQUIRED"] } },
    include: { sourceInstrument: true, affectedInstrument: true },
    orderBy: { detectedAt: "desc" },
    take: 200,
  });
  if (events.length === 0) return [];

  const ctx = toTenantRepositoryContext(context);
  const assessments = await prisma.applicabilityAssessment.findMany({
    where: tenantWhere(ctx, { changeEventId: { in: events.map((event) => event.id) } }),
    orderBy: { createdAt: "desc" },
  });
  const assessmentsByEvent = new Map<string, typeof assessments>();
  for (const assessment of assessments) {
    if (!assessment.changeEventId) continue;
    const existing = assessmentsByEvent.get(assessment.changeEventId) ?? [];
    existing.push(assessment);
    assessmentsByEvent.set(assessment.changeEventId, existing);
  }

  return events.map((event) => ({
    ...event,
    organisationAssessments: assessmentsByEvent.get(event.id) ?? [],
  }));
}

/**
 * Every ACTIVE T46 `OtherRequirementSource` this organisation may want to
 * assess, with its own assessment history — the manual-source counterpart
 * of `listAssessableLegalChangeEvents` above. Unlike a `LegalChangeEvent`,
 * an other-requirement source is already Organisation-owned, so this is a
 * single tenant-scoped query rather than a global-candidates-plus-join.
 */
export async function listAssessableOtherRequirementSources(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const sources = await prisma.otherRequirementSource.findMany({
    where: tenantWhere(ctx, { status: "ACTIVE" as const }),
    orderBy: { createdAt: "desc" },
  });
  if (sources.length === 0) return [];

  const assessments = await prisma.applicabilityAssessment.findMany({
    where: tenantWhere(ctx, { otherRequirementSourceId: { in: sources.map((source) => source.id) } }),
    orderBy: { createdAt: "desc" },
  });
  const assessmentsBySource = new Map<string, typeof assessments>();
  for (const assessment of assessments) {
    if (!assessment.otherRequirementSourceId) continue;
    const existing = assessmentsBySource.get(assessment.otherRequirementSourceId) ?? [];
    existing.push(assessment);
    assessmentsBySource.set(assessment.otherRequirementSourceId, existing);
  }

  return sources.map((source) => ({
    ...source,
    organisationAssessments: assessmentsBySource.get(source.id) ?? [],
  }));
}

export async function listApplicabilityAssessments(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.applicabilityAssessment.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      instrument: true,
      otherRequirementSource: true,
      changeEvent: true,
      scopes: {
        include: {
          entity: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          process: { select: { id: true, name: true } },
          aspect: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function validateScopes(context: OrganisationContext, scopes: ApplicabilityScopeInput[]) {
  if (scopes.length === 0) {
    throw new ApplicabilityWorkflowError("Add at least one entity, site, process, or aspect scope.");
  }
  const ctx = toTenantRepositoryContext(context);

  const validated: ApplicabilityScopeInput[] = [];
  for (const scope of scopes) {
    const entityId = scope.entityId || null;
    const siteId = scope.siteId || null;
    const processId = scope.processId || null;
    const aspectId = scope.aspectId || null;
    const setCount = [entityId, siteId, processId, aspectId].filter(Boolean).length;
    if (setCount !== 1) {
      throw new ApplicabilityWorkflowError("Each scope row must identify exactly one entity, site, process, or aspect.");
    }

    if (entityId) {
      assertEntityAccess(context, entityId);
      const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: entityId }), select: { id: true } });
      if (!entity) throw new TenantOwnershipError();
    } else if (siteId) {
      assertSiteAccess(context, siteId);
      const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: siteId }), select: { id: true } });
      if (!site) throw new TenantOwnershipError();
    } else if (processId) {
      const process = await findTenantActivityProcess(ctx, processId);
      if (!process) throw new TenantOwnershipError();
      if (context.access.mode === "RESTRICTED") {
        const inScope = (process.siteId && context.access.siteIds.has(process.siteId)) || (process.entityId && context.access.entityIds.has(process.entityId));
        if (!inScope) throw new TenantOwnershipError();
      }
    } else if (aspectId) {
      const aspect = await prisma.environmentalAspect.findFirst({
        where: tenantWhere(ctx, { id: aspectId }),
        include: { process: { select: { siteId: true, entityId: true } } },
      });
      if (!aspect) throw new TenantOwnershipError();
      if (context.access.mode === "RESTRICTED") {
        const inScope =
          (aspect.process.siteId && context.access.siteIds.has(aspect.process.siteId)) ||
          (aspect.process.entityId && context.access.entityIds.has(aspect.process.entityId));
        if (!inScope) throw new TenantOwnershipError();
      }
    }

    validated.push({ entityId, siteId, processId, aspectId });
  }
  return validated;
}

/**
 * Resolves and validates whichever one source the caller supplied — a
 * global `LegalInstrument` (optionally with a `LegalChangeEvent` that must
 * actually reference it) or a tenant-owned T46 `OtherRequirementSource`
 * (which never carries a change event: only the provider sync produces
 * those). Returns the pair of columns `createApplicabilityAssessment`/
 * `findPredecessorAssessment` write onto the row — exactly one is non-null.
 */
async function validateSource(
  ctx: ReturnType<typeof toTenantRepositoryContext>,
  input: { instrumentId?: string | null; otherRequirementSourceId?: string | null; changeEventId?: string | null },
): Promise<{ instrumentId: string | null; otherRequirementSourceId: string | null }> {
  const instrumentId = input.instrumentId || null;
  const otherRequirementSourceId = input.otherRequirementSourceId || null;
  if (Boolean(instrumentId) === Boolean(otherRequirementSourceId)) {
    throw new ApplicabilityWorkflowError("Choose exactly one legal instrument or other-requirement source.");
  }

  if (instrumentId) {
    const instrument = await prisma.legalInstrument.findUnique({ where: { id: instrumentId } });
    if (!instrument) throw new ApplicabilityWorkflowError("Unknown legal instrument.");
    if (input.changeEventId) {
      const event = await prisma.legalChangeEvent.findUnique({ where: { id: input.changeEventId } });
      if (!event) throw new ApplicabilityWorkflowError("Unknown legal change event.");
      if (event.sourceInstrumentId !== instrument.id && event.affectedInstrumentId !== instrument.id) {
        throw new ApplicabilityWorkflowError("The change event does not reference this instrument.");
      }
    }
    return { instrumentId: instrument.id, otherRequirementSourceId: null };
  }

  if (input.changeEventId) {
    throw new ApplicabilityWorkflowError("A manual other-requirement source cannot reference a legal change event.");
  }
  const source = await prisma.otherRequirementSource.findFirst({ where: tenantWhere(ctx, { id: otherRequirementSourceId as string }) });
  if (!source) throw new TenantOwnershipError();
  return { instrumentId: null, otherRequirementSourceId: source.id };
}

export async function createApplicabilityAssessment(context: OrganisationContext, input: CreateApplicabilityAssessmentInput) {
  requirePermission(context, "ems.applicability.assess");
  if (!input.rationale.trim()) throw new ApplicabilityWorkflowError("Enter a rationale for the proposed decision.");
  const ctx = toTenantRepositoryContext(context);
  const source = await validateSource(ctx, input);
  const scopes = await validateScopes(context, input.scopes);

  let predecessor: {
    id: string;
    status: ApplicabilityAssessmentStatus;
    instrumentId: string | null;
    otherRequirementSourceId: string | null;
    successorAssessment: { id: string } | null;
  } | null = null;
  if (input.supersedesAssessmentId) {
    predecessor = await prisma.applicabilityAssessment.findFirst({
      where: tenantWhere(ctx, { id: input.supersedesAssessmentId }),
      include: { successorAssessment: { select: { id: true } } },
    });
    if (!predecessor) throw new TenantOwnershipError();
    if (predecessor.status === "DRAFT" || predecessor.status === "IN_REVIEW") {
      throw new ApplicabilityWorkflowError("Decide the current assessment before creating a successor.");
    }
    if (predecessor.successorAssessment) {
      throw new ApplicabilityWorkflowError("That assessment already has a successor.");
    }
    if (predecessor.instrumentId !== source.instrumentId || predecessor.otherRequirementSourceId !== source.otherRequirementSourceId) {
      throw new ApplicabilityWorkflowError("A successor assessment must re-assess the same source as its predecessor.");
    }
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const created = await tx.applicabilityAssessment.create({
      data: {
        organisationId: txCtx.organisationId,
        instrumentId: source.instrumentId,
        otherRequirementSourceId: source.otherRequirementSourceId,
        changeEventId: input.changeEventId || null,
        rationale: input.rationale.trim(),
        proposedDecision: input.decision,
        assessedByMembershipId: context.membershipId,
        supersedesAssessmentId: predecessor?.id ?? null,
      },
    });
    // A separate createMany, not a nested write under `scopes` — this
    // model's `assessment` relation is itself keyed on
    // [organisationId, assessmentId], and Prisma's nested-create input for
    // a to-many relation under a compound-keyed parent relation excludes
    // organisationId even though the sibling `organisation` relation still
    // needs it (confirmed via real-Postgres CI: "Unknown argument
    // `organisationId`" on the nested write).
    if (scopes.length > 0) {
      await tx.applicabilityAssessmentScope.createMany({
        data: scopes.map((scope) => ({
          organisationId: txCtx.organisationId,
          assessmentId: created.id,
          entityId: scope.entityId,
          siteId: scope.siteId,
          processId: scope.processId,
          aspectId: scope.aspectId,
        })),
      });
    }
    const assessment = await tx.applicabilityAssessment.findUniqueOrThrow({ where: { id: created.id }, include: { scopes: true } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "applicability_assessment.created",
      resourceType: "applicability_assessment",
      resourceId: assessment.id,
      summary: source.instrumentId
        ? `Applicability assessment drafted for instrument ${source.instrumentId}.`
        : `Applicability assessment drafted for other-requirement source ${source.otherRequirementSourceId}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: {
        instrumentId: source.instrumentId,
        otherRequirementSourceId: source.otherRequirementSourceId,
        changeEventId: input.changeEventId ?? null,
        proposedDecision: input.decision,
      },
    });
    return assessment;
  });
}

export async function updateApplicabilityAssessmentDraft(
  context: OrganisationContext,
  assessmentId: string,
  input: UpdateApplicabilityAssessmentDraftInput,
) {
  requirePermission(context, "ems.applicability.assess");
  if (!input.rationale.trim()) throw new ApplicabilityWorkflowError("Enter a rationale for the proposed decision.");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT") throw new ApplicabilityWorkflowError("Only a draft assessment can be edited.");
  const scopes = await validateScopes(context, input.scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.applicabilityAssessmentScope.deleteMany({ where: tenantWhere(txCtx, { assessmentId: assessment.id }) });
    const updated = await tx.applicabilityAssessment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
      data: {
        rationale: input.rationale.trim(),
        proposedDecision: input.decision,
        scopes: {
          create: scopes.map((scope) => ({
            organisationId: txCtx.organisationId,
            entityId: scope.entityId,
            siteId: scope.siteId,
            processId: scope.processId,
            aspectId: scope.aspectId,
          })),
        },
      },
      include: { scopes: true },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "applicability_assessment.created",
      resourceType: "applicability_assessment",
      resourceId: assessment.id,
      summary: "Draft applicability assessment updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { proposedDecision: input.decision },
    });
    return updated;
  });
}

/**
 * Discards a draft applicability assessment.
 *
 * Follows the `discardSignificanceMethod` precedent exactly: a DRAFT
 * assessment is the one state that provably cannot be referenced by any
 * downstream snapshot — `ComplianceObligationVersion` rows are only ever
 * created from a *decided* assessment, and a successor assessment may only
 * supersede a decided predecessor. A decided (APPLICABLE / NOT_APPLICABLE /
 * UNCERTAIN) assessment is a legal record and is never deleted; it is
 * superseded by a successor instead. IN_REVIEW is also refused, so a draft
 * cannot be pulled out from under a reviewer mid-review — withdraw it back
 * to DRAFT first is not a transition this workflow has, so the reviewer
 * decides it instead.
 */
export async function discardApplicabilityAssessmentDraft(
  context: OrganisationContext,
  assessmentId: string,
  actorUserId: string,
) {
  requirePermission(context, "ems.applicability.assess");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT") {
    throw new ApplicabilityWorkflowError("Only a draft applicability assessment can be discarded.");
  }
  if (await isUnderLegalHold(ctx, "applicability_assessment", assessment.id)) {
    throw new ApplicabilityWorkflowError("This assessment is under legal hold and cannot be discarded.");
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // Scopes cascade with the assessment row; the polymorphic evidence links
    // are removed explicitly so no orphan link can later imply the
    // assessment still exists. The shared EvidenceObject itself is retained.
    await tx.evidenceLink.deleteMany({
      where: tenantWhere(txCtx, { resourceType: "applicability_assessment", resourceId: assessment.id }),
    });
    await tx.applicabilityAssessmentScope.deleteMany({ where: tenantWhere(txCtx, { assessmentId: assessment.id }) });
    await tx.applicabilityAssessment.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "applicability_assessment.discarded",
      resourceType: "applicability_assessment",
      resourceId: assessment.id,
      summary: "Draft applicability assessment discarded before any decision was recorded.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: {
        status: "DRAFT",
        instrumentId: assessment.instrumentId,
        otherRequirementSourceId: assessment.otherRequirementSourceId,
      },
    });
  });
}

export async function attachEvidenceToApplicabilityAssessment(
  context: OrganisationContext,
  input: { assessmentId: string; evidenceId: string; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.applicability.assess");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, input.assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT" && assessment.status !== "IN_REVIEW") {
    throw new ApplicabilityWorkflowError("Evidence can only be attached before a decision is recorded.");
  }
  return linkEvidence(context, {
    evidenceId: input.evidenceId,
    resourceType: "applicability_assessment",
    resourceId: assessment.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
}

export async function uploadEvidenceToApplicabilityAssessment(
  context: OrganisationContext,
  input: { assessmentId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.applicability.assess");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, input.assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT" && assessment.status !== "IN_REVIEW") {
    throw new ApplicabilityWorkflowError("Evidence can only be attached before a decision is recorded.");
  }
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "applicability_assessment",
    resourceId: assessment.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

async function countEvidence(organisationId: string, assessmentId: string) {
  return prisma.evidenceLink.count({
    where: { organisationId, resourceType: "applicability_assessment", resourceId: assessmentId },
  });
}

export async function submitApplicabilityAssessmentForReview(context: OrganisationContext, assessmentId: string, actorUserId: string) {
  requirePermission(context, "ems.applicability.assess");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT") throw new ApplicabilityWorkflowError("Only a draft assessment can be submitted for review.");
  if (!assessment.rationale?.trim()) throw new ApplicabilityWorkflowError("Enter a rationale before submitting for review.");
  const scopeCount = await prisma.applicabilityAssessmentScope.count({ where: tenantWhere(ctx, { assessmentId: assessment.id }) });
  if (scopeCount === 0) throw new ApplicabilityWorkflowError("Add at least one scope before submitting for review.");
  const evidenceCount = await countEvidence(ctx.organisationId, assessment.id);
  if (evidenceCount === 0) throw new ApplicabilityWorkflowError("Attach at least one piece of evidence before submitting for review.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.applicabilityAssessment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
      data: { status: "IN_REVIEW" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "applicability_assessment.submitted_for_review",
      resourceType: "applicability_assessment",
      resourceId: assessment.id,
      summary: "Applicability assessment submitted for review.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "IN_REVIEW" },
    });
    return updated;
  });
}

export async function decideApplicabilityAssessment(
  context: OrganisationContext,
  assessmentId: string,
  input: DecideApplicabilityAssessmentInput,
) {
  requirePermission(context, "ems.applicability.review");
  if (!isApplicabilityDecision(input.decision)) throw new ApplicabilityWorkflowError("Choose a valid decision.");
  if (!input.rationale.trim()) throw new ApplicabilityWorkflowError("Enter a rationale for the decision.");
  if (!(input.nextReviewAt instanceof Date) || Number.isNaN(input.nextReviewAt.getTime())) {
    throw new ApplicabilityWorkflowError("Enter a valid next-review date.");
  }
  if (input.decision === "UNCERTAIN" && !input.followUpOwnerMembershipId) {
    throw new ApplicabilityWorkflowError("An UNCERTAIN decision requires a follow-up owner.");
  }

  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantApplicabilityAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "IN_REVIEW") throw new ApplicabilityWorkflowError("Only an in-review assessment can be decided.");
  const evidenceCount = await countEvidence(ctx.organisationId, assessment.id);
  if (evidenceCount === 0) throw new ApplicabilityWorkflowError("This assessment has no evidence attached.");

  let followUpOwner: { id: string } | null = null;
  if (input.followUpOwnerMembershipId) {
    followUpOwner = await prisma.organisationMembership.findFirst({
      where: { id: input.followUpOwnerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!followUpOwner) throw new TenantOwnershipError();
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    if (assessment.supersedesAssessmentId) {
      const predecessor = await tx.applicabilityAssessment.findFirst({
        where: tenantWhere(txCtx, { id: assessment.supersedesAssessmentId }),
      });
      if (!predecessor) throw new TenantOwnershipError();
      if (predecessor.status !== "SUPERSEDED") {
        await tx.applicabilityAssessment.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: predecessor.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "applicability_assessment.superseded",
          resourceType: "applicability_assessment",
          resourceId: predecessor.id,
          summary: "Applicability assessment superseded by a new decided assessment.",
          actorUserId: input.actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: predecessor.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const decided = await tx.applicabilityAssessment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
      data: {
        status: input.decision,
        rationale: input.rationale.trim(),
        reviewedByMembershipId: context.membershipId,
        reviewedAt: new Date(),
        nextReviewAt: input.nextReviewAt,
        followUpOwnerMembershipId: input.decision === "UNCERTAIN" ? followUpOwner?.id ?? null : null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "applicability_assessment.decided",
      resourceType: "applicability_assessment",
      resourceId: assessment.id,
      summary: `Applicability assessment decided: ${input.decision}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: input.decision, nextReviewAt: input.nextReviewAt.toISOString() },
    });
    return decided;
  });
}
