import { describe, expect, it } from "vitest";
import { chatResponseSchema } from "@/lib/ai/schemas";
import { extractJsonObject } from "@/lib/ai/run";
import { assessDataCompleteness } from "@/lib/ai/carbon-context";

/**
 * Regression coverage for a real production incident: the general chat
 * assistant showed its internal planning ("We need to answer based on
 * supplied data...", "reasoningSummary must...") to the user instead of a
 * clean answer, and described a 0.00 tCO2e period with zero recorded
 * activity as a confirmed 100% emissions reduction.
 *
 * Two independent fixes, tested independently of any live model call:
 *
 *  1. Chat replies go through chatResponseSchema, and extractJsonObject only
 *     keeps the JSON object itself — planning text a model writes before or
 *     after the object is discarded before the Zod parse ever sees it, and
 *     any field the model invents beyond {answer, confidence, state,
 *     reasoningSummary} is stripped by the schema's default behaviour.
 *  2. assessDataCompleteness distinguishes a genuinely empty current period
 *     from a real (possibly zero) figure, from activity-entry counts alone —
 *     never from the calculated total, which looks identical either way.
 */

const LEAKED_PLANNING_TEXT =
  'We need to answer based on supplied data. The question asks about emissions comparison. We need to quote figures exactly. Must be plain prose. reasoningSummary must be one sentence. So answer should be: ';

describe("chat response: internal reasoning never reaches the user", () => {
  const cleanAnswer =
    "From January to August 2026, emissions were 12.4 tCO2e compared with 14.1 tCO2e for the same period in 2025, a reduction of 12.1%.";

  it("discards planning text a model writes outside the JSON object", () => {
    const modelOutput = `${LEAKED_PLANNING_TEXT}{"answer":${JSON.stringify(cleanAnswer)},"confidence":0.9,"state":"CONFIRMED","reasoningSummary":"Quoted the platform's own totals for both periods."}`;

    const parsed = chatResponseSchema.parse(extractJsonObject(modelOutput));

    expect(parsed.answer).toBe(cleanAnswer);
    expect(parsed.answer).not.toContain("We need to");
    expect(parsed.answer).not.toContain("reasoningSummary must");
    // Only the four contracted fields exist on the parsed result — nothing
    // else the model wrote survives, whatever it was called.
    expect(Object.keys(parsed).sort()).toEqual(["answer", "confidence", "reasoningSummary", "state"]);
  });

  it("strips unknown fields a model adds alongside the required ones", () => {
    const modelOutput = JSON.stringify({
      analysis: "Step one: check the data. Step two: compute the delta.",
      thinking: "The user wants a comparison, so I should...",
      scratchpad: "draft: emissions fell to zero",
      answer: cleanAnswer,
      confidence: 0.9,
      state: "CONFIRMED",
      reasoningSummary: "Quoted the platform's own totals for both periods.",
    });

    const parsed = chatResponseSchema.parse(extractJsonObject(modelOutput));

    expect(parsed).not.toHaveProperty("analysis");
    expect(parsed).not.toHaveProperty("thinking");
    expect(parsed).not.toHaveProperty("scratchpad");
    expect(parsed.answer).toBe(cleanAnswer);
  });

  it("recovers the object from a code-fenced reply with planning before and after it", () => {
    const modelOutput = [
      "Let me think about this step by step. The instruction says to quote figures exactly.",
      "```json",
      JSON.stringify({ answer: cleanAnswer, confidence: 0.85, state: "CONFIRMED", reasoningSummary: "See platform totals." }),
      "```",
      "I believe that answers the question correctly.",
    ].join("\n");

    const parsed = chatResponseSchema.parse(extractJsonObject(modelOutput));
    expect(parsed.answer).toBe(cleanAnswer);
  });

  it("rejects a reply that is nothing but planning text, rather than guessing at an answer", () => {
    expect(() => extractJsonObject("We need to answer based on supplied data. There is no JSON here.")).toThrow();
  });

  it("rejects a reasoningSummary field that is itself a chain-of-thought dump, by length", () => {
    const overlongReasoning = "We need to first check the totals, then compare them, then decide whether to mention data completeness, then phrase the answer, then double check units, then finalise. ".repeat(3);
    const result = chatResponseSchema.safeParse({
      answer: cleanAnswer,
      confidence: 0.9,
      state: "CONFIRMED",
      reasoningSummary: overlongReasoning,
    });
    expect(result.success).toBe(false);
  });
});

describe("assessDataCompleteness: true zero vs missing vs partial data", () => {
  it("flags a current period with zero recorded entries as NO_DATA, never a confirmed reduction", () => {
    const result = assessDataCompleteness(0, 40);
    expect(result.status).toBe("NO_DATA");
    expect(result.note).toMatch(/must never be described as an emissions reduction/i);
  });

  it("flags a current period with far fewer entries than the comparison period as PARTIAL_DATA", () => {
    const result = assessDataCompleteness(3, 40);
    expect(result.status).toBe("PARTIAL_DATA");
    expect(result.note).toMatch(/may still be incomplete/i);
  });

  it("treats comparable entry counts as complete, allowing a real comparison", () => {
    const result = assessDataCompleteness(38, 40);
    expect(result.status).toBe("COMPLETE");
  });

  it("does not flag partial data purely because the comparison period had no entries either", () => {
    // Nothing to be "far fewer" than — a first-ever reporting period, say.
    const result = assessDataCompleteness(5, 0);
    expect(result.status).toBe("COMPLETE");
  });

  it("treats a period with genuinely zero entries in both windows as no data, not a comparison", () => {
    expect(assessDataCompleteness(0, 0).status).toBe("NO_DATA");
  });
});
