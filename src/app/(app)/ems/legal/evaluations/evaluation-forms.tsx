"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createComplianceEvaluationProgrammeAction,
  createComplianceEvaluationAction,
  startComplianceEvaluationAction,
  recordComplianceEvaluationItemResultAction,
  requestComplianceEvaluationFindingLinkAction,
  completeComplianceEvaluationAction,
  issueComplianceEvaluationAction,
  type EvaluationActionState,
} from "./actions";

const emptyState: EvaluationActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type ProgrammeRow = {
  id: string;
  name: string;
  status: string;
  leadName: string;
  periodStart: string;
  periodEnd: string;
  evaluationCount: number;
};

export type EvaluationItemRow = {
  id: string;
  status: string;
  rationale: string | null;
  evaluatorName: string | null;
  evaluatedAt: string | null;
  followUpDate: string | null;
  obligationVersionId: string;
  obligationTitle: string;
  obligationVersion: number;
  instrumentTitle: string;
  findingLinks: Array<{ id: string; linkType: string; referenceNote: string; requestedAt: string }>;
};

export type EvaluationRow = {
  id: string;
  programmeName: string;
  leadName: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  scopes: Array<{ id: string; label: string; kind: "entity" | "site" }>;
  items: EvaluationItemRow[];
};

export type OverdueObligationRow = {
  obligationVersionId: string;
  title: string;
  version: number;
  reviewDueDate: string | null;
  reviewOverdue: boolean;
  neverEvaluated: boolean;
};

function Feedback({ state }: { state: EvaluationActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function evaluationStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ISSUED") return "success";
  if (status === "COMPLETED") return "info";
  if (status === "IN_PROGRESS") return "warning";
  return "neutral";
}

function itemStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "COMPLIANT") return "success";
  if (status === "NONCOMPLIANT") return "danger";
  if (status === "PARTIALLY_COMPLIANT") return "warning";
  if (status === "NOT_APPLICABLE") return "neutral";
  return "info";
}

function CreateProgrammeForm({ members }: { members: Option[] }) {
  const [state, action, pending] = useActionState(createComplianceEvaluationProgrammeAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input name="name" required placeholder="Synthetic example: 2026 Annual Compliance Evaluation" />
        </div>
        <div>
          <Label>Lead</Label>
          <Select name="leadMembershipId" required defaultValue="">
            <option value="" disabled>Choose a lead</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Period start</Label>
          <Input name="periodStart" type="date" required />
        </div>
        <div>
          <Label>Period end</Label>
          <Input name="periodEnd" type="date" required />
        </div>
        <div>
          <Label>Recurrence (optional)</Label>
          <Input name="recurrence" placeholder="e.g. ANNUAL" />
        </div>
      </div>
      <div>
        <Label>Description (optional)</Label>
        <Textarea name="description" rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create programme"}</Button>
    </form>
  );
}

