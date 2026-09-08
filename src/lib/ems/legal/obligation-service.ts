/**
 * Compliance obligation versioning and approval (task T44,
 * Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §§1-2,5,9). Turns a T43 `APPLICABLE`
 * `ApplicabilityAssessment` into a versioned, organisation-owned
 * `ComplianceObligation` whose content only ever becomes authoritative
 * through an explicit, permission-checked, audited approval.
 *
 * Fixed decisions this module enforces (spec §§1,9):
 *  - `ems.compliance_obligation.edit` drafts/edits/submits a version and
 *    records obligation-change-review impact assessments; only
 *    `ems.compliance_obligation.approve` can move a version out of
 *    IN_REVIEW (approve/reject/return) or retire an ACTIVE version — there
 *    is no function either permission can call to skip straight from
 *    DRAFT to ACTIVE;
 *  - approval always re-checks the *current*, live-resolved
 *    `OrganisationContext.permissions` (never a cached/stale grant), so a
 *    revoked/suspended approver is denied even mid-session (spec §9
 *    "revoked/suspended approver denied after page load");
 *  - self-approval is denied whenever `fourEyesEnabled` (default `true`,
 *    the same interim decision T22/T23 made pending an organisation-level
 *    toggle) is on — `approveComplianceObligationVersion` compares the
 *    approving user against the version's `preparedByUserId`;
 *  - a version that has left DRAFT/IN_REVIEW is never edited in place: the
 *    migration's `compliance_obligation_version_immutable_once_approved`
 *    trigger is defence-in-depth for that rule (T22's exact pattern).
 *    Changing an obligation's content once approved only ever happens by
 *    `createSuccessorComplianceObligationVersion`, which links back via
 *    `supersedesVersionId` and leaves the predecessor's row untouched;
 *  - the `ComplianceObligation.activeVersionId` pointer only ever moves
 *    inside `approveComplianceObligationVersion` (a new ACTIVE version
 *    superseding the previous one) or `retireComplianceObligationVersion`
 *    (clearing it) — no other function in this module writes that column;
 *  - `createComplianceObligation` requires an `APPLICABLE` assessment
 *    (spec §9 "create obligations from applicable sources") and
 *    `recordObligationChangeReview` never itself edits an obligation
 *    version — a human still has to act on its NO_CHANGE/REVISE/RETIRE/
 *    SEEK_ADVICE decision through the normal edit/successor/retire
 *    functions, so a `LegalChangeEvent` never directly changes an active
 *    obligation (spec §9 "source event does not create active obligation
 *    or change evaluation status");
 *  - only a resolved, permission-checked `OrganisationContext` can reach
 *    any exported function here — there is no AI-callable entry point in
 *    this module, so "AI cannot set decision" holds architecturally.
 *
 * T46 extension: `createComplianceObligation`/`createSuccessorComplianceObligationVersion`
 * copy whichever one of `instrumentId`/`otherRequirementSourceId` is set on
 * the source `ApplicabilityAssessment` — a T46 manual source (permit,
 * consent, regulator notice, contract, customer requirement, voluntary
 * commitment) goes through this exact same versioning/approval state
 * machine as a `LegalInstrument`, unmodified.
 */

