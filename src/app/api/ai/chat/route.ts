import { NextResponse } from "next/server";

/** Checkpoint A board sprint: no prompt parsing, domain context assembly, provider call or retained conversation. */
export async function POST() {
  return NextResponse.json({
    error: { reason: "DISABLED", message: "AI chat is unavailable during the board sprint. Use the underlying records and calculation explanations." },
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
