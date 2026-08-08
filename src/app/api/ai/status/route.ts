import { NextResponse } from "next/server";
import { getAiAvailability, resolveAiActor } from "@/lib/ai";

/**
 * Whether AI features can run right now, so the UI can offer an honest
 * disabled state rather than a button that fails on click.
 *
 * Returns settings *flags* only — no API key, no model catalogue, nothing
 * that would tell a caller anything about credentials.
 */
export async function GET() {
  const actor = await resolveAiActor();
  if (!actor) {
    return NextResponse.json({ available: false, reason: "UNAUTHENTICATED", message: "Sign in first." }, { status: 401 });
  }

  const availability = await getAiAvailability();

  return NextResponse.json({
    available: availability.available,
    reason: availability.reason,
    message: availability.message,
    freeOnly: availability.config.freeOnly,
  });
}
