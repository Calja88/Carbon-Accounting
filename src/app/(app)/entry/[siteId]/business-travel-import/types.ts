/**
 * Shared types + initial state for the ExpenseIn import flow.
 *
 * Deliberately NOT in actions.ts: a `"use server"` module may only export
 * async functions, so a plain object constant exported from there arrives
 * as `undefined` on the client.
 */

import type { ColumnMapping } from "@/lib/expensein-import";

export interface PreviewRow {
  periodLabel: string;
  periodStartIso: string;
  subtype: string;
  subtypeLabel: string;
  value: number;
  unit: string;
  rowCount: number;
}

export interface SkippedRowView {
  rowNumber: number;
  reason: string;
  categoryText: string;
}

export interface PreviewState {
  stage: "idle" | "preview" | "done";
  error: string | null;
  headers: string[];
  mapping: ColumnMapping | null;
  distanceUnit: "miles" | "km";
  rows: PreviewRow[];
  skipped: SkippedRowView[];
  totalDataRows: number;
  /** Populated once committed. */
  importedCount: number;
  awaitingFactorCount: number;
  flaggedCount: number;
}

export const INITIAL_PREVIEW_STATE: PreviewState = {
  stage: "idle",
  error: null,
  headers: [],
  mapping: null,
  distanceUnit: "miles",
  rows: [],
  skipped: [],
  totalDataRows: 0,
  importedCount: 0,
  awaitingFactorCount: 0,
  flaggedCount: 0,
};