function CreateEvaluationForm({
  programmeId,
  members,
  entities,
  sites,
}: {
  programmeId: string;
  members: Option[];
  entities: Option[];
  sites: Option[];
}) {
  const [state, action, pending] = useActionState(createComplianceEvaluationAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="programmeId" value={programmeId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Lead</Label>
          <Select name="leadMembershipId" required defaultValue="">
            <option value="" disabled>Choose a lead</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Period start</Label>
          <Input name="periodStart" type="date" required />
        </div>
        <div>
          <Label>Period end</Label>
          <Input name="periodEnd" type="date" required />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Entities in scope (optional)</Label>
          <select name="entityIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Sites in scope (optional)</Label>
          <select name="siteIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Leave both empty for an organisation-wide cycle covering every active compliance obligation. The evaluation is
        pre-populated with one item per matching active obligation version at creation time.
      </p>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create evaluation cycle"}</Button>
    </form>
  );
}

function StartButton({ evaluationId }: { evaluationId: string }) {
  const [state, action, pending] = useActionState(startComplianceEvaluationAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <Button type="submit" disabled={pending}>{pending ? "Starting…" : "Start evaluation"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function CompleteButton({ evaluationId }: { evaluationId: string }) {
  const [state, action, pending] = useActionState(completeComplianceEvaluationAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Completing…" : "Complete evaluation"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function IssueButton({ evaluationId }: { evaluationId: string }) {
  const [state, action, pending] = useActionState(issueComplianceEvaluationAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <Button type="submit" disabled={pending}>{pending ? "Issuing…" : "Issue evaluation report"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function RecordItemResultForm({ evaluationItemId }: { evaluationItemId: string }) {
  const [state, action, pending] = useActionState(recordComplianceEvaluationItemResultAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="evaluationItemId" value={evaluationItemId} />
      <div>
        <Label>Outcome</Label>
        <Select name="status" required defaultValue="">
          <option value="" disabled>Choose an outcome</option>
          <option value="COMPLIANT">Compliant</option>
          <option value="PARTIALLY_COMPLIANT">Partially compliant</option>
          <option value="NONCOMPLIANT">Noncompliant</option>
          <option value="NOT_APPLICABLE">Not applicable</option>
        </Select>
      </div>
      <div>
        <Label>Rationale</Label>
        <Textarea name="rationale" required rows={2} placeholder="Synthetic example only." />
      </div>
      <div>
        <Label>Follow-up date (optional)</Label>
        <Input name="followUpDate" type="date" />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Recording…" : "Record outcome"}</Button>
    </form>
  );
}

function FindingLinkForm({ evaluationItemId }: { evaluationItemId: string }) {
  const [state, action, pending] = useActionState(requestComplianceEvaluationFindingLinkAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="evaluationItemId" value={evaluationItemId} />
      <p className="text-xs text-amber-800">
        Requests a link to a nonconformity or corrective action. This is an interface call only — it does not create or
        close a nonconformity record itself; raise or link the actual record on the{" "}
        <Link href="/ems/nonconformities" className="underline">nonconformities &amp; CAPA</Link> page.
      </p>
      <div>
        <Label>Link type</Label>
        <Select name="linkType" required defaultValue="NONCONFORMITY">
          <option value="NONCONFORMITY">Nonconformity</option>
          <option value="CORRECTIVE_ACTION">Corrective action</option>
        </Select>
      </div>
      <div>
        <Label>Reference note</Label>
        <Textarea name="referenceNote" required rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Requesting…" : "Request finding link"}</Button>
    </form>
  );
}

function ItemRow({ item, canRecord }: { item: EvaluationItemRow; canRecord: boolean }) {
  const canRequestFindingLink = item.status === "NONCOMPLIANT" || item.status === "PARTIALLY_COMPLIANT";
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            <a href={`/ems/legal/obligations#obligation-version-${item.obligationVersionId}`} className="text-blue-700 underline">
              v{item.obligationVersion} · {item.obligationTitle}
            </a>
          </p>
          <p className="text-xs text-slate-500">{item.instrumentTitle}</p>
        </div>
        <Badge tone={itemStatusTone(item.status)}>{item.status}</Badge>
      </div>
      {item.rationale && <p className="text-sm text-slate-600">{item.rationale}</p>}
      {item.evaluatorName && (
        <p className="text-xs text-slate-500">
          Evaluated by {item.evaluatorName}{item.evaluatedAt ? ` · ${new Date(item.evaluatedAt).toLocaleString("en-GB")}` : ""}
        </p>
      )}
      {item.findingLinks.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800">
          {item.findingLinks.map((link) => (
            <li key={link.id}>
              {link.linkType} requested · {link.referenceNote} · {new Date(link.requestedAt).toLocaleString("en-GB")}
            </li>
          ))}
        </ul>
      )}
      {canRecord && item.status === "NOT_EVALUATED" && <RecordItemResultForm evaluationItemId={item.id} />}
      {canRecord && canRequestFindingLink && <FindingLinkForm evaluationItemId={item.id} />}
    </div>
  );
}

function EvaluationCard({ evaluation, canPerform }: { evaluation: EvaluationRow; canPerform: boolean }) {
  const outstanding = evaluation.items.filter((item) => item.status === "NOT_EVALUATED").length;
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{evaluation.programmeName}</p>
            <p className="text-xs text-slate-500">
              {new Date(evaluation.periodStart).toLocaleDateString("en-GB")} – {new Date(evaluation.periodEnd).toLocaleDateString("en-GB")} · lead{" "}
              {evaluation.leadName}
            </p>
          </div>
          <Badge tone={evaluationStatusTone(evaluation.status)}>{evaluation.status}</Badge>
        </div>
        {evaluation.scopes.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {evaluation.scopes.map((scope) => (
                <li key={scope.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{scope.kind}: {scope.label}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Items ({evaluation.items.length}{outstanding > 0 ? `, ${outstanding} outstanding` : ""})
          </p>
          <div className="mt-2 space-y-2">
            {evaluation.items.map((item) => (
              <ItemRow key={item.id} item={item} canRecord={canPerform && evaluation.status === "IN_PROGRESS"} />
            ))}
          </div>
        </div>
        {canPerform && evaluation.status === "PLANNED" && <StartButton evaluationId={evaluation.id} />}
        {canPerform && evaluation.status === "IN_PROGRESS" && <CompleteButton evaluationId={evaluation.id} />}
        {canPerform && evaluation.status === "COMPLETED" && <IssueButton evaluationId={evaluation.id} />}
        {evaluation.status === "ISSUED" && (
          <a
            className="text-sm font-medium text-blue-700 underline"
            href={`/api/ems/legal/evaluations/${evaluation.id}/report`}
            target="_blank"
            rel="noreferrer"
          >
            View issued report (frozen at {evaluation.issuedAt ? new Date(evaluation.issuedAt).toLocaleString("en-GB") : "issue time"})
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function OverdueTable({ rows }: { rows: OverdueObligationRow[] }) {
  if (rows.length === 0) {
    return (
      <Card><CardContent className="py-6 text-center text-sm text-slate-500">No active obligation is overdue or unevaluated.</CardContent></Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        {rows.map((row) => (
          <div key={row.obligationVersionId} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
            <div>
              <p className="text-sm font-medium text-slate-900">v{row.version} · {row.title}</p>
              <p className="text-xs text-slate-500">
                {row.reviewDueDate ? `Review due ${new Date(row.reviewDueDate).toLocaleDateString("en-GB")}` : "No review due date set"}
              </p>
            </div>
            <div className="flex gap-1">
              {row.reviewOverdue && <Badge tone="danger">Review overdue</Badge>}
              {row.neverEvaluated && <Badge tone="warning">Unevaluated</Badge>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ComplianceEvaluationWorkspace({
  programmes,
  evaluations,
  overdueObligations,
  members,
  entities,
  sites,
  canPerform,
}: {
  programmes: ProgrammeRow[];
  evaluations: EvaluationRow[];
  overdueObligations: OverdueObligationRow[];
  members: Option[];
  entities: Option[];
  sites: Option[];
  canPerform: boolean;
}) {
  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Overdue and unevaluated obligations</h2>
        <OverdueTable rows={overdueObligations} />
      </div>

      {canPerform && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Create an evaluation programme</h2>
          <CreateProgrammeForm members={members} />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Evaluation programmes</h2>
        {programmes.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No evaluation programme yet.</CardContent></Card>
        ) : (
          programmes.map((programme) => (
            <Card key={programme.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{programme.name}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(programme.periodStart).toLocaleDateString("en-GB")} – {new Date(programme.periodEnd).toLocaleDateString("en-GB")} · lead{" "}
                      {programme.leadName} · {programme.evaluationCount} evaluation(s)
                    </p>
                  </div>
                  <Badge tone={programme.status === "ACTIVE" ? "success" : "neutral"}>{programme.status}</Badge>
                </div>
                {canPerform && programme.status === "ACTIVE" && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-blue-700">Start a new evaluation cycle</summary>
                    <div className="mt-3">
                      <CreateEvaluationForm programmeId={programme.id} members={members} entities={entities} sites={sites} />
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Evaluation cycles</h2>
        {evaluations.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No evaluation cycle yet.</CardContent></Card>
        ) : (
          evaluations.map((evaluation) => <EvaluationCard key={evaluation.id} evaluation={evaluation} canPerform={canPerform} />)
        )}
      </div>
    </div>
  );
}
