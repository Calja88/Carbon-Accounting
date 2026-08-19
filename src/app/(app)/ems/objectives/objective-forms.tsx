"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createEnvironmentalObjectiveAction,
  createSuccessorEnvironmentalObjectiveVersionAction,
  decideEnvironmentalObjectiveVersionAction,
  decideObjectiveAchievementAction,
  cancelEnvironmentalObjectiveVersionAction,
  submitEnvironmentalObjectiveVersionForReviewAction,
  updateEnvironmentalObjectiveVersionDraftAction,
  createObjectiveMetricDefinitionAction,
  approveObjectiveMetricVersionAction,
  type ObjectiveActionState,
} from "./actions";

const emptyState: ObjectiveActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type SourceLinkRow = { id: string; linkType: string; label: string };

export type ObjectiveVersionRow = {
  id: string;
  objectiveId: string;
  version: number;
  status: string;
  title: string;
  intent: string;
  ownerName: string;
  baselineDescription: string;
  targetValue: string | null;
  targetQualitative: string | null;
  unit: string | null;
  targetDate: string;
  evaluationMethod: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  achievementDecidedAt: string | null;
  supersedesVersionId: string | null;
  sourceLinks: SourceLinkRow[];
  approvals: Array<{ id: string; decision: string; comment: string | null; decidedAt: string }>;
};

export type ObjectiveRow = {
  id: string;
  activeVersionId: string | null;
  versions: ObjectiveVersionRow[];
  metricDefinitions: Array<{ id: string; activeVersionId: string | null }>;
};