import type { ComplianceObligationVersionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantComplianceObligation,
  findTenantComplianceObligationVersion,
  findTenantOperationalControl,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class ComplianceObligationError extends Error {}

const APPROVE_PERMISSION = "ems.compliance_obligation.approve" as const;
const EDIT_PERMISSION = "ems.compliance_obligation.edit" as const;

export interface ObligationScopeInput {
  entityId?: string | null;
  siteId?: string | null;
  aspectId?: string | null;
}

export interface ComplianceObligationDraftFields {
  title: string;
  requirementSummary: string;
  provisionReferenceId?: string | null;
  ownerMembershipId: string;
  frequency?: string | null;
  triggerDescription?: string | null;
  effectiveFrom?: Date | null;
  reviewDueDate?: Date | null;
  scopes: ObligationScopeInput[];
  controlIds: string[];
}

export interface CreateComplianceObligationInput extends ComplianceObligationDraftFields {
  applicabilityAssessmentId: string;
  actorUserId: string;
}

export interface UpdateComplianceObligationVersionDraftInput extends ComplianceObligationDraftFields {
  actorUserId: string;
}

export interface CreateSuccessorObligationVersionInput extends ComplianceObligationDraftFields {
  applicabilityAssessmentId: string;
  actorUserId: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const versionListInclude = {
  instrument: { select: { title: true } },
  otherRequirementSource: { select: { title: true, type: true } },
  owner: { include: { user: { select: { name: true } } } },
  scopes: {
    include: {
      entity: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      aspect: { select: { id: true, name: true } },
    },
  },
  approvals: { orderBy: { decidedAt: "desc" as const } },
  controlLinks: { include: { control: { select: { id: true, title: true, controlKey: true, version: true } } } },
} as const;

export async function listComplianceObligations(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.complianceObligation.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      activeVersion: true,
      versions: { orderBy: { version: "desc" }, include: versionListInclude },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getComplianceObligationVersion(context: OrganisationContext, versionId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.complianceObligationVersion.findUnique({
    where: { id: version.id },
    include: {
      obligation: true,
      instrument: true,
      otherRequirementSource: true,
      provisionReference: true,
      applicabilityAssessment: true,
      scopes: {
        include: {
          entity: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          aspect: { select: { id: true, name: true } },
        },
      },
      controlLinks: { include: { control: { select: { id: true, title: true, controlKey: true, version: true } } } },
      approvals: { orderBy: { decidedAt: "desc" } },
      changeReviews: { orderBy: { reviewedAt: "desc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Draft-content validation shared by create/edit/successor
// ---------------------------------------------------------------------------

async function validateScopes(context: OrganisationContext, scopes: ObligationScopeInput[]) {
  const ctx = toTenantRepositoryContext(context);
  const validated: ObligationScopeInput[] = [];
  for (const scope of scopes) {
    const entityId = scope.entityId || null;
    const siteId = scope.siteId || null;
    const aspectId = scope.aspectId || null;
    const setCount = [entityId, siteId, aspectId].filter(Boolean).length;
    if (setCount !== 1) {
      throw new ComplianceObligationError("Each scope row must identify exactly one entity, site, or aspect.");
    }

    if (entityId) {
      assertEntityAccess(context, entityId);
      const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: entityId }), select: { id: true } });
      if (!entity) throw new TenantOwnershipError();
    } else if (siteId) {
      assertSiteAccess(context, siteId);
      const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: siteId }), select: { id: true } });
      if (!site) throw new TenantOwnershipError();
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

    validated.push({ entityId, siteId, aspectId });
  }
  return validated;
}

async function validateControls(context: OrganisationContext, controlIds: string[]) {
  const ctx = toTenantRepositoryContext(context);
  const unique = Array.from(new Set(controlIds));
  for (const controlId of unique) {
    const control = await findTenantOperationalControl(ctx, controlId);
    if (!control) throw new TenantOwnershipError();
  }
  return unique;
}

async function validateOwner(context: OrganisationContext, ownerMembershipId: string) {
  const owner = await prisma.organisationMembership.findFirst({
    where: { id: ownerMembershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Loads a decided applicability assessment this organisation may create an obligation from. Read-only; never creates or edits the assessment. */
async function loadApplicableAssessment(ctx: ReturnType<typeof toTenantRepositoryContext>, applicabilityAssessmentId: string) {
  const assessment = await prisma.applicabilityAssessment.findFirst({ where: tenantWhere(ctx, { id: applicabilityAssessmentId }) });
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "APPLICABLE") {
    throw new ComplianceObligationError("Only an APPLICABLE assessment can source a compliance obligation.");
  }
  return assessment;
}

function assertRequirementFields(fields: Pick<ComplianceObligationDraftFields, "title" | "requirementSummary">) {
  if (!fields.title.trim()) throw new ComplianceObligationError("Enter a title.");
  if (!fields.requirementSummary.trim()) throw new ComplianceObligationError("Enter a requirement summary.");
}

/** Creates a new `ComplianceObligation` with its first DRAFT version, sourced from an APPLICABLE assessment. */
export async function createComplianceObligation(context: OrganisationContext, input: CreateComplianceObligationInput) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequirementFields(input);
  const ctx = toTenantRepositoryContext(context);
  const assessment = await loadApplicableAssessment(ctx, input.applicabilityAssessmentId);
  await validateOwner(context, input.ownerMembershipId);
  const scopes = await validateScopes(context, input.scopes);
  const controlIds = await validateControls(context, input.controlIds);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const obligation = await tx.complianceObligation.create({
      data: { organisationId: txCtx.organisationId },
    });

    const version = await tx.complianceObligationVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        obligationId: obligation.id,
        version: 1,
        title: input.title.trim(),
        requirementSummary: input.requirementSummary.trim(),
        instrumentId: assessment.instrumentId,
        otherRequirementSourceId: assessment.otherRequirementSourceId,
        provisionReferenceId: input.provisionReferenceId || null,
        applicabilityAssessmentId: assessment.id,
        ownerMembershipId: input.ownerMembershipId,
        frequency: input.frequency || null,
        triggerDescription: input.triggerDescription || null,
        effectiveFrom: input.effectiveFrom ?? null,
        reviewDueDate: input.reviewDueDate ?? null,
        preparedByUserId: input.actorUserId,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
        controlLinks: { create: controlIds.map((controlId) => ({ organisationId: txCtx.organisationId, controlId })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.created",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: `Compliance obligation drafted from applicable assessment ${assessment.id}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { obligationId: obligation.id, applicabilityAssessmentId: assessment.id, title: input.title },
    });

    return { obligation, version };
  });
}

// ---------------------------------------------------------------------------
// Draft editing (DRAFT only)
// ---------------------------------------------------------------------------

export async function updateComplianceObligationVersionDraft(
  context: OrganisationContext,
  versionId: string,
  input: UpdateComplianceObligationVersionDraftInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequirementFields(input);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ComplianceObligationError("Only a draft version can be edited.");
  await validateOwner(context, input.ownerMembershipId);
  const scopes = await validateScopes(context, input.scopes);
  const controlIds = await validateControls(context, input.controlIds);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.complianceObligationVersionScope.deleteMany({ where: tenantWhere(txCtx, { obligationVersionId: version.id }) });
    await tx.complianceObligationVersionControl.deleteMany({ where: tenantWhere(txCtx, { obligationVersionId: version.id }) });

    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: {
        title: input.title.trim(),
        requirementSummary: input.requirementSummary.trim(),
        provisionReferenceId: input.provisionReferenceId || null,
        ownerMembershipId: input.ownerMembershipId,
        frequency: input.frequency || null,
        triggerDescription: input.triggerDescription || null,
        effectiveFrom: input.effectiveFrom ?? null,
        reviewDueDate: input.reviewDueDate ?? null,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
        controlLinks: { create: controlIds.map((controlId) => ({ organisationId: txCtx.organisationId, controlId })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.created",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Draft compliance obligation version updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { title: input.title },
    });

    return updated;
  });
}

export async function submitComplianceObligationVersionForReview(context: OrganisationContext, versionId: string, actorUserId: string) {
  requirePermission(context, EDIT_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ComplianceObligationError("Only a draft version can be submitted for review.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "IN_REVIEW" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.submitted_for_review",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Compliance obligation version submitted for review.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "IN_REVIEW" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approval transaction — the only place the active-version pointer moves.
// ---------------------------------------------------------------------------

export interface DecideComplianceObligationVersionInput {
  actorUserId: string;
  comment?: string | null;
  /** Whether four-eyes (the drafting user cannot also approve) is enforced. Defaults to enabled — no organisation-level toggle exists yet (T14 note), the same interim decision T22/T23 made. */
  fourEyesEnabled?: boolean;
}

async function recordApprovalDecision(
  tx: Prisma.TransactionClient,
  txCtx: ReturnType<typeof toTenantRepositoryContext>,
  versionId: string,
  decision: "APPROVED" | "REJECTED" | "RETURNED",
  approverMembershipId: string,
  input: DecideComplianceObligationVersionInput,
) {
  await tx.complianceObligationApproval.create({
    data: {
      organisationId: txCtx.organisationId,
      obligationVersionId: versionId,
      decision,
      permissionCode: APPROVE_PERMISSION,
      comment: input.comment || null,
      approverMembershipId,
    },
  });
}

/**
 * Approves an IN_REVIEW version, moves it (and the obligation's active
 * pointer) straight to ACTIVE, and supersedes whatever version was
 * previously ACTIVE for this obligation — all in one transaction, so the
 * pointer never has an intermediate resting state. `APPROVED` remains a
 * defined status for spec fidelity even though this module never leaves a
 * version resting there.
 */
export async function approveComplianceObligationVersion(
  context: OrganisationContext,
  versionId: string,
  input: DecideComplianceObligationVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ComplianceObligationError("Only an in-review version can be approved.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: version.preparedByUserId,
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const obligation = await tx.complianceObligation.findFirst({ where: tenantWhere(txCtx, { id: version.obligationId }) });
    if (!obligation) throw new TenantOwnershipError();

    if (obligation.activeVersionId && obligation.activeVersionId !== version.id) {
      const previousActive = await tx.complianceObligationVersion.findFirst({
        where: tenantWhere(txCtx, { id: obligation.activeVersionId }),
      });
      if (previousActive) {
        await tx.complianceObligationVersion.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousActive.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "compliance_obligation_version.superseded",
          resourceType: "compliance_obligation_version",
          resourceId: previousActive.id,
          summary: "Compliance obligation version superseded by a newly approved version.",
          actorUserId: input.actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: previousActive.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "ACTIVE", approvedByUserId: input.actorUserId, approvedAt: new Date() },
    });

    await tx.complianceObligation.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: obligation.id } },
      data: { activeVersionId: version.id },
    });

    await recordApprovalDecision(tx, txCtx, version.id, "APPROVED", context.membershipId, input);

    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.approved",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Compliance obligation version approved and made active.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "ACTIVE" },
    });

    return updated;
  });
}

