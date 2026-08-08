/**
 * The authorization boundary for everything the AI is allowed to see.
 *
 * Authorization happens *before* any context is assembled, in this module,
 * against the session — never by asking the model to respect a boundary, and
 * never from an identifier supplied in a prompt. A request that names a site
 * or an LCA project is checked against the actor's resolved scope first; if
 * it isn't in scope the request fails, and nothing about it reaches a model.
 *
 * The pure predicates live in `./scope`, so they can be tested with a
 * deliberately narrowed scope without the auth stack; this module is the part
 * that reads the session and the database.
 *
 * Current tenancy model: this deployment is a single group (Paragon ID UK)
 * whose entities are consolidated under operational control, and every
 * signed-in user can already see all group data everywhere else in the
 * application. The AI layer therefore grants the same visibility — but it
 * resolves that visibility here, from the database, into an explicit list of
 * entity and site ids that every AI context query then filters on. That means
 * the enforcement point exists, is testable, and is the single place to change
 * if per-entity or multi-organisation access is introduced later. It does not
 * pretend a boundary the rest of the application does not have.
 */

import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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
 * Resolves the signed-in user into an explicit data scope. Returns null when
 * there is no valid session — callers must treat that as "no AI, no context".
 */
export async function resolveAiActor(): Promise<AiActor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true },
  });
  if (!user) return null;

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, entityId: true },
  });

  return {
    userId: user.id,
    name: user.name,
    role: user.role,
    isAdmin: user.role === Role.ADMIN,
    entityIds: Array.from(new Set(sites.map((s) => s.entityId))),
    siteIds: sites.map((s) => s.id),
  };
}

/**
 * Checks an LCA project belongs to the actor's scope before its contents are
 * put in front of a model.
 */
export async function assertLcaProjectInScope(actor: AiActor, projectId: string): Promise<void> {
  const project = await prisma.lcaProject.findUnique({
    where: { id: projectId },
    select: { id: true, entityId: true },
  });
  if (!project) throw new AiAuthorizationError("That LCA project doesn't exist.");
  if (!isEntityInScope(actor, project.entityId)) {
    throw new AiAuthorizationError("That LCA project isn't available to you.");
  }
}

/** Same check for an uploaded evidence document. */
export async function assertDocumentInScope(actor: AiActor, documentId: string): Promise<void> {
  const document = await prisma.sourceDocument.findUnique({
    where: { id: documentId },
    select: { id: true, siteId: true },
  });
  if (!document) throw new AiAuthorizationError("That document doesn't exist.");
  if (document.siteId) assertSiteInScope(actor, document.siteId);
}
