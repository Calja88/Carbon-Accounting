/**
 * The one path from something the assistant worked out to a real
 * ActivityEntry.
 *
 * Everything the assistant might want to log — a figure read off an invoice, a
 * figure the user stated in chat — comes through `logEntryCandidate`, and it
 * always does the same four things in the same order:
 *
 *   1. resolve the candidate against the platform's own catalogue (data point,
 *      sub-type, site, period, unit) — nothing the model said is taken as an
 *      identifier without being looked up;
 *   2. run the deterministic auto-log checks (src/lib/ai/auto-log.ts), which
 *      include resolving the emission factor *before* anything is written;
 *   3. create the entry through the existing pipeline
 *      (`createActivityEntryWithCalculations`), so plausibility, factor
 *      resolution, Scope 2 dual reporting and the calculation audit trail all
 *      behave exactly as they do for a hand-typed entry; and
 *   4. build the result card from the rows that were actually written.
 *
 * The model never supplies an emission factor, never supplies a kgCO2e figure,
 * and never decides that a write is safe. It supplies an interpretation; this
 * module and the auto-log engine decide, and the deterministic engine
 * calculates.
 */

import { AiDataEntryMode, AiSuggestionStatus, AiTaskType, DataOrigin, EntryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createActivityEntryWithCalculations, previewFactorResolution } from "@/lib/entries-service";
import { resolvePeriod } from "@/lib/period";
import { formatRangeLabel } from "@/lib/report-period";
// The pure scope predicates, not the session-backed module: nothing here
// needs to read a session, and keeping the import narrow means this file
// (and its tests) never drag the auth stack in.
import { AiActor, isSiteInScope } from "./scope";
import { AutoLogDecision, AutoLogFacts, AutoLogTrigger, evaluateAutoLog } from "./auto-log";
import { activityEntryIdempotencyKey, findDuplicateEntries } from "./duplicate-check";
import type { AssistantCard, DuplicateCard, EntryCreatedCard, ReviewRequiredCard } from "./assistant-types";

/** What the platform believes might be loggable, before it has been checked. */
export interface EntryCandidate {
  /** Stable within one document/turn, for de-duplicating the candidate list. */
  key: string;
  /** Human label, e.g. "Grid electricity consumption". */
  label: string;
  dataPointCode: string | null;
  siteId: string | null;
  quantity: number | null;
  unit: string | null;
  /** "YYYY-MM" or "YYYY-MM-DD". */
  periodInput: string | null;
  subtypeKey: string | null;
  supplierName: string | null;
  sourceDocumentId: string | null;
  extractionId: string | null;
  /** Why the platform thinks this is loggable — shown on the card. */
  basis: string;
  warnings: string[];
  /** Figures on the document that contradict each other. */
  conflicts: string[];
  /** Duplicate signals read off the extraction. */
  invoiceNumber: string | null;
  meterNumber: string | null;
  documentSha256: string | null;
}

export interface LogEntryOptions {
  mode: AiDataEntryMode;
  trigger: AutoLogTrigger;
  /** Stable across retries of one submitted turn. */
  turnRequestId: string | null;
  /** The AiInteraction that led here, for the provenance chain. */
  interactionId: string | null;
  /**
   * Only ever true because the *authenticated user's own message* said so —
   * see `userOverrodeDuplicate`. Never settable by a model or a document.
   */
  allowDuplicate: boolean;
}

export type LogEntryStatus = "CREATED" | "DUPLICATE" | "REVIEW_REQUIRED";

export interface LogEntryOutcome {
  status: LogEntryStatus;
  card: AssistantCard;
  /** The minimum question that would unblock a REVIEW_REQUIRED outcome. */
  question: string | null;
  entryId: string | null;
  /** A one-line digest for the model to narrate, built from what happened. */
  digest: string;
}

const SCOPE_LABELS: Record<string, string> = {
  SCOPE_1: "Scope 1",
  SCOPE_2: "Scope 2",
  SCOPE_3: "Scope 3",
};

