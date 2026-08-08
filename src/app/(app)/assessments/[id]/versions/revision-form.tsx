"use client";

import { useActionState, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint, Notice } from "@/components/lca/ui";
import { emptyAssessmentState } from "@/lib/lca/form-state";
import { createRevisionAction } from "../../actions";

export function CreateRevisionForm({
  assessmentId,
  suggestedReference,
  currentTitle,
}: {
  assessmentId: string;
  suggestedReference: string;
  currentTitle: string;
}) {
  const [state, formAction, pending] = useActionState(createRevisionAction, emptyAssessmentState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <GitBranch className="h-4 w-4" />
        Create a revision
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}

      <Notice tone="warning">
        A revision is a full copy of this assessment as a new, editable record. This assessment is marked superseded and
        becomes read-only — anything already issued from it stays exactly as it was.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="revisionReference">Reference</Label>
          <Input id="revisionReference" name="reference" required defaultValue={suggestedReference} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="revisionTitle">Title</Label>
          <Input id="revisionTitle" name="title" required defaultValue={currentTitle} className="mt-1" />
          <Hint>Say what the revision is for, so the two are distinguishable in a list.</Hint>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create revision"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
