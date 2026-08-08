import { NextResponse, type NextRequest } from "next/server";
import { SourceDocumentKind } from "@prisma/client";
import { getAiConfig, resolveAiActor } from "@/lib/ai";
import { AiAuthorizationError, assertSiteInScope } from "@/lib/ai/authorization";
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_MIME_TYPES,
  DocumentValidationError,
  uploadDocument,
} from "@/lib/documents-service";

/**
 * Attaching a file to the assistant.
 *
 * This is not a second upload system. It stores the file with exactly the same
 * function the /documents screen uses, under exactly the same size cap and
 * MIME allow-list, producing exactly the same SourceDocument — which is what
 * makes the document usable from both places, and what keeps the evidence link
 * on an entry meaningful wherever the file came in.
 *
 * The one behavioural difference is `reuseIdenticalUpload`: dragging the same
 * invoice into a chat twice is a slip, not a filing decision, so identical
 * bytes for the same site return the document already on file rather than a
 * second copy of it.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const actor = await resolveAiActor();
  if (!actor) {
    return NextResponse.json({ error: { reason: "UNAUTHENTICATED", message: "Sign in to attach a file." } }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: { reason: "BAD_REQUEST", message: "Invalid upload." } }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: { reason: "BAD_REQUEST", message: "Choose a file to attach." } }, { status: 400 });
  }

  const siteIdRaw = form.get("siteId");
  const siteId = typeof siteIdRaw === "string" && siteIdRaw.trim() ? siteIdRaw.trim() : null;

  try {
    if (siteId) assertSiteInScope(actor, siteId);

    const config = await getAiConfig();

    const document = await uploadDocument({
      filename: file.name,
      // The browser-declared type is checked against the allow-list inside
      // uploadDocument, not trusted here.
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      kind: SourceDocumentKind.UNKNOWN,
      siteId,
      notes: "Attached to the AI assistant.",
      uploadedByUserId: actor.userId,
      maxBytes: config.maxDocumentBytes,
      reuseIdenticalUpload: true,
    });

    return NextResponse.json({
      documentId: document.id,
      filename: document.filename,
      byteSize: document.byteSize,
      reusedExisting: document.reusedExisting,
      autoExtract: config.autoExtractAttachments,
    });
  } catch (err) {
    if (err instanceof DocumentValidationError || err instanceof AiAuthorizationError) {
      return NextResponse.json({ error: { reason: "BAD_REQUEST", message: err.message } }, { status: 400 });
    }
    return NextResponse.json(
      { error: { reason: "SERVER_ERROR", message: "That file couldn't be stored." } },
      { status: 500 },
    );
  }
}

/** What the composer tells the user it accepts, taken from the one allow-list. */
export async function GET() {
  const actor = await resolveAiActor();
  if (!actor) {
    return NextResponse.json({ error: { reason: "UNAUTHENTICATED", message: "Sign in first." } }, { status: 401 });
  }
  const config = await getAiConfig();
  return NextResponse.json({
    accept: ACCEPTED_DOCUMENT_EXTENSIONS.join(","),
    mimeTypes: Array.from(ACCEPTED_DOCUMENT_MIME_TYPES),
    maxBytes: config.maxDocumentBytes,
  });
}
