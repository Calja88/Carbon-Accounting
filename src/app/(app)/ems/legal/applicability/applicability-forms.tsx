"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createApplicabilityAssessmentAction,
  decideApplicabilityAssessmentAction,
  discardApplicabilityAssessmentDraftAction,
  submitApplicabilityAssessmentForReviewAction,
  uploadApplicabilityEvidenceAction,
  type ApplicabilityActionState,
} from "./actions";

const emptyState: ApplicabilityActionState = { error: null, message: null };

type ChangeEventOption = {
  id: string;
  eventType: string;
  detectedAt: string;
  instrumentId: string;
  instrumentTitle: string;
  affectedInstrumentId: string | null;
  affectedInstrumentTitle: string | null;
  organisationAssessmentCount: number;
};

/** A T46 other-requirement source not yet (or already) assessed — the manual-source counterpart of ChangeEventOption. */
type OtherRequirementSourceOption = {
  id: string;
  type: string;
  title: string;
  issuingParty: string;
  organisationAssessmentCount: number;
};

type ScopeSummary = { id: string; label: string; kind: "entity" | "site" | "process" | "aspect" };

/** Either source id is set, never both — mirrors ApplicabilityAssessment.instrumentId/otherRequirementSourceId. */
type SourceKind = "instrument" | "other_requirement";

type AssessmentRow = {
  id: string;
  status: string;
  proposedDecision: string | null;
  rationale: string | null;
  instrumentId: string | null;
  otherRequirementSourceId: string | null;
  sourceKind: SourceKind;
  sourceLabel: string;
  changeEventId: string | null;
  assessedAt: string;
  reviewedAt: string | null;
  nextReviewAt: string | null;
  supersedesAssessmentId: string | null;
  scopes: ScopeSummary[];
  evidence: Array<{ id: string; filename: string }>;
  hasSuccessorEligible: boolean;
};

type Option = { id: string; name: string };

function Feedback({ state }: { state: ApplicabilityActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "APPLICABLE") return "success";
  if (status === "NOT_APPLICABLE") return "neutral";
  if (status === "UNCERTAIN") return "warning";
  if (status === "IN_REVIEW") return "info";
  if (status === "SUPERSEDED") return "neutral";
  return "info";
}

