import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AiUnavailableError, resolveAiActor, AiAuthorizationError } from "@/lib/ai";
import { runAssistantTurn } from "@/lib/ai/services/agent";
import { claimDedupeSlot, dedupeKey } from "@/lib/ai/rate-limit";
import { resolveMonthRange } from "@/lib/report-period";
import type { AssistantTurnResponse } from "@/lib/ai/assistant-types";

/**
 * The assistant endpoint, for both the group-wide carbon assistant and the
 * LCA copilot (which one runs is decided by whether a projectId is supplied).
 *
 * Authorization happens here, before any context is assembled: an
 * unauthenticated request never reaches a model, and an assessment id, site id
 * or document id the caller can't see is rejected by the scope check rather
 * than filtered out later.
 *
 * A turn can now change stored data, which makes two things load-bearing:
 *
 *  - `turnRequestId` is supplied by the client and is stable across retries of
 *    one submitted turn. It is what makes an entry created during that turn
 *    idempotent, so a dropped response the browser retries cannot record the
 *    same invoice twice.
 *  - `conversationEntryIds` are the entries this conversation has actually
 *    created. A conversational reference ("change that to 1,550") can only
 *    resolve to one of them, so an ambiguous pronoun cannot reach an unrelated
 *    row — and the server re-checks ownership and provenance on top.
 *
 * Every failure comes back as a structured, non-500 response so the UI can
 * say "AI is unavailable, carry on manually" instead of showing an error page.
 */

const bodySchema = z.object({
  question: z.string().min(1, "Ask a question.").max(4000),
  from: z.string().optional(),
  to: z.string().optional(),
  siteId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .optional(),
  attachmentDocumentIds: z.array(z.string().max(64)).max(10).optional(),
  conversationEntryIds: z.array(z.string().max(64)).max(50).optional(),
  turnRequestId: z.string().min(1).max(64).optional(),
});

export async function POST(request: NextRequest) {
  const actor = await resolveAiActor();
  if (!actor) {
    return NextResponse.json({ error: { reason: "UNAUTHENTICATED", message: "Sign in to use the assistant." } }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: { reason: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { reason: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." } },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Swallows an accidental double-submit without spending a request. The
  // durable protection against a duplicated *entry* is the idempotency key —
  // this only stops the work starting twice in the same few seconds.
  if (!claimDedupeSlot(dedupeKey(actor.userId, "carbon-chat", body))) {
    return NextResponse.json(
      { error: { reason: "DUPLICATE", message: "That message is already being handled." } },
      { status: 429 },
    );
  }

  try {
    const range = resolveMonthRange(body.from, body.to);

    const result = await runAssistantTurn(actor, {
      question: body.question,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      siteId: body.siteId ?? null,
      projectId: body.projectId ?? null,
      history: body.history ?? [],
      attachmentDocumentIds: body.attachmentDocumentIds ?? [],
      conversationEntryIds: body.conversationEntryIds ?? [],
      // A client that doesn't supply one still gets per-request dedupe from
      // the guard above; it just doesn't get idempotency across a retry.
      turnRequestId: body.turnRequestId ?? `${actor.userId}:${Date.now()}`,
    });

    const response: AssistantTurnResponse = {
      answer: result.answer,
      cards: result.cards,
      model: result.meta?.modelUsed ?? null,
      usedFallback: result.meta?.usedFallback ?? false,
      periodLabel: result.periodLabel,
      actionsRun: result.actionsRun,
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof AiAuthorizationError) {
      return NextResponse.json({ error: { reason: "FORBIDDEN", message: err.message } }, { status: 403 });
    }
    if (err instanceof AiUnavailableError) {
      // 200 with a structured error: the request was understood and handled,
      // AI just couldn't answer. The UI shows a notice, not a failure state.
      return NextResponse.json({ error: { reason: err.reason, message: err.message } });
    }
    return NextResponse.json(
      { error: { reason: "PROVIDER_ERROR", message: "AI assistance is temporarily unavailable." } },
      { status: 200 },
    );
  }
}