const BASIS_LABELS: Record<string, string> = {
  STANDARD: "Standard",
  LOCATION_BASED: "Location-based",
  MARKET_BASED: "Market-based",
  RESIDUAL_MIX: "Residual mix",
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

function reviewCard(
  candidate: EntryCandidate,
  decision: AutoLogDecision | null,
  reasons: string[],
  question: string | null,
): ReviewRequiredCard {
  return {
    kind: "REVIEW_REQUIRED",
    label: candidate.label,
    reasons: decision ? decision.blockers : reasons,
    question,
    documentId: candidate.sourceDocumentId,
    reviewHref: candidate.sourceDocumentId ? `/documents/${candidate.sourceDocumentId}` : null,
  };
}

function duplicateCard(candidate: EntryCandidate, reason: string, matches: Awaited<ReturnType<typeof findDuplicateEntries>>["matches"]): DuplicateCard {
  return {
    kind: "DUPLICATE",
    label: candidate.label,
    reason,
    existing: matches.map((m) => ({
      entryId: m.entryId,
      siteId: m.siteId,
      dataPointName: m.dataPointName,
      quantity: formatNumber(m.quantity),
      unit: m.unit,
      periodLabel: formatRangeLabel(m.periodStart, m.periodStart),
      siteName: m.siteName,
      recordedOn: m.enteredAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      sourceDocumentId: m.sourceDocumentId,
      sourceFilename: m.sourceFilename,
    })),
  };
}

/**
 * Validates one candidate and, if every condition holds, writes it.
 *
 * Never throws for an ordinary "can't do that" — a batch of documents must be
 * able to produce three successes and one review-required without the batch
 * failing, so refusals come back as outcomes.
 */
export async function logEntryCandidate(
  actor: AiActor,
  candidate: EntryCandidate,
  options: LogEntryOptions,
): Promise<LogEntryOutcome> {
  // --- Resolve everything against the platform's own catalogue --------------

  const dataPoint = candidate.dataPointCode
    ? await prisma.activityDataPoint.findUnique({
        where: { code: candidate.dataPointCode },
        include: { factorOptions: { orderBy: { sortOrder: "asc" } } },
      })
    : null;

  if (candidate.dataPointCode && !dataPoint) {
    // A code that doesn't exist here is dropped, never approximated.
    return {
      status: "REVIEW_REQUIRED",
      card: reviewCard(candidate, null, [`"${candidate.dataPointCode}" isn't a data point this platform collects.`], null),
      question: "I can't tell which activity this belongs to. What is it a record of?",
      entryId: null,
      digest: `${candidate.label}: no matching activity data point, nothing recorded.`,
    };
  }

  if (dataPoint && dataPoint.formType !== "QUANTITY") {
    return {
      status: "REVIEW_REQUIRED",
      card: reviewCard(
        candidate,
        null,
        [`${dataPoint.code} isn't a quantity entry, so it can't be created from a document or a chat message.`],
        null,
      ),
      question: null,
      entryId: null,
      digest: `${candidate.label}: ${dataPoint.code} is not a quantity entry, nothing recorded.`,
    };
  }

  const factorOption =
    dataPoint && candidate.subtypeKey
      ? (dataPoint.factorOptions.find((o) => o.subtypeKey === candidate.subtypeKey) ?? null)
      : null;

  const acceptedUnits = factorOption?.unit ? [factorOption.unit] : (dataPoint?.unitOptions ?? []);
  const siteAuthorised = Boolean(candidate.siteId) && isSiteInScope(actor, candidate.siteId!);

  const site = siteAuthorised
    ? await prisma.site.findUnique({ where: { id: candidate.siteId! }, select: { id: true, name: true } })
    : null;

  const period =
    dataPoint && candidate.periodInput
      ? (() => {
          try {
            return resolvePeriod(dataPoint.frequency, candidate.periodInput!);
          } catch {
            return null;
          }
        })()
      : null;

  // --- Factor resolution, before anything is written -----------------------

  const factorPreview =
    dataPoint && period && candidate.quantity !== null && candidate.unit && site
      ? await previewFactorResolution({
          factorCategory: dataPoint.factorCategory,
          scope: dataPoint.scope,
          subtypeKey: factorOption?.subtypeKey ?? null,
          rawValue: candidate.quantity,
          rawUnit: candidate.unit,
          periodStart: period.periodStart,
          siteId: site.id,
          supplierName: candidate.supplierName,
        })
      : null;

  // --- Duplicate search ----------------------------------------------------

  const idempotencyKey =
    dataPoint && site && candidate.periodInput && candidate.quantity !== null && candidate.unit
      ? activityEntryIdempotencyKey({
          sourceDocumentId: candidate.sourceDocumentId,
          turnRequestId: options.turnRequestId,
          dataPointCode: dataPoint.code,
          siteId: site.id,
          periodInput: candidate.periodInput,
          quantity: candidate.quantity,
          unit: candidate.unit,
          subtypeKey: factorOption?.subtypeKey ?? null,
        })
      : null;

  const duplicate =
    idempotencyKey && dataPoint && site && period && candidate.quantity !== null && candidate.unit
      ? await findDuplicateEntries({
          idempotencyKey,
          activityDataPointId: dataPoint.id,
          dataPointCode: dataPoint.code,
          siteId: site.id,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          quantity: candidate.quantity,
          unit: candidate.unit,
          factorOptionId: factorOption?.id ?? null,
          sourceDocumentId: candidate.sourceDocumentId,
          documentSha256: candidate.documentSha256,
          invoiceNumber: candidate.invoiceNumber,
          supplier: candidate.supplierName,
          meterNumber: candidate.meterNumber,
        })
      : { suspected: false, reason: null, matches: [] };

  // An override is only honoured for a *judgement* duplicate. An identical
  // request is not a judgement — re-running it must stay a no-op whatever
  // anyone says, because that is the guarantee the unique key exists to give.
  const overridable = duplicate.suspected && !duplicate.matches.some((m) => m.signal === "identical request");
  const duplicateBlocks = duplicate.suspected && !(options.allowDuplicate && overridable);

  if (duplicateBlocks) {
    return {
      status: "DUPLICATE",
      card: duplicateCard(candidate, duplicate.reason ?? "This appears to have already been recorded.", duplicate.matches),
      question: null,
      entryId: duplicate.matches[0]?.entryId ?? null,
      digest: `${candidate.label}: already recorded — ${duplicate.reason ?? "duplicate detected"}. Nothing new was created.`,
    };
  }

  // --- The decision --------------------------------------------------------

  const facts: AutoLogFacts = {
    sourceUsable: true,
    sourceUnusableReason: null,
    quantity: candidate.quantity,
    unit: candidate.unit,
    acceptedUnits,
    periodInput: period ? candidate.periodInput : null,
    dataPointCode: dataPoint?.code ?? null,
    dataPointName: dataPoint?.dataPointName ?? null,
    requiresSubtype: (dataPoint?.factorOptions.length ?? 0) > 0,
    subtypeKey: factorOption?.subtypeKey ?? null,
    subtypeOptions: (dataPoint?.factorOptions ?? []).map((o) => ({ key: o.subtypeKey, label: o.label })),
    siteId: candidate.siteId,
    siteAuthorised,
    factor: {
      resolved: factorPreview?.resolved ?? false,
      ambiguous: factorPreview?.ambiguous ?? false,
      candidateLabels: factorPreview?.factors.map((f) => f.label) ?? [],
      unitCompatible: factorPreview?.unitCompatible ?? false,
      reason: factorPreview?.reason ?? null,
    },
    duplicate: { suspected: false, reason: null, existingEntryIds: [] },
    conflicts: candidate.conflicts,
    sourceDocumentId: candidate.sourceDocumentId,
    extractionId: candidate.extractionId,
  };

  const decision = evaluateAutoLog(facts, { mode: options.mode, trigger: options.trigger });

  if (!decision.allowed) {
    const reasons = decision.withheldReason ? [decision.withheldReason, ...decision.blockers] : decision.blockers;
    await recordDecision(actor, candidate, decision, options, "REVIEW_REQUIRED");
    return {
      status: "REVIEW_REQUIRED",
      card: reviewCard(candidate, { ...decision, blockers: reasons }, reasons, decision.question),
      question: decision.question,
      entryId: null,
      digest: `${candidate.label}: not recorded — ${reasons[0] ?? "review required"}.`,
    };
  }

  // --- The write -----------------------------------------------------------

  try {
    const created = await createActivityEntryWithCalculations({
      activityDataPointId: dataPoint!.id,
      siteId: site!.id,
      periodStart: period!.periodStart,
      periodEnd: period!.periodEnd,
      rawValue: candidate.quantity!,
      rawUnit: candidate.unit!,
      factorOptionId: factorOption?.id ?? null,
      supplierName: candidate.supplierName ?? null,
      enteredByUserId: actor.userId,
      notes: candidate.basis,
      dataOrigin: candidate.sourceDocumentId ? DataOrigin.AI_EXTRACTED : DataOrigin.AI_CHAT,
      sourceDocumentId: candidate.sourceDocumentId,
      acceptedFromExtractionId: candidate.extractionId,
      autoLogged: true,
      aiIdempotencyKey: idempotencyKey,
      aiInteractionId: options.interactionId,
    });

    if (candidate.extractionId) {
      await prisma.documentExtraction.update({
        where: { id: candidate.extractionId },
        data: { reviewedByUserId: actor.userId, reviewedAt: new Date() },
      });
    }
    if (candidate.sourceDocumentId) {
      await prisma.sourceDocument.update({
        where: { id: candidate.sourceDocumentId },
        data: { status: "PARTIALLY_ACCEPTED" },
      });
    }

    await recordDecision(actor, candidate, decision, options, "CREATED", created.entry.id);

    const card = await buildEntryCard(created.entry.id);
    return {
      status: "CREATED",
      card,
      question: null,
      entryId: created.entry.id,
      digest: entryDigest(card),
    };
  } catch (err) {
    // The unique idempotency key firing here means a concurrent request won
    // the race. That is the mechanism working, not a failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = idempotencyKey
        ? await findDuplicateEntries({
            idempotencyKey,
            activityDataPointId: dataPoint!.id,
            dataPointCode: dataPoint!.code,
            siteId: site!.id,
            periodStart: period!.periodStart,
            periodEnd: period!.periodEnd,
            quantity: candidate.quantity!,
            unit: candidate.unit!,
            factorOptionId: factorOption?.id ?? null,
            sourceDocumentId: candidate.sourceDocumentId,
            documentSha256: candidate.documentSha256,
            invoiceNumber: candidate.invoiceNumber,
            supplier: candidate.supplierName,
            meterNumber: candidate.meterNumber,
          })
        : { suspected: true, reason: null, matches: [] };

      return {
        status: "DUPLICATE",
        card: duplicateCard(candidate, "This had already been recorded — the identical request reached the platform twice.", existing.matches),
        question: null,
        entryId: existing.matches[0]?.entryId ?? null,
        digest: `${candidate.label}: already recorded, no duplicate created.`,
      };
    }

    const message = err instanceof Error ? err.message : "The entry could not be saved.";
    return {
      status: "REVIEW_REQUIRED",
      card: reviewCard(candidate, null, [message], null),
      question: null,
      entryId: null,
      digest: `${candidate.label}: could not be recorded (${message}).`,
    };
  }
}

