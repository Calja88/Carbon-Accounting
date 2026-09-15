import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { getManagementReviewPack } from "@/lib/ems/review/pack-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const pack = await getManagementReviewPack(await requireOrganisationContext(), (await params).id);
    if (!pack || pack.status !== "ISSUED" || !(pack.payload as { board?: unknown } | null)?.board) return new Response("Not found", { status: 404 });
    // Export the exact canonical payload, never a live reconstruction or AI narrative.
    return Response.json({ packId: pack.id, issuedAt: pack.issuedAt, checksumSha256: pack.checksumSha256, payload: pack.payload }, { headers: {
      "Content-Disposition": `attachment; filename="management-review-${pack.id}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError || error instanceof TenantOwnershipError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
