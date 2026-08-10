import { NextResponse } from "next/server";
import { getAiAvailability, resolveAiActor } from "@/lib/ai";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";

/**
 * Whether AI features can run right now for the caller's Organisation, so
 * the UI can offer an honest disabled state rather than a button that fails
 * on click.
 *
 * Returns settings *flags* only — no API key, no model catalogue, nothing
 * that would tell a caller anything about credentials.
 */
export async function GET() {
  let organisation;
  try {
    organisation = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return NextResponse.json({ available: false, reason: "UNAUTHENTICATED", message: "Sign in first." }, { status: 401 });
    }
    throw err;
  }

  const actor = await resolveAiActor(organisation);
  if (!actor) {
    return NextResponse.json({ available: false, reason: "UNAUTHENTICATED", message: "Sign in first." }, { status: 401 });
  }

  const availability = await getAiAvailability(organisation.organisationId);

  return NextResponse.json({
    available: availability.available,
    reason: availability.reason,
    message: availability.message,
    freeOnly: availability.config.freeOnly,
  });
}
