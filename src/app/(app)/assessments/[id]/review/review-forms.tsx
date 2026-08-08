"use client";

import { useActionState, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { LcaAssuranceType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { ASSURANCE_LABELS, STATUS_LABELS } from "@/lib/lca/labels";
import { emptyAssessmentState, emptyAssessmentState as emptyReviewState } from "@/lib/lca/form-state";
import { changeStatusAction, issueVersionAction } from "../../actions";
import { recordVerificationAction } from "./actions";

export function StatusTransitionForm({
  assessmentId,
  currentStatus,
  allowedNext,
  blockedReasons,
}: {
  assessmentId: string;
  currentStatus: string;
  allowedNext: { status: string; allowed: boolean; reason: string | null }[];
  blockedReasons: string[];
}) {
  const [state, formAction, pending] = useActionState(changeStatusAction, emptyAssessmentState);
  const [target, setTarget] = useState(allowedNext[0]?.status ?? "");

  if (allowedNext.length === 0) {
    return <p className="text-sm text-slate-500">This assessment is at the end of its workflow.</p>;
  }

  const selected = allowedNext.find((option) => option.status === target);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="status">Move to</Label>
          <Select id="status" name="status" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1">
            {allowedNext.map((option) => (
              <option key={option.status} value={option.status}>
                {STATUS_LABELS[option.status as keyof typeof STATUS_LABELS]}
                {option.allowed ? "" : " — blocked"}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="statusNote">Note (optional)</Label>
          <Input id="statusNote" name="note" className="mt-1" />
        </div>
      </div>

      {selected && !selected.allowed && selected.reason && <Notice tone="warning">{selected.reason}</Notice>}
      {blockedReasons.length > 0 && target === "READY_FOR_VERIFICATION" && (
        <Notice tone="danger" title="Validation errors must be cleared first">
          <ul className="ml-4 list-disc space-y-0.5">
            {blockedReasons.slice(0, 5).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Button type="submit" size="sm" disabled={pending || !selected?.allowed}>
        <ArrowRight className="h-4 w-4" />
        {pending ? "Updating…" : `Move from ${STATUS_LABELS[currentStatus as keyof typeof STATUS_LABELS].toLowerCase()}`}
      </Button>
    </form>
  );
}

export function IssueVersionForm({ assessmentId, nextVersion }: { assessmentId: string; nextVersion: number }) {
  const [state, formAction, pending] = useActionState(issueVersionAction, emptyAssessmentState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div>
        <Label htmlFor="versionLabel">Label for version {nextVersion}</Label>
        <Input id="versionLabel" name="label" className="mt-1" placeholder="Issued for customer disclosure" />
        <Hint>
          Issuing freezes the whole assessment — goal and scope, model, inventory, factor snapshots, results, registers,
          validation and readiness — into a version that cannot change afterwards.
        </Hint>
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Issuing…" : `Issue version ${nextVersion}`}
      </Button>
    </form>
  );
}

export function VerificationForm({ assessmentId }: { assessmentId: string }) {
  const [state, formAction, pending] = useActionState(recordVerificationAction, emptyReviewState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-4 w-4" />
        Record a verification
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <Notice tone="info">
        This records what an external reviewer concluded, attributed to them. The platform does not verify anything
        itself and never issues a certification.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="organisation">Verifying organisation</Label>
          <Input id="organisation" name="organisation" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="verifierName">Verifier</Label>
          <Input id="verifierName" name="verifierName" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="verificationDate">Date</Label>
          <Input id="verificationDate" name="verificationDate" type="date" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="assuranceType">Type of review or assurance</Label>
          <Select id="assuranceType" name="assuranceType" defaultValue={LcaAssuranceType.LIMITED_ASSURANCE} className="mt-1">
            {Object.entries(ASSURANCE_LABELS)
              .filter(([value]) => value !== "NONE")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="scopeOfVerification">What the verification covered</Label>
          <Textarea id="scopeOfVerification" name="scopeOfVerification" rows={2} required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="statementReference">Statement reference</Label>
          <Input id="statementReference" name="statementReference" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="statementUrl">Statement link</Label>
          <Input id="statementUrl" name="statementUrl" className="mt-1" placeholder="https://…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="conclusion">The verifier&apos;s conclusion, in their words</Label>
          <Textarea id="conclusion" name="conclusion" rows={3} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="verificationNotes">Notes</Label>
          <Textarea id="verificationNotes" name="notes" rows={2} className="mt-1" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record verification"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
