/**
 * AI interpretation of the deterministic data-quality scan.
 *
 * The findings themselves are produced by `scanDataQuality` — ordinary code
 * over the database. The model is given that finished list and asked to
 * prioritise it and explain what it means, which is the part a model is
 * genuinely good at and the part where being wrong costs nothing that a human
 * can't correct.
 *
 * It is explicitly told not to invent additional issues. Any finding it
 * returns whose `relatesTo` doesn't line up with the scan is still shown, but
 * marked as unverified — it can never masquerade as one of the platform's own
 * checks.
 */

import { AiTaskType } from "@prisma/client";
import { DataQualityScan, formatScanForPrompt } from "@/lib/data-quality";
import { AiActor } from "../authorization";
import { formatMethodologyNotes, notesByTopic } from "../methodology";
import { dataQualityReviewSchema, DataQualityReview } from "../schemas";
import { runStructuredTask } from "../run";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { AiRunMetadata } from "../types";

export interface DataQualityInterpretation {
  review: DataQualityReview;
  meta: AiRunMetadata;
}

export async function analyseCarbonData(
  actor: AiActor,
  scan: DataQualityScan,
  siteId?: string | null,
): Promise<DataQualityInterpretation> {
  const notes = formatMethodologyNotes([...notesByTopic("data-quality"), ...notesByTopic("limitations")]);

  const systemPrompt = buildSystemPrompt({
    role: [
      "Your task is to interpret a list of data-quality findings that this platform has already produced.",
      "Do not add findings of your own about the data — you cannot see the underlying records and have no basis for one. Work with the list you are given: group related items, put them in the order a sustainability lead should tackle them, and explain the consequence of leaving each one.",
      "You may add a METHODOLOGY finding where the platform's own documented limitations bear on how these results should be read, and you must label it as such.",
      "Every number you mention must come from the list below. Never state an emissions figure of your own.",
      "suggestedAction must be something a person does — enter data, import a factor, check a bill, record a contract. Never suggest changing a number to make a total look better.",
    ].join(" "),
    context: `${formatScanForPrompt(scan)}\n\nRELEVANT METHODOLOGY:\n${notes}`,
    outputContract: JSON_ONLY_CONTRACT,
  });

  const run = await runStructuredTask<DataQualityReview>({
    task: AiTaskType.DATA_QUALITY_REVIEW,
    feature: "data-quality-review",
    systemPrompt,
    schema: dataQualityReviewSchema,
    schemaName: "data_quality_review",
    temperature: 0.1,
    maxOutputTokens: 2000,
    requirements: { prefersStructuredOutputs: true },
    messages: [
      {
        role: "user",
        content:
          "Prioritise these findings and explain what each one means for the reliability of this period's inventory.",
      },
    ],
    audit: {
      userId: actor.userId,
      siteId: siteId ?? null,
      relatedType: "DATA_QUALITY_SCAN",
      relatedId: null,
    },
  });

  return { review: run.data, meta: run.meta };
}
