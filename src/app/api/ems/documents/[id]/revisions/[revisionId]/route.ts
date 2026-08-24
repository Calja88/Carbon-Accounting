import { NextResponse } from "next/server";
import { resolveControlledDocumentRevisionDownload } from "@/lib/documents/download-boundary";
import { canViewDocuments, getDocumentsContext } from "@/lib/documents/permissions";
import { failureResponse, successResponse } from "@/lib/documents/download-response";

/**
 * Downloads the content attached to one controlled-document revision (task
 * T22, extended by SP04 to resolve a SharePoint-linked revision's pinned
 * version, unified through the SP05 download boundary). The boundary's
 * `expectedDocumentId` parameter is the nested-parent-substitution guard —
 * a revision belonging to a different document under the same organisation
 * cannot be fetched through another document's route. Every ordinary
 * failure mode (missing, foreign tenant, no clearance) collapses to the
 * same non-disclosing 404; a checksum mismatch, an unpinned draft, or an
 * unreachable/revoked SharePoint reference is reported precisely instead of
 * silently served or conflated with "not found".
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

  const result = await resolveControlledDocumentRevisionDownload(context!, revisionId, id);
  if (!result.ok) return failureResponse(result.reason, result.detail);
  return successResponse(result.metadata, result.bytes);
}
