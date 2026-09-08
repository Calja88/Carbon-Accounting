"use server";

import { AiUnavailableError, carbonAI, resolveAiActor } from "@/lib/ai";
import { assertSiteInScope } from "@/lib/ai/authorization";
import { prisma } from "@/lib/prisma";
import { explainCalculation } from "@/lib/explain-calculation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";

export interface ExplainState {
  error: string | null;
  aiUnavailable: boolean;
  text: string | null;
  model: string | null;
}

const initial: ExplainState = { error: null, aiUnavailable: false, text: null, model: null };

/**
 * Asks AI to put a completed calculation into plain English.
 *
 * The deterministic explanation is already on the page — this only ever adds
 * a paragraph. The model receives finished figures, not the ingredients of a
 * calculation, so there is nothing for it to get arithmetically wrong.
 */
export async function explainInPlainEnglishAction(_prev: ExplainState, formData: FormData): Promise<ExplainState> {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return { ...initial, error: "You must be signed in." };
    throw err;
  }

  const actor = await resolveAiActor(context);
  if (!actor) return { ...initial, error: "You must be signed in." };

  const calculationId = String(formData.get("calculationId") ?? "");
  if (!calculationId) return { ...initial, error: "Missing calculation." };

  const calc = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: { activityEntry: { select: { siteId: true } } },
  });
  if (!calc) return { ...initial, error: "That calculation doesn't exist." };

  try {
    assertSiteInScope(actor, calc.activityEntry.siteId);
  } catch {
    return { ...initial, error: "That calculation isn't available to you." };
  }

  const explanation = await explainCalculation(context, calculationId);
  if (!explanation) return { ...initial, error: "That calculation doesn't exist." };

  const audience = formData.get("audience") === "internal" ? "internal" : "non-technical";

  try {
    const result = await carbonAI.explainCalculation(actor, explanation, audience);
    return { error: null, aiUnavailable: false, text: result.text, model: result.meta.modelUsed };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ...initial, aiUnavailable: true, error: err.message };
    }
    return { ...initial, error: "Could not produce a plain-English explanation." };
  }
}
