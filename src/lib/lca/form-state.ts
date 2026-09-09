/**
 * Shared form-state shapes for the product LCA server actions.
 *
 * These live outside the `"use server"` files deliberately: a server-action
 * module may only export async functions, so the initial-state constants the
 * client forms need have to sit somewhere both sides can import from.
 */

import type { InventoryImportPreview } from "./import/inventory-import";

/** The state every simple LCA form action returns. */
export interface AssessmentFormState {
  error: string | null;
  success: boolean;
  message?: string | null;
}

export const emptyAssessmentState: AssessmentFormState = { error: null, success: false, message: null };

export interface ProductFormState {
  error: string | null;
  success: boolean;
  message?: string | null;
}

export const emptyProductState: ProductFormState = { error: null, success: false, message: null };

export interface SupplierFormState {
  error: string | null;
  success: boolean;
  message?: string | null;
  /** Non-blocking findings from a supplier document import. */
  warnings?: string[];
}

export const emptySupplierState: SupplierFormState = { error: null, success: false, message: null, warnings: [] };

export interface MethodologyFormState {
  error: string | null;
  success: boolean;
  message?: string | null;
}

export const emptyMethodologyState: MethodologyFormState = { error: null, success: false, message: null };

/**
 * The inventory import is a two-step form: the first action produces a preview
 * and writes nothing, the second writes what the importer confirmed.
 */
export interface ImportState {
  error: string | null;
  preview: InventoryImportPreview | null;
  fileName: string | null;
  committed: { created: number; updated: number; skipped: number } | null;
}

export const emptyImportState: ImportState = { error: null, preview: null, fileName: null, committed: null };
