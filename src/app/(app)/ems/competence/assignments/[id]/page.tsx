import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { COMPETENCE_SENSITIVE_VIEW_PERMISSION } from "@/lib/ems/competence/person-service";
import { listCompetenceEvidenceForAssignment } from "@/lib/ems/competence/evidence-service";
import { listCompetenceAssessmentsForAssignment } from "@/lib/ems/competence/assessment-service";
import { listEvidenceForResource } from "@/lib/documents/evidence-service";
import { SubmitEvidenceForm, VerifyEvidenceButton, RejectEvidenceForm } from "./evidence-forms";
import { CreateAssessmentForm, CompleteAssessmentForm } from "./assessment-forms";

export const dynamic = "force-dynamic";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "COMPETENT") return "success";
  if (status === "GAP" || status === "EXPIRED") return "danger";
  if (status === "IN_PROGRESS" || status === "EVIDENCE_SUBMITTED") return "info";
  return "warning";
}

export default async function CompetenceAssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);
  const assignment = await prisma.competenceAssignment.findFirst({
    where: tenantWhere(ctx, { id }),
    include: {
      person: { include: { membership: { include: { user: { select: { name: true } } } } } },
      requirementVersion: { include: { requirement: true } },
    },
  });
  if (!assignment) redirect("/ems/competence/assignments");

  const canManage = hasPermission(context, "ems.competence.manage");
  const canViewSensitive = hasPermission(context, COMPETENCE_SENSITIVE_VIEW_PERMISSION);

  const [evidence, assessments] = await Promise.all([
    canViewSensitive ? listCompetenceEvidenceForAssignment(context, id) : Promise.resolve([]),
    canViewSensitive ? listCompetenceAssessmentsForAssignment(context, id) : Promise.resolve([]),
  ]);

  const evidenceFiles = canViewSensitive
    ? await Promise.all(
        evidence.map(async (item) => ({
          id: item.id,
          files: await listEvidenceForResource(ctx, "competence_evidence", item.id),
        })),
      )
    : [];
  const filesByEvidenceId = new Map(evidenceFiles.map((entry) => [entry.id, entry.files]));

  const personName = assignment.person.displayName ?? assignment.person.membership?.user.name ?? "Unnamed person";
  const draftAssessment = assessments.find((assessment) => assessment.status === "DRAFT");
  const isExpiryPast = assignment.status === "EXPIRED";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {assignment.requirementVersion.requirement.requirementKey} — {assignment.requirementVersion.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            v{assignment.requirementVersion.version} ·{" "}
            <Link href={`/ems/competence/people/${assignment.person.id}`} className="text-blue-700 hover:underline">
              {personName}
            </Link>
            {assignment.dueDate ? ` · due ${assignment.dueDate.toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(assignment.status)}>{assignment.status}</Badge>
          {assignment.competentUntil && (
            <Badge tone={isExpiryPast ? "danger" : "neutral"}>
              {isExpiryPast ? "Expired" : "Valid until"} {assignment.competentUntil.toISOString().slice(0, 10)}
            </Badge>
          )}
        </div>
      </div>

      {assignment.gapNote && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {assignment.gapNote}
          {assignment.gapSince && ` (since ${assignment.gapSince.toISOString().slice(0, 10)})`}
        </div>
      )}

      <p className="text-sm text-slate-500">
        See the{" "}
        <Link href="/ems/competence/requirements" className="text-blue-700 hover:underline">
          requirement definition
        </Link>{" "}
        for what this version applies to and whether verified training alone can satisfy it. Attendance/training only
        completes this assignment directly when the requirement version&apos;s policy explicitly allows it — otherwise
        a completed assessment is required.
      </p>

      {canViewSensitive ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Evidence</h2>
            {evidence.length === 0 ? (
              <p className="text-sm text-slate-500">No evidence submitted yet.</p>
            ) : (
              <div className="space-y-2">
                {evidence.map((item) => {
                  const files = filesByEvidenceId.get(item.id) ?? [];
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{item.evidenceType}</p>
                          <p className="text-sm text-slate-500">
                            {item.issuedDate ? `Issued ${item.issuedDate.toISOString().slice(0, 10)}` : "No issue date"}
                            {item.expiryDate ? ` · expires ${item.expiryDate.toISOString().slice(0, 10)}` : ""}
                          </p>
                          {files.map((file) => (
                            <a
                              key={file.id}
                              href={`/api/ems/evidence/${file.id}`}
                              className="mt-1 block text-sm text-blue-600 hover:underline"
                            >
                              {file.filename}
                            </a>
                          ))}
                          {item.status === "REJECTED" && item.rejectionReason && (
                            <p className="mt-1 text-sm text-red-600">Rejected: {item.rejectionReason}</p>
                          )}
                        </div>
                        <Badge tone={item.status === "VERIFIED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>
                          {item.status}
                        </Badge>
                      </div>
                      {canManage && item.status === "SUBMITTED" && (
                        <div className="mt-3 flex flex-wrap items-start gap-3">
                          <VerifyEvidenceButton evidenceId={item.id} assignmentId={id} />
                          <RejectEvidenceForm evidenceId={item.id} assignmentId={id} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canManage && <SubmitEvidenceForm assignmentId={id} />}
          </CardContent>
        </Card>
      ) : canManage ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Submit evidence</h2>
            <p className="text-sm text-slate-500">
              You can submit evidence, but viewing existing evidence detail requires the sensitive-competence
              permission.
            </p>
            <SubmitEvidenceForm assignmentId={id} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-slate-400">Evidence detail is hidden — you do not hold the sensitive-competence permission.</p>
      )}

      {canViewSensitive && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Assessments</h2>
            <p className="text-sm text-slate-500">
              An assessment (not attendance) is what proves competence unless the requirement policy says otherwise.
            </p>
            {assessments.length === 0 ? (
              <p className="text-sm text-slate-500">No assessment recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {assessments.map((assessment) => (
                  <div key={assessment.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{assessment.method}</p>
                        {assessment.criteria && <p className="text-sm text-slate-500">{assessment.criteria}</p>}
                        {assessment.outcome && (
                          <p className="text-sm text-slate-500">
                            Outcome: {assessment.outcome}
                            {assessment.assessedAt ? ` · ${assessment.assessedAt.toISOString().slice(0, 10)}` : ""}
                          </p>
                        )}
                        {assessment.rationale && <p className="text-sm text-slate-500">{assessment.rationale}</p>}
                        {assessment.reassessmentDueDate && (
                          <p className="text-sm text-slate-500">
                            Reassessment due {assessment.reassessmentDueDate.toISOString().slice(0, 10)}
                          </p>
                        )}
                      </div>
                      <Badge tone={assessment.status === "COMPLETED" ? "success" : assessment.status === "SUPERSEDED" ? "neutral" : "warning"}>
                        {assessment.status}
                      </Badge>
                    </div>
                    {canManage && assessment.status === "DRAFT" && (
                      <div className="mt-3">
                        <CompleteAssessmentForm assessmentId={assessment.id} assignmentId={id} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canManage && !draftAssessment && <CreateAssessmentForm assignmentId={id} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
