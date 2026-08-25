"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createCompetenceAssessmentAction,
  completeCompetenceAssessmentAction,
  type CompetenceEvidenceActionState,
} from "./actions";

const emptyState: CompetenceEvidenceActionState = { error: null, message: null };

function Feedback({ state }: { state: CompetenceEvidenceActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export function CreateAssessmentForm({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(createCompetenceAssessmentAction, emptyState);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div>
        <Label htmlFor="method">Assessment method</Label>
        <Input id="method" name="method" required />
      </div>
      <div>
        <Label htmlFor="criteria">Criteria (optional)</Label>
        <Input id="criteria" name="criteria" />
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
        <Button type="submit" disabled={pending}>{pending ? "Drafting…" : "Draft assessment"}</Button>
      </div>
    </form>
  );
}

export function CompleteAssessmentForm({ assessmentId, assignmentId }: { assessmentId: string; assignmentId: string }) {
  const [state, formAction, pending] = useActionState(completeCompetenceAssessmentAction, emptyState);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div>
        <Label htmlFor={`outcome-${assessmentId}`}>Outcome</Label>
        <Select id={`outcome-${assessmentId}`} name="outcome" defaultValue="COMPETENT" required>
          <option value="COMPETENT">Competent</option>
          <option value="NOT_COMPETENT">Not competent</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`reassessment-${assessmentId}`}>Reassessment due (optional)</Label>
        <Input id={`reassessment-${assessmentId}`} name="reassessmentDueDate" type="date" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`rationale-${assessmentId}`}>Rationale (optional)</Label>
        <Textarea id={`rationale-${assessmentId}`} name="rationale" rows={2} />
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
        <Button type="submit" disabled={pending}>{pending ? "Completing…" : "Complete assessment"}</Button>
      </div>
    </form>
  );
}
