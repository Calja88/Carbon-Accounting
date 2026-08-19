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
  ensureDraftChecklistAction,
  addChecklistItemAction,
  removeChecklistItemAction,
  freezeChecklistAction,
  recordQuestionResponseAction,
  createAuditFindingAction,
  confirmAuditFindingAction,
  requireActionOnAuditFindingAction,
  acceptAuditFindingAsObservationAction,
  closeAuditFindingAction,
  createAuditReportDraftAction,
  issueAuditReportAction,
  type AuditActionState,
} from "../actions";

const emptyState: AuditActionState = { error: null, message: null };

type Option = { id: string; name: string };

function Feedback({ state }: { state: AuditActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export type ChecklistItemRow = {
  id: string;
  question: string;
  criteriaReference: string | null;
  expectedEvidence: string | null;
  response: { result: string; notes: string | null; auditorName: string } | null;
};

export type ChecklistRow = { id: string; version: number; status: string; items: ChecklistItemRow[] };

export type FindingRow = {
  id: string;
  classification: string;
  status: string;
  statement: string;
  objectiveEvidence: string | null;
  criterionReference: string | null;
};

export type ReportRow = { status: string; issuedAt: string | null; checksumSha256: string | null };

function findingTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "CLOSED") return "neutral";
  if (status === "ACTION_REQUIRED") return "danger";
  if (status === "CONFIRMED") return "warning";
  if (status === "ACCEPTED_OBSERVATION") return "info";
  return "neutral";
}