export async function rejectComplianceObligationVersion(
  context: OrganisationContext,
  versionId: string,
  input: DecideComplianceObligationVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ComplianceObligationError("Only an in-review version can be rejected.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: version.preparedByUserId,
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "REJECTED" },
    });
    await recordApprovalDecision(tx, txCtx, version.id, "REJECTED", context.membershipId, input);
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.rejected",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Compliance obligation version rejected.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "REJECTED" },
    });
    return updated;
  });
}

export async function returnComplianceObligationVersionForRevision(
  context: OrganisationContext,
  versionId: string,
  input: DecideComplianceObligationVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ComplianceObligationError("Only an in-review version can be returned for revision.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "DRAFT" },
    });
    await recordApprovalDecision(tx, txCtx, version.id, "RETURNED", context.membershipId, input);
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.returned",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Compliance obligation version returned for revision.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "DRAFT" },
    });
    return updated;
  });
}

export interface RetireComplianceObligationVersionInput {
  actorUserId: string;
  comment?: string | null;
}

/** Retires an ACTIVE version — the obligation no longer applies. Clears the obligation's active pointer; it is not automatically replaced. */
export async function retireComplianceObligationVersion(
  context: OrganisationContext,
  versionId: string,
  input: RetireComplianceObligationVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "ACTIVE") throw new ComplianceObligationError("Only an active version can be retired.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceObligationVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "RETIRED" },
    });
    await tx.complianceObligation.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.obligationId } },
      data: { activeVersionId: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.retired",
      resourceType: "compliance_obligation_version",
      resourceId: version.id,
      summary: "Compliance obligation version retired.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: "RETIRED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor versions — the only path to changing an approved/active/
// superseded/retired/rejected obligation's content.
// ---------------------------------------------------------------------------

export async function createSuccessorComplianceObligationVersion(
  context: OrganisationContext,
  obligationId: string,
  input: CreateSuccessorObligationVersionInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequirementFields(input);
  const ctx = toTenantRepositoryContext(context);
  const obligation = await findTenantComplianceObligation(ctx, obligationId);
  if (!obligation) throw new TenantOwnershipError();
  const assessment = await loadApplicableAssessment(ctx, input.applicabilityAssessmentId);
  await validateOwner(context, input.ownerMembershipId);
  const scopes = await validateScopes(context, input.scopes);
  const controlIds = await validateControls(context, input.controlIds);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.complianceObligationVersion.findFirst({
      where: tenantWhere(txCtx, { obligationId: obligation.id }),
      orderBy: { version: "desc" },
    });
    if (!latest) throw new ComplianceObligationError("Obligation has no versions to replace.");
    if (latest.status === "DRAFT" || latest.status === "IN_REVIEW") {
      throw new ComplianceObligationError(
        `Version ${latest.version} is still ${latest.status} — edit it directly instead of creating a successor.`,
      );
    }

    const successor = await tx.complianceObligationVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        obligationId: obligation.id,
        version: latest.version + 1,
        title: input.title.trim(),
        requirementSummary: input.requirementSummary.trim(),
        instrumentId: assessment.instrumentId,
        otherRequirementSourceId: assessment.otherRequirementSourceId,
        provisionReferenceId: input.provisionReferenceId || null,
        applicabilityAssessmentId: assessment.id,
        ownerMembershipId: input.ownerMembershipId,
        frequency: input.frequency || null,
        triggerDescription: input.triggerDescription || null,
        effectiveFrom: input.effectiveFrom ?? null,
        reviewDueDate: input.reviewDueDate ?? null,
        preparedByUserId: input.actorUserId,
        supersedesVersionId: latest.id,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
        controlLinks: { create: controlIds.map((controlId) => ({ organisationId: txCtx.organisationId, controlId })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_obligation_version.created",
      resourceType: "compliance_obligation_version",
      resourceId: successor.id,
      summary: `Successor version ${successor.version} created, replacing version ${latest.version}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { version: successor.version, supersedesVersionId: latest.id },
    });

    return successor;
  });
}

// ---------------------------------------------------------------------------
// Obligation-change review — the review candidate an upstream amendment
// opens. Never itself edits an obligation version (spec §1/§9).
// ---------------------------------------------------------------------------

export interface RecordObligationChangeReviewInput {
  changeEventId: string;
  obligationVersionId: string;
  impactAssessment: string;
  decision?: "NO_CHANGE" | "REVISE" | "RETIRE" | "SEEK_ADVICE" | null;
  followUpDate?: Date | null;
  actorUserId: string;
}

export async function recordObligationChangeReview(context: OrganisationContext, input: RecordObligationChangeReviewInput) {
  requirePermission(context, EDIT_PERMISSION);
  if (!input.impactAssessment.trim()) throw new ComplianceObligationError("Enter an impact assessment.");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantComplianceObligationVersion(ctx, input.obligationVersionId);
  if (!version) throw new TenantOwnershipError();
  const changeEvent = await prisma.legalChangeEvent.findUnique({ where: { id: input.changeEventId } });
  if (!changeEvent) throw new ComplianceObligationError("Unknown legal change event.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const review = await tx.obligationChangeReview.create({
      data: {
        organisationId: txCtx.organisationId,
        changeEventId: input.changeEventId,
        obligationVersionId: version.id,
        impactAssessment: input.impactAssessment.trim(),
        decision: input.decision ?? null,
        followUpDate: input.followUpDate ?? null,
        reviewerMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "obligation_change_review.recorded",
      resourceType: "obligation_change_review",
      resourceId: review.id,
      summary: `Obligation change review recorded for version ${version.id}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { changeEventId: input.changeEventId, decision: input.decision ?? null },
    });
    return review;
  });
}

export type { ComplianceObligationVersionStatus };
