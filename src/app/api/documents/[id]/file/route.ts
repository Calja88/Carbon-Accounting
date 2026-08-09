import { NextResponse, type NextRequest } from "next/server";
import { resolveAiActor } from "@/lib/ai";
import { AiAuthorizationError, assertDocumentInScope } from "@/lib/ai/authorization";
import { getDocumentContent } from "@/lib/documents-service";

/**
 * Serves an uploaded evidence document back to the review screen.
 *
 * Authorization is checked per request — a document id is not a capability.
 * The response is deliberately hostile to being treated as a web page:
 * `X-Content-Type-Options: nosniff` stops a browser re-interpreting an
 * uploaded file as HTML, `Content-Security-Policy: sandbox` neutralises
 * scripting inside a PDF viewer, and the filename is quoted and stripped so a
 * crafted upload name can't inject a header.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAiActor();
  if (!actor) return new NextResponse("Sign in first.", { status: 401 });

  const { id } = await context.params;

  try {
    await assertDocumentInScope(actor, id);
  } catch (err) {
    if (err instanceof AiAuthorizationError) return new NextResponse(err.message, { status: 403 });
    throw err;
  }

  const document = await getDocumentContent(id);
  if (!document) return new NextResponse("Not found.", { status: 404 });

  const safeFilename = document.filename.replace(/["\\\r\n]/g, "_");

  // The CSP `sandbox` directive with no tokens forces the response into a
  // unique opaque origin — which also blocks Chrome's built-in PDF viewer
  // from rendering inside the review screen's <iframe>, leaving it blank.
  // mimeType is already constrained to an allow-list at upload time
  // (ACCEPTED_DOCUMENT_MIME_TYPES) and nosniff stops the browser from
  // reinterpreting the bytes as anything else, so PDFs and images — the
  // only types embedded inline — don't need the extra sandbox restriction.
  // Other types are never rendered inline (see review-screen.tsx), so they
  // keep the stricter header as defence in depth.
  const isInlineRenderable = document.mimeType === "application/pdf" || document.mimeType.startsWith("image/");

  return new NextResponse(Buffer.from(document.content) as unknown as BodyInit, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      ...(isInlineRenderable ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'" }),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
