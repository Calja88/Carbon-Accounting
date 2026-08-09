/**
 * Evidence documents: upload, storage, and turning a reviewed AI extraction
 * into real accounting data.
 *
 * The important function here is `acceptExtractionAsEntry`. It is the only
 * path from an AI extraction to an ActivityEntry, and it deliberately takes
 * the values *the reviewer confirmed on screen*, not the values the model
 * returned. If the reviewer edited a figure before accepting, the edit is
 * what is saved — and `dataOrigin`, `sourceDocumentId`,
 * `acceptedFromExtractionId`, `enteredByUserId` and `enteredAt` together
 * record that this row came from a document, via AI, and who accepted it and
 * when.
 *
 * Emissions are then calculated by the existing deterministic pipeline
 * (`createActivityEntryWithCalculations`), exactly as for a hand-typed entry:
 * same plausibility check, same factor resolution, same audit trail.
 */

import { createHash } from "crypto";
import { DataOrigin, DocumentStatus, Prisma, SourceDocumentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createActivityEntryWithCalculations } from "@/lib/entries-service";
import { resolvePeriod } from "@/lib/period";

/** Formats the upload accepts. Kept narrow on purpose — see SECURITY notes in the README. */
export const ACCEPTED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/csv",
]);

export const ACCEPTED_DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".csv"];

export class DocumentValidationError extends Error {}

export interface UploadDocumentInput {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
  kind?: SourceDocumentKind;
  siteId?: string | null;
  notes?: string | null;
  uploadedByUserId: string;
  maxBytes: number;
}

/**
 * Stores an uploaded document. The declared MIME type is checked against an
 * allow-list rather than trusted, the size is capped, and the original
 * filename is normalised — a browser-supplied name is untrusted input and is
 * never used as a path.
 */
export async function uploadDocument(input: UploadDocumentInput) {
  const buffer = Buffer.from(input.bytes);

  if (buffer.byteLength === 0) {
    throw new DocumentValidationError("That file is empty.");
  }
  if (buffer.byteLength > input.maxBytes) {
    throw new DocumentValidationError(
      `That file is ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB. The limit is ${(input.maxBytes / (1024 * 1024)).toFixed(0)} MB.`,
    );
  }
  if (!ACCEPTED_DOCUMENT_MIME_TYPES.has(input.mimeType)) {
    throw new DocumentValidationError(
      `"${input.mimeType}" files aren't accepted. Upload a PDF, PNG, JPEG, WebP, plain text or CSV file.`,
    );
  }

  const safeName = input.filename.replace(/[/\\]/g, "_").slice(0, 200) || "document";
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  return prisma.sourceDocument.create({
    data: {
      filename: safeName,
      mimeType: input.mimeType,
      byteSize: buffer.byteLength,
      sha256,
      content: buffer,
      kind: input.kind ?? SourceDocumentKind.UNKNOWN,
      status: DocumentStatus.UPLOADED,
      siteId: input.siteId ?? null,
      notes: input.notes ?? null,
      uploadedByUserId: input.uploadedByUserId,
    },
    select: { id: true, filename: true, sha256: true, byteSize: true },
  });
}

export async function listDocuments(siteIds: string[], limit = 50) {
  return prisma.sourceDocument.findMany({
    where: { archivedAt: null, OR: [{ siteId: null }, { siteId: { in: siteIds } }] },
    orderBy: { uploadedAt: "desc" },
    take: limit,
    select: {
      id: true,
      filename: true,
      mimeType: true,
      byteSize: true,
      kind: true,
      status: true,
      uploadedAt: true,
      site: { select: { id: true, name: true } },
      uploadedBy: { select: { name: true } },
      _count: { select: { extractions: true, activityEntries: true } },
    },
  });
}

export async function getDocumentWithExtractions(documentId: string) {
  return prisma.sourceDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      byteSize: true,
      kind: true,
      status: true,
      notes: true,
      uploadedAt: true,
      siteId: true,
      site: { select: { id: true, name: true, entity: { select: { name: true } } } },
      uploadedBy: { select: { name: true } },
      extractions: {
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: { select: { name: true } },
          reviewedBy: { select: { name: true } },
          acceptedEntries: {
            select: { id: true, enteredAt: true, activityDataPoint: { select: { code: true, dataPointName: true } } },
          },
        },
      },
      activityEntries: {
        select: {
          id: true,
          periodStart: true,
          rawValue: true,
          rawUnit: true,
          status: true,
          dataOrigin: true,
          activityDataPoint: { select: { code: true, dataPointName: true } },
          site: { select: { name: true } },
        },
      },
    },
  });
}

/** Raw bytes, for the review screen's document viewer. Authorize before calling. */
export async function getDocumentContent(documentId: string) {
  return prisma.sourceDocument.findUnique({
    where: { id: documentId },
    select: { filename: true, mimeType: true, content: true },
  });
}

export interface AcceptExtractionInput {
  extractionId: string;
  /** The activity data point code the reviewer confirmed. */
  dataPointCode: string;
  siteId: string;
  /** "YYYY-MM" or "YYYY-MM-DD", matching the data point's frequency. */
  periodInput: string;
  /** The value as it stands on the review screen — the reviewer's, not the model's. */
  quantity: number;
  unit: string;
  factorOptionId?: string | null;
  supplierName?: string | null;
  notes?: string | null;
  acceptedByUserId: string;
}

