/**
 * Synthetic two-tenant fixtures for Phase 1 tenant-isolation tests, matching
 * the adversarial test matrix (`Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md`).
 * No real environmental data — every value here is fictional.
 */

import { createTenantRepositoryContext, type TenantRepositoryContext } from "@/lib/repositories/context";
import type { OrganisationContext } from "@/lib/organisation/context";

export const ORG_A = "org-aster-demo";
export const ORG_B = "org-birch-demo";

export const ENTITY_A = "entity-aster-manufacturing";
export const ENTITY_B = "entity-birch-services";

export const SITE_A = "site-aster-north";
export const SITE_B = "site-birch-south";

export function makeTenantContext(
  organisationId: string,
  overrides: Partial<Omit<TenantRepositoryContext, "organisationId">> = {},
): TenantRepositoryContext {
  return createTenantRepositoryContext({
    organisationId,
    userId: overrides.userId ?? `user-${organisationId}`,
    correlationId: overrides.correlationId ?? `correlation-${organisationId}`,
  });
}

export const contextA = makeTenantContext(ORG_A);
export const contextB = makeTenantContext(ORG_B);

export const entityA = { id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" };
export const entityB = { id: ENTITY_B, organisationId: ORG_B, name: "Birch Services" };

export const siteA = { id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North" };
export const siteB = { id: SITE_B, organisationId: ORG_B, entityId: ENTITY_B, name: "Birch South" };

/** A synthetic Site A record whose entityId was substituted for Entity B's, simulating the "A organisation + B Entity/Site combination" attack. */
export const siteASubstitutedEntity = { ...siteA, entityId: ENTITY_B };

export const activityEntryA = { id: "entry-a-1", organisationId: ORG_A, siteId: SITE_A, kwh: 100 };
export const activityEntryB = { id: "entry-b-1", organisationId: ORG_B, siteId: SITE_B, kwh: 200 };

/**
 * Request-level `OrganisationContext` fixtures (T13 shape), for tests of the
 * T16 carbon repository/service layer that also need permission/scope
 * checks, not just the narrower `TenantRepositoryContext` above.
 */
export function makeOrganisationContext(
  organisationId: string,
  overrides: Partial<Omit<OrganisationContext, "organisationId">> = {},
): OrganisationContext {
  return {
    userId: overrides.userId ?? `user-${organisationId}`,
    membershipId: overrides.membershipId ?? `membership-${organisationId}`,
    organisationId,
    organisationSlug: overrides.organisationSlug ?? organisationId,
    permissions: overrides.permissions ?? new Set(),
    access: overrides.access ?? { mode: "ORGANISATION_WIDE", entityIds: new Set(), siteIds: new Set() },
    correlationId: overrides.correlationId ?? `correlation-${organisationId}`,
  };
}

/** ORGANISATION_WIDE members of Organisation A/B — every permission granted, for tests that aren't about permission denial itself. */
export const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set([
    "carbon.view",
    "carbon.entry.create",
    "carbon.entry.review",
    "carbon.entry.approve",
    "carbon.contract.manage",
    "carbon.document.manage",
    "carbon.report.generate",
    "carbon.report.export",
  ]) as unknown as OrganisationContext["permissions"],
});
export const orgContextB = makeOrganisationContext(ORG_B, {
  permissions: new Set([
    "carbon.view",
    "carbon.entry.create",
    "carbon.entry.review",
    "carbon.entry.approve",
    "carbon.contract.manage",
    "carbon.document.manage",
    "carbon.report.generate",
    "carbon.report.export",
  ]) as unknown as OrganisationContext["permissions"],
});

/** A RESTRICTED member of Organisation A scoped to Site A only (no Entity-wide grant), for the "Site A1 scope, Entity-wide aggregate contains A1 only" adversarial case. */
export const restrictedOrgContextA = makeOrganisationContext(ORG_A, {
  permissions: orgContextA.permissions,
  access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
});