function Feedback({ state }: { state: ObjectiveActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE" || status === "ACHIEVED") return "success";
  if (status === "CANCELLED" || status === "NOT_ACHIEVED") return "danger";
  if (status === "SUPERSEDED") return "neutral";
  if (status === "IN_REVIEW" || status === "APPROVED") return "info";
  return "warning";
}

function SourceLinkPicker({
  policyRecords,
  aspectAssessments,
  obligationVersions,
  riskOpportunities,
  links,
  setLinks,
}: {
  policyRecords: Option[];
  aspectAssessments: Option[];
  obligationVersions: Option[];
  riskOpportunities: Option[];
  links: Array<Record<string, string>>;
  setLinks: (links: Array<Record<string, string>>) => void;
}) {
  const [linkType, setLinkType] = useState("ASPECT_ASSESSMENT");
  const [targetId, setTargetId] = useState("");
  const optionsByType: Record<string, Option[]> = {
    POLICY: policyRecords,
    ASPECT_ASSESSMENT: aspectAssessments,
    OBLIGATION_VERSION: obligationVersions,
    RISK_OPPORTUNITY: riskOpportunities,
  };
  const idFieldByType: Record<string, string> = {
    POLICY: "policyRecordId",
    ASPECT_ASSESSMENT: "aspectAssessmentId",
    OBLIGATION_VERSION: "obligationVersionId",
    RISK_OPPORTUNITY: "riskOpportunityId",
  };
  return (
    <div className="space-y-2">
      <Label>Source links (policy, aspect, obligation, risk/opportunity)</Label>
      <div className="flex flex-wrap gap-2">
        <Select value={linkType} onChange={(e) => { setLinkType(e.target.value); setTargetId(""); }} className="w-48">
          <option value="POLICY">Policy</option>
          <option value="ASPECT_ASSESSMENT">Aspect assessment</option>
          <option value="OBLIGATION_VERSION">Obligation version</option>
          <option value="RISK_OPPORTUNITY">Risk/opportunity</option>
        </Select>
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-64">
          <option value="">Choose a record</option>
          {(optionsByType[linkType] ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={!targetId}
          onClick={() => {
            setLinks([...links, { linkType, [idFieldByType[linkType]]: targetId }]);
            setTargetId("");
          }}
        >
          Add link
        </Button>
      </div>
      {links.length > 0 && (
        <ul className="text-xs text-slate-600">
          {links.map((link, index) => (
            <li key={index} className="flex items-center gap-2">
              {link.linkType}: {Object.values(link).find((v, i) => i > 0)}
              <button type="button" className="text-red-600" onClick={() => setLinks(links.filter((_, i) => i !== index))}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name="sourceLinks" value={JSON.stringify(links)} />
    </div>
  );
}

function DraftFields({
  members,
  policyRecords,
  aspectAssessments,
  obligationVersions,
  riskOpportunities,
}: {
  members: Option[];
  policyRecords: Option[];
  aspectAssessments: Option[];
  obligationVersions: Option[];
  riskOpportunities: Option[];
}) {
  const [links, setLinks] = useState<Array<Record<string, string>>>([]);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Title</Label>
          <Input name="title" required placeholder="Synthetic example: Reduce fictional pilot-site scope 2 intensity" />
        </div>
        <div>
          <Label>Owner</Label>
          <Select name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Target value (numeric, optional)</Label>
          <Input name="targetValue" type="number" step="any" placeholder="e.g. 10" />
        </div>
        <div>
          <Label>Unit (required with a numeric target)</Label>
          <Input name="unit" placeholder="e.g. tCO2e/unit" />
        </div>
        <div>
          <Label>Qualitative target (used instead of a numeric target)</Label>
          <Input name="targetQualitative" placeholder="e.g. Achieve certification" />
        </div>
        <div>
          <Label>Target date</Label>
          <Input name="targetDate" type="date" required />
        </div>
        <div>
          <Label>Baseline date (optional)</Label>
          <Input name="baselineDate" type="date" />
        </div>
      </div>
      <div>
        <Label>Intent</Label>
        <Textarea name="intent" required rows={2} placeholder="Synthetic intent text only." />
      </div>
      <div>
        <Label>Baseline description</Label>
        <Textarea name="baselineDescription" required rows={2} placeholder="Synthetic baseline text only." />
      </div>
      <div>
        <Label>Evaluation method</Label>
        <Textarea name="evaluationMethod" required rows={2} placeholder="How progress/achievement will be evaluated." />
      </div>
      <SourceLinkPicker
        policyRecords={policyRecords}
        aspectAssessments={aspectAssessments}
        obligationVersions={obligationVersions}
        riskOpportunities={riskOpportunities}
        links={links}
        setLinks={setLinks}
      />
    </>
  );
}

function CreateObjectiveForm(props: {
  members: Option[];
  policyRecords: Option[];
  aspectAssessments: Option[];
  obligationVersions: Option[];
  riskOpportunities: Option[];
}) {
  const [state, action, pending] = useActionState(createEnvironmentalObjectiveAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <DraftFields {...props} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft objective"}</Button>
    </form>
  );
}

function EditDraftForm({ version, ...props }: { version: ObjectiveVersionRow } & Parameters<typeof CreateObjectiveForm>[0]) {
  const [state, action, pending] = useActionState(updateEnvironmentalObjectiveVersionDraftAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="objectiveVersionId" value={version.id} />
      <DraftFields {...props} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
    </form>
  );
}

function SubmitForReviewButton({ objectiveVersionId }: { objectiveVersionId: string }) {
  const [state, action, pending] = useActionState(submitEnvironmentalObjectiveVersionForReviewAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="objectiveVersionId" value={objectiveVersionId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function DecideForm({ objectiveVersionId }: { objectiveVersionId: string }) {
  const [state, action, pending] = useActionState(decideEnvironmentalObjectiveVersionAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="objectiveVersionId" value={objectiveVersionId} />
      <div>
        <Label>Decision</Label>
        <Select name="decision" defaultValue="APPROVED" required>
          <option value="APPROVED">Approve (makes this version active)</option>
          <option value="REJECTED">Reject</option>
          <option value="RETURNED">Return for revision</option>
        </Select>
      </div>
      <div>
        <Label>Comment (optional)</Label>
        <Textarea name="comment" rows={2} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record decision"}</Button>
    </form>
  );
}

function AchievementForm({ objectiveVersionId }: { objectiveVersionId: string }) {
  const [state, action, pending] = useActionState(decideObjectiveAchievementAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="objectiveVersionId" value={objectiveVersionId} />
      <div>
        <Label>Achievement decision</Label>
        <Select name="achieved" defaultValue="true" required>
          <option value="true">Achieved</option>
          <option value="false">Not achieved</option>
        </Select>
      </div>
      <div>
        <Label>Rationale</Label>
        <Textarea name="rationale" rows={2} required placeholder="Explicit review rationale — never inferred from linked action completion." />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record achievement decision"}</Button>
    </form>
  );
}

function CancelForm({ objectiveVersionId }: { objectiveVersionId: string }) {
  const [state, action, pending] = useActionState(cancelEnvironmentalObjectiveVersionAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="objectiveVersionId" value={objectiveVersionId} />
      <Textarea name="rationale" rows={2} required placeholder="Rationale for cancelling." className="w-full" />
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Cancelling…" : "Cancel objective"}</Button>
    </form>
  );
}

function MetricDefinitionForm({ objectiveId, canApprove }: { objectiveId: string; canApprove: boolean }) {
  const [createState, createAction, createPending] = useActionState(createObjectiveMetricDefinitionAction, emptyState);
  return (
    <form action={createAction} className="space-y-3 rounded-lg border border-dashed border-slate-300 p-4">
      <input type="hidden" name="objectiveId" value={objectiveId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Metric name</Label>
          <Input name="name" required placeholder="Synthetic example: Scope 2 intensity" />
        </div>
        <div>
          <Label>Source type</Label>
          <Select name="sourceType" defaultValue="MANUAL" required>
            <option value="MANUAL">Manual</option>
            <option value="CORPORATE_CARBON">Corporate carbon</option>
            <option value="PRODUCT_LCA">Product LCA</option>
            <option value="MONITORING">Monitoring</option>
            <option value="DERIVED_APPROVED_FORMULA">Derived (approved formula)</option>
          </Select>
        </div>
        <div>
          <Label>Unit</Label>
          <Input name="unit" required placeholder="e.g. tCO2e/unit" />
        </div>
        <div>
          <Label>Frequency</Label>
          <Input name="frequency" required placeholder="e.g. Monthly" />
        </div>
      </div>
      <div>
        <Label>Boundary description (optional)</Label>
        <Textarea name="boundaryDescription" rows={2} />
      </div>
      <Feedback state={createState} />
      <Button type="submit" disabled={createPending}>{createPending ? "Saving…" : "Add draft metric definition"}</Button>
      {!canApprove && <p className="text-xs text-slate-500">Approval requires the objective-approval permission.</p>}
    </form>
  );
}

function ApproveMetricVersionButton({ metricVersionId }: { metricVersionId: string }) {
  const [state, action, pending] = useActionState(approveObjectiveMetricVersionAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="metricVersionId" value={metricVersionId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Approving…" : "Approve metric definition"}</Button>
      <Feedback state={state} />
    </form>
  );
}

/** `definition.activeVersionId` is null for a metric definition still on its first DRAFT version — that DRAFT version's id equals `activeVersionId` only once approved, so the draft's own version id isn't in the page's read shape yet. Approving a metric definition's first version is available today from `metric-service.ts` (used and tested there); wiring this button to real draft-version ids is a small follow-up once the objectives page also lists metric *versions*, not just definitions. */

function ObjectiveVersionCard({
  version,
  isActive,
  canEdit,
  canApprove,
  props,
}: {
  version: ObjectiveVersionRow;
  isActive: boolean;
  canEdit: boolean;
  canApprove: boolean;
  props: Parameters<typeof CreateObjectiveForm>[0];
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-900">
              v{version.version} — {version.title} {isActive && <span className="text-xs text-emerald-600">(active)</span>}
            </p>
            <p className="text-xs text-slate-500">Owner: {version.ownerName}</p>
          </div>
          <Badge tone={statusTone(version.status)}>{version.status}</Badge>
        </div>
        <p className="text-sm text-slate-700">{version.intent}</p>
        <p className="text-xs text-slate-500">
          Target: {version.targetValue ? `${version.targetValue} ${version.unit ?? ""}` : version.targetQualitative} — by{" "}
          {new Date(version.targetDate).toLocaleDateString()}
        </p>
        {version.sourceLinks.length > 0 && (
          <p className="text-xs text-slate-500">Links: {version.sourceLinks.map((link) => `${link.linkType}:${link.label}`).join(", ")}</p>
        )}
        {canEdit && version.status === "DRAFT" && (
          <details>
            <summary className="cursor-pointer text-sm text-slate-600">Edit draft</summary>
            <EditDraftForm version={version} {...props} />
          </details>
        )}
        {canEdit && version.status === "DRAFT" && <SubmitForReviewButton objectiveVersionId={version.id} />}
        {canApprove && version.status === "IN_REVIEW" && <DecideForm objectiveVersionId={version.id} />}
        {canApprove && isActive && version.status === "ACTIVE" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <AchievementForm objectiveVersionId={version.id} />
            <CancelForm objectiveVersionId={version.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ObjectiveWorkspace({
  objectives,
  members,
  policyRecords,
  aspectAssessments,
  obligationVersions,
  riskOpportunities,
  canEdit,
  canApprove,
}: {
  objectives: ObjectiveRow[];
  members: Option[];
  policyRecords: Option[];
  aspectAssessments: Option[];
  obligationVersions: Option[];
  riskOpportunities: Option[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const draftProps = { members, policyRecords, aspectAssessments, obligationVersions, riskOpportunities };
  return (
    <div className="space-y-8">
      {canEdit && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">New objective</h2>
          <CreateObjectiveForm {...draftProps} />
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Objectives</h2>
        {objectives.length === 0 && <p className="text-sm text-slate-500">No objectives yet.</p>}
        {objectives.map((objective) => {
          const latest = objective.versions[0];
          return (
            <div key={objective.id} className="space-y-3">
              {objective.versions.map((version) => (
                <ObjectiveVersionCard
                  key={version.id}
                  version={version}
                  isActive={objective.activeVersionId === version.id}
                  canEdit={canEdit}
                  canApprove={canApprove}
                  props={draftProps}
                />
              ))}
              {canEdit && latest && latest.status !== "DRAFT" && latest.status !== "IN_REVIEW" && (
                <details>
                  <summary className="cursor-pointer text-sm text-slate-600">Create successor version</summary>
                  <SuccessorForm objectiveId={objective.id} {...draftProps} />
                </details>
              )}

              {objective.activeVersionId && (
                <div className="ml-4 space-y-2 border-l border-slate-200 pl-4">
                  <h3 className="text-sm font-semibold text-slate-800">Metric definitions</h3>
                  {objective.metricDefinitions.map((definition) => (
                    <p key={definition.id} className="text-xs text-slate-500">
                      {definition.id} {definition.activeVersionId ? "(active version approved)" : "(no active version yet)"}
                    </p>
                  ))}
                  {canEdit && <MetricDefinitionForm objectiveId={objective.id} canApprove={canApprove} />}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function SuccessorForm({ objectiveId, ...props }: { objectiveId: string } & Parameters<typeof CreateObjectiveForm>[0]) {
  const [state, action, pending] = useActionState(createSuccessorEnvironmentalObjectiveVersionAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="objectiveId" value={objectiveId} />
      <DraftFields {...props} />
      <div>
        <Label>Revision rationale</Label>
        <Textarea name="revisionRationale" rows={2} required />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create successor draft"}</Button>
    </form>
  );
}

export { ApproveMetricVersionButton };
