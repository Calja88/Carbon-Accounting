/**
 * Person profiles (task T70, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §§1,3,6). Depends on T23 (EmsProgramme/context foundation) and T33
 * (OperationalControl), both already on this branch.
 *
 * Fixed decisions this module enforces (spec §1, T70 acceptance):
 *  - a `PersonProfile` links a login identity (`OrganisationMembership`) via
 *    `membershipId` only — it never copies the membership's name/email onto
 *    its own row ("login identity and person profile are linked, not
 *    duplicated"); a person without a membership (contractor/other) carries
 *    its own `displayName` instead;
 *  - restricted contact detail (email/phone/notes) lives in a separate
 *    `PersonSensitiveProfile` row. Writing it only requires
 *    `ems.competence.manage` (the same permission that manages the rest of
 *    the record), but reading it back requires the additional
 *    `ems.competence.sensitive.view` permission — `getPersonProfile` never
 *    includes it; only `getPersonSensitiveProfile` does, and that function
 *    denies without the extra grant. Mirrors the T62
 *    `ems.incident.restricted.view` read-gate pattern exactly;
 *  - `listPersonProfiles` applies the same RESTRICTED-membership
 *    Entity/Site visibility rule as `accessibleSiteFilter` (T16): an
 *    ORGANISATION_WIDE member sees every person, a RESTRICTED member sees
 *    only persons scoped to an Entity/Site they are granted, and a person
 *    with no Entity/Site (organisation-wide) is invisible to a RESTRICTED
 *    member — deny by default, not everything;
 *  - no function in this module ever deletes a `PersonProfile` —
 *    `deactivatePersonProfile`/`reactivatePersonProfile` are the only
 *    lifecycle transitions, so a deactivated person still exists for
 *    historical assignment/audit history.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import { findTenantPersonProfile, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class PersonProfileError extends Error {}

export const COMPETENCE_MANAGE_PERMISSION = "ems.competence.manage" as const;
export const COMPETENCE_VIEW_PERMISSION = "ems.competence.view" as const;
export const COMPETENCE_SENSITIVE_VIEW_PERMISSION = "ems.competence.sensitive.view" as const;

export interface PersonSensitiveFields {
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

export interface CreatePersonProfileInput {
  personType: "EMPLOYEE" | "CONTRACTOR" | "OTHER";
  displayName?: string | null;
  membershipId?: string | null;
  entityId?: string | null;
  siteId?: string | null;
  sensitive?: PersonSensitiveFields | null;
  actorUserId: string;
}

async function validateMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
}

async function validateEntitySite(context: OrganisationContext, entityId?: string | null, siteId?: string | null) {
  const ctx = toTenantRepositoryContext(context);
  if (entityId) {
    assertEntityAccess(context, entityId);
    const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: entityId }) });
    if (!entity) throw new TenantOwnershipError();
  }
  if (siteId) {
    assertSiteAccess(context, siteId);
    const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: siteId }) });
    if (!site) throw new TenantOwnershipError();
    if (entityId && site.entityId !== entityId) {
      throw new PersonProfileError("Site does not belong to the given entity.");
    }
  }
}

function hasSensitiveContent(sensitive?: PersonSensitiveFields | null): boolean {
  if (!sensitive) return false;
  return Boolean(sensitive.contactEmail?.trim() || sensitive.contactPhone?.trim() || sensitive.notes?.trim());
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createPersonProfile(context: OrganisationContext, input: CreatePersonProfileInput) {
  requirePermission(context, COMPETENCE_MANAGE_PERMISSION);
  if (!input.membershipId && !input.displayName?.trim()) {
    throw new PersonProfileError("Enter a display name for a person without a login identity.");
  }
  if (input.membershipId) await validateMembership(context, input.membershipId);
  await validateEntitySite(context, input.entityId, input.siteId);

  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const existing = input.membershipId
      ? await tx.personProfile.findFirst({ where: tenantWhere(txCtx, { membershipId: input.membershipId }) })
      : null;
    if (existing) throw new PersonProfileError("This membership is already linked to a person profile.");

    const person = await tx.personProfile.create({
      data: {
        organisationId: txCtx.organisationId,
        membershipId: input.membershipId ?? null,
        personType: input.personType,
        displayName: input.membershipId ? null : input.displayName?.trim(),
        entityId: input.entityId ?? null,
        siteId: input.siteId ?? null,
        createdByMembershipId: context.membershipId,
      },
    });

    if (hasSensitiveContent(input.sensitive)) {
      await tx.personSensitiveProfile.create({
        data: {
          organisationId: txCtx.organisationId,
          personId: person.id,
          contactEmail: input.sensitive?.contactEmail?.trim() || null,
          contactPhone: input.sensitive?.contactPhone?.trim() || null,
          notes: input.sensitive?.notes?.trim() || null,
          updatedByMembershipId: context.membershipId,
        },
      });
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "person_profile.created",
      resourceType: "person_profile",
      resourceId: person.id,
      summary: `Person profile created (${input.personType}).`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { personType: input.personType, hasMembership: Boolean(input.membershipId) },
    });

    return person;
  });
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export interface UpdatePersonProfileInput {
  displayName?: string | null;
  entityId?: string | null;
  siteId?: string | null;
  actorUserId: string;
}

export async function updatePersonProfile(context: OrganisationContext, personId: string, input: UpdatePersonProfileInput) {
  requirePermission(context, COMPETENCE_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);
  await validateEntitySite(context, input.entityId ?? person.entityId, input.siteId ?? person.siteId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.personProfile.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: person.id } },
      data: {
        displayName: person.membershipId ? null : (input.displayName?.trim() ?? person.displayName),
        entityId: input.entityId ?? person.entityId,
        siteId: input.siteId ?? person.siteId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "person_profile.updated",
      resourceType: "person_profile",
      resourceId: person.id,
      summary: "Person profile updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });
    return updated;
  });
}

export async function setPersonSensitiveProfile(
  context: OrganisationContext,
  personId: string,
  input: PersonSensitiveFields & { actorUserId: string },
) {
  requirePermission(context, COMPETENCE_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.personSensitiveProfile.upsert({
      where: { organisationId_personId: { organisationId: txCtx.organisationId, personId: person.id } },
      create: {
        organisationId: txCtx.organisationId,
        personId: person.id,
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        notes: input.notes?.trim() || null,
        updatedByMembershipId: context.membershipId,
      },
      update: {
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        notes: input.notes?.trim() || null,
        updatedByMembershipId: context.membershipId,
      },
    });
    // Never write actual contact/notes content into the audit trail.
    await recordAuditEvent(tx, txCtx, {
      eventType: "person_sensitive_profile.updated",
      resourceType: "person_profile",
      resourceId: person.id,
      summary: "Restricted contact detail updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export async function deactivatePersonProfile(context: OrganisationContext, personId: string, actorUserId: string) {
  requirePermission(context, COMPETENCE_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);
  if (!person.isActive) throw new PersonProfileError("Person profile is already inactive.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.personProfile.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: person.id } },
      data: { isActive: false, activeTo: new Date() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "person_profile.deactivated",
      resourceType: "person_profile",
      resourceId: person.id,
      summary: "Person profile deactivated.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { isActive: true },
      after: { isActive: false },
    });
    return updated;
  });
}

export async function reactivatePersonProfile(context: OrganisationContext, personId: string, actorUserId: string) {
  requirePermission(context, COMPETENCE_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);
  if (person.isActive) throw new PersonProfileError("Person profile is already active.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.personProfile.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: person.id } },
      data: { isActive: true, activeTo: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "person_profile.reactivated",
      resourceType: "person_profile",
      resourceId: person.id,
      summary: "Person profile reactivated.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { isActive: false },
      after: { isActive: true },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** RESTRICTED-membership visibility filter, mirroring `accessibleSiteFilter` (T16): deny-by-default for a person with no Entity/Site. */
