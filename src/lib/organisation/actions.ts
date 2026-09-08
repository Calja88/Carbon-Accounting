"use server";

/**
 * Phase 1 tenancy (T13) — secure organisation switching. Validates the
 * requested organisation against a real ACTIVE membership before writing
 * the selector cookie; an inaccessible id/slug is rejected and the cookie
 * is left untouched, per PHASE1_TENANCY_RBAC_SPEC.md §7.
 */

import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, OrganisationAccessError } from "@/lib/organisation/context";
import { ACTIVE_ORGANISATION_COOKIE, encodeOrganisationCookie } from "@/lib/organisation/cookie";

export interface SwitchOrganisationState {
  error: string | null;
  success: boolean;
}

export async function switchOrganisationAction(
  _prevState: SwitchOrganisationState,
  formData: FormData,
): Promise<SwitchOrganisationState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in.", success: false };
  }

  const requested = formData.get("organisation");
  if (typeof requested !== "string" || requested.length === 0) {
    return { error: "Select an organisation.", success: false };
  }

  try {
    const context = await resolveOrganisationContext(prisma, {
      userId: session.user.id,
      requestedOrganisation: requested,
    });

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORGANISATION_COOKIE, encodeOrganisationCookie(context.organisationId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    return { error: null, success: true };
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return { error: "You do not have access to that organisation.", success: false };
    }
    throw err;
  }
}
