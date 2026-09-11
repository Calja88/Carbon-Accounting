import { notFound, redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { getBoardManagementPack } from "@/lib/board/live-management-pack";
import { ManagementPack } from "@/components/board/management-pack";
import { PackActions } from "./pack-actions";

export const dynamic = "force-dynamic";

export default async function ManagementPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let pack;
  try {
    pack = await getBoardManagementPack(await requireOrganisationContext(), id);
  } catch (error) {
    if (error instanceof OrganisationAccessError && error.reason === "NOT_AUTHENTICATED") redirect("/login");
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError || error instanceof TenantOwnershipError) notFound();
    throw error;
  }
  if (!pack || pack.status !== "issued") notFound();
  return <><PackActions reviewId={id} /><ManagementPack pack={pack} /></>;
}
