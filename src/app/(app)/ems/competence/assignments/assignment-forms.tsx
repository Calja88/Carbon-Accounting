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
  assignCompetenceRequirementAction,
  startCompetenceAssignmentAction,
  markCompetenceAssignmentGapAction,
  type AssignmentActionState,
} from "./actions";

const emptyState: AssignmentActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type AssignmentRow = {
  id: string;
  personId: string;
  personName: string;
  requirementVersionId: string;
  requirementTitle: string;
  requirementVersion: number;
  status: string;
  dueDate: string | null;
};

function Feedback({ state }: { state: AssignmentActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "COMPETENT") return "success";
  if (status === "GAP" || status === "EXPIRED") return "danger";
  if (status === "IN_PROGRESS" || status === "EVIDENCE_SUBMITTED") return "info";
  return "warning";
}

export function CreateAssignmentForm({ people, activeVersions, defaultPersonId }: {
  people: Option[];
  activeVersions: Option[];
  defaultPersonId?: string;
}) {
  const [state, formAction, pending] = useActionState(assignCompetenceRequirementAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Assign a competence requirement</h2>
        <p className="text-sm text-slate-500">Only an ACTIVE requirement version can be assigned to an active person.</p>
        <form action={formAction} className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="assign-personId">Person</Label>
            <Select id="assign-personId" name="personId" defaultValue={defaultPersonId ?? ""} required>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="assign-requirementVersionId">Active requirement</Label>
            <Select id="assign-requirementVersionId" name="requirementVersionId" defaultValue="" required>
              <option value="">Choose…</option>
              {activeVersions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="assign-dueDate">Due date (optional)</Label>
            <Input id="assign-dueDate" name="dueDate" type="date" />
          </div>
          <div className="sm:col-span-3">
            <Feedback state={state} />
            <Button type="submit" disabled={pending}>{pending ? "Assigning…" : "Assign requirement"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function StartAssignmentButton({ assignmentId, personId }: { assignmentId: string; personId?: string }) {
  const [state, formAction, pending] = useActionState(startCompetenceAssignmentAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Starting…" : "Mark in progress"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function MarkGapForm({ assignmentId, personId }: { assignmentId: string; personId?: string }) {
  const [state, formAction, pending] = useActionState(markCompetenceAssignmentGapAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      <div className="w-full max-w-sm">
        <Label htmlFor={`gap-note-${assignmentId}`}>Gap note (optional)</Label>
        <Textarea id={`gap-note-${assignmentId}`} name="note" rows={2} />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Mark as gap"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function AssignmentList({ assignments, showPersonLink = true }: { assignments: AssignmentRow[]; showPersonLink?: boolean }) {
  if (assignments.length === 0) {
    return <p className="text-sm text-slate-500">No assignments visible to you yet.</p>;
  }
  return (
    <div className="space-y-2">
      {assignments.map((assignment) => (
        <div key={assignment.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {showPersonLink ? (
                <Link href={`/ems/competence/people/${assignment.personId}`} className="font-medium text-blue-700 hover:underline">
                  {assignment.personName}
                </Link>
              ) : (
                <p className="font-medium text-slate-900">{assignment.personName}</p>
              )}
              <p className="text-sm text-slate-500">
                v{assignment.requirementVersion} · {assignment.requirementTitle}
                {assignment.dueDate ? ` · due ${assignment.dueDate}` : ""}
              </p>
              <Link href={`/ems/competence/assignments/${assignment.id}`} className="text-sm text-blue-700 hover:underline">
                Evidence, assessment &amp; expiry
              </Link>
            </div>
            <Badge tone={statusTone(assignment.status)}>{assignment.status}</Badge>
          </div>
          {(assignment.status === "REQUIRED" || assignment.status === "IN_PROGRESS") && (
            <div className="mt-3 flex flex-wrap items-start gap-3">
              {assignment.status === "REQUIRED" && <StartAssignmentButton assignmentId={assignment.id} personId={assignment.personId} />}
              <MarkGapForm assignmentId={assignment.id} personId={assignment.personId} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
