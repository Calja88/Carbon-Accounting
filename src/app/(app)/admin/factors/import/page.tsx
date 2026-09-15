import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { listFactorSets } from "@/lib/factor-sets-service";
import { BoardLink, PageHeader, Surface } from "@/components/ui/primitives";
import { ImportPreview } from "./import-preview";

export default async function AdminFactorsImportPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "carbon.factor.view");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  // The server action re-checks this independently; hiding the form only keeps
  // a viewer from being offered something that would be refused.
  const canManage = hasPermission(context, "carbon.factor.manage");
  const existingSets = canManage
    ? (await listFactorSets(context)).map((s) => ({ id: s.id, name: s.name, factorCount: s._count.factors }))
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Emission factors"
        title="UK factor import preview"
        description={
          <p>
            Check a UK Government / DEFRA / DESNZ conversion factor file before anything is imported. This reads the
            file, maps it onto the platform&apos;s factor model and reports every row it would accept, question or
            refuse. It is a review step only — no factor is created or changed by running it.
          </p>
        }
        actions={
          <BoardLink href="/admin/factors" className="bd-button bd-button--quiet">
            All factor sets
          </BoardLink>
        }
      />

      <div className="bd-notice mt-2" role="note">
        <strong>Preview only.</strong> No factors will be created or changed. Commit and import stay disabled until the
        official workbook and the persistence design are approved.
      </div>

      {canManage ? (
        <ImportPreview existingSets={existingSets} />
      ) : (
        <Surface title="Preview unavailable" className="mt-6">
          <p className="bd-muted">
            Previewing a factor file needs the emission factor management grant. Ask an administrator for it, or view
            the datasets already loaded from the factor sets page.
          </p>
        </Surface>
      )}
    </div>
  );
}
