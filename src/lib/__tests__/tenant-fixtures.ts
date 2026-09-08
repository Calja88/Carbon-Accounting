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

/**
 * LCA-domain (T17) fixtures — same synthetic Aster/Birch tenants, extended
 * with the product/supplier/assessment/evidence/version rows the LCA
 * adversarial tests (detail/export/version/evidence paths) exercise.
 */
export const lcaOrgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set([
    "lca.view",
    "lca.product.manage",
    "lca.assessment.edit",
    "lca.assessment.calculate",
    "lca.assessment.approve",
    "lca.version.issue",
    "lca.verification.record",
    "lca.methodology.manage",
    "lca.supplier.manage",
    "lca.evidence.manage",
    "lca.export",
  ]) as unknown as OrganisationContext["permissions"],
});
export const lcaOrgContextB = makeOrganisationContext(ORG_B, {
  permissions: lcaOrgContextA.permissions,
});

export const PRODUCT_A = "product-aster-widget";
export const PRODUCT_B = "product-birch-widget";
export const SUPPLIER_A = "supplier-aster-co";
export const SUPPLIER_B = "supplier-birch-co";
export const ASSESSMENT_A = "assessment-aster-1";
export const ASSESSMENT_B = "assessment-birch-1";
export const EVIDENCE_A = "evidence-aster-1";
export const EVIDENCE_B = "evidence-birch-1";
export const VERSION_A = "version-aster-1";
export const VERSION_B = "version-birch-1";
export const SUPPLIER_PCF_A = "supplier-pcf-aster-1";
export const SUPPLIER_PCF_B = "supplier-pcf-birch-1";

export const productA = { id: PRODUCT_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster Widget" };
export const productB = { id: PRODUCT_B, organisationId: ORG_B, entityId: ENTITY_B, name: "Birch Widget" };

export const supplierA = { id: SUPPLIER_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster Co" };
export const supplierB = { id: SUPPLIER_B, organisationId: ORG_B, entityId: ENTITY_B, name: "Birch Co" };

export const assessmentA = { id: ASSESSMENT_A, organisationId: ORG_A, entityId: ENTITY_A, reference: "A-001", status: "DRAFT" };
export const assessmentB = { id: ASSESSMENT_B, organisationId: ORG_B, entityId: ENTITY_B, reference: "B-001", status: "DRAFT" };

export const evidenceA = { id: EVIDENCE_A, organisationId: ORG_A, assessmentId: ASSESSMENT_A, title: "A evidence" };
export const evidenceB = { id: EVIDENCE_B, organisationId: ORG_B, assessmentId: ASSESSMENT_B, title: "B evidence" };

export const assessmentVersionA = { id: VERSION_A, organisationId: ORG_A, assessmentId: ASSESSMENT_A, version: 1 };
export const assessmentVersionB = { id: VERSION_B, organisationId: ORG_B, assessmentId: ASSESSMENT_B, version: 1 };

export const supplierPcfA = { id: SUPPLIER_PCF_A, organisationId: ORG_A, entityId: ENTITY_A, supplierId: SUPPLIER_A, productName: "Aster part" };
export const supplierPcfB = { id: SUPPLIER_PCF_B, organisationId: ORG_B, entityId: ENTITY_B, supplierId: SUPPLIER_B, productName: "Birch part" };

/** A synthetic Evidence A record whose assessmentId was substituted for Assessment B's, simulating "B evidence attached to A assessment" / nested-parent substitution the other way. */
export const evidenceASubstitutedAssessment = { ...evidenceA, assessmentId: ASSESSMENT_B };
