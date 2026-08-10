import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { carbonAI, AiUnavailableError, resolveAiActor, AiAuthorizationError } from "@/lib/ai";
import { assistLca } from "@/lib/ai/services/lca-copilot";
import { claimDedupeSlot, dedupeKey } from "@/lib/ai/rate-limit";
import { resolveMonthRange } from "@/lib/report-period";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";

/**
 * The assistant endpoint, for both the group-wide carbon assistant and the
 * LCA copilot (which one runs is decided by whether a projectId is supplied).
 *
 * Authorization happens here, before any context is assembled: an
 * unauthenticated request never reaches a model, and an assessment id or site id
 * the caller can't see is rejected by the scope check rather than filtered
 * out later.
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
});

export async function POST(request: NextRequest) {
  let organisation;
  try {
    organisation = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return NextResponse.json({ error: { reason: "UNAUTHENTICATED", message: "Sign in to use the assistant." } }, { status: 401 });
    }
    throw err;
  }

  const actor = await resolveAiActor(organisation);
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

  // Swallows an accidental double-submit without spending a request.
  if (!claimDedupeSlot(dedupeKey(actor.userId, "carbon-chat", body))) {
    return NextResponse.json(
      { error: { reason: "DUPLICATE", message: "That question is already being answered." } },
      { status: 429 },
    );
  }

  try {
    if (body.projectId) {
      const result = await assistLca(actor, body.projectId, body.question, body.history ?? []);
      return NextResponse.json({
        answer: result.answer,
        model: result.meta.modelUsed,
        usedFallback: result.meta.usedFallback,
        periodLabel: null,
      });
    }

    const range = resolveMonthRange(body.from, body.to);
    const result = await carbonAI.chat(organisation, actor, {
      question: body.question,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      siteId: body.siteId ?? null,
      history: body.history ?? [],
    });

    return NextResponse.json({
      answer: result.answer,
      model: result.meta.modelUsed,
      usedFallback: result.meta.usedFallback,
      periodLabel: result.periodLabel,
    });
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
