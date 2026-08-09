/**
 * AI disclosure primitives.
 *
 * A reader must always be able to tell, at a glance, what they are looking
 * at: something a person entered, something imported, something AI read off a
 * document, something AI suggested, or a figure the platform calculated. That
 * distinction is a compliance requirement as much as a UX one, so the labels
 * live in one place and every AI surface uses them.
 */

import { Sparkles, ShieldCheck, FileUp, UserRound, Cog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/** The provenance of a value on screen. */
export type ValueOrigin =
  | "USER_ENTERED"
  | "IMPORTED"
  | "AI_EXTRACTED"
  | "AI_SUGGESTED"
  | "DERIVED"
  | "CALCULATED"
  | "SOURCE_STATED"
  | "CALCULATED_FROM_SOURCE"
  | "REVIEW_REQUIRED";

const ORIGIN_META: Record<ValueOrigin, { label: string; tone: "neutral" | "info" | "success" | "warning"; Icon: typeof Sparkles }> = {
  USER_ENTERED: { label: "Entered by a person", tone: "neutral", Icon: UserRound },
  IMPORTED: { label: "Imported", tone: "neutral", Icon: FileUp },
  AI_EXTRACTED: { label: "AI-extracted, accepted by a person", tone: "info", Icon: Sparkles },
  AI_SUGGESTED: { label: "AI suggestion", tone: "warning", Icon: Sparkles },
  DERIVED: { label: "Derived by the platform", tone: "neutral", Icon: Cog },
  CALCULATED: { label: "Calculated by the platform", tone: "success", Icon: ShieldCheck },
  // A2/A6: provenance for an extracted numeric field/proposal, distinct from
  // the blanket "AI suggestion" badge — a figure legible on the document
  // itself vs. one the platform derived from other source figures vs. one
  // that needs a person's input before it means anything.
  SOURCE_STATED: { label: "Stated in source", tone: "success", Icon: ShieldCheck },
  CALCULATED_FROM_SOURCE: { label: "Calculated from source", tone: "neutral", Icon: Cog },
  REVIEW_REQUIRED: { label: "Review required", tone: "warning", Icon: Sparkles },
};

export function OriginBadge({ origin, className }: { origin: ValueOrigin; className?: string }) {
  const meta = ORIGIN_META[origin];
  return (
    <Badge tone={meta.tone} className={className}>
      <meta.Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/**
 * The standing label on anything a model produced. Deliberately says
 * "suggestion" and never "result" — an AI output is an input to a decision,
 * not an outcome.
 */
export function AiSuggestionBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={className}>
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      AI suggestion — not verified
    </Badge>
  );
}

type Tone = "neutral" | "success" | "info" | "warning" | "danger";

const STATE_COPY: Record<string, { label: string; tone: Tone; hint: string }> = {
  CONFIRMED: { label: "Stated in the source", tone: "success", hint: "The supplied data states this directly." },
  SUGGESTED: { label: "Suggested", tone: "info", hint: "A well-supported reading that still needs checking." },
  NEEDS_REVIEW: { label: "Needs review", tone: "warning", hint: "Plausible but genuinely uncertain." },
  INSUFFICIENT_DATA: { label: "Not enough information", tone: "danger", hint: "The source doesn't answer this." },
};

/**
 * Confidence shown as a state *and* a number, with a bar. Never colour
 * alone — the same accessibility rule the dashboard charts follow.
 */
export function ConfidenceIndicator({
  state,
  confidence,
  className,
}: {
  state: string;
  confidence: number;
  className?: string;
}) {
  const copy: { label: string; tone: Tone; hint: string } =
    STATE_COPY[state] ?? { label: state, tone: "neutral", hint: "" };
  const percent = Math.round(Math.min(1, Math.max(0, confidence)) * 100);

  const barColor =
    percent >= 80 ? "bg-emerald-500" : percent >= 60 ? "bg-blue-500" : percent >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Badge tone={copy.tone}>{copy.label}</Badge>
      <div className="flex items-center gap-1.5" title={copy.hint}>
        <span
          className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
          role="img"
          aria-label={`Model confidence ${percent} per cent`}
        >
          <span className={cn("block h-full rounded-full", barColor)} style={{ width: `${percent}%` }} />
        </span>
        <span className="tabular-nums text-xs text-slate-500">{percent}%</span>
      </div>
    </div>
  );
}

/**
 * The standard message when AI can't run. It always says what still works,
 * because the answer is "everything else" — AI is an enhancement here, never
 * a dependency.
 */
export function AiUnavailableNotice({
  message,
  className,
  action,
}: {
  message: string;
  className?: string;
  action?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50/60 p-3", className)}>
      <p className="text-sm font-medium text-amber-900">AI assistance is unavailable</p>
      <p className="mt-1 text-sm text-amber-800">{message}</p>
      <p className="mt-1 text-sm text-amber-800">
        {action ?? "Everything else in the platform works as normal — you can carry on entering and reviewing data by hand."}
      </p>
    </div>
  );
}

/** Footnote under any AI answer, carrying the model actually used. */
export function AiProvenanceFootnote({
  model,
  usedFallback,
  className,
}: {
  model: string | null;
  usedFallback?: boolean;
  className?: string;
}) {
  return (
    <p className={cn("text-xs text-slate-400", className)}>
      Generated by AI{model ? ` using ${model}` : ""}
      {usedFallback ? " (fallback model — the first choice was unavailable)" : ""}. Check anything important against the
      underlying records; the platform&apos;s own calculations, not this text, are the source of truth.
    </p>
  );
}
