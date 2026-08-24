import { NextResponse } from "next/server";
import { getRevision } from "@/lib/documents/document-control-service";
import { readControlledDocumentRevisionBytes, SharePointLinkError } from "@/lib/documents/storage/controlled-document-link-service";
import { canViewDocuments, getDocumentsContext } from "@/lib/documents/permissions";

/**
 * Downloads the content attached to one controlled-document revision (task
 * T22, extended by SP04 to also resolve a SharePoint-linked revision's
 * pinned version). `getRevision` is called with `expectedDocumentId` so a
 * revision belonging to a different document under the same organisation
 * cannot be fetched through another document's route
 * (nested-parent-substitution guard). Classification is enforced again
 * inside `readControlledDocumentRevisionBytes` — every ordinary failure mode
 * (missing, foreign tenant, no clearance) collapses to the same 404. A
 * `SharePointLinkError` is a distinct, blocking evidence-integrity
 * condition (e.g. a pruned SharePoint version or a checksum mismatch) and is
 * reported as 409 rather than silently served or conflated with "not
 * found".
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
  if (!revision) {
    return new NextResponse("That document revision could not be found.", { status: 404 });
  }

  let result;
  try {
    result = await readControlledDocumentRevisionBytes(context!, revisionId);
  } catch (err) {
    if (err instanceof SharePointLinkError) {
      return new NextResponse("That document revision's content could not be verified.", { status: 409 });
    }
    throw err;
  }
  if (!result) {
    return new NextResponse("That document revision could not be found.", { status: 404 });
  }

  const { bytes, mimeType, checksumSha256, filename } = result;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${(filename ?? `revision-${revisionId}`).replace(/"/g, "")}"`,
      "X-Content-SHA256": checksumSha256,
    },
  });
}
