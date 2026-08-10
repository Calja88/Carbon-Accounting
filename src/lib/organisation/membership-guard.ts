/**
 * Phase 1 tenancy (T19) — the membership/role administration UI must never
 * leave an Organisation with zero members able to manage roles, per
 * PHASE1_TENANCY_RBAC_SPEC.md §1's adversarial-matrix requirement: "Last
 * role-management principal removal: blocked or explicit audited recovery
 * workflow."
 *
 * This module is pure and DB-agnostic: the caller (an admin action) loads
 * the organisation's current active memberships and their resolved
 * permission grants, computes what the membership set would look like
 * *after* the change it's about to make, and asks `assertRoleManagerCoverageRemains`
 * whether that projection still has a survivor. Keeping the projection at
 * the call site — rather than this module querying Prisma itself — makes it
 * usable for every kind of change that could zero out coverage: suspending
 * or removing a membership, unassigning a role from one, or revoking
 * `organisation.role.manage` from a role itself.
 *
 * "Explicit recovery path" is realised here as a hard block with a message
 * telling the admin to grant role-management to someone else first — not a
 * bypassable confirmation checkbox. There is deliberately no override flag.
 */

export const ROLE_MANAGEMENT_PERMISSION = "organisation.role.manage";

export interface RoleManagerCandidate {
  membershipId: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  permissionCodes: ReadonlySet<string>;
}

export class LastRoleManagerError extends Error {
  constructor() {
    super(
      "This is the last membership able to manage roles for this organisation. " +
        "Grant role management to another active member before changing this one.",
    );
    this.name = "LastRoleManagerError";
  }
}

export function isRoleManager(candidate: RoleManagerCandidate): boolean {
  return candidate.status === "ACTIVE" && candidate.permissionCodes.has(ROLE_MANAGEMENT_PERMISSION);
}

export function countActiveRoleManagers(candidates: readonly RoleManagerCandidate[]): number {
  return candidates.filter(isRoleManager).length;
}

/**
 * Pass the membership list as it would read *after* the pending change
 * (removed membership dropped from the array, or its `permissionCodes`
 * recomputed without the grant being revoked). Throws `LastRoleManagerError`
 * if that projection has no one left who can manage roles.
 */
export function assertRoleManagerCoverageRemains(
  projectedCandidates: readonly RoleManagerCandidate[],
): void {
  if (countActiveRoleManagers(projectedCandidates) === 0) {
    throw new LastRoleManagerError();
  }
}
