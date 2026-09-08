/**
 * Phase 1 RBAC (T14) permission evaluation service —
 * PHASE1_TENANCY_RBAC_SPEC.md §7 (`requirePermission`, `assertEntityAccess`,
 * `assertSiteAccess`) plus the optional four-eyes evaluation named in the
 * T14 task packet.
 *
 * Deny by default: every check starts from "no" and only a positive match
 * in the already-resolved `OrganisationContext` (T13 — live DB membership,
 * never the legacy `User.role` claim) grants access. Nothing here queries
 * the database; callers pass the context resolved for the current request.
 *
 * Entity/Site scope: an `OrganisationContext.access` restriction is a
 * membership-level grant on top of whatever the role's `permissions` allow.
 * `assertEntityAccess`/`assertSiteAccess` check `access.entityIds`/`siteIds`
 * directly against the id passed in — they do not infer entity membership
 * from a site or vice versa, matching the spec §7 signatures (each takes
 * only the one id it scopes). A caller with a resource that carries both an
 * entityId and a siteId should check the one matching how that resource is
 * scoped in its own tenant-ownership model, or both if it is scoped by both.
 */

import type { OrganisationContext, PermissionCode } from "@/lib/organisation/context";
import { isKnownPermissionCode } from "@/lib/rbac/permission-catalogue";

export type PermissionDeniedReason =
  | "MISSING_PERMISSION"
  | "ENTITY_NOT_IN_SCOPE"
  | "SITE_NOT_IN_SCOPE"
  | "FOUR_EYES_SELF_APPROVAL";

export class PermissionDeniedError extends Error {
  readonly reason: PermissionDeniedReason;

  constructor(reason: PermissionDeniedReason) {
    super(`Permission denied: ${reason}`);
    this.name = "PermissionDeniedError";
    this.reason = reason;
  }
}

function assertKnownPermissionCode(permission: string): asserts permission is PermissionCode {
  if (!isKnownPermissionCode(permission)) {
    throw new Error(`Unknown permission code: ${permission}`);
  }
}

/** True only if the current membership's resolved grants include this exact code. */
export function hasPermission(context: OrganisationContext, permission: PermissionCode): boolean {
  assertKnownPermissionCode(permission);
  return context.permissions.has(permission);
}

export function requirePermission(context: OrganisationContext, permission: PermissionCode): void {
  if (!hasPermission(context, permission)) {
    throw new PermissionDeniedError("MISSING_PERMISSION");
  }
}

/** Organisation-wide access passes for any entity; a restricted membership must hold this entity explicitly. */
export function hasEntityAccess(context: OrganisationContext, entityId: string): boolean {
  if (context.access.mode === "ORGANISATION_WIDE") return true;
  return context.access.entityIds.has(entityId);
}

export function assertEntityAccess(context: OrganisationContext, entityId: string): void {
  if (!hasEntityAccess(context, entityId)) {
    throw new PermissionDeniedError("ENTITY_NOT_IN_SCOPE");
  }
}

/** Organisation-wide access passes for any site; a restricted membership must hold this site explicitly. */
export function hasSiteAccess(context: OrganisationContext, siteId: string): boolean {
  if (context.access.mode === "ORGANISATION_WIDE") return true;
  return context.access.siteIds.has(siteId);
}

export function assertSiteAccess(context: OrganisationContext, siteId: string): void {
  if (!hasSiteAccess(context, siteId)) {
    throw new PermissionDeniedError("SITE_NOT_IN_SCOPE");
  }
}

export interface FourEyesCheck {
  /** The organisation's current four-eyes toggle for this record type — not stored by T14; the caller supplies it. */
  enabled: boolean;
  actorUserId: string;
  /** The user who authored/submitted the record now being approved. */
  authorUserId: string;
}

/** When four-eyes is enabled, the author of a record may not also be its approver. */
export function passesFourEyes(check: FourEyesCheck): boolean {
  if (!check.enabled) return true;
  return check.actorUserId !== check.authorUserId;
}

export function assertFourEyes(check: FourEyesCheck): void {
  if (!passesFourEyes(check)) {
    throw new PermissionDeniedError("FOUR_EYES_SELF_APPROVAL");
  }
}
