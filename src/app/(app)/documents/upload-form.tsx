"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { uploadDocumentAction, UploadDocumentState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const initialState: UploadDocumentState = { error: null, documentId: null, duplicateOfId: null, duplicateOfFilename: null };

export interface SiteOption {
  id: string;
  name: string;
  entityName: string;
}

export function UploadForm({
  sites,
  kinds,
  acceptedExtensions,
  maxBytes,
}: {
  sites: SiteOption[];
  kinds: { value: string; label: string }[];
  acceptedExtensions: string[];
  maxBytes: number;
}) {
  const [state, formAction, pending] = useActionState(uploadDocumentAction, initialState);
  const router = useRouter();

  // Straight to the review screen once the file is stored — uploading is a
  // step towards reviewing, not a destination. A matching hash carries
  // through as a query param so the review screen can show an advisory
  // "you already have this" notice without a second round trip.
  useEffect(() => {
    if (!state.documentId) return;
    const query = state.duplicateOfId ? `?duplicateOf=${state.duplicateOfId}` : "";
    router.push(`/documents/${state.documentId}${query}`);
  }, [state.documentId, state.duplicateOfId, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="file">Evidence file</Label>
        <input
          id="file"
          name="file"
          type="file"
          required
          accept={acceptedExtensions.join(",")}
          className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
        <p className="mt-1 text-xs text-slate-400">
          {acceptedExtensions.join(", ")} · up to {(maxBytes / (1024 * 1024)).toFixed(0)} MB
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="siteId">Site (optional)</Label>
          <Select id="siteId" name="siteId" defaultValue="" className="mt-1">
            <option value="">— not site-specific —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.entityName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="kind">Document type (optional)</Label>
          <Select id="kind" name="kind" defaultValue="UNKNOWN" className="mt-1">
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            Leave as &ldquo;not yet classified&rdquo; and AI will propose one; your choice always wins.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" name="notes" className="mt-1" placeholder="e.g. Q1 electricity bill, Hull" />
      </div>

      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        <Upload className="h-4 w-4" />
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
