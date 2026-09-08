/**
 * Phase 1 tenancy (T13) — request-level entry point wiring NextAuth session,
 * Prisma, and the active-organisation cookie into `resolveOrganisationContext`.
 * Server-only: reads `next/headers` cookies, so it must run inside a request
 * (route handler, server action, or server component).
 */

import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  OrganisationAccessError,
  resolveOrganisationContext,
  type OrganisationContext,
} from "@/lib/organisation/context";
import { ACTIVE_ORGANISATION_COOKIE, decodeOrganisationCookie } from "@/lib/organisation/cookie";

export { OrganisationAccessError };
export type { OrganisationContext };

/**
 * Resolves the signed-in user's Organisation context.
 *
 * @param requestedOrganisation Explicit override (id or slug), e.g. from a
 *   query string on an organisation-switch request. Falls back to the
 *   signed cookie, then to the user's most recently accessed membership.
 *   Every path re-validates against the database — the cookie and this
 *   argument are hints, never authority.
 * @throws OrganisationAccessError when the caller is unauthenticated or has
 *   no accessible organisation matching the request.
 */
export async function requireOrganisationContext(
  requestedOrganisation?: string,
): Promise<OrganisationContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new OrganisationAccessError("NOT_AUTHENTICATED");
  }

  const cookieStore = await cookies();
  const fromCookie = decodeOrganisationCookie(cookieStore.get(ACTIVE_ORGANISATION_COOKIE)?.value);

  return resolveOrganisationContext(prisma, {
    userId: session.user.id,
    requestedOrganisation: requestedOrganisation ?? fromCookie,
  });
}
