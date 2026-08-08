/**
 * The tool registry and its executor.
 *
 * This is the choke point. A model's reply can name a tool and hand over a
 * string; nothing else it produces reaches an application operation. Between
 * that string and any database access sit, in order:
 *
 *   1. the name must match a tool defined in this codebase;
 *   2. the tool must be one this conversation offers (LCA tools only inside an
 *      LCA project);
 *   3. the argument string must parse as JSON;
 *   4. the parsed object must satisfy the tool's Zod schema;
 *   5. the tool's own checks — authorization, ownership, business rules —
 *      must pass.
 *
 * A failure at any step is an outcome, not an exception: the model is told,
 * in the application's words, that the action did not happen and why, and the
 * user sees a refusal rather than a crash. Nothing is partially applied.
 */

import { AiAuthorizationError } from "../authorization";
import { CARBON_TOOLS } from "./carbon-tools";
import { LCA_TOOLS } from "./lca-tools";
import { AiToolContext, AiToolDefinition, AiToolOutcome, AiToolRequest, toolRefused } from "./types";

const ALL_TOOLS: AiToolDefinition<never>[] = [...CARBON_TOOLS, ...LCA_TOOLS];

/** Only what this conversation can legitimately use. */
export function toolsFor(options: { projectId: string | null }): AiToolDefinition<never>[] {
  return ALL_TOOLS.filter((tool) => (tool.lcaOnly ? Boolean(options.projectId) : true));
}

export function findTool(name: string, options: { projectId: string | null }): AiToolDefinition<never> | null {
  return toolsFor(options).find((tool) => tool.name === name) ?? null;
}

/** The catalogue as the model sees it: names, one-line summaries, argument shapes. */
export function renderToolCatalogue(options: { projectId: string | null }): string {
  return toolsFor(options)
    .map((tool) => `- ${tool.name}${tool.mutates ? " (changes stored data)" : ""}: ${tool.summary}\n  arguments: ${tool.argsHint}`)
    .join("\n");
}

const MAX_ARGUMENTS_CHARS = 4000;

/**
 * Runs one requested action, or explains why it didn't run.
 *
 * Never throws. A batch of three documents where one fails has to record the
 * other two, and a turn that asks for something impossible has to come back as
 * a sentence rather than a 500.
 */
export async function executeTool(request: AiToolRequest, context: AiToolContext): Promise<AiToolOutcome> {
  const tool = findTool(request.tool, { projectId: context.projectId });
  if (!tool) {
    return toolRefused(
      `REFUSED: "${request.tool}" is not an action this platform offers${
        context.projectId ? "" : " outside an LCA project"
      }. Nothing was done.`,
    );
  }

  if (request.argumentsJson.length > MAX_ARGUMENTS_CHARS) {
    return toolRefused(`REFUSED: the arguments for ${tool.name} were too long to be a real request. Nothing was done.`);
  }

  let raw: unknown;
  try {
    raw = request.argumentsJson.trim() === "" ? {} : JSON.parse(request.argumentsJson);
  } catch {
    return toolRefused(`REFUSED: the arguments for ${tool.name} were not valid JSON. Nothing was done.`);
  }

  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return toolRefused(
      `REFUSED: ${tool.name} was called with arguments this platform doesn't accept${path ? ` (${path}: ${issue?.message})` : ""}. Nothing was done.`,
    );
  }

  try {
    return await tool.run(parsed.data as never, context);
  } catch (err) {
    if (err instanceof AiAuthorizationError) {
      return toolRefused(`REFUSED: ${err.message} Nothing was done.`);
    }
    // The detail stays server-side; the model gets enough to say something
    // true and useless to an attacker.
    return toolRefused(`FAILED: ${tool.name} could not be completed. Nothing was changed.`);
  }
}

export type { AiToolContext, AiToolOutcome, AiToolRequest } from "./types";
