"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createControlledDocumentAction, type DocumentsActionState } from "./actions";

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

export function CreateDocumentForm({ members }: { members: Option[] }) {
  const [state, formAction, pending] = useActionState(createControlledDocumentAction, emptyState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        New controlled document
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Create a controlled document</h2>
        <p className="text-sm text-slate-500">
          This creates the document record and its first DRAFT revision (revision 1). Attach content and submit for
          review from the document&apos;s detail page.
        </p>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" required className="mt-1" placeholder="POL-ENV-001" />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Input id="category" name="category" required className="mt-1" placeholder="policy / procedure / form" />
          </div>
          <div>
            <Label htmlFor="classification">Classification</Label>
            <Select id="classification" name="classification" defaultValue="INTERNAL" className="mt-1">
              <option value="PUBLIC">Public</option>
              <option value="INTERNAL">Internal</option>
              <option value="CONFIDENTIAL">Confidential</option>
              <option value="RESTRICTED">Restricted</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="ownerMembershipId">Owner</Label>
            <Select id="ownerMembershipId" name="ownerMembershipId" defaultValue="" className="mt-1">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="reviewIntervalMonths">Review interval (months)</Label>
            <Input id="reviewIntervalMonths" name="reviewIntervalMonths" type="number" min={1} max={120} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Feedback state={state} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create document"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