/**
 * Creates an ActivityEntry from a reviewed extraction and runs the normal
 * calculation pipeline. Returns the entry plus whatever the pipeline decided
 * about it (flagged, awaiting a factor, or calculated).
 */
export async function acceptExtractionAsEntry(input: AcceptExtractionInput) {
  const extraction = await prisma.documentExtraction.findUnique({
    where: { id: input.extractionId },
    select: { id: true, documentId: true },
  });
  if (!extraction) throw new DocumentValidationError("That extraction no longer exists.");

  const dataPoint = await prisma.activityDataPoint.findUnique({ where: { code: input.dataPointCode } });
  if (!dataPoint) throw new DocumentValidationError("That activity data point doesn't exist.");
  if (dataPoint.formType !== "QUANTITY") {
    throw new DocumentValidationError(
      `${dataPoint.code} isn't a quantity entry, so it can't be created from a document extraction.`,
    );
  }
  if (!(input.quantity > 0)) {
    throw new DocumentValidationError("Enter a quantity greater than zero before accepting.");
  }

  const site = await prisma.site.findUnique({ where: { id: input.siteId }, select: { id: true } });
  if (!site) throw new DocumentValidationError("That site doesn't exist.");

  const { periodStart, periodEnd } = resolvePeriod(dataPoint.frequency, input.periodInput);

  const created = await createActivityEntryWithCalculations({
    activityDataPointId: dataPoint.id,
    siteId: input.siteId,
    periodStart,
    periodEnd,
    rawValue: input.quantity,
    rawUnit: input.unit,
    factorOptionId: input.factorOptionId || null,
    supplierName: input.supplierName || null,
    enteredByUserId: input.acceptedByUserId,
    notes: input.notes || undefined,
  });

  // Provenance is recorded after creation so the existing entry pipeline
  // keeps its single, well-tested signature.
  await prisma.activityEntry.update({
    where: { id: created.entry.id },
    data: {
      dataOrigin: DataOrigin.AI_EXTRACTED,
      sourceDocumentId: extraction.documentId,
      acceptedFromExtractionId: extraction.id,
    },
  });

  await prisma.documentExtraction.update({
    where: { id: extraction.id },
    data: { reviewedByUserId: input.acceptedByUserId, reviewedAt: new Date() },
  });

  await prisma.sourceDocument.update({
    where: { id: extraction.documentId },
    data: { status: DocumentStatus.PARTIALLY_ACCEPTED },
  });

  return created;
}

/** Records a reviewer rejecting an extraction outright. */
export async function rejectExtraction(extractionId: string, userId: string) {
  const extraction = await prisma.documentExtraction.update({
    where: { id: extractionId },
    data: { reviewedByUserId: userId, reviewedAt: new Date() },
    select: { documentId: true },
  });

  await prisma.sourceDocument.update({
    where: { id: extraction.documentId },
    data: { status: DocumentStatus.REJECTED },
  });
}

/** Marks a document fully dealt with once its entries have been created. */
export async function markDocumentAccepted(documentId: string) {
  await prisma.sourceDocument.update({
    where: { id: documentId },
    data: { status: DocumentStatus.ACCEPTED },
  });
}

/**
 * Deletes a document the safe way (G4/G6): if it still supports an
 * accounting record (a non-retracted ActivityEntry) or LCA evidence, its
 * bytes and extraction history can't be destroyed — it's archived instead,
 * which drops it off the normal document list but keeps the audit trail
 * intact. Only a document with no such reference is hard-deleted.
 */
export async function deleteDocument(documentId: string, userId: string) {
  const document = await prisma.sourceDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      archivedAt: true,
      activityEntries: { where: { retractedAt: null }, select: { id: true } },
    },
  });
  if (!document) throw new DocumentValidationError("That document no longer exists.");

  // SourceDocument has one downstream authoritative link in this schema —
  // ActivityEntry.sourceDocumentId. LCA evidence is stored separately
  // (LcaEvidence has its own blob storage) and isn't linked to this model.
  const hasAuthoritativeReferences = document.activityEntries.length > 0;

  if (hasAuthoritativeReferences) {
    if (document.archivedAt) return { mode: "already_archived" as const };
    await prisma.sourceDocument.update({
      where: { id: documentId },
      data: { archivedAt: new Date(), archivedByUserId: userId },
    });
    return { mode: "archived" as const };
  }

  await prisma.$transaction([
    prisma.documentExtraction.deleteMany({ where: { documentId } }),
    prisma.sourceDocument.delete({ where: { id: documentId } }),
  ]);
  return { mode: "deleted" as const };
}

export const DOCUMENT_KIND_LABELS: Record<SourceDocumentKind, string> = {
  ELECTRICITY_INVOICE: "Electricity invoice",
  GAS_INVOICE: "Gas invoice",
  WATER_INVOICE: "Water invoice",
  FUEL_INVOICE: "Fuel invoice",
  WASTE_TRANSFER_NOTE: "Waste Transfer Note",
  WASTE_INVOICE: "Waste invoice",
  TRANSPORT_RECORD: "Transport / freight record",
  SUPPLIER_DOCUMENT: "Supplier document",
  METER_STATEMENT: "Meter statement",
  OTHER: "Other evidence",
  UNKNOWN: "Not yet classified",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  UPLOADED: "Uploaded",
  EXTRACTED: "Extracted — awaiting review",
  EXTRACTION_FAILED: "Extraction failed",
  PARTIALLY_ACCEPTED: "Partly accepted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

export type DocumentListItem = Prisma.PromiseReturnType<typeof listDocuments>[number];
