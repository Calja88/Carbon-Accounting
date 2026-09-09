import { NextResponse } from "next/server";
import { readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { canViewDocuments, getDocumentsContext } from "@/lib/documents/permissions";

/**
 * Downloads a shared evidence object (task T22). Tenant- and
 * classification-scoped: `readEvidenceObjectBytes` returns null for a
 * missing id, a foreign-tenant id, or a classification the caller isn't
 * cleared for — all three produce the identical 404 here, so a denial
 * reveals nothing about the record (Phase 2 spec §6: "Document download
 * denial reveals no filename, MIME, size, checksum or existence.").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getDocumentsContext();
  if (!canViewDocuments(context)) {
    return new NextResponse("You must be signed in to download evidence.", { status: 401 });
  }

  const result = await readEvidenceObjectBytes(context!, id);
  if (!result) {
    return new NextResponse("That evidence file could not be found.", { status: 404 });
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