function accessiblePersonProfileFilter(context: OrganisationContext) {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ],
  };
}

/** Non-sensitive person profile read. Never includes `PersonSensitiveProfile` — use `getPersonSensitiveProfile` explicitly. */
export async function getPersonProfile(context: OrganisationContext, personId: string) {
  requirePermission(context, COMPETENCE_VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);
  if (context.access.mode === "RESTRICTED") {
    const inScope =
      (person.siteId && context.access.siteIds.has(person.siteId)) ||
      (person.entityId && context.access.entityIds.has(person.entityId));
    if (!inScope) throw new TenantOwnershipError();
  }
  return prisma.personProfile.findUnique({
    where: { id: person.id },
    include: { membership: { include: { user: { select: { name: true } } } } },
  });
}

/** Restricted read — throws unless the caller has `ems.competence.sensitive.view`. */
export async function getPersonSensitiveProfile(context: OrganisationContext, personId: string) {
  requirePermission(context, COMPETENCE_SENSITIVE_VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  await findTenantPersonProfile(ctx, personId);
  return prisma.personSensitiveProfile.findFirst({ where: tenantWhere(ctx, { personId }) });
}

export interface ListPersonProfilesFilter {
  entityId?: string;
  siteId?: string;
  isActive?: boolean;
}

export async function listPersonProfiles(context: OrganisationContext, filter: ListPersonProfilesFilter = {}) {
  requirePermission(context, COMPETENCE_VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.personProfile.findMany({
    where: tenantWhere(ctx, {
      ...accessiblePersonProfileFilter(context),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.siteId ? { siteId: filter.siteId } : {}),
      ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
    }),
    include: { membership: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}
