/**
 * Conversational corrections: "change that to 1,550 litres", "that was June,
 * not July", "delete the entry you just created".
 *
 * Two rules shape this file.
 *
 * **Accounting data is never edited in place.** A Calculation snapshots the
 * factor and the formula it applied to a specific input; silently changing
 * that input would leave a stored calculation that no longer describes
 * anything real. So a correction *withdraws* the original — status REJECTED,
 * excluded from every total, kept on file with its calculations and a note
 * saying what replaced it — and creates a corrected entry beside it. The audit
 * trail then reads as what actually happened: someone recorded a figure, then
 * corrected it.
 *
 * **A conversational reference can only reach what the conversation created.**
 * The caller must pass the entry ids this conversation has actually shown, the
 * entry must have come from the assistant, and it must have been entered by
 * the person asking. "That entry" can therefore never resolve to a row from
 * someone else's work, whatever the model believes it refers to.
 */

import { DataOrigin, EntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createActivityEntryWithCalculations } from "@/lib/entries-service";
import { resolvePeriod } from "@/lib/period";
import { AiActor, assertSiteInScope } from "./scope";
import { activityEntryIdempotencyKey } from "./duplicate-check";
import { buildEntryCard } from "./entry-writer";
import type { AssistantCard } from "./assistant-types";

export class EntryCorrectionError extends Error {}

const ASSISTANT_ORIGINS: DataOrigin[] = [DataOrigin.AI_EXTRACTED, DataOrigin.AI_CHAT];

/**
 * Resolves an entry id a conversation referred to, refusing anything the
 * conversation has no business touching.
 */
async function loadCorrectableEntry(actor: AiActor, entryId: string, conversationEntryIds: string[]) {
  if (!conversationEntryIds.includes(entryId)) {
    throw new EntryCorrectionError(
      "That entry isn't one this conversation created, so I haven't touched it. Open it in the platform to change it.",
    );
  }

  const entry = await prisma.activityEntry.findUnique({
    where: { id: entryId },
    include: { activityDataPoint: true, factorOption: true, site: { select: { id: true, name: true } } },
  });
  if (!entry) throw new EntryCorrectionError("That entry no longer exists.");

  assertSiteInScope(actor, entry.siteId);

  if (!ASSISTANT_ORIGINS.includes(entry.dataOrigin)) {
    throw new EntryCorrectionError(
      "That entry wasn't created by the assistant, so I won't change it from here. Edit it in the platform instead.",
    );
  }
  if (entry.enteredByUserId !== actor.userId) {
    throw new EntryCorrectionError("That entry was recorded by someone else, so I haven't changed it.");
  }
  if (entry.status === EntryStatus.REJECTED) {
    throw new EntryCorrectionError("That entry has already been withdrawn.");
  }

  return entry;
}

export interface RetractionResult {
  digest: string;
  cards: AssistantCard[];
}

/**
 * Withdraws an entry. The row and its calculations stay on file — excluded
 * from every total, and readable in the audit trail with the reason.
 */
export async function retractAssistantEntry(
  actor: AiActor,
  entryId: string,
  conversationEntryIds: string[],
  reason: string,
): Promise<RetractionResult> {
  const entry = await loadCorrectableEntry(actor, entryId, conversationEntryIds);

  const note = `Withdrawn on ${new Date().toISOString().slice(0, 10)} at ${actor.name ?? "the user"}'s request via the assistant${reason ? `: ${reason}` : "."}`;

  await prisma.activityEntry.update({
    where: { id: entry.id },
    data: {
      status: EntryStatus.REJECTED,
      notes: entry.notes ? `${entry.notes}\n${note}` : note,
    },
  });

  return {
    digest: `WITHDRAWN entry ${entry.id}: ${entry.activityDataPoint.dataPointName}, ${Number(entry.rawValue)} ${entry.rawUnit} at ${entry.site.name}. It is excluded from all totals and kept on file with the reason.`,
    cards: [
      {
        kind: "REVIEW_REQUIRED",
        label: `Withdrawn — ${entry.activityDataPoint.dataPointName}`,
        reasons: [
          `${Number(entry.rawValue)} ${entry.rawUnit} at ${entry.site.name} is no longer counted in any total.`,
          "The record and its calculations are kept for the audit trail.",
        ],
        question: null,
        documentId: entry.sourceDocumentId,
        reviewHref: `/entry/${entry.siteId}`,
      },
    ],
  };
}

export interface EntryCorrection {
  quantity?: number | null;
  unit?: string | null;
  periodInput?: string | null;
  subtypeKey?: string | null;
}

export interface CorrectionResult {
  digest: string;
  cards: AssistantCard[];
  entryId: string;
}

/**
 * Withdraws an entry and records the corrected version, keeping the link
 * between them in both directions through the notes and the shared source
 * document.
 */
