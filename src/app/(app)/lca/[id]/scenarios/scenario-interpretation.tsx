"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { interpretScenarioAction, type ScenarioInterpretationState } from "../../actions";
import { Button } from "@/components/ui/button";
import { AiText } from "@/components/ai/ai-text";
import { AiProvenanceFootnote, AiSuggestionBadge, AiUnavailableNotice } from "@/components/ai/ai-disclosure";

const initialState: ScenarioInterpretationState = {
  error: null,
  aiUnavailable: false,
  scenarioId: null,
  interpretation: null,
  model: null,
};

/**
 * Asks the copilot to explain a scenario result.
 *
 * The percentages it quotes are computed by `compareScenario` before the model
 * is called — the model is handed a finished comparison and told to interpret
 * it, never to work anything out.
 */
export function ScenarioInterpretation({
  projectId,
  scenarioId,
  aiAvailable,
}: {
  projectId: string;
  scenarioId: string;
  aiAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(interpretScenarioAction, initialState);
  const isThis = state.scenarioId === scenarioId;

  return (
    <div className="mt-3 space-y-2">
      <form action={formAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="scenarioId" value={scenarioId} />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !aiAvailable}>
          <Sparkles className="h-4 w-4" />
          {pending ? "Interpreting…" : "Explain this result"}
        </Button>
      </form>

      {isThis && state.aiUnavailable && (
        <AiUnavailableNotice
          message={state.error ?? "AI interpretation is unavailable."}
          action="The scenario figures above were calculated by the platform and are unaffected."
        />
      )}
      {isThis && state.error && !state.aiUnavailable && <p className="text-sm text-red-600">{state.error}</p>}

      {isThis && state.interpretation && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <AiSuggestionBadge />
          <AiText text={state.interpretation} />
          <AiProvenanceFootnote model={state.model} />
        </div>
      )}
    </div>
  );
}
