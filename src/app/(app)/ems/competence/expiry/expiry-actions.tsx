"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runCompetenceExpiryCheckAction, type ExpiryActionState } from "./actions";

const emptyState: ExpiryActionState = { error: null, message: null };

export function RunExpiryCheckButton() {
  const [state, formAction, pending] = useActionState(runCompetenceExpiryCheckAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Run expiry check now"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </form>
  );
}
