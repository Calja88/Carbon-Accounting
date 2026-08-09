"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { SourceDocumentKind } from "@prisma/client";
import { AiUnavailableError, resolveAiActor, carbonAI, getAiConfig } from "@/lib/ai";
import { AiAuthorizationError, assertDocumentInScope, assertSiteInScope } from "@/lib/ai/authorization";
import {
  DocumentValidationError,
  acceptExtractionAsEntry,
  markDocumentAccepted,
  rejectExtraction,
  uploadDocument,
} from "@/lib/documents-service";

/**
 * Server actions for the evidence-document workflow.
 *
 * Every one of these re-checks authorization against the session. The client
 * supplies ids; it never supplies authority, and a document or site outside
 * the caller's scope is rejected here rather than filtered later.
 */

export interface UploadDocumentState {
  error: string | null;
  documentId: string | null;
  /** A previously-uploaded document with identical bytes, if any — advisory only, never blocks the upload. */
  duplicateOfId: string | null;
  duplicateOfFilename: string | null;
}

const uploadSchema = z.object({
  siteId: z.string().optional(),
  kind: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export async function uploadDocumentAction(
  _prev: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const actor = await resolveAiActor();
  if (!actor) return { error: "You must be signed in.", documentId: null, duplicateOfId: null, duplicateOfFilename: null };

  const parsed = uploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid input.", documentId: null, duplicateOfId: null, duplicateOfFilename: null };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload.", documentId: null, duplicateOfId: null, duplicateOfFilename: null };
  }

  const siteId = parsed.data.siteId?.trim() || null;
  try {
    if (siteId) assertSiteInScope(actor, siteId);

    const config = await getAiConfig();
    const kind =
      parsed.data.kind && (Object.values(SourceDocumentKind) as string[]).includes(parsed.data.kind)
        ? (parsed.data.kind as SourceDocumentKind)
        : SourceDocumentKind.UNKNOWN;

    const document = await uploadDocument({
      filename: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      kind,
      siteId,
      notes: parsed.data.notes || null,
      uploadedByUserId: actor.userId,
      maxBytes: config.maxDocumentBytes,
    });

    revalidatePath("/documents");
    return {
      error: null,
      documentId: document.id,
      duplicateOfId: document.duplicateOf?.id ?? null,
      duplicateOfFilename: document.duplicateOf?.filename ?? null,
    };
  } catch (err) {
    if (err instanceof DocumentValidationError || err instanceof AiAuthorizationError) {
      return { error: err.message, documentId: null, duplicateOfId: null, duplicateOfFilename: null };
    }
    return { error: "Could not store that file.", documentId: null, duplicateOfId: null, duplicateOfFilename: null };
  }
}

export interface ExtractState {
  error: string | null;
  aiUnavailable: boolean;
  extractionId: string | null;
}

/** Runs (or re-runs) AI extraction. Failure is reported, never thrown at the user. */
export async function extractDocumentAction(_prev: ExtractState, formData: FormData): Promise<ExtractState> {
  const actor = await resolveAiActor();
  if (!actor) return { error: "You must be signed in.", aiUnavailable: false, extractionId: null };

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return { error: "Missing document.", aiUnavailable: false, extractionId: null };

  try {
    const outcome = await carbonAI.extractDocument(actor, documentId);
    revalidatePath(`/documents/${documentId}`);
    revalidatePath("/documents");
    return { error: null, aiUnavailable: false, extractionId: outcome.extractionId };
  } catch (err) {
    if (err instanceof AiAuthorizationError) {
      return { error: err.message, aiUnavailable: false, extractionId: null };
    }
    if (err instanceof AiUnavailableError) {
      revalidatePath(`/documents/${documentId}`);
      return { error: err.message, aiUnavailable: true, extractionId: null };
    }
    return { error: "Extraction failed.", aiUnavailable: true, extractionId: null };
  }
}

export interface AcceptExtractionState {
  error: string | null;
  success: boolean;
  flagged: boolean;
  awaitingFactor: boolean;
}

const acceptSchema = z.object({
  documentId: z.string().min(1),
  extractionId: z.string().min(1),
  dataPointCode: z.string().min(1, "Choose what this record is."),
  siteId: z.string().min(1, "Choose a site."),
  periodInput: z.string().min(1, "Choose the period this covers."),
  quantity: z.coerce.number().positive("Enter a quantity greater than zero."),
  unit: z.string().min(1, "Choose a unit."),
  factorOptionId: z.string().optional(),
  supplierName: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * Turns a reviewed extraction into a real ActivityEntry.
 *
 * The values written are the ones on the review form at the moment the person
 * pressed Accept — their edits, not the model's originals. The accepting user
 * and time are recorded on the entry itself.
 */
export async function acceptExtractionAction(
  _prev: AcceptExtractionState,
  formData: FormData,
): Promise<AcceptExtractionState> {
  const actor = await resolveAiActor();
  if (!actor) return { error: "You must be signed in.", success: false, flagged: false, awaitingFactor: false };

  const parsed = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the values before accepting.",
      success: false,
      flagged: false,
      awaitingFactor: false,
    };
  }
  const data = parsed.data;

  try {
    await assertDocumentInScope(actor, data.documentId);
    assertSiteInScope(actor, data.siteId);

    const created = await acceptExtractionAsEntry({
      extractionId: data.extractionId,
      dataPointCode: data.dataPointCode,
      siteId: data.siteId,
      periodInput: data.periodInput,
      quantity: data.quantity,
      unit: data.unit,
      factorOptionId: data.factorOptionId || null,
      supplierName: data.supplierName || null,
      notes: data.notes ? `${data.notes}` : "Accepted from AI document extraction after review.",
      acceptedByUserId: actor.userId,
    });

    revalidatePath(`/documents/${data.documentId}`);
    revalidatePath("/");

    return {
      error: null,
      success: true,
      flagged: created.entry.status === "FLAGGED",
      awaitingFactor: created.calculations.length === 0 && created.entry.status !== "FLAGGED",
    };
  } catch (err) {
    if (err instanceof DocumentValidationError || err instanceof AiAuthorizationError) {
      return { error: err.message, success: false, flagged: false, awaitingFactor: false };
    }
    return { error: "Could not save that entry.", success: false, flagged: false, awaitingFactor: false };
  }
}

export async function rejectExtractionAction(formData: FormData): Promise<void> {
  const actor = await resolveAiActor();
  if (!actor) return;

  const documentId = String(formData.get("documentId") ?? "");
  const extractionId = String(formData.get("extractionId") ?? "");
  if (!documentId || !extractionId) return;

  await assertDocumentInScope(actor, documentId);
  await rejectExtraction(extractionId, actor.userId);
  revalidatePath(`/documents/${documentId}`);
}

export async function markDocumentAcceptedAction(formData: FormData): Promise<void> {
  const actor = await resolveAiActor();
  if (!actor) return;

  const documentId = String(formData.get("documentId") ?? "");
  if (!documentId) return;

  await assertDocumentInScope(actor, documentId);
  await markDocumentAccepted(documentId);
  revalidatePath(`/documents/${documentId}`);
}
