"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  uploadRevisionEvidenceAction,
  linkExistingEvidenceAction,
  submitRevisionForReviewAction,
  recordRevisionReviewAction,
  approveRevisionAction,
  publishRevisionEffectiveAction,
  createSuccessorRevisionAction,
  discardDraftRevisionAction,
  distributeRevisionAction,
  acknowledgeDistributionAction,
  type DocumentsActionState,
} from "../actions";

const emptyState: DocumentsActionState = { error: null, message: null };

type Option = { id: string; name: string };

function Feedback({ state }: { state: DocumentsActionState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.message && (
        <p aria-live="polite" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
    </>
  );
}

function HiddenIds({ documentId, revisionId }: { documentId: string; revisionId?: string }) {
  return (
    <>
      <input type="hidden" name="documentId" value={documentId} />
      {revisionId && <input type="hidden" name="revisionId" value={revisionId} />}
    </>
  );
}

export function UploadRevisionEvidenceForm({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(uploadRevisionEvidenceAction, emptyState);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <Label htmlFor={`file-${revisionId}`}>Upload new content</Label>
      <input id={`file-${revisionId}`} name="file" type="file" className="block text-sm" required />
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Upload & attach"}
      </Button>
    </form>
  );
}

export function LinkExistingEvidenceForm({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(linkExistingEvidenceAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <div>
        <Label htmlFor={`evidenceId-${revisionId}`}>Link existing evidence object ID</Label>
        <Input id={`evidenceId-${revisionId}`} name="evidenceId" className="mt-1" placeholder="From the evidence hub" required />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Linking…" : "Link"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function SubmitForReviewButton({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(submitRevisionForReviewAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Submitting…" : "Submit for review"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DiscardDraftRevisionButton({ documentId, revisionId, revisionNumber }: { documentId: string; revisionId: string; revisionNumber: number }) {
  const [state, formAction, pending] = useActionState(discardDraftRevisionAction, emptyState);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col gap-1"
      onSubmit={(event) => {
        if (!window.confirm(`Discard draft revision ${revisionNumber}? This cannot be undone.`)) event.preventDefault();
      }}
    >
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        {pending ? "Discarding…" : "Discard draft"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RecordReviewButton({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(recordRevisionReviewAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Recording…" : "Record review"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ApproveRevisionButton({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(approveRevisionAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      <Feedback state={state} />
      <p className="text-xs text-slate-500">Four-eyes: the preparer cannot approve their own revision.</p>
    </form>
  );
}

export function PublishRevisionEffectiveForm({ documentId, revisionId }: { documentId: string; revisionId: string }) {
  const [state, formAction, pending] = useActionState(publishRevisionEffectiveAction, emptyState);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`eff-${revisionId}`}>Effective date</Label>
          <Input id={`eff-${revisionId}`} name="effectiveDate" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor={`due-${revisionId}`}>Next review due</Label>
          <Input id={`due-${revisionId}`} name="reviewDueDate" type="date" className="mt-1" />
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Publishing…" : "Publish as effective"}
      </Button>
    </form>
  );
}

export function CreateSuccessorRevisionForm({ documentId }: { documentId: string }) {
  const [state, formAction, pending] = useActionState(createSuccessorRevisionAction, emptyState);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Create successor revision
      </Button>
    );
  }
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="documentId" value={documentId} />
      <Label htmlFor="changeSummary">Change summary</Label>
      <Textarea id="changeSummary" name="changeSummary" rows={2} className="mt-1" placeholder="What is changing and why" />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create successor draft"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DistributeRevisionForm({ documentId, revisionId, members }: { documentId: string; revisionId: string; members: Option[] }) {
  const [state, formAction, pending] = useActionState(distributeRevisionAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3">
      <HiddenIds documentId={documentId} revisionId={revisionId} />
      <div>
        <Label htmlFor={`aud-member-${revisionId}`}>Distribute to member</Label>
        <select id={`aud-member-${revisionId}`} name="audienceMembershipId" defaultValue="" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`aud-role-${revisionId}`}>or role</Label>
        <Input id={`aud-role-${revisionId}`} name="audienceRole" className="mt-1" placeholder="e.g. Site Manager" />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Recording…" : "Record distribution"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function AcknowledgeDistributionButton({ documentId, distributionId }: { documentId: string; distributionId: string }) {
  const [state, formAction, pending] = useActionState(acknowledgeDistributionAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="distributionId" value={distributionId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Acknowledging…" : "Acknowledge receipt"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
