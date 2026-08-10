import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { listFactorSets } from "@/lib/factor-sets-service";
import { UploadForm } from "./upload-form";

export default async function AdminFactorsUploadPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "carbon.factor.manage");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const existingSets = await listFactorSets(context);

  return (
    <div className="max-w-2xl">
      <Link href="/admin/factors" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        All factor sets
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Import emission factors</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload a .csv or .xlsx file in the platform&apos;s factor template —{" "}
        <a href="/api/admin/factor-template.csv" className="text-blue-700 hover:text-blue-800">
          download the template
        </a>
        . This never edits an existing set — it always creates a new one. Nothing is imported unless every row
        passes validation.
      </p>

      <div className="mt-6">
        <UploadForm existingSets={existingSets.map((s) => ({ id: s.id, name: s.name, effectiveTo: s.effectiveTo?.toISOString() ?? null }))} />
      </div>
    </div>
  );
}
