"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  submitCompetenceEvidenceAction,
  verifyCompetenceEvidenceAction,
  rejectCompetenceEvidenceAction,
  type CompetenceEvidenceActionState,
} from "./actions";
import { COMPETENCE_EVIDENCE_TYPES } from "@/lib/ems/competence/evidence-schemas";

const emptyState: CompetenceEvidenceActionState = { error: null, message: null };

function Feedback({ state }: { state: CompetenceEvidenceActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export function SubmitEvidenceForm({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(submitCompetenceEvidenceAction, emptyState);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div>
        <Label htmlFor="evidenceType">Evidence type</Label>
        <Select id="evidenceType" name="evidenceType" defaultValue="TRAINING" required>
          {COMPETENCE_EVIDENCE_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="evidence-file">File</Label>
        <input id="evidence-file" name="file" type="file" className="block text-sm" required />
      </div>
      <div>
        <Label htmlFor="issuedDate">Issued date (optional)</Label>
        <Input id="issuedDate" name="issuedDate" type="date" />
      </div>
      <div>
        <Label htmlFor="expiryDate">Expiry date (optional)</Label>
        <Input id="expiryDate" name="expiryDate" type="date" />
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
        <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit evidence"}</Button>
      </div>
    </form>
  );
}

export function VerifyEvidenceButton({ evidenceId, assignmentId }: { evidenceId: string; assignmentId: string }) {
  const [state, formAction, pending] = useActionState(verifyCompetenceEvidenceAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Button type="submit" disabled={pending}>{pending ? "Verifying…" : "Verify"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function RejectEvidenceForm({ evidenceId, assignmentId }: { evidenceId: string; assignmentId: string }) {
  const [state, formAction, pending] = useActionState(rejectCompetenceEvidenceAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="w-full max-w-sm">
        <Label htmlFor={`reject-reason-${evidenceId}`}>Rejection reason</Label>
        <Textarea id={`reject-reason-${evidenceId}`} name="reason" rows={2} required />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Rejecting…" : "Reject"}</Button>
      <Feedback state={state} />
    </form>
  );
}
