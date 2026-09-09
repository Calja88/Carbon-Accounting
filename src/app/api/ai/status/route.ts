import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ available: false, reason: "DISABLED", message: "AI chat is unavailable during the board sprint.", freeOnly: true },
    { headers: { "Cache-Control": "no-store" } });
}
