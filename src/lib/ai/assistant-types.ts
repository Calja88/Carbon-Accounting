/**
 * The wire contract between the assistant panel and the assistant endpoint.
 *
 * Types only, no imports that pull the server in, because both sides of the
 * boundary use this file.
 *
 * The important property of the card types below is that every figure in them
 * is produced by the application: an `EntryCreatedCard` is built from the
 * ActivityEntry and Calculation rows that were actually written, and a
 * `DocumentReadCard` from the validated extraction. None of it is composed by
 * the model, and none of it is raw model JSON — the panel renders labelled
 * fields, so a reader never has to interpret a payload.
 */

/** Where an assistant attachment is in the upload → read pipeline. */
export type AttachmentPhase = "UPLOADING" | "UPLOADED" | "READING" | "READ" | "FAILED";

export interface AssistantAttachment {
  /** Client-side id, stable from the moment the file is chosen. */
  localId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  phase: AttachmentPhase;
  documentId: string | null;
  /** Set when the upload or the read failed — shown on the chip. */
  error: string | null;
  /** True when the identical file was already on file and was re-used. */
  reusedExisting: boolean;
}

export interface DocumentReadCard {
  kind: "DOCUMENT_READ";
  documentId: string;
  filename: string;
  /** "Electricity invoice", "Waste Transfer Note" — this platform's own label. */
  documentTypeLabel: string;
  supplier: string | null;
  periodLabel: string | null;
  /** Transcribed figures, already formatted. Never a raw payload dump. */
  facts: { label: string; value: string }[];
  /** What the platform's own rules make of it, e.g. "Scope 2 — purchased electricity". */
  suggestion: string | null;
  warnings: string[];
  /** True when the document contains text aimed at an AI system. */
  injectionSuspected: boolean;
}

export interface EntryCreatedCard {
  kind: "ENTRY_CREATED";
  entryId: string;
  siteId: string;
  siteName: string;
  dataPointCode: string;
  dataPointName: string;
  scopeLabel: string;
  quantity: string;
  unit: string;
  periodLabel: string;
  /** One row per basis — Scope 2 always carries both. */
  calculations: {
    calculationId: string;
    basisLabel: string;
    kgCo2e: string;
    factorLabel: string;
    factorSource: string;
    factorVintage: string;
    formula: string;
  }[];
  /** Present when the entry was saved but no factor could be applied yet. */
  awaitingFactor: boolean;
  flagged: boolean;
  flagReason: string | null;
  /** True when the platform's checks cleared it; false when a person confirmed it. */
  autoLogged: boolean;
  sourceDocumentId: string | null;
  sourceFilename: string | null;
}

export interface DuplicateCard {
  kind: "DUPLICATE";
  label: string;
  reason: string;
  existing: {
    entryId: string;
    siteId: string;
    dataPointName: string;
    quantity: string;
    unit: string;
    periodLabel: string;
    siteName: string;
    recordedOn: string;
    sourceDocumentId: string | null;
    sourceFilename: string | null;
  }[];
}

export interface ReviewRequiredCard {
  kind: "REVIEW_REQUIRED";
  label: string;
  /** The failed conditions, in the engine's own words. */
  reasons: string[];
  /** The single question that would unblock it, when one exists. */
  question: string | null;
  documentId: string | null;
  /** Where a person can finish it by hand. */
  reviewHref: string | null;
}

export interface UnsupportedCard {
  kind: "UNSUPPORTED";
  label: string;
  detail: string;
  reason: string;
  documentId: string | null;
}

export interface LcaFlowCard {
  kind: "LCA_FLOW";
  assessmentId: string;
  itemId: string;
  action: "created" | "updated";
  name: string;
  quantity: string;
  unit: string;
  stageLabel: string;
  processName: string;
  /** LCA figures come from a calculation run, never from this write. */
  note: string;
}

export type AssistantCard =
  | DocumentReadCard
  | EntryCreatedCard
  | DuplicateCard
  | ReviewRequiredCard
  | UnsupportedCard
  | LcaFlowCard;

export interface AssistantTurnRequest {
  question: string;
  from?: string;
  to?: string;
  siteId?: string | null;
  projectId?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
  /** SourceDocument ids uploaded in this turn, in the order they were attached. */
  attachmentDocumentIds?: string[];
  /**
   * Stable across retries of one submitted turn, different between turns.
   * This is what makes a chat-stated entry idempotent without blocking two
   * genuinely separate records of the same quantity.
   */
  turnRequestId?: string;
}

export interface AssistantTurnResponse {
  answer: string;
  cards: AssistantCard[];
  model: string | null;
  usedFallback: boolean;
  periodLabel: string | null;
  /** Actions the application ran this turn, for the "what did it do" line. */
  actionsRun: string[];
}

export interface AssistantErrorResponse {
  error: { reason: string; message: string };
}

export function isAssistantError(value: unknown): value is AssistantErrorResponse {
  return Boolean(value && typeof value === "object" && "error" in value);
}
