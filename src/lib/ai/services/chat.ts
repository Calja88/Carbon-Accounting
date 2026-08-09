/**
 * The carbon assistant.
 *
 * Context is assembled deterministically before the model is called: totals
 * and breakdowns from the same aggregation module the dashboard and reports
 * use, the platform's own methodology notes retrieved by relevance, and —
 * only when the question needs it — the activity data point catalogue.
 * Authorization is applied while assembling that context, never delegated to
 * the model.
 *
 * The model is a reader and an explainer. Every figure in an answer is one we
 * put in front of it; it is told, in the system prompt and by construction,
 * that it has no way to calculate anything itself.
 */

import { AiTaskType } from "@prisma/client";
import { AiActor } from "../authorization";
import { buildCarbonContext } from "../carbon-context";
import { formatMethodologyNotes, retrieveMethodologyNotes } from "../methodology";
import { runStructuredTask } from "../run";
import { chatResponseSchema, ChatResponse } from "../schemas";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { fenceUntrusted, newFenceNonce, truncateForPrompt, untrustedContentRules } from "../untrusted";
import { AiMessage, AiRunMetadata } from "../types";

export interface CarbonChatInput {
  question: string;
  periodStart: Date;
  periodEnd: Date;
  siteId?: string | null;
  /** Prior turns, oldest first. Trimmed to keep prompts bounded. */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface CarbonChatResult {
  answer: string;
  periodLabel: string;
  meta: AiRunMetadata;
}

const MAX_HISTORY_TURNS = 8;
const MAX_QUESTION_CHARS = 4000;

/** A question mentioning what the platform collects needs the catalogue too. */
function needsCatalogue(question: string): boolean {
  return /\b(missing|collect|record|enter|data point|category|categories|what should|which data|complete)\b/i.test(question);
}

export async function askCarbonAssistant(actor: AiActor, input: CarbonChatInput): Promise<CarbonChatResult> {
  const nonce = newFenceNonce();

  const context = await buildCarbonContext(actor, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    siteId: input.siteId ?? null,
    includeCatalogue: needsCatalogue(input.question),
  });

  const notes = formatMethodologyNotes(retrieveMethodologyNotes(input.question, 5));

  const systemPrompt = buildSystemPrompt({
    role: [
      "You are answering questions from the people who run this organisation's carbon accounting, through a chat panel in the product.",
      "Answer from the platform data and methodology given below. Quote figures from it exactly, with their units, and say which period they cover.",
      "If the data below does not answer the question, say so directly and say what would need to be entered or imported for it to be answerable. That is a useful answer; a guess is not.",
      "When you are drawing on general GHG accounting knowledge rather than this platform's data or methodology, say so in the sentence where you do it.",
      "Do not perform arithmetic on the figures given — quote the platform's own figures (including any percentage change) exactly as supplied, rather than computing your own. If a calculation is needed that the platform has not already done, say which report or screen produces it.",
      "Before describing any period-on-period decrease as a genuine reduction, check the DATA STATUS line in the COMPLETENESS section below. If it says NO_DATA, state plainly that no activity has been recorded for the current period yet and that the total shown reflects missing data, not a measured reduction — never say emissions 'decreased' or 'fell' in that case. If it says PARTIAL_DATA, say the comparison may not be reliable because the current period looks incomplete. Only describe a decrease as real when entry counts for the two periods are broadly comparable.",
      "Write `answer` as the complete, final reply the user will read: natural, concise plain prose or short bullet lists, no headings for a short answer, ready to display exactly as written with nothing added or removed.",
    ].join(" "),
    context: `OUR DATA:\n${context.text}\n\nOUR METHODOLOGY (authoritative for anything this platform calculates):\n${notes}`,
    outputContract: JSON_ONLY_CONTRACT,
    untrustedRules: untrustedContentRules(nonce),
  });

  const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS);
  const messages: AiMessage[] = [
    ...history.map((m) => ({ role: m.role, content: truncateForPrompt(m.content, 2000) })),
    {
      role: "user" as const,
      content: fenceUntrusted("QUESTION", truncateForPrompt(input.question, MAX_QUESTION_CHARS), nonce),
    },
  ];

  const run = await runStructuredTask<ChatResponse>({
    task: AiTaskType.GENERAL_CHAT,
    feature: "carbon-chat",
    systemPrompt,
    schema: chatResponseSchema,
    schemaName: "chat_response",
    messages,
    temperature: 0.2,
    maxOutputTokens: 1200,
    requirements: { prefersStructuredOutputs: true },
    audit: {
      userId: actor.userId,
      siteId: input.siteId ?? null,
      relatedType: "CARBON_CHAT",
      relatedId: null,
    },
  });

  // Only the validated `answer` field ever reaches the caller — confidence,
  // state and reasoningSummary are recorded in the audit row (see run.ts)
  // but are never rendered, and any field the model invented beyond this
  // schema was already discarded by the Zod parse before this line runs.
  return { answer: run.data.answer, periodLabel: context.periodLabel, meta: run.meta };
}
