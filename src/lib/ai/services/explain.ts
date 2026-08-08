/**
 * "Explain this calculation in plain English."
 *
 * The figures are produced by `explainCalculation` (deterministic, no AI) and
 * handed to the model already finished. The model's only job is wording: it
 * is told to restate the numbers exactly as given, and it is never given the
 * inputs in a form that would let it recompute anything — no factor lookup,
 * no unit conversion, no arithmetic.
 *
 * If the AI is unavailable, the deterministic explanation is still shown in
 * full. The plain-English paragraph is a convenience on top, never the
 * substance.
 */

import { AiTaskType } from "@prisma/client";
import { CalculationExplanation, formatExplanationForPrompt } from "@/lib/explain-calculation";
import { AiActor } from "../authorization";
import { runTextTask } from "../run";
import { buildSystemPrompt } from "../system-prompts";
import { AiRunMetadata } from "../types";
import { formatMethodologyNotes, retrieveMethodologyNotes } from "../methodology";

export interface PlainEnglishExplanation {
  text: string;
  meta: AiRunMetadata;
}

export async function explainCalculationInPlainEnglish(
  actor: AiActor,
  explanation: CalculationExplanation,
  audience: "internal" | "non-technical" = "non-technical",
): Promise<PlainEnglishExplanation> {
  const notes = formatMethodologyNotes(
    retrieveMethodologyNotes(`${explanation.scope} ${explanation.factor.category} calculation factor`, 3),
  );

  const systemPrompt = buildSystemPrompt({
    role: [
      "Your task is to restate a completed emissions calculation in clear English.",
      "Every number, unit, factor value, source name and date in your answer must appear verbatim in the calculation record below. Do not recalculate, re-round, convert, annualise or combine any figure — not even to be helpful.",
      "Do not add context the record does not contain: no benchmarks, no typical values, no comparisons to other organisations.",
      audience === "non-technical"
        ? "Write for someone who does not know what a 'scope' or an 'emission factor' is. Two or three short paragraphs, no jargon, no bullet lists."
        : "Write for a sustainability practitioner. Be concise and precise; keep the technical terms.",
      "If the record lists caveats, state them plainly at the end — they are the part a reader most needs.",
    ].join(" "),
    context: `CALCULATION RECORD (produced by this platform's deterministic engine):\n${formatExplanationForPrompt(explanation)}\n\nRELEVANT METHODOLOGY:\n${notes}`,
  });

  const run = await runTextTask({
    task: AiTaskType.CARBON_REASONING,
    feature: "explain-calculation",
    systemPrompt,
    temperature: 0.2,
    maxOutputTokens: 700,
    messages: [{ role: "user", content: "Explain how this figure was arrived at." }],
    audit: {
      userId: actor.userId,
      relatedType: "CALCULATION",
      relatedId: explanation.calculationId,
    },
  });

  return { text: run.data, meta: run.meta };
}