function ChecklistSection({
  auditId,
  auditStatus,
  checklist,
  auditingTeam,
}: {
  auditId: string;
  auditStatus: string;
  checklist: ChecklistRow | null;
  auditingTeam: Option[];
}) {
  const [startState, startAction, startPending] = useActionState(ensureDraftChecklistAction, emptyState);
  const [freezeState, freezeAction, freezePending] = useActionState(freezeChecklistAction, emptyState);
  const canEditChecklist = auditStatus === "PLANNED" || auditStatus === "PREPARATION";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Checklist</h2>
          {checklist && <Badge tone={checklist.status === "FROZEN" ? "success" : "warning"}>{checklist.status}</Badge>}
        </div>

        {!checklist && canEditChecklist && (
          <form action={startAction}>
            <input type="hidden" name="auditId" value={auditId} />
            <Button type="submit" size="sm" disabled={startPending}>{startPending ? "Starting…" : "Start checklist"}</Button>
            <Feedback state={startState} />
          </form>
        )}

        {!checklist && !canEditChecklist && <p className="text-sm text-slate-500">No checklist was prepared for this audit.</p>}

        {checklist && (
          <div className="space-y-3">
            {checklist.items.map((item) => (
              <ChecklistItemCard
                key={item.id}
                item={item}
                checklistFrozen={checklist.status === "FROZEN"}
                auditInProgress={auditStatus === "IN_PROGRESS"}
                auditingTeam={auditingTeam}
              />
            ))}
            {checklist.status === "DRAFT" && <AddChecklistItemForm checklistVersionId={checklist.id} />}
            {checklist.status === "DRAFT" && checklist.items.length > 0 && (
              <form action={freezeAction}>
                <input type="hidden" name="auditId" value={auditId} />
                <Button type="submit" size="sm" variant="secondary" disabled={freezePending}>
                  {freezePending ? "Freezing…" : "Freeze checklist"}
                </Button>
                <Feedback state={freezeState} />
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddChecklistItemForm({ checklistVersionId }: { checklistVersionId: string }) {
  const [state, action, pending] = useActionState(addChecklistItemAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded-md border border-slate-200 p-3">
      <input type="hidden" name="checklistVersionId" value={checklistVersionId} />
      <div>
        <Label>Question</Label>
        <Textarea name="question" rows={2} required placeholder="Synthetic example: Is the site's waste segregation procedure followed?" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label>Criteria reference (optional)</Label>
          <Input name="criteriaReference" placeholder="e.g. ISO 14001 §8.1" />
        </div>
        <div>
          <Label>Expected evidence (optional)</Label>
          <Input name="expectedEvidence" placeholder="Synthetic example only." />
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Adding…" : "Add question"}</Button>
    </form>
  );
}

function ChecklistItemCard({
  item,
  checklistFrozen,
  auditInProgress,
  auditingTeam,
}: {
  item: ChecklistItemRow;
  checklistFrozen: boolean;
  auditInProgress: boolean;
  auditingTeam: Option[];
}) {
  const [removeState, removeAction, removePending] = useActionState(removeChecklistItemAction, emptyState);
  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-800">{item.question}</p>
        {!checklistFrozen && (
          <form action={removeAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <Button type="submit" size="sm" variant="secondary" disabled={removePending}>{removePending ? "Removing…" : "Remove"}</Button>
          </form>
        )}
      </div>
      {item.criteriaReference && <p className="text-xs text-slate-500">Criteria: {item.criteriaReference}</p>}
      {item.expectedEvidence && <p className="text-xs text-slate-500">Expected evidence: {item.expectedEvidence}</p>}
      {item.response ? (
        <p className="text-xs text-slate-600">
          Answered: <span className="font-medium">{item.response.result}</span> by {item.response.auditorName}
          {item.response.notes && ` — ${item.response.notes}`}
        </p>
      ) : (
        checklistFrozen && auditInProgress && <RecordResponseForm checklistItemId={item.id} auditingTeam={auditingTeam} />
      )}
      <Feedback state={removeState} />
    </div>
  );
}

function RecordResponseForm({ checklistItemId, auditingTeam }: { checklistItemId: string; auditingTeam: Option[] }) {
  const [state, action, pending] = useActionState(recordQuestionResponseAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded border border-dashed border-slate-300 p-2">
      <input type="hidden" name="checklistItemId" value={checklistItemId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label>Result</Label>
          <Select name="result" required defaultValue="">
            <option value="" disabled>Choose a result</option>
            <option value="CONFORMS">Conforms</option>
            <option value="NONCONFORMANCE">Nonconformance</option>
            <option value="NOT_APPLICABLE">Not applicable</option>
          </Select>
        </div>
        <div>
          <Label>Responding auditor</Label>
          <Select name="auditorMembershipId" required defaultValue="">
            <option value="" disabled>Choose the auditor</option>
            {auditingTeam.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
      </div>
      <div>
        <Label>Notes (optional)</Label>
        <Textarea name="notes" rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Recording…" : "Record response"}</Button>
    </form>
  );
}

function FindingsSection({ auditId, findings, auditStatus }: { auditId: string; findings: FindingRow[]; auditStatus: string }) {
  const canRaise = auditStatus === "IN_PROGRESS" || auditStatus === "REPORT_DRAFT";
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <h2 className="text-lg font-semibold text-slate-900">Findings</h2>
        <p className="text-xs text-slate-500">
          A finding&apos;s classification is a working category the audit team assigns — it is never inferred automatically and is not a certification decision.
        </p>
        <div className="space-y-2">
          {findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} canRaise={canRaise} />
          ))}
        </div>
        {canRaise && <CreateFindingForm auditId={auditId} />}
      </CardContent>
    </Card>
  );
}

function FindingCard({ finding, canRaise }: { finding: FindingRow; canRaise: boolean }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmAuditFindingAction, emptyState);
  const [actionState, actionRequiredAction, actionPending] = useActionState(requireActionOnAuditFindingAction, emptyState);
  const [observationState, observationAction, observationPending] = useActionState(acceptAuditFindingAsObservationAction, emptyState);
  const [closeState, closeAction, closePending] = useActionState(closeAuditFindingAction, emptyState);

  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{finding.classification.replace(/_/g, " ")}</span>
        <Badge tone={findingTone(finding.status)}>{finding.status}</Badge>
      </div>
      <p className="text-slate-800">{finding.statement}</p>
      {finding.objectiveEvidence && <p className="text-xs text-slate-500">Objective evidence: {finding.objectiveEvidence}</p>}
      {finding.criterionReference && <p className="text-xs text-slate-500">Criterion: {finding.criterionReference}</p>}
      {canRaise && (
        <div className="flex flex-wrap gap-2">
          {finding.status === "DRAFT" && (
            <form action={confirmAction}>
              <input type="hidden" name="findingId" value={finding.id} />
              <Button type="submit" size="sm" disabled={confirmPending}>{confirmPending ? "Confirming…" : "Confirm"}</Button>
            </form>
          )}
          {finding.status === "CONFIRMED" && (
            <>
              <form action={actionRequiredAction}>
                <input type="hidden" name="findingId" value={finding.id} />
                <Button type="submit" size="sm" variant="secondary" disabled={actionPending}>{actionPending ? "Saving…" : "Requires action"}</Button>
              </form>
              <form action={observationAction}>
                <input type="hidden" name="findingId" value={finding.id} />
                <Button type="submit" size="sm" variant="secondary" disabled={observationPending}>{observationPending ? "Saving…" : "Accept as observation"}</Button>
              </form>
            </>
          )}
          {(finding.status === "ACTION_REQUIRED" || finding.status === "ACCEPTED_OBSERVATION") && (
            <form action={closeAction}>
              <input type="hidden" name="findingId" value={finding.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={closePending}>{closePending ? "Closing…" : "Close"}</Button>
            </form>
          )}
        </div>
      )}
      <Feedback state={confirmState} />
      <Feedback state={actionState} />
      <Feedback state={observationState} />
      <Feedback state={closeState} />
    </div>
  );
}

function CreateFindingForm({ auditId }: { auditId: string }) {
  const [state, action, pending] = useActionState(createAuditFindingAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded-md border border-slate-200 p-3">
      <input type="hidden" name="auditId" value={auditId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label>Classification</Label>
          <Select name="classification" required defaultValue="">
            <option value="" disabled>Choose a classification</option>
            <option value="OBSERVATION">Observation</option>
            <option value="OPPORTUNITY_FOR_IMPROVEMENT">Opportunity for improvement</option>
            <option value="MINOR_NONCONFORMITY">Minor nonconformity</option>
            <option value="MAJOR_NONCONFORMITY">Major nonconformity</option>
          </Select>
        </div>
        <div>
          <Label>Criterion reference (optional)</Label>
          <Input name="criterionReference" placeholder="e.g. ISO 14001 §8.1" />
        </div>
      </div>
      <div>
        <Label>Statement</Label>
        <Textarea name="statement" rows={2} required placeholder="Synthetic example only." />
      </div>
      <div>
        <Label>Objective evidence (optional)</Label>
        <Textarea name="objectiveEvidence" rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Raising…" : "Raise finding"}</Button>
    </form>
  );
}

function ReportSection({ auditId, auditStatus, report }: { auditId: string; auditStatus: string; report: ReportRow | null }) {
  const [draftState, draftAction, draftPending] = useActionState(createAuditReportDraftAction, emptyState);
  const [issueState, issueAction, issuePending] = useActionState(issueAuditReportAction, emptyState);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Audit report</h2>
          {report && <Badge tone={report.status === "ISSUED" ? "success" : "warning"}>{report.status}</Badge>}
        </div>

        {!report && auditStatus === "IN_PROGRESS" && (
          <form action={draftAction}>
            <input type="hidden" name="auditId" value={auditId} />
            <Button type="submit" size="sm" disabled={draftPending}>{draftPending ? "Starting…" : "Start report draft"}</Button>
            <Feedback state={draftState} />
          </form>
        )}

        {report && report.status === "DRAFT" && (
          <form action={issueAction}>
            <input type="hidden" name="auditId" value={auditId} />
            <Button type="submit" size="sm" disabled={issuePending}>{issuePending ? "Issuing…" : "Issue report"}</Button>
            <Feedback state={issueState} />
          </form>
        )}

        {report && report.status === "ISSUED" && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>Issued {report.issuedAt}. This report is frozen and cannot be edited.</p>
            {report.checksumSha256 && <p className="break-all text-xs text-slate-400">SHA-256: {report.checksumSha256}</p>}
            <a href={`/api/ems/audits/${auditId}/report`} className="text-sm font-medium text-blue-700 hover:underline">
              Download frozen report
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditExecutionWorkspace({
  auditId,
  auditStatus,
  checklist,
  findings,
  report,
  auditingTeam,
}: {
  auditId: string;
  auditStatus: string;
  checklist: ChecklistRow | null;
  findings: FindingRow[];
  report: ReportRow | null;
  auditingTeam: Option[];
  members: Option[];
}) {
  return (
    <div className="space-y-6">
      <ChecklistSection auditId={auditId} auditStatus={auditStatus} checklist={checklist} auditingTeam={auditingTeam} />
      <FindingsSection auditId={auditId} findings={findings} auditStatus={auditStatus} />
      <ReportSection auditId={auditId} auditStatus={auditStatus} report={report} />
    </div>
  );
}
