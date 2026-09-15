import type { FactorBasis, Scope } from "@prisma/client";

export interface ImportMessage {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface DatasetMetadata {
  publisher: string | null;
  year: number | null;
  release: string | null;
}

export interface SourceRow {
  sheet: string;
  rowNumber: number;
  /** Original cell text, including units, values and unrecognised columns. */
  cells: string[];
  fields: Record<string, string>;
  messages: ImportMessage[];
}

export interface ParsedFactorFile {
  sourceFileName: string;
  fileHash: string;
  metadata: DatasetMetadata;
  sheets: { name: string; supported: boolean; rowsScanned: number }[];
  totalRowsScanned: number;
  rows: SourceRow[];
  messages: ImportMessage[];
}

export interface FactorCandidate {
  source: SourceRow;
  metadata: DatasetMetadata;
  categoryPath: string;
  activity: string;
  rawUnit: string;
  canonicalUnit: string | null;
  factorValue: string | null;
  factorUnit: string | null;
  gas: string | null;
  kind: string | null;
  scope: Scope | null;
  category: string | null;
  subtypeKey: string | null;
  basis: FactorBasis | null;
  region: string | null;
  /** Source dimensions, independent of ordering and numerical value. */
  identity: string;
  /** Includes source position, raw text and value for traceability. */
  sourceHash: string;
  status: "accepted" | "warning" | "rejected" | "duplicate";
  messages: ImportMessage[];
}

/** Minimal comparable projection; callers must scope database reads first. */
export interface ExistingFactor {
  category: string;
  subtypeKey: string | null;
  basis: FactorBasis;
  scope: Scope;
  region: string;
  unit: string;
  co2eFactor: string;
}

export interface FactorImportPreview extends ParsedFactorFile {
  candidates: FactorCandidate[];
  acceptedRows: FactorCandidate[];
  warningRows: FactorCandidate[];
  rejectedRows: FactorCandidate[];
  duplicateRows: FactorCandidate[];
  counts: {
    accepted: number; warning: number; rejected: number; duplicate: number;
    bySheet: Record<string, number>;
    byCategory: Record<string, number>;
    byUnit: Record<string, number>;
  };
  proposedFactorSet: DatasetMetadata & { name: string; sourceType: "OFFICIAL_DEFRA_DESNZ" };
  existingDatasetChecked: boolean;
  validationPassed: boolean;
  /** Phase 3-i previews are never authorisation to persist. */
  commitAllowed: false;
  commitBlockedReasons: string[];
}