function ScopePicker({ uid, entities, sites, processes, aspects }: { uid: string; entities: Option[]; sites: Option[]; processes: Option[]; aspects: Option[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor={`entityIds-${uid}`}>Entities</Label>
        <select id={`entityIds-${uid}`} name="entityIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`siteIds-${uid}`}>Sites</Label>
        <select id={`siteIds-${uid}`} name="siteIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`processIds-${uid}`}>Processes</Label>
        <select id={`processIds-${uid}`} name="processIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`aspectIds-${uid}`}>Aspects</Label>
        <select id={`aspectIds-${uid}`} name="aspectIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}
        </select>
      </div>
      <p className="sm:col-span-2 text-xs text-slate-500">Select at least one scope across these four lists (ctrl/cmd-click for multiple).</p>
    </div>
  );
}

function CreateAssessmentForm({
  uid,
  sourceKind,
  sourceId,
  changeEventId,
  supersedesAssessmentId,
  entities,
  sites,
  processes,
  aspects,
  onCreated,
}: {
  uid: string;
  sourceKind: SourceKind;
  sourceId: string;
  changeEventId?: string | null;
  supersedesAssessmentId?: string | null;
  entities: Option[];
  sites: Option[];
  processes: Option[];
  aspects: Option[];
  onCreated?: () => void;
}) {
  const [state, action, pending] = useActionState(createApplicabilityAssessmentAction, emptyState);
  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-slate-200 p-4"
      onSubmit={() => onCreated?.()}
    >
      <input type="hidden" name={sourceKind === "instrument" ? "instrumentId" : "otherRequirementSourceId"} value={sourceId} />
      {changeEventId && <input type="hidden" name="changeEventId" value={changeEventId} />}
      {supersedesAssessmentId && <input type="hidden" name="supersedesAssessmentId" value={supersedesAssessmentId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`decision-${uid}`}>Proposed decision</Label>
          <Select id={`decision-${uid}`} name="decision" defaultValue="APPLICABLE" required>
            <option value="APPLICABLE">Applicable</option>
            <option value="NOT_APPLICABLE">Not applicable</option>
            <option value="UNCERTAIN">Uncertain</option>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor={`rationale-${uid}`}>Rationale</Label>
        <Textarea id={`rationale-${uid}`} name="rationale" required rows={3} placeholder="Synthetic example: applies to Site A's packaging line under GB-ENG jurisdiction." />
      </div>
      <ScopePicker uid={uid} entities={entities} sites={sites} processes={processes} aspects={aspects} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft assessment"}</Button>
    </form>
  );
}

function CandidateRow({
  event,
  entities,
  sites,
  processes,
  aspects,
  canAssess,
}: {
  event: ChangeEventOption;
  entities: Option[];
  sites: Option[];
  processes: Option[];
  aspects: Option[];
  canAssess: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{event.instrumentTitle}</p>
            <p className="text-xs text-slate-500">
              {event.eventType} · detected {new Date(event.detectedAt).toLocaleDateString("en-GB")}
              {event.affectedInstrumentTitle ? ` · affects ${event.affectedInstrumentTitle}` : ""}
            </p>
          </div>
          <Badge tone={event.organisationAssessmentCount > 0 ? "info" : "neutral"}>
            {event.organisationAssessmentCount > 0 ? `${event.organisationAssessmentCount} assessment(s)` : "Not yet assessed"}
          </Badge>
        </div>
        {canAssess && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Assess this candidate</summary>
            <div className="mt-3">
              <CreateAssessmentForm uid={`candidate-${event.id}`} sourceKind="instrument" sourceId={event.instrumentId} changeEventId={event.id} entities={entities} sites={sites} processes={processes} aspects={aspects} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function OtherRequirementCandidateRow({
  source,
  entities,
  sites,
  processes,
  aspects,
  canAssess,
}: {
  source: OtherRequirementSourceOption;
  entities: Option[];
  sites: Option[];
  processes: Option[];
  aspects: Option[];
  canAssess: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{source.title}</p>
            <p className="text-xs text-slate-500">{source.type} · {source.issuingParty}</p>
          </div>
          <Badge tone={source.organisationAssessmentCount > 0 ? "info" : "neutral"}>
            {source.organisationAssessmentCount > 0 ? `${source.organisationAssessmentCount} assessment(s)` : "Not yet assessed"}
          </Badge>
        </div>
        {canAssess && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Assess this source</summary>
            <div className="mt-3">
              <CreateAssessmentForm uid={`other-${source.id}`} sourceKind="other_requirement" sourceId={source.id} entities={entities} sites={sites} processes={processes} aspects={aspects} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function SubmitForReviewButton({ assessmentId }: { assessmentId: string }) {
  const [state, action, pending] = useActionState(submitApplicabilityAssessmentForReviewAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function DiscardDraftButton({ assessmentId }: { assessmentId: string }) {
  const [state, action, pending] = useActionState(discardApplicabilityAssessmentDraftAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        onClick={(event) => { if (!confirm("Discard this draft applicability assessment? This cannot be undone.")) event.preventDefault(); }}
      >
        {pending ? "Discarding…" : "Discard draft"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function UploadEvidenceForm({ assessmentId }: { assessmentId: string }) {
  const [state, action, pending] = useActionState(uploadApplicabilityEvidenceAction, emptyState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div><Label htmlFor={`evidenceFile-${assessmentId}`}>Attach evidence</Label><Input id={`evidenceFile-${assessmentId}`} name="file" type="file" required /></div>
      <div><Label htmlFor={`evidencePurpose-${assessmentId}`}>Purpose (optional)</Label><Input id={`evidencePurpose-${assessmentId}`} name="purpose" /></div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function DecideForm({ assessmentId, members, defaultDecision }: { assessmentId: string; members: Option[]; defaultDecision: string | null }) {
  const [state, action, pending] = useActionState(decideApplicabilityAssessmentAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`finalDecision-${assessmentId}`}>Final decision</Label>
          <Select id={`finalDecision-${assessmentId}`} name="decision" defaultValue={defaultDecision ?? "APPLICABLE"} required>
            <option value="APPLICABLE">Applicable</option>
            <option value="NOT_APPLICABLE">Not applicable</option>
            <option value="UNCERTAIN">Uncertain</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`nextReviewAt-${assessmentId}`}>Next review date</Label>
          <Input id={`nextReviewAt-${assessmentId}`} name="nextReviewAt" type="date" required />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`followUpOwnerMembershipId-${assessmentId}`}>Follow-up owner (required for Uncertain)</Label>
          <Select id={`followUpOwnerMembershipId-${assessmentId}`} name="followUpOwnerMembershipId" defaultValue="">
            <option value="">None</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor={`decideRationale-${assessmentId}`}>Rationale</Label>
        <Textarea id={`decideRationale-${assessmentId}`} name="rationale" required rows={3} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record decision"}</Button>
    </form>
  );
}

function AssessmentCard({
  assessment,
  entities,
  sites,
  processes,
  aspects,
  members,
  canAssess,
  canReview,
}: {
  assessment: AssessmentRow;
  entities: Option[];
  sites: Option[];
  processes: Option[];
  aspects: Option[];
  members: Option[];
  canAssess: boolean;
  canReview: boolean;
}) {
  return (
    <Card>
      <CardContent id={`assessment-${assessment.id}`} className="scroll-mt-24 space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{assessment.sourceLabel}</p>
            <p className="text-xs text-slate-500">
              {assessment.sourceKind === "instrument" ? "Legal instrument" : "Other requirement source"} · Assessed{" "}
              {new Date(assessment.assessedAt).toLocaleDateString("en-GB")}
              {assessment.reviewedAt ? ` · reviewed ${new Date(assessment.reviewedAt).toLocaleDateString("en-GB")}` : ""}
              {assessment.nextReviewAt ? ` · next review ${new Date(assessment.nextReviewAt).toLocaleDateString("en-GB")}` : ""}
            </p>
          </div>
          <Badge tone={statusTone(assessment.status)}>{assessment.status}</Badge>
        </div>
        {assessment.rationale && <p className="text-sm text-slate-600">{assessment.rationale}</p>}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scopes</p>
          {assessment.scopes.length === 0 ? (
            <p className="mt-1 text-sm text-amber-700">No scopes recorded.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1">
              {assessment.scopes.map((scope) => (
                <li key={scope.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{scope.kind}: {scope.label}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
          {assessment.evidence.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No evidence attached.</p>
          ) : (
            <ul className="mt-1 text-sm">
              {assessment.evidence.map((item) => (
                <li key={item.id}>
                  <a href={`/ems/evidence#evidence-${item.id}`} className="text-blue-700 underline">{item.filename}</a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(assessment.status === "DRAFT" || assessment.status === "IN_REVIEW") && canAssess && <UploadEvidenceForm assessmentId={assessment.id} />}
        {assessment.status === "DRAFT" && canAssess && <SubmitForReviewButton assessmentId={assessment.id} />}
        {assessment.status === "DRAFT" && canAssess && <DiscardDraftButton assessmentId={assessment.id} />}
        {assessment.status === "IN_REVIEW" && canReview && (
          <details open>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Decide</summary>
            <div className="mt-3">
              <DecideForm assessmentId={assessment.id} members={members} defaultDecision={assessment.proposedDecision} />
            </div>
          </details>
        )}
        {(assessment.status === "APPLICABLE" || assessment.status === "NOT_APPLICABLE" || assessment.status === "UNCERTAIN") &&
          assessment.hasSuccessorEligible &&
          canAssess && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-blue-700">Re-assess (creates a new draft)</summary>
              <div className="mt-3">
                <CreateAssessmentForm
                  uid={`reassess-${assessment.id}`}
                  sourceKind={assessment.sourceKind}
                  sourceId={(assessment.instrumentId ?? assessment.otherRequirementSourceId) as string}
                  changeEventId={assessment.changeEventId}
                  supersedesAssessmentId={assessment.id}
                  entities={entities}
                  sites={sites}
                  processes={processes}
                  aspects={aspects}
                />
              </div>
            </details>
          )}
      </CardContent>
    </Card>
  );
}

export function ApplicabilityWorkspace({
  changeEvents,
  otherRequirementSources,
  assessments,
  entities,
  sites,
  processes,
  aspects,
  members,
  canAssess,
  canReview,
}: {
  changeEvents: ChangeEventOption[];
  otherRequirementSources: OtherRequirementSourceOption[];
  assessments: AssessmentRow[];
  entities: Option[];
  sites: Option[];
  processes: Option[];
  aspects: Option[];
  members: Option[];
  canAssess: boolean;
  canReview: boolean;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Legal-change candidates awaiting assessment</h2>
        {changeEvents.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No triaged legal changes are currently queued.</CardContent></Card>
        ) : (
          changeEvents.map((event) => (
            <CandidateRow key={event.id} event={event} entities={entities} sites={sites} processes={processes} aspects={aspects} canAssess={canAssess} />
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Other requirement sources</h2>
        <p className="text-sm text-slate-500">
          Manually recorded permits, consents, regulator notices, contracts, customer requirements, and voluntary
          commitments. Manage the source record itself on the{" "}
          <a href="/ems/legal/other-requirements" className="text-blue-700 underline">other requirements</a> page.
        </p>
        {otherRequirementSources.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No active other-requirement sources recorded yet.</CardContent></Card>
        ) : (
          otherRequirementSources.map((source) => (
            <OtherRequirementCandidateRow key={source.id} source={source} entities={entities} sites={sites} processes={processes} aspects={aspects} canAssess={canAssess} />
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Applicability assessments</h2>
        {assessments.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No applicability assessments yet.</CardContent></Card>
        ) : (
          assessments.map((assessment) => (
            <AssessmentCard
              key={assessment.id}
              assessment={assessment}
              entities={entities}
              sites={sites}
              processes={processes}
              aspects={aspects}
              members={members}
              canAssess={canAssess}
              canReview={canReview}
            />
          ))
        )}
      </div>
    </div>
  );
}
