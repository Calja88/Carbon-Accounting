import { NextResponse } from "next/server";
import { readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { listIncidentEvidence, TenantOwnershipError } from "@/lib/ems/incidents/incident-service";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";

/**
 * Downloads evidence attached to an environmental incident (task T62,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §7). Unlike the generic
 * `/api/ems/evidence/[id]` route, this one first re-checks the caller's
 * access to the *incident* — including the restricted-incident permission
 * gate in `incident-service.ts#listIncidentEvidence` — before ever reading
 * bytes, and confirms the evidence id is actually linked to this incident. A
 * missing incident, a foreign-tenant incident, denied restricted access, or
 * an evidence id not linked to this incident all produce the identical 404
 * below, so a denial reveals nothing about the record.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return new NextResponse("You must be signed in to download evidence.", { status: 401 });
    }
    throw err;
  }

  let linkedEvidence;
  try {
    linkedEvidence = await listIncidentEvidence(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) {
      return new NextResponse("That evidence file could not be found.", { status: 404 });
    }
    throw err;
  }
  if (!linkedEvidence.some((evidence) => evidence.id === evidenceId)) {
    return new NextResponse("That evidence file could not be found.", { status: 404 });
  }

  const result = await readEvidenceObjectBytes(context, evidenceId);
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
