"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/lca/ui";
import { emptyAssessmentState } from "@/lib/lca/form-state";
import { deleteDraftAssessmentAction } from "../actions";

/**
 * Removal action for an accidental or duplicate draft assessment. Only ever
 * rendered for a DRAFT assessment (see the layout that places it); the
 * server action re-checks status and every governed dependency regardless,
 * so this can never be the only thing standing between a click and a
 * destructive delete.
 */
export function DeleteDraftAssessmentButton({
  assessmentId,
  reference,
  dependencyHint,
}: {
  assessmentId: string;
  reference: string;
  /** Counts already loaded by the layout — shown up front so the confirm dialog isn't a guess. */
  dependencyHint?: { evidenceCount: number; scenarioCount: number };
}) {
  const [state, formAction, pending] = useActionState(deleteDraftAssessmentAction, emptyAssessmentState);
  const hasKnownDependency = Boolean(dependencyHint && (dependencyHint.evidenceCount > 0 || dependencyHint.scenarioCount > 0));

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-1"
      onSubmit={(event) => {
        const parts = [`Delete draft assessment ${reference}? This cannot be undone.`];
        if (dependencyHint) {
          if (dependencyHint.evidenceCount > 0) parts.push(`It has ${dependencyHint.evidenceCount} evidence file(s) attached.`);
          if (dependencyHint.scenarioCount > 0) parts.push(`It has ${dependencyHint.scenarioCount} scenario(s) copied from it.`);
        }
        if (!window.confirm(parts.join(" "))) event.preventDefault();
      }}
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <Button
        type="submit"
        size="sm"
        variant="danger"
        disabled={pending}
        title={hasKnownDependency ? "Has dependencies — deletion will likely be blocked; discontinue or supersede instead" : undefined}
      >
        <Trash2 className="h-4 w-4" />
        {pending ? "Deleting…" : "Delete draft"}
      </Button>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
    </form>
  );
}
