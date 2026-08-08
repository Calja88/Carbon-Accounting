import { NextResponse, type NextRequest } from "next/server";
import { resolveAiActor } from "@/lib/ai";
import { AiAuthorizationError } from "@/lib/ai/authorization";
import { readDocumentForAssistant } from "@/lib/ai/document-intake";

/**
 * Reading an attached document, as a separate call from storing it.
 *
 * Two calls rather than one so the composer can show the honest sequence —
 * uploaded, then reading, then read — instead of one long spinner that hides
 * which half is slow. It also means a failed read leaves a stored document
 * that can be retried or reviewed by hand, rather than losing the file.
 *
 * This returns the *card*, not the extraction payload: the panel renders
 * labelled fields, and raw model output never crosses to the client.
 */

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  const actor = await resolveAiActor();
  if (!actor) {
    return NextResponse.json({ error: { reason: "UNAUTHENTICATED", message: "Sign in first." } }, { status: 401 });
  }

  const { documentId } = await context.params;

  try {
    const intake = await readDocumentForAssistant(actor, documentId, { extractIfMissing: true });
    return NextResponse.json({
      documentId: intake.documentId,
      filename: intake.filename,
      card: intake.card,
      // Whether anything was found that this platform could record. The panel
      // uses it for the chip's wording only; the decision to record is taken
      // server-side when the turn runs.
      loggableCount: intake.candidates.length,
    });
  } catch (err) {
    if (err instanceof AiAuthorizationError) {
      return NextResponse.json({ error: { reason: "FORBIDDEN", message: err.message } }, { status: 403 });
    }
    return NextResponse.json(
      {
        error: {
          reason: "EXTRACTION_FAILED",
          message: "That document is stored, but it couldn't be read automatically. You can still ask about it or review it by hand.",
        },
      },
      { status: 200 },
    );
  }
}
