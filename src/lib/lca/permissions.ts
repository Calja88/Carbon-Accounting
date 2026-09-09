/**
 * Authorisation for the product LCA module.
 *
 * Phase 1 tenancy (T17): this module used to decide access from the
 * signed-in user's single global `Role` claim. It now delegates every grant
 * decision to the Phase 1 permission service (T14) against the caller's
 * resolved `OrganisationContext` (T13) — never the legacy JWT role — per
 * PHASE1_FILE_REFACTOR_MAP.md's Batch A row for this file: "Delegate to
 * permission service and organisation scope; preserve locked-status logic."
 *
 * Two rules matter beyond permission grants, and both are enforced here
 * rather than in each server action, unchanged from before:
 *
 *  - an assessment that has been issued or verified is closed to edits, so a
 *    figure a reviewer has seen can never change under them; and
 *  - recording verification is separated from doing the assessment work.
 */

import { LcaAssessmentStatus } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";
import { hasPermission } from "@/lib/rbac/authorize";

export { OrganisationAccessError };
export type { OrganisationContext };

/** Statuses in which the assessment's data may still be changed. */
const OPEN_STATUSES: LcaAssessmentStatus[] = [
  LcaAssessmentStatus.DRAFT,
  LcaAssessmentStatus.DATA_COLLECTION,
  LcaAssessmentStatus.CALCULATION,
  LcaAssessmentStatus.INTERNAL_REVIEW,
];

export function isAssessmentOpenForEditing(status: LcaAssessmentStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function canViewLca(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.view");
}

export function canEditLcaData(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.assessment.edit");
}

export function canCalculateLca(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.assessment.calculate");
}

export function canApproveLca(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.assessment.approve");
}

export function canManageProducts(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.product.manage");
}

export function canManageMethodology(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.methodology.manage");
}

export function canRecordVerification(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.verification.record");
}

export function canIssueVersion(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.version.issue");
}

export function canManageSuppliers(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.supplier.manage");
}

export function canManageEvidence(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.evidence.manage");
}

export function canExportLca(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "lca.export");
}

export type PermissionResult = { ok: true } | { ok: false; reason: string };

const OK: PermissionResult = { ok: true };

/**
 * The check every mutating server action in this module runs first: the
 * caller's Organisation grants `lca.assessment.edit`, and the assessment is
 * still open.
 */
export function checkCanEditAssessment(
  context: OrganisationContext | null | undefined,
  status: LcaAssessmentStatus,
): PermissionResult {
  if (!context) return { ok: false, reason: "You must be signed in." };
  if (!canEditLcaData(context)) {
    return { ok: false, reason: "Your permissions do not allow changes to product assessments." };
  }
  if (!isAssessmentOpenForEditing(status)) {
    return {
      ok: false,
      reason:
        status === LcaAssessmentStatus.SUPERSEDED
          ? "This assessment has been superseded by a later version and is read-only. Open the current version to make changes."
          : "This assessment is locked because it has been issued for verification or verified. Create a new revision to make changes.",
    };
  }
  return OK;
}

export function checkCanApprove(context: OrganisationContext | null | undefined): PermissionResult {
  if (!context) return { ok: false, reason: "You must be signed in." };
  if (!canApproveLca(context)) {
    return { ok: false, reason: "Your permissions do not allow approving product assessments." };
  }
  return OK;
}

/** Resolved Organisation context, or null when signed out / no accessible organisation — the LCA-module equivalent of the old session-based `getLcaActor`. */
export async function getLcaContext(): Promise<OrganisationContext | null> {
  try {
    return await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return null;
    throw err;
  }
}

export const ROLE_CAPABILITY_SUMMARY: { permission: string; can: string[] }[] = [
  { permission: "lca.assessment.edit", can: ["Create and edit products, assessments, inventory and evidence", "Record assumptions and exclusions"] },
  { permission: "lca.assessment.calculate", can: ["Run LCA calculations"] },
  { permission: "lca.assessment.approve", can: ["Approve register entries", "Move an assessment through its status workflow"] },
  { permission: "lca.version.issue", can: ["Issue an immutable assessment version"] },
  { permission: "lca.verification.record", can: ["Record third-party verification of a result"] },
  { permission: "lca.view", can: ["Read assessments, results and reports"] },
  { permission: "lca.export", can: ["Export LCA results and reports"] },
];
