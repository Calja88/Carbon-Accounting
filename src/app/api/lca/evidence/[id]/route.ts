import { NextResponse } from "next/server";
import { readEvidenceBytes } from "@/lib/lca/evidence-service";
import { canViewLca, getLcaActor } from "@/lib/lca/permissions";

/** Downloads an uploaded evidence file from whichever storage provider holds it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getLcaActor();
  if (!canViewLca(actor)) {
    return new NextResponse("You must be signed in to download evidence.", { status: 401 });
  }

  const result = await readEvidenceBytes(id);
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