/**
 * Reads back what was actually written and renders it.
 *
 * Every figure on the card comes from this query — the quantity from the
 * entry, the emissions from the Calculation rows, the factor from the
 * snapshots the calculation stored. Nothing is carried over from the
 * candidate, and nothing is carried over from the model.
 */
export async function buildEntryCard(entryId: string): Promise<EntryCreatedCard> {
  const entry = await prisma.activityEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: {
      activityDataPoint: true,
      factorOption: true,
      site: { select: { id: true, name: true } },
      sourceDocument: { select: { id: true, filename: true } },
      calculations: { orderBy: { basis: "asc" } },
    },
  });

  return {
    kind: "ENTRY_CREATED",
    entryId: entry.id,
    siteId: entry.site.id,
    siteName: entry.site.name,
    dataPointCode: entry.activityDataPoint.code,
    dataPointName: entry.activityDataPoint.dataPointName,
    scopeLabel: `${SCOPE_LABELS[entry.activityDataPoint.scope] ?? entry.activityDataPoint.scope}${
      entry.activityDataPoint.scope3Category ? ` — ${entry.activityDataPoint.scope3Category}` : ""
    }`,
    quantity: formatNumber(Number(entry.rawValue)),
    unit: entry.rawUnit,
    periodLabel: formatRangeLabel(entry.periodStart, entry.periodEnd),
    calculations: entry.calculations.map((c) => ({
      calculationId: c.id,
      basisLabel: BASIS_LABELS[c.basis] ?? c.basis,
      kgCo2e: Number(c.resultKgCo2e).toLocaleString("en-GB", { maximumFractionDigits: 2 }),
      factorLabel: `${c.factorValueSnapshot} kgCO2e/${c.factorUnitSnapshot}`,
      factorSource: c.factorSourceSnapshot,
      factorVintage: c.factorVintageSnapshot,
      formula: c.formulaApplied,
    })),
    awaitingFactor: entry.status === EntryStatus.AWAITING_FACTOR || entry.calculations.length === 0,
    flagged: entry.plausibilityFlagged,
    flagReason: entry.plausibilityReason,
    autoLogged: entry.autoLogged,
    sourceDocumentId: entry.sourceDocument?.id ?? null,
    sourceFilename: entry.sourceDocument?.filename ?? null,
  };
}

