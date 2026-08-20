import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getEnvironmentalIncident,
  listIncidentSeverityLevels,
  listIncidentEvidence,
  INCIDENT_MANAGE_PERMISSION,
} from "@/lib/ems/incidents/incident-service";
import { listIncidentNotificationAssessments } from "@/lib/ems/incidents/notification-assessment-service";
import {
  AssignSeverityForm,
  StartInvestigationButton,
  CompleteResponseButton,
  CloseIncidentButton,
  ReopenIncidentButton,
  IncidentCorrectionForm,
  NotificationAssessmentForm,
  IncidentEvidenceUploadForm,
} from "../incident-forms";

export const dynamic = "force-dynamic";

export default async function EnvironmentalIncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  let incident;
  try {
    incident = await getEnvironmentalIncident(context, id);
  } catch (error) {
    if (error instanceof TenantOwnershipError) redirect("/ems/incidents");
    throw error;
  }

  const canManage = hasPermission(context, INCIDENT_MANAGE_PERMISSION);

  const [severityLevels, evidence, notificationAssessments, reviewers] = await Promise.all([
    listIncidentSeverityLevels(context),
    listIncidentEvidence(context, id),
    listIncidentNotificationAssessments(context, id),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{incident.reference}</h1>
          <p className="mt-1 text-sm text-slate-500">{incident.type} · reported {incident.reportedAt.toISOString().slice(0, 10)}</p>
        </div>
        <div className="flex items-center gap-2">
          {incident.restricted && <Badge tone="warning">Restricted</Badge>}
          <Badge>{incident.status}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Current facts</h2>
          <div>
            <p className="text-sm font-medium text-slate-700">What happened</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{incident.currentFactualDescription}</p>
          </div>
          {incident.currentImmediateResponse && (
            <div>
              <p className="text-sm font-medium text-slate-700">Immediate response</p>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{incident.currentImmediateResponse}</p>
            </div>
          )}
          {incident.currentPotentialReceptors && (
            <div>
              <p className="text-sm font-medium text-slate-700">Potential receptors</p>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{incident.currentPotentialReceptors}</p>
            </div>
          )}
          {incident.corrections.length > 0 && (
            <details className="text-sm text-slate-500">
              <summary className="cursor-pointer">Original report and correction history ({incident.corrections.length})</summary>
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                <p><span className="font-medium">Original facts:</span> {incident.factualDescription}</p>
                {incident.immediateResponse && <p><span className="font-medium">Original response:</span> {incident.immediateResponse}</p>}
                {incident.potentialReceptors && <p><span className="font-medium">Original receptors:</span> {incident.potentialReceptors}</p>}
                {incident.corrections.map((correction) => (
                  <div key={correction.id} className="border-t border-slate-200 pt-2">
                    <p className="font-medium">Correction ({correction.correctedAt.toISOString().slice(0, 10)}): {correction.reason}</p>
                    {correction.correctedFactualDescription && <p>Facts: {correction.correctedFactualDescription}</p>}
                    {correction.correctedImmediateResponse && <p>Response: {correction.correctedImmediateResponse}</p>}
                    {correction.correctedPotentialReceptors && <p>Receptors: {correction.correctedPotentialReceptors}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Workflow</h2>
            <AssignSeverityForm
              incidentId={incident.id}
              levels={severityLevels.map((level) => ({ id: level.id, key: level.key, label: level.label, rank: level.rank }))}
              currentLabel={(incident.severityConfigSnapshot as { label?: string } | null)?.label ?? null}
            />
            <div className="flex flex-wrap gap-3">
              {incident.status === "TRIAGED" && <StartInvestigationButton incidentId={incident.id} />}
              {incident.status === "INVESTIGATING" && <CompleteResponseButton incidentId={incident.id} />}
              {incident.status === "RESPONSE_COMPLETE" && <CloseIncidentButton incidentId={incident.id} />}
              {incident.status === "CLOSED" && <ReopenIncidentButton incidentId={incident.id} />}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && <IncidentCorrectionForm incidentId={incident.id} />}

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Notification / reportability assessments</h2>
          <p className="text-sm text-slate-500">No decision here is automatic — every row was entered by a named competent reviewer.</p>
          {notificationAssessments.length === 0 ? (
            <p className="text-sm text-slate-500">No assessment recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notificationAssessments.map((assessment) => (
                <li key={assessment.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{assessment.authorityOrParty}: {assessment.decision}</p>
                  <p className="text-slate-600">{assessment.rationale}</p>
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <NotificationAssessmentForm
              incidentId={incident.id}
              reviewers={reviewers.map((member) => ({ id: member.id, name: member.user.name ?? member.id }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Evidence</h2>
          {evidence.length === 0 ? (
            <p className="text-sm text-slate-500">No evidence uploaded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {evidence.map((item) => (
                <li key={item.id}>
                  <a className="text-blue-600 hover:underline" href={`/api/ems/incidents/${incident.id}/evidence/${item.id}`}>
                    {item.filename}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {canManage && <IncidentEvidenceUploadForm incidentId={incident.id} />}
        </CardContent>
      </Card>
    </div>
  );
}
