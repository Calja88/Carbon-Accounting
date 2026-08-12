import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { listActivityProcesses } from "@/lib/ems/aspects/process-service";
import { listEnvironmentalAspects, listEnvironmentalImpacts } from "@/lib/ems/aspects/aspect-service";
import { AspectRegister } from "./aspect-forms";

export const dynamic = "force-dynamic";

export default async function EmsAspectsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [processRows, aspectRows, impactRows] = await Promise.all([
    listActivityProcesses(context),
    listEnvironmentalAspects(context),
    listEnvironmentalImpacts(context),
  ]);
  const aspectIds = aspectRows.map((aspect) => aspect.id);
  const evidenceLinks = aspectIds.length === 0 ? [] : await prisma.evidenceLink.findMany({
    where: {
      organisationId: context.organisationId,
      resourceType: "environmental_aspect",
      resourceId: { in: aspectIds },
    },
    include: { evidence: { select: { id: true, filename: true } } },
    orderBy: { linkedAt: "desc" },
  });

  const evidenceByAspect = new Map<string, Array<{ id: string; filename: string }>>();
  for (const link of evidenceLinks) {
    const current = evidenceByAspect.get(link.resourceId) ?? [];
    current.push(link.evidence);
    evidenceByAspect.set(link.resourceId, current);
  }

  const processes = processRows
    .filter((process) => process.status !== "ARCHIVED" && process.status !== "SUPERSEDED")
    .map((process) => ({
      id: process.id,
      name: process.name,
      lifecycleStage: process.lifecycleStage,
      operatingCondition: process.operatingCondition,
    }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Aspect and impact register</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Record environmental aspects against current process profiles, describe direct control or influence,
          capture lifecycle and operating conditions, and link each aspect to one or more impact catalogue items.
          This register stores no carbon or product-LCA totals.
        </p>
      </div>
      <AspectRegister
        processes={processes}
        aspects={aspectRows.map((aspect) => ({
          id: aspect.id,
          processId: aspect.processId,
          processName: aspect.process.name,
          name: aspect.name,
          description: aspect.description,
          sourceInputOutput: aspect.sourceInputOutput,
          scopeDescription: aspect.scopeDescription,
          existingControls: aspect.existingControls,
          controlRelationship: aspect.controlRelationship,
          lifecycleStage: aspect.lifecycleStage,
          operatingCondition: aspect.operatingCondition,
          effect: aspect.effect,
          impacts: aspect.impactLinks.map((link) => ({
            linkId: link.id,
            impactId: link.impactId,
            name: link.impact.name,
            causalDescription: link.causalDescription,
          })),
          evidence: evidenceByAspect.get(aspect.id) ?? [],
        }))}
        impacts={impactRows}
        canEdit={hasPermission(context, "ems.aspect.edit")}
      />
    </div>
  );
}
