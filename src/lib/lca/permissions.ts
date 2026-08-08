/**
 * Authorisation for the product LCA module.
 *
 * The platform's existing model is role-based across a single consolidated
 * group (Role on User; every signed-in user sees all three operating
 * entities). This module keeps that model rather than inventing a second
 * tenancy scheme: products, suppliers and assessments are *scoped* to an
 * Entity for organisation and reporting, and access is decided by role.
 *
 * Two rules matter beyond role membership, and both are enforced here rather
 * than in each server action:
 *
 *  - an assessment that has been issued or verified is closed to edits, so a
 *    figure a reviewer has seen can never change under them; and
 *  - recording verification is separated from doing the assessment work.
 */

import { LcaAssessmentStatus, Role } from "@prisma/client";
import { auth } from "@/auth";

export interface LcaActor {
  id: string;
  name: string;
  role: Role | string;
}

const EDITORS: string[] = [Role.DATA_OWNER, Role.SUSTAINABILITY_LEAD, Role.ADMIN];
const APPROVERS: string[] = [Role.SUSTAINABILITY_LEAD, Role.ADMIN];

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

/** Anyone signed in can read product assessments. */
export function canViewLca(actor: LcaActor | null | undefined): boolean {
  return Boolean(actor);
}

export function canEditLcaData(actor: LcaActor | null | undefined): boolean {
  return Boolean(actor) && EDITORS.includes(String(actor?.role));
}

export function canApproveLca(actor: LcaActor | null | undefined): boolean {
  return Boolean(actor) && APPROVERS.includes(String(actor?.role));
}

export function canManageMethodology(actor: LcaActor | null | undefined): boolean {
  return canApproveLca(actor);
}

export function canRecordVerification(actor: LcaActor | null | undefined): boolean {
  return canApproveLca(actor);
}

export function canIssueVersion(actor: LcaActor | null | undefined): boolean {
  return canApproveLca(actor);
}

export function canManageSuppliers(actor: LcaActor | null | undefined): boolean {
  return canEditLcaData(actor);
}

export type PermissionResult = { ok: true } | { ok: false; reason: string };

const OK: PermissionResult = { ok: true };

/**
 * The check every mutating server action in this module runs first: right
 * role, and an assessment that is still open.
 */
export function checkCanEditAssessment(
  actor: LcaActor | null | undefined,
  status: LcaAssessmentStatus,
): PermissionResult {
  if (!actor) return { ok: false, reason: "You must be signed in." };
  if (!canEditLcaData(actor)) {
    return { ok: false, reason: "Your role does not allow changes to product assessments." };
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

export function checkCanApprove(actor: LcaActor | null | undefined): PermissionResult {
  if (!actor) return { ok: false, reason: "You must be signed in." };
  if (!canApproveLca(actor)) {
    return { ok: false, reason: "Only a sustainability lead or an administrator can do this." };
  }
  return OK;
}

/** Session -> actor, or null when signed out. */
export async function getLcaActor(): Promise<LcaActor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "Unknown user",
    role: session.user.role,
  };
}

export const ROLE_CAPABILITY_SUMMARY: { role: Role; can: string[] }[] = [
  { role: Role.DATA_OWNER, can: ["Create and edit products, assessments, inventory and evidence", "Run calculations", "Record assumptions and exclusions"] },
  { role: Role.SUSTAINABILITY_LEAD, can: ["Everything a data owner can do", "Approve register entries", "Move an assessment through its status workflow", "Issue versions", "Record verification"] },
  { role: Role.FINANCE, can: ["Read assessments, results and reports"] },
  { role: Role.ADMIN, can: ["Everything, plus emission factor library administration"] },
];
