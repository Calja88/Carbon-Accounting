/**
 * The action layer: what the assistant is allowed to *do*, as opposed to say.
 *
 * The division of labour is the whole design, and it is worth stating plainly
 * because it is what makes automatic data entry defensible:
 *
 *   the model INTERPRETS  — "this looks like an electricity invoice for July"
 *   the application VALIDATES — the data point, site, period, unit, factor and
 *                               duplicate checks, against the database
 *   the application WRITES — through the same services the UI uses
 *   the engine CALCULATES  — deterministically, from an approved factor
 *
 * A tool call from the model is therefore a *request*, not an instruction. It
 * arrives as a name and a JSON argument string, both untrusted; the name has
 * to match a tool defined in this codebase, the arguments have to satisfy that
 * tool's Zod schema, the actor has to be authorised for every id in them, and
 * the tool's own business rules have to pass. Anything else comes back as a
 * refusal the model can only narrate.
 *
 * There is no tool that takes a query, a filter expression, a table name or
 * anything else that would let a model reach data by describing it. Every read
 * is a fixed query with the actor's scope applied in code.
 */

import { z } from "zod";
import type { AiRuntimeConfig } from "../config";
import type { AiActor } from "../authorization";
import type { AssistantCard } from "../assistant-types";

export interface AiToolContext {
  actor: AiActor;
  config: AiRuntimeConfig;
  /**
   * The authenticated user's own message this turn.
   *
   * Used for the checks that must depend on what the *person* said rather than
   * on what the model reported they meant — overriding a duplicate warning,
   * confirming a retraction. Document contents never reach this field.
   */
  userMessage: string;
  /** Stable across retries of this turn; different between turns. */
  turnRequestId: string;
  /** The AiInteraction that produced the plan, for the provenance chain. */
  interactionId: string | null;
  periodStart: Date;
  periodEnd: Date;
  /** Documents attached this turn — already checked against the actor's scope. */
  attachmentDocumentIds: string[];
  /**
   * Entries this conversation has already created or discussed, supplied by
   * the panel from the cards it rendered. A conversational reference like
   * "that entry" can only ever resolve to one of these, so an ambiguous
   * pronoun can never reach an unrelated row.
   */
  conversationEntryIds: string[];
  /** The LCA assessment the conversation is inside, when it is inside one. */
  projectId: string | null;
}

export interface AiToolOutcome {
  ok: boolean;
  /**
   * What happened, in the application's own words, for the model to narrate.
   * Always built from database or calculation results — never echoed back
   * from the model's own arguments.
   */
  digest: string;
  cards: AssistantCard[];
  /** The one thing the user could say that would let this proceed. */
  question: string | null;
}

export function toolOk(digest: string, cards: AssistantCard[] = [], question: string | null = null): AiToolOutcome {
  return { ok: true, digest, cards, question };
}

export function toolRefused(digest: string, question: string | null = null): AiToolOutcome {
  return { ok: false, digest, cards: [], question };
}

export interface AiToolDefinition<TArgs = unknown> {
  name: string;
  /** One line, shown to the model in the tool catalogue. */
  summary: string;
  /** The argument shape, in prose, shown to the model. */
  argsHint: string;
  schema: z.ZodType<TArgs>;
  /** True when running it changes stored data. */
  mutates: boolean;
  /** Only offered inside an LCA project. */
  lcaOnly?: boolean;
  run(args: TArgs, context: AiToolContext): Promise<AiToolOutcome>;
}

/** A tool request as it arrives from the model — both fields untrusted. */
export interface AiToolRequest {
  tool: string;
  argumentsJson: string;
}
