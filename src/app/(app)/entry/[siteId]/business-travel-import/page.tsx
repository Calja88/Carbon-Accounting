import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ExpenseInImportForm } from "./import-form";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requireSiteInScope } from "@/lib/repositories/carbon-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export default async function BusinessTravelImportPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  let site;
  try {
    site = await requireSiteInScope(context, siteId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) notFound();
    throw err;
  }

  return (
    <div className="max-w-3xl">
      <Link
        href={`/entry/${siteId}`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {site.name}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Import business travel from ExpenseIn</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bulk-load rail, flight and hotel travel for {site.name} straight from an ExpenseIn export, instead of entering
        each month by hand. Imported entries go through the same calculation, plausibility check and audit trail as
        anything entered manually.
      </p>

      <div className="mt-6">
        <ExpenseInImportForm site={{ id: site.id, name: site.name }} />
      </div>
    </div>
  );
}
