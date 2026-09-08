import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError, hasPermission } from "@/lib/rbac/authorize";
import { listActivityProcesses, listProcessProfileTemplates } from "@/lib/ems/aspects/process-service";
import { ProcessManagement } from "./process-forms";

export const dynamic = "force-dynamic";

export default async function EmsProcessesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const [processes, templates, programmes, sites] = await Promise.all([
    listActivityProcesses(context),
    listProcessProfileTemplates(context),
    prisma.emsProgramme.findMany({
      where: { organisationId: context.organisationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true },
    }),
    prisma.site.findMany({
      where: { organisationId: context.organisationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, entityId: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Process/activity profiles</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          The site processes, activities, products, and services this organisation&apos;s EMS covers, and the lifecycle
          stage/operating condition each runs under. This is structure only — no aspect scores or environmental
          measurements are created here.
        </p>
      </div>

      <ProcessManagement
        processes={processes.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          activityType: p.activityType,
          lifecycleStage: p.lifecycleStage,
          operatingCondition: p.operatingCondition,
          siteId: p.siteId,
          programmeId: p.programmeId,
          sourceTemplateId: p.sourceTemplateId,
          createdAt: p.createdAt.toISOString(),
        }))}
        templates={templates.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
          siteLabel: t.siteLabel,
          description: t.description,
          itemCount: t.items.length,
        }))}
        programmes={programmes}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        canEdit={hasPermission(context, "ems.aspect.edit")}
      />
    </div>
  );
}
