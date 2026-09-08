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
  resolveObjectiveMetricObservationAction,
  type ObjectiveActionState,
  type MetricObservationState,
} from "./actions";

const emptyState: ObjectiveActionState = { error: null, message: null };
const emptyObservationState: MetricObservationState = { error: null, observations: null };

type Option = { id: string; name: string };

export type SourceLinkRow = { id: string; linkType: string; label: string; href: string | null };

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

export type MetricDefinitionRow = {
  id: string;
  activeVersionId: string | null;
  latestVersion: {
    id: string;
    name: string;
    sourceType: string;
    unit: string;
    frequency: string;
    status: string;
  } | null;
};

export type ObjectiveRow = {
  id: string;
  activeVersionId: string | null;
  versions: ObjectiveVersionRow[];
  metricDefinitions: MetricDefinitionRow[];
  actionProgrammeCount: number;
};

const ADAPTER_LINKED_SOURCE_TYPES = new Set(["CORPORATE_CARBON", "PRODUCT_LCA"]);

function dueTone(targetDate: string, status: string): { label: string; className: string } | null {
  if (["ACHIEVED", "NOT_ACHIEVED", "CANCELLED", "SUPERSEDED"].includes(status)) return null;
  const days = Math.ceil((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: `Overdue by ${Math.abs(days)}d`, className: "bg-red-100 text-red-700" };
  if (days <= 30) return { label: `Due in ${days}d`, className: "bg-amber-100 text-amber-700" };
  return { label: `Due in ${days}d`, className: "bg-slate-100 text-slate-600" };
}

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
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Source links (policy, aspect, obligation, risk/opportunity)</legend>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Source link type" value={linkType} onChange={(e) => { setLinkType(e.target.value); setTargetId(""); }} className="w-48">
          <option value="POLICY">Policy</option>
          <option value="ASPECT_ASSESSMENT">Aspect assessment</option>
          <option value="OBLIGATION_VERSION">Obligation version</option>
          <option value="RISK_OPPORTUNITY">Risk/opportunity</option>
        </Select>
        <Select aria-label="Source link record" value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-64">
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
    </fieldset>
  );
}

