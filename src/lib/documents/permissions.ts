/**
 * Authorisation helpers for controlled documents / shared evidence (task
 * T22) — same shape as `src/lib/lca/permissions.ts`: resolve the caller's
 * Organisation context and expose small permission predicates for routes to
 * check before calling into the service layer.
 */

import type { OrganisationContext } from "@/lib/organisation/context";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";
import { hasPermission } from "@/lib/rbac/authorize";

export { OrganisationAccessError };
export type { OrganisationContext };

export function canViewDocuments(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "ems.view");
}

export function canManageControlledDocuments(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "ems.controlled_document.manage");
}

export function canApproveControlledDocuments(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "ems.controlled_document.approve");
}

export function canManageEvidence(context: OrganisationContext | null | undefined): boolean {
  return Boolean(context) && hasPermission(context as OrganisationContext, "ems.evidence.manage");
}

/** Resolved Organisation context, or null when signed out / no accessible organisation. */
export async function getDocumentsContext(): Promise<OrganisationContext | null> {
  try {
    return await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return null;
    throw err;
  }
}
