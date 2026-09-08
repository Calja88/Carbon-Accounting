/**
 * Phase 1 tenancy (T13) — resolve the current Organisation, membership, and
 * granted permissions/scopes from live database state, per
 * PHASE1_TENANCY_RBAC_SPEC.md §7.
 *
 * Never authorise from the legacy `User.role` claim or from a client-supplied
 * organisation ID without checking it against a real, active membership row.
 * `resolveOrganisationContext` always reads fresh — no caching — so a
 * membership suspended or removed after page load takes effect on the very
 * next request.
 */

import type { PermissionCode } from "@/lib/rbac/permission-catalogue";

export type { PermissionCode };

export interface OrganisationContext {
  userId: string;
  membershipId: string;
  organisationId: string;
  organisationSlug: string;
  permissions: ReadonlySet<PermissionCode>;
  access: {
    mode: "ORGANISATION_WIDE" | "RESTRICTED";
    entityIds: ReadonlySet<string>;
    siteIds: ReadonlySet<string>;
  };
  correlationId: string;
}

export type OrganisationAccessErrorReason =
  | "NOT_AUTHENTICATED"
  | "NO_ACTIVE_MEMBERSHIP"
  | "ORGANISATION_NOT_ACCESSIBLE";

export class OrganisationAccessError extends Error {
  readonly reason: OrganisationAccessErrorReason;

  constructor(reason: OrganisationAccessErrorReason) {
    super(`Organisation context unavailable: ${reason}`);
    this.name = "OrganisationAccessError";
    this.reason = reason;
  }
}

/** Minimal row shape this module needs — deliberately narrower than the full Prisma model. */
export interface MembershipContextRow {
  id: string;
  organisationId: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  accessMode: "ORGANISATION_WIDE" | "RESTRICTED";
  lastAccessedAt: Date | null;
  createdAt: Date;
  organisation: { id: string; slug: string; status: "ACTIVE" | "SUSPENDED" | "CLOSED" };
  roles: { role: { isActive: boolean; permissions: { permissionCode: string }[] } }[];
  entityScopes: { entityId: string }[];
  siteScopes: { siteId: string }[];
}

/** The subset of Prisma this resolver depends on, so tests can supply a fake. */
export interface OrganisationContextDb {
  organisationMembership: {
    findMany(args: {
      where: { userId: string; status: "ACTIVE" };
      include: {
        organisation: true;
        roles: { include: { role: { include: { permissions: true } } } };
        entityScopes: true;
        siteScopes: true;
      };
    }): Promise<MembershipContextRow[]>;
  };
}

export interface ResolveOrganisationContextParams {
  userId: string;
  /** Organisation `slug` or `id` requested via cookie/query — never trusted without re-validation. */
  requestedOrganisation?: string | null;
  correlationId?: string;
}

const membershipInclude = {
  organisation: true,
  roles: { include: { role: { include: { permissions: true } } } },
  entityScopes: true,
  siteScopes: true,
} as const;

/** Fetches every currently ACTIVE membership for the user, with grants and scopes. */
export async function loadActiveMemberships(
  db: OrganisationContextDb,
  userId: string,
): Promise<MembershipContextRow[]> {
  return db.organisationMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: membershipInclude,
  });
}

function toContext(membership: MembershipContextRow, correlationId: string): OrganisationContext {
  const permissions = new Set<PermissionCode>();
  for (const { role } of membership.roles) {
    if (!role.isActive) continue;
    for (const grant of role.permissions) {
      permissions.add(grant.permissionCode as PermissionCode);
    }
  }

  return {
    userId: "", // filled by caller — kept out of this pure step to avoid threading it twice
    membershipId: membership.id,
    organisationId: membership.organisationId,
    organisationSlug: membership.organisation.slug,
    permissions,
    access: {
      mode: membership.accessMode,
      entityIds: new Set(membership.entityScopes.map((s) => s.entityId)),
      siteIds: new Set(membership.siteScopes.map((s) => s.siteId)),
    },
    correlationId,
  };
}

/**
 * Resolves the caller's active Organisation context.
 *
 * - No `requestedOrganisation`: picks the most recently accessed active
 *   membership (falling back to most recently created) as the default.
 * - `requestedOrganisation` supplied (from a cookie or explicit switch):
 *   only succeeds if it matches an ACTIVE membership in an ACTIVE
 *   organisation for this user — an inaccessible ID/slug is rejected, never
 *   silently ignored or trusted.
 */
export async function resolveOrganisationContext(
  db: OrganisationContextDb,
  params: ResolveOrganisationContextParams,
): Promise<OrganisationContext> {
  const correlationId = params.correlationId ?? crypto.randomUUID();
  const memberships = await loadActiveMemberships(db, params.userId);
  const accessible = memberships.filter((m) => m.organisation.status === "ACTIVE");

  if (accessible.length === 0) {
    throw new OrganisationAccessError("NO_ACTIVE_MEMBERSHIP");
  }

  let selected: MembershipContextRow;
  if (params.requestedOrganisation) {
    const match = accessible.find(
      (m) =>
        m.organisation.id === params.requestedOrganisation ||
        m.organisation.slug === params.requestedOrganisation,
    );
    if (!match) {
      throw new OrganisationAccessError("ORGANISATION_NOT_ACCESSIBLE");
    }
    selected = match;
  } else {
    selected = [...accessible].sort((a, b) => {
      const aTime = (a.lastAccessedAt ?? a.createdAt).getTime();
      const bTime = (b.lastAccessedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    })[0];
  }

  const context = toContext(selected, correlationId);
  return { ...context, userId: params.userId };
}