function DraftFields({
  idPrefix,
  members,
  policyRecords,
  aspectAssessments,
  obligationVersions,
  riskOpportunities,
}: {
  idPrefix: string;
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
          <Label htmlFor={`${idPrefix}-title`}>Title</Label>
          <Input id={`${idPrefix}-title`} name="title" required placeholder="Synthetic example: Reduce fictional pilot-site scope 2 intensity" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-owner`}>Owner</Label>
          <Select id={`${idPrefix}-owner`} name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-target-value`}>Target value (numeric, optional)</Label>
          <Input id={`${idPrefix}-target-value`} name="targetValue" type="number" step="any" placeholder="e.g. 10" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-unit`}>Unit (required with a numeric target)</Label>
          <Input id={`${idPrefix}-unit`} name="unit" placeholder="e.g. tCO2e/unit" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-target-qualitative`}>Qualitative target (used instead of a numeric target)</Label>
          <Input id={`${idPrefix}-target-qualitative`} name="targetQualitative" placeholder="e.g. Achieve certification" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-target-date`}>Target date</Label>
          <Input id={`${idPrefix}-target-date`} name="targetDate" type="date" required />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-baseline-date`}>Baseline date (optional)</Label>
          <Input id={`${idPrefix}-baseline-date`} name="baselineDate" type="date" />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-intent`}>Intent</Label>
        <Textarea id={`${idPrefix}-intent`} name="intent" required rows={2} placeholder="Synthetic intent text only." />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-baseline-description`}>Baseline description</Label>
        <Textarea id={`${idPrefix}-baseline-description`} name="baselineDescription" required rows={2} placeholder="Synthetic baseline text only." />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-evaluation-method`}>Evaluation method</Label>
        <Textarea id={`${idPrefix}-evaluation-method`} name="evaluationMethod" required rows={2} placeholder="How progress/achievement will be evaluated." />
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
      <DraftFields idPrefix="new-objective" {...props} />
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
      <DraftFields idPrefix={`edit-${version.id}`} {...props} />
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
        <Label htmlFor={`decision-${objectiveVersionId}`}>Decision</Label>
        <Select id={`decision-${objectiveVersionId}`} name="decision" defaultValue="APPROVED" required>
          <option value="APPROVED">Approve (makes this version active)</option>
          <option value="REJECTED">Reject</option>
          <option value="RETURNED">Return for revision</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`decision-comment-${objectiveVersionId}`}>Comment (optional)</Label>
        <Textarea id={`decision-comment-${objectiveVersionId}`} name="comment" rows={2} />
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
        <Label htmlFor={`achieved-${objectiveVersionId}`}>Achievement decision</Label>
        <Select id={`achieved-${objectiveVersionId}`} name="achieved" defaultValue="true" required>
          <option value="true">Achieved</option>
          <option value="false">Not achieved</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`achievement-rationale-${objectiveVersionId}`}>Rationale</Label>
        <Textarea id={`achievement-rationale-${objectiveVersionId}`} name="rationale" rows={2} required placeholder="Explicit review rationale — never inferred from linked action completion." />
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
  const [sourceType, setSourceType] = useState("MANUAL");
  return (
    <form action={createAction} className="space-y-3 rounded-lg border border-dashed border-slate-300 p-4">
      <input type="hidden" name="objectiveId" value={objectiveId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`metric-name-${objectiveId}`}>Metric name</Label>
          <Input id={`metric-name-${objectiveId}`} name="name" required placeholder="Synthetic example: Scope 2 intensity" />
        </div>
        <div>
          <Label htmlFor={`metric-source-type-${objectiveId}`}>Source type</Label>
          <Select id={`metric-source-type-${objectiveId}`} name="sourceType" value={sourceType} onChange={(e) => setSourceType(e.target.value)} required>
            <option value="MANUAL">Manual</option>
            <option value="CORPORATE_CARBON">Corporate carbon</option>
            <option value="PRODUCT_LCA">Product LCA</option>
            <option value="MONITORING">Monitoring</option>
            <option value="DERIVED_APPROVED_FORMULA">Derived (approved formula)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`metric-unit-${objectiveId}`}>Unit</Label>
          <Input id={`metric-unit-${objectiveId}`} name="unit" required placeholder="e.g. tCO2e/unit" />
        </div>
        <div>
          <Label htmlFor={`metric-frequency-${objectiveId}`}>Frequency</Label>
          <Input id={`metric-frequency-${objectiveId}`} name="frequency" required placeholder="e.g. Monthly" />
        </div>
      </div>
      <div>
        <Label htmlFor={`metric-boundary-${objectiveId}`}>Boundary description (optional)</Label>
        <Textarea id={`metric-boundary-${objectiveId}`} name="boundaryDescription" rows={2} />
      </div>

      {sourceType === "CORPORATE_CARBON" && (
        <div className="space-y-3 rounded-md bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">
            Corporate carbon adapter link (T51) — reads an existing issued report snapshot, never a live recalculation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`report-snapshot-${objectiveId}`}>Report snapshot ID</Label>
              <Input id={`report-snapshot-${objectiveId}`} name="reportSnapshotId" placeholder="Existing issued report snapshot id" />
            </div>
            <div>
              <Label htmlFor={`report-scope-${objectiveId}`}>Scope</Label>
              <Select id={`report-scope-${objectiveId}`} name="scope" defaultValue="">
                <option value="">Choose a scope</option>
                <option value="SCOPE_1">Scope 1</option>
                <option value="SCOPE_2">Scope 2</option>
                <option value="SCOPE_3">Scope 3</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`report-basis-${objectiveId}`}>Basis (Scope 2 only)</Label>
              <Select id={`report-basis-${objectiveId}`} name="basis" defaultValue="">
                <option value="">N/A</option>
                <option value="LOCATION_BASED">Location-based</option>
                <option value="MARKET_BASED">Market-based</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`report-category-${objectiveId}`}>Category (optional)</Label>
              <Input id={`report-category-${objectiveId}`} name="category" placeholder="Report category boundary" />
            </div>
            <div>
              <Label htmlFor={`report-site-${objectiveId}`}>Site ID (optional, mutually exclusive with category)</Label>
              <Input id={`report-site-${objectiveId}`} name="siteId" placeholder="Report site boundary" />
            </div>
            <div>
              <Label htmlFor={`report-period-start-${objectiveId}`}>Report period start</Label>
              <Input id={`report-period-start-${objectiveId}`} name="periodStart" type="date" />
            </div>
            <div>
              <Label htmlFor={`report-period-end-${objectiveId}`}>Report period end</Label>
              <Input id={`report-period-end-${objectiveId}`} name="periodEnd" type="date" />
            </div>
          </div>
        </div>
      )}

      {sourceType === "PRODUCT_LCA" && (
        <div className="space-y-3 rounded-md bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">
            Product LCA adapter link (T51) — reads one issued, frozen assessment version; never a live/mutable one.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`assessment-id-${objectiveId}`}>Assessment ID</Label>
              <Input id={`assessment-id-${objectiveId}`} name="assessmentId" placeholder="Existing product LCA assessment id" />
            </div>
            <div>
              <Label htmlFor={`assessment-version-id-${objectiveId}`}>Issued version ID</Label>
              <Input id={`assessment-version-id-${objectiveId}`} name="versionId" placeholder="Issued/superseded assessment version id" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`intensity-basis-${objectiveId}`}>Intensity basis</Label>
              <Select id={`intensity-basis-${objectiveId}`} name="intensityBasis" defaultValue="">
                <option value="">Choose a basis</option>
                <option value="HEADLINE_PER_FUNCTIONAL_UNIT">Headline, per functional unit</option>
                <option value="INCLUDING_BIOGENIC_PER_FUNCTIONAL_UNIT">Including biogenic, per functional unit</option>
              </Select>
            </div>
          </div>
        </div>
      )}

      <Feedback state={createState} />
      <Button type="submit" disabled={createPending}>{createPending ? "Saving…" : "Add draft metric definition"}</Button>
      {!canApprove && <p className="text-xs text-slate-500">Approval requires the objective-approval permission.</p>}
    </form>
  );
}

function ViewMetricReadingButton({ metricVersionId }: { metricVersionId: string }) {
  const [state, action, pending] = useActionState(resolveObjectiveMetricObservationAction, emptyObservationState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="metricVersionId" value={metricVersionId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Reading…" : "View adapter reading"}
      </Button>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
      {state.observations && state.observations.length === 0 && (
        <p className="text-xs text-slate-500">The adapter returned no observation for this configuration.</p>
      )}
      {state.observations && state.observations.length > 0 && (
        <ul className="space-y-1 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
          {state.observations.map((observation, index) => (
            <li key={index}>
              <span className="font-medium">{observation.value} {observation.unit}</span>{" "}
              ({observation.magnitudeKind.toLowerCase()}, {observation.periodStart} to {observation.periodEnd}) — read-only, from{" "}
              {String(observation.provenance.sourceType ?? "adapter")} record {String(observation.provenance.recordId ?? "")}.
            </li>
          ))}
        </ul>
      )}
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
              v{version.version} — {version.title} {isActive && <span className="text-xs text-emerald-700">(active)</span>}
            </p>
            <p className="text-xs text-slate-500">Owner: {version.ownerName}</p>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (() => {
              const due = dueTone(version.targetDate, version.status);
              return due ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${due.className}`}>{due.label}</span> : null;
            })()}
            <Badge tone={statusTone(version.status)}>{version.status}</Badge>
          </div>
        </div>
        <p className="text-sm text-slate-700">{version.intent}</p>
        <p className="text-xs text-slate-500">
          Target: {version.targetValue ? `${version.targetValue} ${version.unit ?? ""}` : version.targetQualitative} — by{" "}
          {new Date(version.targetDate).toLocaleDateString()}
        </p>
        {version.sourceLinks.length > 0 && (
          <p className="text-xs text-slate-500">
            Links:{" "}
            {version.sourceLinks.map((link, index) => (
              <span key={link.id}>
                {index > 0 && ", "}
                {link.href ? (
                  <a href={link.href} className="underline underline-offset-2 hover:text-slate-900">
                    {link.linkType}:{link.label}
                  </a>
                ) : (
                  `${link.linkType}:${link.label}`
                )}
              </span>
            ))}
          </p>
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
                <div className="ml-4 space-y-3 border-l border-slate-200 pl-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">Metric definitions</h3>
                    <a href="/ems/actions" className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">
                      {objective.actionProgrammeCount} supporting action programme{objective.actionProgrammeCount === 1 ? "" : "s"}
                    </a>
                  </div>
                  {objective.metricDefinitions.length === 0 && <p className="text-xs text-slate-500">No metric definitions yet.</p>}
                  {objective.metricDefinitions.map((definition) => (
                    <div key={definition.id} className="space-y-1 rounded-md border border-slate-100 p-2">
                      {definition.latestVersion ? (
                        <>
                          <p className="text-xs text-slate-700">
                            <span className="font-medium">{definition.latestVersion.name}</span> — {definition.latestVersion.sourceType} —{" "}
                            {definition.latestVersion.unit} — {definition.latestVersion.frequency}{" "}
                            <Badge tone={statusTone(definition.latestVersion.status)}>{definition.latestVersion.status}</Badge>
                          </p>
                          {ADAPTER_LINKED_SOURCE_TYPES.has(definition.latestVersion.sourceType) &&
                            (definition.latestVersion.status === "ACTIVE" || definition.latestVersion.status === "SUPERSEDED") && (
                              <ViewMetricReadingButton metricVersionId={definition.latestVersion.id} />
                            )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">{definition.id} (no version yet)</p>
                      )}
                    </div>
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
      <DraftFields idPrefix={`successor-${objectiveId}`} {...props} />
      <div>
        <Label htmlFor={`successor-${objectiveId}-revision-rationale`}>Revision rationale</Label>
        <Textarea id={`successor-${objectiveId}-revision-rationale`} name="revisionRationale" rows={2} required />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create successor draft"}</Button>
    </form>
  );
}

export { ApproveMetricVersionButton };
