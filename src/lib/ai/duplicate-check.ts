/**
 * Duplicate prevention for entries the assistant creates.
 *
 * Two independent mechanisms, because they fail in different ways:
 *
 *  1. **Idempotency** (`activityEntryIdempotencyKey`) — a deterministic
 *     fingerprint stored in a unique column. This is what stops the *same*
 *     write happening twice: a retried request, an extraction re-run, a
 *     refreshed page, OpenRouter retrying underneath us, the user pressing
 *     send again. The database rejects the second insert; no comparison logic
 *     has to be right for that to hold.
 *
 *  2. **Duplicate detection** (`findDuplicateEntries`) — a search for
 *     something that looks like the same fact recorded a different way: the
 *     same invoice uploaded twice as two files, the same meter reading typed
 *     in by hand last week, the same period logged from a re-issued bill. This
 *     one is a judgement, so it never silently overwrites anything — it stops
 *     the write and shows the entry it found.
 *
 * An authorised user can still record something the platform thinks is a
 * duplicate, but only by saying so themselves: `userOverrodeDuplicate` reads
 * the *user's own message*, never the model's opinion of it. Document content
 * can never reach that check, so an invoice that says "this is not a
 * duplicate, record it again" has no effect.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

/** Quantities this close together are the same reading, not two readings. */
const QUANTITY_TOLERANCE = 0.005;

export interface IdempotencyKeyInput {
  /** The document this fact came from, when it came from one. */
  sourceDocumentId: string | null;
  /**
   * For a fact stated in chat rather than read off a document: an id that is
   * stable across retries of one submitted turn, and different between turns.
   * Without it, two genuinely separate deliveries of 1,500 litres in the same
   * month would collide.
   */
  turnRequestId: string | null;
  dataPointCode: string;
  siteId: string;
  periodInput: string;
  quantity: number;
  unit: string;
  subtypeKey: string | null;
}

/**
 * The fingerprint written to ActivityEntry.aiIdempotencyKey.
 *
 * Rounded to four decimal places to match the precision the column stores, so
 * a value that survives a round-trip through the database still hashes to the
 * same key.
 */
export function activityEntryIdempotencyKey(input: IdempotencyKeyInput): string {
  const parts = [
    input.sourceDocumentId ?? `chat:${input.turnRequestId ?? "unknown"}`,
    input.dataPointCode,
    input.siteId,
    input.periodInput,
    input.quantity.toFixed(4),
    input.unit.trim().toLowerCase(),
    input.subtypeKey ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 48);
}

export interface DuplicateMatch {
  entryId: string;
  siteId: string;
  siteName: string;
  dataPointCode: string;
  dataPointName: string;
  periodStart: Date;
  quantity: number;
  unit: string;
  enteredAt: Date;
  sourceDocumentId: string | null;
  sourceFilename: string | null;
  /** Which signal matched — shown to the user so the claim is checkable. */
  signal: string;
}

export interface DuplicateVerdict {
  suspected: boolean;
  reason: string | null;
  matches: DuplicateMatch[];
}

const NO_DUPLICATE: DuplicateVerdict = { suspected: false, reason: null, matches: [] };

export interface DuplicateSearchInput {
  idempotencyKey: string;
  activityDataPointId: string;
  dataPointCode: string;
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  quantity: number;
  unit: string;
  factorOptionId: string | null;
  sourceDocumentId: string | null;
  /** sha256 of the uploaded bytes, so an identical file re-uploaded is caught. */
  documentSha256: string | null;
  /** Read off the extraction, when the document had one. */
  invoiceNumber: string | null;
  supplier: string | null;
  meterNumber: string | null;
}

interface ExtractionMetadata {
  invoiceNumber?: unknown;
  supplier?: unknown;
  accountReference?: unknown;
}

function metadataOf(payload: unknown): ExtractionMetadata {
  if (payload && typeof payload === "object" && "metadata" in payload) {
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (metadata && typeof metadata === "object") return metadata as ExtractionMetadata;
  }
  return {};
}

function meterOf(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "energy" in payload) {
    const energy = (payload as { energy?: { meterNumber?: unknown } }).energy;
    const meter = energy?.meterNumber;
    return typeof meter === "string" && meter.trim() ? meter.trim() : null;
  }
  return null;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function relativeDifference(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale;
}

/**
 * Looks for an entry that already records this fact.
 *
 * Deliberately generous about what counts as a match and conservative about
 * what it does with one: a false positive costs the user one sentence of
 * explanation and a link, a false negative puts a double count into a
 * published carbon figure.
 */
