"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { reviewProjectAction, keepFindingAction, type LcaReviewState } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiText } from "@/components/ai/ai-text";
import { AiProvenanceFootnote, AiSuggestionBadge, AiUnavailableNotice } from "@/components/ai/ai-disclosure";

const initialState: LcaReviewState = {
  error: null,
  aiUnavailable: false,
  summary: null,
  model: null,
  recommendations: [],
};

const SEVERITY_TONES: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  INFO: "neutral",
  LOW: "info",
  MEDIUM: "warning",
  HIGH: "danger",
};

/**
 * "What am I missing?" — the AI completeness review.
 *
 * Every recommendation is framed as a question or a proposal, is labelled an
 * AI suggestion, and does nothing to the study until someone keeps it. Kept
 * findings are stored with source = AI so the study's record always shows
 * where the AI helped. This is explicitly not a critical review.
 */
export function LcaReviewPanel({ projectId, aiAvailable }: { projectId: string; aiAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(reviewProjectAction, initialState);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>AI completeness review</CardTitle>
        <form action={formAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" variant="secondary" size="sm" disabled={pending || !aiAvailable}>
            <Sparkles className="h-4 w-4" />
            {pending ? "Reviewing…" : "Review this study"}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          Checks the study for methodological choices not yet recorded, flows that look likely to be missing, unmapped
          factors and weak data on the flows that dominate the result. It is advisory: it is not a critical review under
          ISO 14044, and nothing it says changes the study.
        </p>

        {state.aiUnavailable && <AiUnavailableNotice message={state.error ?? "AI review is unavailable."} />}
        {state.error && !state.aiUnavailable && <p className="text-sm text-red-600">{state.error}</p>}

        {state.summary && (
          <div className="space-y-3">
            <AiSuggestionBadge />
            <AiText text={state.summary} />
          </div>
        )}

        {state.recommendations.map((rec, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONES[rec.severity] ?? "neutral"}>{rec.severity.toLowerCase()}</Badge>
              <Badge tone="neutral">{rec.area.replace(/_/g, " ").toLowerCase()}</Badge>
              <span className="text-sm font-medium text-slate-900">{rec.title}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{rec.detail}</p>
            {rec.suggestedAction && (
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Suggested next step:</span> {rec.suggestedAction}
              </p>
            )}
            <form action={keepFindingAction} className="mt-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="category" value={rec.area} />
              <input type="hidden" name="severity" value={rec.severity} />
              <input type="hidden" name="finding" value={`${rec.title}: ${rec.detail}`} />
              <input type="hidden" name="suggestion" value={rec.suggestedAction ?? ""} />
              <Button type="submit" variant="ghost" size="sm">
                Keep as a review finding
              </Button>
            </form>
          </div>
        ))}

        {state.summary && <AiProvenanceFootnote model={state.model} />}
      </CardContent>
    </Card>
  );
}
