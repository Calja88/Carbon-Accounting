import { NextResponse } from "next/server";
import { readEvidenceBytes } from "@/lib/lca/evidence-service";
import { canViewLca, getLcaContext } from "@/lib/lca/permissions";

/**
 * Downloads an uploaded evidence file from whichever storage provider holds
 * it. Tenant-scoped at the initial lookup (readEvidenceBytes -> getEvidence
 * -> findTenantEvidence) — a foreign-tenant or guessed evidence id returns
 * the same 404 as a genuinely missing one, per the T17 acceptance criteria
 * for the evidence export path.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getLcaContext();
  if (!canViewLca(context)) {
    return new NextResponse("You must be signed in to download evidence.", { status: 401 });
  }

  const result = await readEvidenceBytes(context!, id);
  if (!result) {
    return new NextResponse("That evidence file could not be found.", { status: 404 });
  }

  const { bytes, evidence } = result;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": evidence.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${(evidence.fileName ?? "evidence").replace(/"/g, "")}"`,
      // The checksum recorded at upload, so a recipient can show the file is
      // the same one the assessment cites.
      ...(evidence.checksumSha256 ? { "X-Content-SHA256": evidence.checksumSha256 } : {}),
    },
  });
}
