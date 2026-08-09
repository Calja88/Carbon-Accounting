"use server";

import { revalidatePath } from "next/cache";
import { AiUnavailableError, carbonAI, resolveAiActor } from "@/lib/ai";
import { assertSiteInScope } from "@/lib/ai/authorization";
import { prisma } from "@/lib/prisma";
import { explainCalculation } from "@/lib/explain-calculation";
import { deleteActivityEntry } from "@/lib/entries-service";
import type { DeleteActionState } from "@/components/ui/delete-button";

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
  const actor = await resolveAiActor();
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

  const explanation = await explainCalculation(calculationId);
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

/**
 * G1/G2/G6: deletes the activity entry behind this calculation via the
 * shared, permission-checked service — never a raw prisma call from the UI
 * layer. Cross-organisation scope is enforced the same way every other
 * action on this record already is (assertSiteInScope), so a request for a
 * record outside the caller's sites is denied before anything is touched.
 */
export async function deleteEntryAction(_prev: DeleteActionState, formData: FormData): Promise<DeleteActionState> {
  const session = await resolveAiActor();
  if (!session) return { error: "You must be signed in.", success: false, message: null };

  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "Missing entry.", success: false, message: null };

  const entry = await prisma.activityEntry.findUnique({ where: { id: entryId }, select: { siteId: true } });
  if (!entry) return { error: "That entry no longer exists.", success: false, message: null };

  try {
    assertSiteInScope(session, entry.siteId);
  } catch {
    return { error: "That entry isn't available to you.", success: false, message: null };
  }

  try {
    const result = await deleteActivityEntry(entryId, session.userId);
    revalidatePath("/reports");
    revalidatePath("/documents");
    return {
      error: null,
      success: true,
      message:
        result.mode === "deleted"
          ? "Entry deleted — it never had a calculated figure, so nothing else references it."
          : "Entry retracted — it's excluded from dashboards and reports, and the record is kept for audit.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete this entry.", success: false, message: null };
  }
}
