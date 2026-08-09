"use client";

/**
 * The single delete pattern used across the app (G1): a trash icon that
 * expands into an inline "are you sure?" confirmation instead of a native
 * `confirm()` popup or a separate modal component, since neither existed
 * here yet and this keeps the affordance next to the record it acts on.
 */

import { useActionState, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "./button";

export interface DeleteActionState {
  error: string | null;
  success: boolean;
  message: string | null;
}

export const deleteActionInitialState: DeleteActionState = { error: null, success: false, message: null };

export function DeleteButton({
  action,
  hiddenFields,
  confirmText,
  label = "Delete",
  size = "sm",
}: {
  action: (prevState: DeleteActionState, formData: FormData) => Promise<DeleteActionState>;
  hiddenFields: Record<string, string>;
  confirmText: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [state, formAction, pending] = useActionState(action, deleteActionInitialState);
  const [confirming, setConfirming] = useState(false);

  if (state.success) {
    return <span className="text-sm font-medium text-slate-500">{state.message ?? "Deleted."}</span>;
  }

  if (!confirming) {
    return (
      <Button type="button" variant="danger" size={size} onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <span className="text-sm text-red-900">{confirmText}</span>
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Confirm delete
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        <X className="h-4 w-4" />
        Cancel
      </Button>
      {state.error && <span className="w-full text-sm text-red-700">{state.error}</span>}
    </form>
  );
}
