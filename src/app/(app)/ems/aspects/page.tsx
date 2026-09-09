import { readableEvidenceIds } from "@/lib/documents/classification-access";
import { requireUnscopedEmsAccess } from "@/lib/rbac/ems-access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { listActivityProcesses } from "@/lib/ems/aspects/process-service";
import { listEnvironmentalAspects, listEnvironmentalImpacts } from "@/lib/ems/aspects/aspect-service";
import { listEmsProgrammes } from "@/lib/ems/foundation/programme-service";
import { listAspectAssessments, listSignificanceMethods } from "@/lib/ems/aspects/significance-service";
import { listOperationalControls } from "@/lib/ems/controls/control-service";
import { AspectRegister } from "./aspect-forms";
import { SignificanceWorkspace } from "./significance-forms";

export const dynamic = "force-dynamic";

export default async function EmsAspectsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requireUnscopedEmsAccess(context);
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [processRows, aspectRows, impactRows, programmeRows, methodRows, assessmentRows, controlRows] = await Promise.all([
    listActivityProcesses(context),
    listEnvironmentalAspects(context),
    listEnvironmentalImpacts(context),
    listEmsProgrammes(context),
    listSignificanceMethods(context),
    listAspectAssessments(context),
    listOperationalControls(context),
  ]);
  const controlsByAspect = new Map<string, Array<{ id: string; label: string }>>();
  for (const control of controlRows) {
    if (control.status !== "ACTIVE") continue;
    for (const link of control.aspectLinks) {
      const current = controlsByAspect.get(link.aspectId) ?? [];
      current.push({ id: control.id, label: `${control.title} v${control.version}` });
      controlsByAspect.set(link.aspectId, current);
    }
  }
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

  const allowedEvidence = await readableEvidenceIds(context, evidenceLinks.map(link => link.evidence.id));
  const evidenceByAspect = new Map<string, Array<{ id: string; filename: string }>>();
  for (const link of evidenceLinks) {
    if (!allowedEvidence.has(link.evidence.id)) continue;
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
      <SignificanceWorkspace
        programmes={programmeRows.map((programme) => ({ id: programme.id, name: programme.name }))}
        aspects={aspectRows.map((aspect) => ({ id: aspect.id, name: aspect.name, programmeId: aspect.process.programmeId }))}
        methods={methodRows.map((method) => ({
          id: method.id,
          programmeId: method.programmeId,
          methodKey: method.methodKey,
          name: method.name,
          version: method.version,
          status: method.status,
          formula: method.formula,
          formulaConfig: method.formulaConfig,
          threshold: method.threshold.toString(),
          criteria: method.criteria.map((criterion) => ({
            key: criterion.key,
            label: criterion.label,
            scaleConfig: criterion.scaleConfig,
            weight: criterion.weight?.toString() ?? null,
            required: criterion.required,
            sortOrder: criterion.sortOrder,
          })),
        }))}
        assessments={assessmentRows.map((assessment) => ({
          id: assessment.id,
          aspectId: assessment.aspectId,
          assessmentVersion: assessment.assessmentVersion,
          status: assessment.status,
          methodKeySnapshot: assessment.methodKeySnapshot,
          methodVersionSnapshot: assessment.methodVersionSnapshot,
          formulaSnapshot: assessment.formulaSnapshot,
          thresholdSnapshot: assessment.thresholdSnapshot.toString(),
          criterionInputs: assessment.criterionInputs,
          calculatedScore: assessment.calculatedScore.toString(),
          calculatedSignificant: assessment.calculatedSignificant,
          overrideSignificant: assessment.overrideSignificant,
          overrideRationale: assessment.overrideRationale,
          finalSignificant: assessment.finalSignificant,
          calculationTrace: assessment.calculationTrace,
        }))}
        canEdit={hasPermission(context, "ems.aspect.edit")}
        canApprove={hasPermission(context, "ems.aspect.approve")}
      />
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
          controls: controlsByAspect.get(aspect.id) ?? [],
        }))}
        impacts={impactRows}
        canEdit={hasPermission(context, "ems.aspect.edit")}
      />
    </div>
  );
}
