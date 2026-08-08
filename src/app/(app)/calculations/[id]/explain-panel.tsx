"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { explainInPlainEnglishAction, type ExplainState } from "./actions";
import { Button } from "@/components/ui/button";
import { AiText } from "@/components/ai/ai-text";
import { AiProvenanceFootnote, AiSuggestionBadge, AiUnavailableNotice } from "@/components/ai/ai-disclosure";

const initialState: ExplainState = { error: null, aiUnavailable: false, text: null, model: null };

export function ExplainPanel({ calculationId, aiAvailable }: { calculationId: string; aiAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(explainInPlainEnglishAction, initialState);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="calculationId" value={calculationId} />
          <input type="hidden" name="audience" value="non-technical" />
          <Button type="submit" variant="secondary" size="sm" disabled={pending || !aiAvailable}>
            <Sparkles className="h-4 w-4" />
            {pending ? "Writing…" : "Explain this to a non-technical reader"}
          </Button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="calculationId" value={calculationId} />
          <input type="hidden" name="audience" value="internal" />
          <Button type="submit" variant="ghost" size="sm" disabled={pending || !aiAvailable}>
            Explain for a practitioner
          </Button>
        </form>
      </div>

      {state.aiUnavailable && (
        <AiUnavailableNotice
          message={state.error ?? "AI explanations are unavailable."}
          action="The full calculation record above is produced by the platform itself and is unaffected."
        />
      )}
      {state.error && !state.aiUnavailable && <p className="text-sm text-red-600">{state.error}</p>}

      {state.text && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-4">
          <AiSuggestionBadge />
          <AiText text={state.text} />
          <AiProvenanceFootnote model={state.model} />
        </div>
      )}
    </div>
  );
}