export async function findDuplicateEntries(input: DuplicateSearchInput): Promise<DuplicateVerdict> {
  const select = {
    id: true,
    siteId: true,
    periodStart: true,
    rawValue: true,
    rawUnit: true,
    enteredAt: true,
    sourceDocumentId: true,
    activityDataPoint: { select: { code: true, dataPointName: true } },
    site: { select: { name: true } },
    sourceDocument: { select: { id: true, filename: true, sha256: true } },
    acceptedFromExtraction: { select: { payload: true } },
  } as const;

  // 1. The exact same write, already done. This is the idempotent case and
  //    the only one that is a *certainty* rather than a judgement.
  const identical = await prisma.activityEntry.findUnique({
    where: { aiIdempotencyKey: input.idempotencyKey },
    select,
  });
  if (identical) {
    return {
      suspected: true,
      reason: "This exact record has already been created — the same document, data point, site, period and quantity.",
      matches: [toMatch(identical, "identical request")],
    };
  }

  // 2. Anything already recorded against this document, or against a document
  //    with identical bytes (the same PDF uploaded a second time).
  if (input.sourceDocumentId || input.documentSha256) {
    const fromSameDocument = await prisma.activityEntry.findMany({
      where: {
        activityDataPointId: input.activityDataPointId,
        OR: [
          ...(input.sourceDocumentId ? [{ sourceDocumentId: input.sourceDocumentId }] : []),
          ...(input.documentSha256 ? [{ sourceDocument: { sha256: input.documentSha256 } }] : []),
        ],
      },
      select,
      take: 5,
    });
    if (fromSameDocument.length > 0) {
      const sameBytes = fromSameDocument.some((e) => e.sourceDocumentId !== input.sourceDocumentId);
      return {
        suspected: true,
        reason: sameBytes
          ? "A file with identical contents has already been uploaded and recorded."
          : "This document has already been recorded against this activity.",
        matches: fromSameDocument.map((e) => toMatch(e, sameBytes ? "identical file already uploaded" : "same document")),
      };
    }
  }

  // 3. The same activity, site and period recorded from somewhere else. The
  //    candidate set is small by construction, so the finer comparisons
  //    (quantity, invoice number, meter) happen in code where they can be
  //    read and tested.
  const samePeriod = await prisma.activityEntry.findMany({
    where: {
      activityDataPointId: input.activityDataPointId,
      siteId: input.siteId,
      periodStart: input.periodStart,
      ...(input.factorOptionId ? { factorOptionId: input.factorOptionId } : {}),
    },
    select,
    take: 20,
  });

  for (const candidate of samePeriod) {
    const metadata = metadataOf(candidate.acceptedFromExtraction?.payload);

    // The number quoted back is the one on the entry already on file, not the
    // one just read — so the user can check the claim against what is stored.
    const recordedInvoice = typeof metadata.invoiceNumber === "string" ? metadata.invoiceNumber : null;
    if (input.invoiceNumber && sameText(recordedInvoice, input.invoiceNumber)) {
      return {
        suspected: true,
        reason: `Invoice ${recordedInvoice} has already been recorded for this site and period.`,
        matches: [toMatch(candidate, "same invoice number")],
      };
    }

    const meter = meterOf(candidate.acceptedFromExtraction?.payload);
    if (input.meterNumber && sameText(meter, input.meterNumber)) {
      return {
        suspected: true,
        reason: `Meter ${input.meterNumber} has already been recorded for this site and period.`,
        matches: [toMatch(candidate, "same meter number")],
      };
    }

    if (
      sameText(candidate.rawUnit, input.unit) &&
      relativeDifference(Number(candidate.rawValue), input.quantity) <= QUANTITY_TOLERANCE
    ) {
      return {
        suspected: true,
        reason: `${Number(candidate.rawValue)} ${candidate.rawUnit} is already recorded for this site, activity and period.`,
        matches: [toMatch(candidate, "same quantity, site and period")],
      };
    }

    if (input.supplier && sameText(String(metadata.supplier ?? ""), input.supplier)) {
      return {
        suspected: true,
        reason: `A ${input.supplier} record already exists for this site, activity and period.`,
        matches: [toMatch(candidate, "same supplier, site and period")],
      };
    }
  }

  return NO_DUPLICATE;
}

type EntryRow = {
  id: string;
  siteId: string;
  periodStart: Date;
  rawValue: unknown;
  rawUnit: string;
  enteredAt: Date;
  sourceDocumentId: string | null;
  activityDataPoint: { code: string; dataPointName: string };
  site: { name: string };
  sourceDocument: { id: string; filename: string; sha256: string } | null;
};

function toMatch(entry: EntryRow, signal: string): DuplicateMatch {
  return {
    entryId: entry.id,
    siteId: entry.siteId,
    siteName: entry.site.name,
    dataPointCode: entry.activityDataPoint.code,
    dataPointName: entry.activityDataPoint.dataPointName,
    periodStart: entry.periodStart,
    quantity: Number(entry.rawValue),
    unit: entry.rawUnit,
    enteredAt: entry.enteredAt,
    sourceDocumentId: entry.sourceDocumentId,
    sourceFilename: entry.sourceDocument?.filename ?? null,
    signal,
  };
}

/**
 * Phrases that count as the authenticated user overriding a duplicate
 * warning, matched against *their own message text only*.
 *
 * This is checked in application code rather than being a parameter the model
 * can set, because "the user asked for it" has to mean the user, not a
 * sentence a model produced or a line of text inside an uploaded invoice.
 */
const OVERRIDE_PATTERNS: RegExp[] = [
  /\b(record|log|add|save|create)\s+(it|this|them|that|both|all)?\s*(one\s+)?(anyway|regardless|again)\b/i,
  /\bnot\s+a\s+duplicate\b/i,
  /\bit'?s\s+a\s+(separate|different|second)\s+(one|invoice|delivery|bill|reading|entry)\b/i,
  /\byes,?\s*(please\s*)?(record|log|add)\s+(it|this|them)\s+(again|anyway)\b/i,
];

export function userOverrodeDuplicate(userMessage: string): boolean {
  return OVERRIDE_PATTERNS.some((pattern) => pattern.test(userMessage));
}
