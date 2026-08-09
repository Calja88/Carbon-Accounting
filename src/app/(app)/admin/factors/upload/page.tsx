import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminSession } from "@/lib/admin";
import { listFactorSets } from "@/lib/factor-sets-service";
import { UploadForm } from "./upload-form";

export default async function AdminFactorsUploadPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/");

  const existingSets = await listFactorSets();

  return (
    <div className="max-w-2xl">
      <Link href="/admin/factors" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        All factor sets
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Import emission factors</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload a .csv or .xlsx file in the platform&apos;s factor template —{" "}
        <a href="/api/admin/factor-template.csv" className="text-brand-700 hover:text-brand-800">
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
