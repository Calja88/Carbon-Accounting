import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { listManagementReviewAgendaTemplates } from "@/lib/ems/review/agenda-service";
import { listManagementReviewInputDefinitions } from "@/lib/ems/review/review-service";
import { AgendaTemplateWorkspace, type AgendaTemplateRow } from "./agenda-template-forms";

export const dynamic = "force-dynamic";

export default async function AgendaTemplatesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [templates, inputDefinitions] = await Promise.all([
    listManagementReviewAgendaTemplates(context),
    listManagementReviewInputDefinitions(context),
  ]);

  const templateRows: AgendaTemplateRow[] = templates.map((template) => ({
    id: template.id,
    templateKey: template.templateKey,
    name: template.name,
    activeVersionId: template.activeVersionId,
    versions: template.versions.map((version) => ({
      id: version.id,
      version: version.version,
      name: version.name,
      status: version.status,
      revisionRationale: version.revisionRationale,
      items: version.items.map((item) => ({
        id: item.id,
        order: item.order,
        title: item.title,
        description: item.description,
        inputDefinitionKey: item.inputDefinitionKey,
      })),
    })),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Management review agenda templates</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Configure the ordered agenda items and required ISO 14001 management-review inputs/outputs for each
          template, then version and approve/activate it before scheduling a review against it.
          Draft → Approved → Active → Superseded.
        </p>
      </div>

      <AgendaTemplateWorkspace
        templates={templateRows}
        inputDefinitionKeys={inputDefinitions.map((d) => d.key)}
      />
    </div>
  );
}
