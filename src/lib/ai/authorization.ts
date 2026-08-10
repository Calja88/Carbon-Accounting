/**
 * The authorization boundary for everything the AI is allowed to see.
 *
 * Authorization happens *before* any context is assembled, in this module,
 * against the session and the caller's resolved Organisation — never by
 * asking the model to respect a boundary, and never from an identifier
 * supplied in a prompt. A request that names a site, a document or an LCA
 * project is checked against the actor's resolved scope first; if it isn't
 * in scope the request fails, and nothing about it reaches a model.
 *
 * The pure predicates live in `./scope`, so they can be tested with a
 * deliberately narrowed scope without the auth stack; this module is the part
 * that reads the database.
 *
 * Phase 1 tenancy (T18): `AiActor` is built from an already-resolved
 * `OrganisationContext` (T13) rather than from the session directly, and its
 * `entityIds`/`siteIds` are scoped to that one Organisation using the same
 * `accessibleSiteFilter` every other domain repository uses (T14/T16) — so a
 * member of Organisation B can no longer see Organisation A's entities/sites
 * through the AI layer just because both exist in the same database. A
 * record looked up by id (a document, an LCA assessment) is additionally
 * checked against `actor.organisationId` in the query itself, per the
 * repository contract (PHASE1_TENANCY_RBAC_SPEC.md §8) — entity/site scope
 * alone is not proof of tenant ownership, because an ORGANISATION_WIDE
 * membership passes every entity/site check unconditionally regardless of
 * which organisation the id actually belongs to.
 */

import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { accessibleSiteFilter } from "@/lib/repositories/carbon-repository";
import { AiActor, AiAuthorizationError, assertSiteInScope, isEntityInScope } from "./scope";

export type { AiActor } from "./scope";
export {
  AiAuthorizationError,
  assertSiteInScope,
  isSiteInScope,
  isEntityInScope,
  assertEntityInScope,
  scopedToSite,
  filterToScope,
} from "./scope";

/**
 * Resolves the caller's Organisation context into an explicit AI data scope.
 * Returns null when the signed-in user has no matching database row —
 * callers must treat that as "no AI, no context". Never queries `auth()`
 * itself: the caller resolves `OrganisationContext` first (which already
 * requires a valid session), so this module has no legacy-role/session logic
 * of its own to keep in sync.
 */
export async function resolveAiActor(organisation: OrganisationContext): Promise<AiActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: organisation.userId },
    select: { id: true, name: true, role: true },
  });
  if (!user) return null;

  const sites = await prisma.site.findMany({
    where: {
      isActive: true,
      entity: { organisationId: organisation.organisationId },
      ...accessibleSiteFilter(organisation),
    },
    select: { id: true, entityId: true },
  });

  return {
    userId: user.id,
    name: user.name,
    role: user.role,
    isAdmin: user.role === Role.ADMIN,
    organisationId: organisation.organisationId,
    correlationId: organisation.correlationId,
    entityIds: Array.from(new Set(sites.map((s) => s.entityId))),
    siteIds: sites.map((s) => s.id),
  };
}

/**
 * Checks a product LCA assessment belongs to the actor's tenant and scope
 * before its contents are put in front of a model. The organisationId filter
 * is part of the query itself, not a check applied after the fact.
 */
export async function assertLcaAssessmentInScope(actor: AiActor, assessmentId: string): Promise<void> {
  const assessment = await prisma.lcaAssessment.findFirst({
    where: { id: assessmentId, organisationId: actor.organisationId },
    select: { id: true, entityId: true },
  });
  if (!assessment) throw new AiAuthorizationError("That LCA assessment doesn't exist.");
  if (!isEntityInScope(actor, assessment.entityId)) {
    throw new AiAuthorizationError("That LCA assessment isn't available to you.");
  }
}

/** Same check for an uploaded evidence document, tenant ownership first. */
export async function assertDocumentInScope(actor: AiActor, documentId: string): Promise<void> {
  const document = await prisma.sourceDocument.findFirst({
    where: { id: documentId, organisationId: actor.organisationId },
    select: { id: true, siteId: true },
  });
  if (!document) throw new AiAuthorizationError("That document doesn't exist.");
  if (document.siteId) assertSiteInScope(actor, document.siteId);
}