export async function correctAssistantEntry(
  actor: AiActor,
  entryId: string,
  conversationEntryIds: string[],
  correction: EntryCorrection,
  options: { interactionId: string | null; turnRequestId: string | null },
): Promise<CorrectionResult> {
  const entry = await loadCorrectableEntry(actor, entryId, conversationEntryIds);

  const quantity = correction.quantity ?? Number(entry.rawValue);
  const unit = correction.unit ?? entry.rawUnit;

  if (!(quantity > 0)) throw new EntryCorrectionError("A corrected quantity has to be greater than zero.");

  const acceptedUnits = entry.factorOption?.unit ? [entry.factorOption.unit] : entry.activityDataPoint.unitOptions;
  if (acceptedUnits.length > 0 && !acceptedUnits.some((u) => u.toLowerCase() === unit.trim().toLowerCase())) {
    throw new EntryCorrectionError(
      `${entry.activityDataPoint.code} is recorded in ${acceptedUnits.join(" or ")}, so I can't record it in "${unit}".`,
    );
  }

  let factorOptionId = entry.factorOptionId;
  if (correction.subtypeKey) {
    const option = await prisma.factorOption.findFirst({
      where: { activityDataPointId: entry.activityDataPointId, subtypeKey: correction.subtypeKey },
      select: { id: true },
    });
    if (!option) {
      throw new EntryCorrectionError(`"${correction.subtypeKey}" isn't a type offered for ${entry.activityDataPoint.code}.`);
    }
    factorOptionId = option.id;
  }

  const period = correction.periodInput
    ? (() => {
        try {
          return resolvePeriod(entry.activityDataPoint.frequency, correction.periodInput!);
        } catch {
          throw new EntryCorrectionError(`"${correction.periodInput}" isn't a period I can use. Try a month like 2026-07.`);
        }
      })()
    : { periodStart: entry.periodStart, periodEnd: entry.periodEnd };

  const replacementNote = `Corrected from entry ${entry.id} at ${actor.name ?? "the user"}'s request via the assistant.`;

  const created = await createActivityEntryWithCalculations({
    activityDataPointId: entry.activityDataPointId,
    siteId: entry.siteId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    rawValue: quantity,
    rawUnit: unit,
    factorOptionId,
    supplierName: entry.supplierName,
    enteredByUserId: actor.userId,
    notes: replacementNote,
    dataOrigin: entry.dataOrigin,
    sourceDocumentId: entry.sourceDocumentId,
    acceptedFromExtractionId: entry.acceptedFromExtractionId,
    // A correction is a person's decision, not the auto-log rules clearing it.
    autoLogged: false,
    aiIdempotencyKey: activityEntryIdempotencyKey({
      sourceDocumentId: null,
      turnRequestId: `correction:${entry.id}:${options.turnRequestId ?? "unknown"}`,
      dataPointCode: entry.activityDataPoint.code,
      siteId: entry.siteId,
      periodInput: correction.periodInput ?? entry.periodStart.toISOString().slice(0, 7),
      quantity,
      unit,
      subtypeKey: correction.subtypeKey ?? entry.factorOption?.subtypeKey ?? null,
    }),
    aiInteractionId: options.interactionId,
  });

  const withdrawalNote = `Superseded by entry ${created.entry.id} on ${new Date().toISOString().slice(0, 10)}, corrected at ${actor.name ?? "the user"}'s request via the assistant.`;
  await prisma.activityEntry.update({
    where: { id: entry.id },
    data: {
      status: EntryStatus.REJECTED,
      notes: entry.notes ? `${entry.notes}\n${withdrawalNote}` : withdrawalNote,
    },
  });

  const card = await buildEntryCard(created.entry.id);

  return {
    entryId: created.entry.id,
    digest: `CORRECTED entry ${entry.id} (now withdrawn) and recorded ${created.entry.id} in its place: ${card.dataPointName}, ${card.quantity} ${card.unit}, ${card.periodLabel}, ${card.siteName}.`,
    cards: [card],
  };
}

/**
 * Phrases that count as the user confirming a withdrawal, checked against
 * their own message. A destructive action on accounting data needs the person
 * to have said so, not the model to have inferred it.
 */
const CONFIRMATION_PATTERNS: RegExp[] = [
  /\b(delete|remove|withdraw|undo|retract|cancel|reverse|scrap|bin)\b/i,
  /\bdon'?t\s+(log|record|keep)\s+(it|this|that)\b/i,
  /\bshouldn'?t\s+have\s+been\s+(logged|recorded)\b/i,
];

export function userConfirmedRetraction(userMessage: string): boolean {
  return CONFIRMATION_PATTERNS.some((pattern) => pattern.test(userMessage));
}
