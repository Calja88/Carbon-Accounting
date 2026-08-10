/**
 * Ownership primitives shared by every tenant repository (Phase 1 spec §8,
 * task T15). Two complementary mechanisms:
 *
 *  - `tenantWhere` bakes `organisationId` into a Prisma `where` clause so the
 *    tenant filter travels with the query itself, per the spec rule that
 *    scoping must happen in the query, not as a check bolted on afterwards.
 *  - `assertOwned` (and the named wrappers below it) are the defense-in-depth
 *    check applied to whatever a query returns, so a mistake in one call
 *    site can't leak a foreign-tenant row. A missing record and a
 *    foreign-tenant record raise the identical error, so callers can't
 *    distinguish "doesn't exist" from "belongs to someone else".
 *
 * These are intentionally schema-agnostic — they operate on any shape that
 * carries `organisationId`, rather than importing concrete Prisma model
 * types. `Entity`/`Site` don't have that column yet (T10/T11 land it); once
 * they do, domain repositories wire these primitives to real Prisma calls
 * without this module changing.
 */

import type { TenantRepositoryContext } from "./context";

export class TenantOwnershipError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "TenantOwnershipError";
  }
}

interface OrganisationOwned {
  // Nullable: T10/T16 add organisationId to existing tables as an
  // expand-only, not-yet-backfilled column (PHASE1_TENANCY_RBAC_SPEC.md
  // §9). A null value can never equal a real ctx.organisationId, so it is
  // correctly denied by `assertOwned` below rather than requiring every
  // caller to narrow the type first.
  organisationId: string | null;
}

/** Merges the context's organisation into a `where` clause. Always call this when building the query, rather than filtering after the fact. */
export function tenantWhere<W extends Record<string, unknown>>(
  ctx: TenantRepositoryContext,
  where: W,
): W & { organisationId: string } {
  return { ...where, organisationId: ctx.organisationId };
}

/**
 * Defense-in-depth ownership check for a record already loaded by an
 * organisation-scoped query. Throws the same error for "missing" and
 * "belongs to another organisation" so no caller can branch on which one it
 * was.
 */
export function assertOwned<T extends OrganisationOwned>(
  ctx: TenantRepositoryContext,
  record: T | null | undefined,
): T {
  if (!record || record.organisationId !== ctx.organisationId) {
    throw new TenantOwnershipError();
  }
  return record;
}

export function assertAllOwned<T extends OrganisationOwned>(ctx: TenantRepositoryContext, records: T[]): T[] {
  for (const record of records) assertOwned(ctx, record);
  return records;
}

/** Tenant-root check: does this organisation id match the context's organisation? */
export function assertTenantRoot(ctx: TenantRepositoryContext, organisationId: string): void {
  if (organisationId !== ctx.organisationId) {
    throw new TenantOwnershipError();
  }
}

/** Named alias for Entity ownership checks, for call-site clarity and future Entity-specific rules. */
export function assertEntityOwnership<T extends OrganisationOwned>(
  ctx: TenantRepositoryContext,
  entity: T | null | undefined,
): T {
  return assertOwned(ctx, entity);
}

/**
 * Site ownership check. When `expectedEntityId` is supplied, also guards
 * against the nested-parent-substitution attack from the adversarial test
 * matrix: an organisation-owned Site attached to a foreign Entity id.
 */
export function assertSiteOwnership<T extends OrganisationOwned & { entityId: string }>(
  ctx: TenantRepositoryContext,
  site: T | null | undefined,
  expectedEntityId?: string,
): T {
  const owned = assertOwned(ctx, site);
  if (expectedEntityId !== undefined && owned.entityId !== expectedEntityId) {
    throw new TenantOwnershipError();
  }
  return owned;
}

/**
 * Generic child-resource ownership check (activity entries, calculations,
 * report snapshots, LCA nodes, ...). When `expectedParentId`/`parentField`
 * are supplied, also guards against a foreign-tenant child being attached to
 * an in-tenant parent by substituting the parent id.
 */
export function assertChildOwnership<T extends OrganisationOwned>(
  ctx: TenantRepositoryContext,
  record: T | null | undefined,
  expectedParentId?: string,
  parentField?: keyof T,
): T {
  const owned = assertOwned(ctx, record);
  if (expectedParentId !== undefined && parentField !== undefined && owned[parentField] !== expectedParentId) {
    throw new TenantOwnershipError();
  }
  return owned;
}
