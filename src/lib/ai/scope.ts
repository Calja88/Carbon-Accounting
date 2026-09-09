/**
 * The data scope an AI request is allowed to touch, and the predicates that
 * enforce it.
 *
 * Split out from `authorization.ts` deliberately: that module reads the
 * session (and therefore pulls in the auth stack), while the rules that
 * decide whether a site is inside a scope are pure. Keeping them here means
 * the enforcement itself can be unit-tested directly, with a deliberately
 * narrowed scope, without a session, a database or a network.
 *
 * Nothing here consults a model, and no scope is ever derived from something
 * a prompt said.
 */

export interface AiActor {
  userId: string;
  name: string;
  /**
   * The Organisation this actor is currently acting within (Phase 1 tenancy,
   * T18). Every AI query that reads or writes tenant-owned data — documents,
   * factor sets, interaction/suggestion audit rows, LCA assessments — must
   * scope on this id in the query itself, not filter afterwards. `entityIds`/
   * `siteIds` below are already resolved within this one Organisation; they
   * are never a substitute for checking `organisationId` directly on a
   * record fetched by id, because an entity/site id alone does not prove
   * which tenant it belongs to.
   */
  organisationId: string;
  /** Carried from the resolved OrganisationContext for audit/log tracing. */
  correlationId: string;
  /** Entities this actor may read. Every AI context query filters on it. */
  entityIds: string[];
  /** Sites this actor may read. */
  siteIds: string[];
}

export class AiAuthorizationError extends Error {
  constructor(message = "You don't have access to that.") {
    super(message);
    this.name = "AiAuthorizationError";
  }
}

export function isSiteInScope(actor: AiActor, siteId: string): boolean {
  return actor.siteIds.includes(siteId);
}

export function assertSiteInScope(actor: AiActor, siteId: string): void {
  if (!isSiteInScope(actor, siteId)) {
    throw new AiAuthorizationError("That site isn't available to you.");
  }
}

export function isEntityInScope(actor: AiActor, entityId: string | null): boolean {
  // A record with no entity is group-level: visible to anyone who can see any
  // entity at all, and to nobody with an empty scope.
  if (entityId === null) return actor.entityIds.length > 0;
  return actor.entityIds.includes(entityId);
}

export function assertEntityInScope(actor: AiActor, entityId: string | null): void {
  if (!isEntityInScope(actor, entityId)) {
    throw new AiAuthorizationError("That isn't available to you.");
  }
}

/** Narrows an actor's scope to a single site, for site-specific features. */
export function scopedToSite(actor: AiActor, siteId: string): AiActor {
  assertSiteInScope(actor, siteId);
  return { ...actor, siteIds: [siteId] };
}

/**
 * Filters any collection of site-tagged records down to the actor's scope.
 * Used on aggregation output before it is put in front of a model, so the
 * filter is applied to data rather than left to the prompt to respect.
 */
export function filterToScope<T extends { siteId: string }>(actor: AiActor, records: T[]): T[] {
  const allowed = new Set(actor.siteIds);
  return records.filter((r) => allowed.has(r.siteId));
}