function entryDigest(card: EntryCreatedCard): string {
  const emissions =
    card.calculations.length > 0
      ? card.calculations.map((c) => `${c.kgCo2e} kgCO2e ${c.basisLabel.toLowerCase()} (factor: ${c.factorSource})`).join("; ")
      : "no emission factor available yet, so the entry is held as awaiting a factor";
  return `CREATED entry ${card.entryId}: ${card.dataPointName} (${card.dataPointCode}, ${card.scopeLabel}), ${card.quantity} ${card.unit}, ${card.periodLabel}, ${card.siteName}. Calculated: ${emissions}.`;
}

/**
 * Records the decision itself, separately from the AI call.
 *
 * AiInteraction says a model was asked something; this says what the platform
 * then did about it and on what basis — which check passed, which failed, and
 * whether a person or the auto-log rules cleared it. Together they answer
 * "where did this number come from?" without needing either to be trusted on
 * its own.
 */
async function recordDecision(
  actor: AiActor,
  candidate: EntryCandidate,
  decision: AutoLogDecision,
  options: LogEntryOptions,
  outcome: LogEntryStatus,
  entryId?: string,
): Promise<void> {
  try {
    await prisma.aiSuggestion.create({
      data: {
        task: AiTaskType.CARBON_REASONING,
        feature: options.trigger === "DOCUMENT" ? "assistant-document-auto-log" : "assistant-chat-entry",
        targetType: "ACTIVITY_ENTRY",
        targetId: entryId ?? candidate.sourceDocumentId ?? null,
        status: outcome === "CREATED" ? AiSuggestionStatus.ACCEPTED : AiSuggestionStatus.PENDING,
        requiresReview: outcome !== "CREATED",
        reasoningSummary: candidate.basis.slice(0, 900),
        // Round-tripped through JSON so the stored payload is exactly what a
        // reader will get back, with no Date or Decimal surviving as something
        // Prisma's Json type wouldn't accept.
        payload: JSON.parse(
          JSON.stringify({
            candidate: {
              label: candidate.label,
              dataPointCode: candidate.dataPointCode,
              siteId: candidate.siteId,
              quantity: candidate.quantity,
              unit: candidate.unit,
              periodInput: candidate.periodInput,
              subtypeKey: candidate.subtypeKey,
              sourceDocumentId: candidate.sourceDocumentId,
              extractionId: candidate.extractionId,
            },
            mode: options.mode,
            trigger: options.trigger,
            outcome,
            checks: decision.checks,
          }),
        ) as Prisma.InputJsonValue,
        interactionId: options.interactionId,
        raisedByUserId: actor.userId,
        decidedByUserId: outcome === "CREATED" ? actor.userId : null,
        decidedAt: outcome === "CREATED" ? new Date() : null,
      },
    });
  } catch {
    // The decision record is an audit enhancement; failing to write it must
    // not fail the user's request or roll back an entry that was created.
  }
}
