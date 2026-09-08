import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listEnvironmentalIncidents, listIncidentSeverityLevels, INCIDENT_MANAGE_PERMISSION } from "@/lib/ems/incidents/incident-service";
import { CreateIncidentForm, IncidentList, IncidentPolicyWorkspace, type IncidentListRow } from "./incident-forms";

export const dynamic = "force-dynamic";

export default async function EnvironmentalIncidentsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [incidents, entities, sites, processes, aspects, severityLevels] = await Promise.all([
    listEnvironmentalIncidents(context),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.activityProcess.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.environmentalAspect.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    listIncidentSeverityLevels(context),
  ]);

  const rows: IncidentListRow[] = incidents.map((incident) => ({
    id: incident.id,
    reference: incident.reference,
    type: incident.type,
    status: incident.status,
    restricted: incident.restricted,
    reportedAt: incident.reportedAt.toISOString().slice(0, 10),
  }));

  const canManage = hasPermission(context, INCIDENT_MANAGE_PERMISSION);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Environmental incident intake</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Capture incident facts, immediate response, severity and evidence. Reporting an incident never concludes
          legal reportability or noncompliance on its own — that is always a separate, human notification assessment.
        </p>
      </div>

      <CreateIncidentForm
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        processes={processes.map((p) => ({ id: p.id, name: p.name }))}
        aspects={aspects.map((a) => ({ id: a.id, name: a.name }))}
      />

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Incidents</h2>
        <IncidentList incidents={rows} />
      </div>

      {canManage && (
        <IncidentPolicyWorkspace severityLevels={severityLevels.map((level) => ({ id: level.id, key: level.key, label: level.label, rank: level.rank }))} />
      )}
    </div>
  );
}
