import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { buildReadinessReport, ALLOWED_TRANSITIONS, checkStatusTransition, READINESS_DESCRIPTIONS } from "@/lib/lca/readiness-service";
import { groupIssuesBySection, SEVERITY_TONES } from "@/lib/lca/validation-service";
import { canApproveLca, getLcaActor } from "@/lib/lca/permissions";
import { ASSURANCE_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/lca/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTable,
  Notice,
  PageHeading,
  ReadinessBadge,
  SectionCard,
  Stat,
  StatusBadge,
  Td,
} from "@/components/lca/ui";
import { IssueVersionForm, StatusTransitionForm, VerificationForm } from "./review-forms";
import { deleteVerificationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assessment, readiness, actor] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id } }),
    buildReadinessReport(id),
    getLcaActor(),
  ]);
  if (!assessment) notFound();

  const [verifications, versions] = await Promise.all([
    prisma.lcaVerification.findMany({
      where: { assessmentId: id },
      include: { recordedBy: true, evidence: true },
      orderBy: { verificationDate: "desc" },
    }),
    prisma.lcaAssessmentVersion.findMany({ where: { assessmentId: id }, orderBy: { version: "desc" } }),
  ]);

  const canApprove = canApproveLca(actor);
  const validation = readiness.validation;
  const grouped = groupIssuesBySection(validation);

  const allowedNext = await Promise.all(
    ALLOWED_TRANSITIONS[assessment.status].map(async (status) => {
      const check = await checkStatusTransition(id, assessment.status, status);
      return { status, allowed: check.allowed, reason: check.reason };
    }),
  );

  const blockedReasons = validation.issues.filter((i) => i.severity === "ERROR").map((i) => i.title);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Review and verification readiness"
        description="What an independent reviewer would find today, what is blocking, and the controls for moving this assessment through its workflow."
      />

      <Notice tone="info" title="What this page is, and is not">
        {readiness.disclaimer}
      </Notice>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <Stat label="Readiness" value=" " caption={<ReadinessBadge state={readiness.overall} />} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat label="Errors" value={String(validation.errorCount)} caption="Block readiness for verification" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat label="Warnings" value={String(validation.warningCount)} caption="A reviewer will ask about these" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat label="Advisory" value={String(validation.advisoryCount)} caption="Good practice not yet followed" />
          </CardContent>
        </Card>
      </div>

      <SectionCard title="Overall readiness" description={READINESS_DESCRIPTIONS[readiness.overall]}>
        <p className="text-sm text-slate-700">{readiness.overallExplanation}</p>
      </SectionCard>

      <SectionCard
        title="Readiness by area"
        description="Each area a reviewer works through, with the reason behind its state rather than just a colour."
      >
        <ul className="space-y-4">
          {readiness.areas.map((area) => (
            <li key={area.area} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">{area.label}</h3>
                <ReadinessBadge state={area.state} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{area.explanation}</p>
              {area.nextStep && (
                <p className="mt-2 text-sm font-medium text-slate-800">Next step: {area.nextStep}</p>
              )}
              {area.facts.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {area.facts.map((fact) => (
                    <li key={fact} className="text-xs text-slate-500">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Validation"
        description="Automated checks over the whole assessment. Errors mean a figure is wrong or missing and block readiness; warnings mean something material is undocumented; advisory items are good practice."
      >
        {grouped.length === 0 ? (
          <Notice tone="success" title="Nothing outstanding">
            No errors, warnings or advisory items. Every automated check passes.
          </Notice>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <div key={group.section}>
                <h3 className="text-sm font-semibold text-slate-900">{group.label}</h3>
                <ul className="mt-2 space-y-2">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{issue.title}</span>
                        <Badge tone={SEVERITY_TONES[issue.severity]}>{issue.severity.toLowerCase()}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{issue.detail}</p>
                      {issue.guidance && <p className="mt-1 text-xs text-slate-500">{issue.guidance}</p>}
                      {issue.target && (
                        <p className="mt-1.5 text-xs text-slate-500">
                          {issue.target.type === "inventory_item" ? (
                            <Link
                              href={`/assessments/${id}/inventory/${issue.target.id}`}
                              className="font-medium text-brand-700 hover:text-brand-800"
                            >
                              Open {issue.target.label} →
                            </Link>
                          ) : issue.target.type === "process" ? (
                            <Link href={`/assessments/${id}/model`} className="font-medium text-brand-700 hover:text-brand-800">
                              Open the lifecycle model →
                            </Link>
                          ) : (
                            <span>Relates to: {issue.target.label}</span>
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Status workflow"
          description="Draft → data collection → calculation → internal review → ready for verification → verified. Moving to ready for verification needs a clean validation run; moving to verified needs a verification record and an issued version."
        >
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {STATUS_ORDER.filter((s) => s !== "SUPERSEDED").map((status, index, all) => (
              <span key={status} className="flex items-center gap-1.5">
                <Badge tone={status === assessment.status ? "info" : "neutral"}>{STATUS_LABELS[status]}</Badge>
                {index < all.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
            Currently: <StatusBadge status={assessment.status} />
          </div>
          {canApprove ? (
            <StatusTransitionForm
              assessmentId={id}
              currentStatus={assessment.status}
              allowedNext={allowedNext}
              blockedReasons={blockedReasons}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Only a sustainability lead or an administrator can move an assessment through its workflow.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Versions"
          description="Issuing freezes the assessment. An issued version never changes; a later change means a new revision."
        >
          {versions.length === 0 ? (
            <p className="mb-4 text-sm text-slate-500">No version has been issued yet.</p>
          ) : (
            <ul className="mb-4 space-y-1.5">
              {versions.map((version) => (
                <li key={version.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/assessments/${id}/versions/${version.id}`} className="text-brand-700 hover:text-brand-800">
                    Version {version.version}
                    {version.label ? ` — ${version.label}` : ""}
                  </Link>
                  <Badge tone={version.status === "ISSUED" ? "success" : "neutral"}>{version.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
          {canApprove ? (
            <IssueVersionForm assessmentId={id} nextVersion={(versions[0]?.version ?? 0) + 1} />
          ) : (
            <p className="text-sm text-slate-500">Only a sustainability lead or an administrator can issue a version.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Verification record"
        description="An external reviewer's conclusion, recorded and attributed to them. This platform does not verify anything itself, and nothing it produces is a certification."
        actions={canApprove ? <VerificationForm assessmentId={id} /> : null}
      >
        {verifications.length === 0 ? (
          <p className="text-sm text-slate-500">
            No verification recorded. An assessment cannot be marked verified until one exists — the status will not
            claim more than the evidence supports.
          </p>
        ) : (
          <DataTable headers={["Organisation", "Verifier", "Date", "Type", "Scope", "Statement", "Evidence", ""]}>
            {verifications.map((verification) => (
              <tr key={verification.id}>
                <Td className="font-medium text-slate-900">{verification.organisation}</Td>
                <Td>{verification.verifierName}</Td>
                <Td className="text-xs">{verification.verificationDate.toISOString().slice(0, 10)}</Td>
                <Td className="text-xs">{ASSURANCE_LABELS[verification.assuranceType]}</Td>
                <Td className="text-xs">{verification.scopeOfVerification}</Td>
                <Td className="text-xs">
                  {verification.statementUrl ? (
                    <a href={verification.statementUrl} target="_blank" rel="noreferrer noopener" className="text-brand-700 hover:text-brand-800">
                      {verification.statementReference ?? "Statement"}
                    </a>
                  ) : (
                    (verification.statementReference ?? <span className="text-slate-400">—</span>)
                  )}
                </Td>
                <Td className="text-xs">
                  {verification.evidence.length > 0 ? (
                    `${verification.evidence.length} attached`
                  ) : (
                    <span className="text-amber-700">None attached</span>
                  )}
                </Td>
                <Td align="right">
                  {canApprove && (
                    <form action={deleteVerificationAction}>
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="verificationId" value={verification.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label="Remove verification record">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
