import { NextResponse } from "next/server";
import { resolveEvidenceObjectDownload } from "@/lib/documents/download-boundary";
import { canViewDocuments, getDocumentsContext } from "@/lib/documents/permissions";
import { failureResponse, successResponse } from "@/lib/documents/download-response";

/**
 * Downloads a shared evidence object (task T22, unified through the SP05
 * download boundary). Tenant- and classification-scoped:
 * `resolveEvidenceObjectDownload` collapses a missing id, a foreign-tenant
 * id, or a classification the caller isn't cleared for into the identical
 * non-disclosing 404 (Phase 2 spec §6), but reports every other failure
 * (tombstoned, checksum mismatch, revoked SharePoint access, etc.)
 * precisely, since those are only reachable once authorisation has already
 * succeeded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getDocumentsContext();
  if (!canViewDocuments(context)) {
    return new NextResponse("You must be signed in to download evidence.", { status: 401 });
  }

  const result = await resolveEvidenceObjectDownload(context!, id);
  if (!result.ok) return failureResponse(result.reason, result.detail);
  return successResponse(result.metadata, result.bytes);
}
