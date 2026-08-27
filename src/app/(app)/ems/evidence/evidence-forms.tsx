"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { discardUnlinkedEvidenceAction, type DocumentsActionState } from "../documents/actions";

export function EvidenceSearchForm({ initialQuery }: { initialQuery: string }) {
  return (
    <form action="/ems/evidence" method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="q">Search by filename</Label>
        <Input id="q" name="q" defaultValue={initialQuery} className="mt-1" placeholder="e.g. policy.pdf" />
      </div>
      <Button type="submit" size="sm" variant="secondary">
        Search
      </Button>
    </form>
  );
}

const emptyState: DocumentsActionState = { error: null, message: null };

/** Discards an evidence upload that has never been linked to anything — the accidental/duplicate-upload case. Never deletes real SharePoint content: only the storage bytes are removed (tombstoned), the metadata/checksum row is kept. */
export function DiscardUnlinkedEvidenceButton({ evidenceId, fileName }: { evidenceId: string; fileName: string }) {
  const [state, action, pending] = useActionState(discardUnlinkedEvidenceAction, emptyState);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Discard the unlinked evidence upload "${fileName}"? This removes the file's stored bytes and cannot be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? "Discarding…" : "Discard"}
      </Button>
      {state.error && <p role="alert" className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
