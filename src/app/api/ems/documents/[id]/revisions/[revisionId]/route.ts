import { NextResponse } from "next/server";
import { getRevision } from "@/lib/documents/document-control-service";
import { readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { canViewDocuments, getDocumentsContext } from "@/lib/documents/permissions";

/**
 * Downloads the content attached to one controlled-document revision (task
 * T22). `getRevision` is called with `expectedDocumentId` so a revision
 * belonging to a different document under the same organisation cannot be
 * fetched through another document's route (nested-parent-substitution
 * guard). Classification is enforced again inside `readEvidenceObjectBytes`
 * — every failure mode collapses to the same 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const { id, revisionId } = await params;

  const context = await getDocumentsContext();
  if (!canViewDocuments(context)) {
    return new NextResponse("You must be signed in to download this document.", { status: 401 });
  }

  let revision;
  try {
    revision = await getRevision(context!, revisionId, id);
  } catch {
    revision = null;
  }
  if (!revision || !revision.evidenceObjectId) {
    return new NextResponse("That document revision could not be found.", { status: 404 });
  }

  const result = await readEvidenceObjectBytes(context!, revision.evidenceObjectId);
  if (!result) {
    return new NextResponse("That document revision could not be found.", { status: 404 });
  }

  const { bytes, evidence } = result;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": evidence.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${evidence.filename.replace(/"/g, "")}"`,
      "X-Content-SHA256": evidence.checksumSha256,
    },
  });
}
