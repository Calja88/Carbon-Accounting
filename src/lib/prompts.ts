import { format } from "date-fns";

/**
 * Resolves the verbatim "Plain-English Prompt" template from the data map
 * into the actual on-screen question, substituting the sheet's own bracket
 * placeholders with real values. No wording is added or reworded — only
 * the bracketed tokens the sheet itself defines are replaced.
 */

export function formatPeriodLabel(periodStart: Date, frequency: string): string {
  if (frequency.toLowerCase().includes("quarter")) {
    const quarter = Math.floor(periodStart.getMonth() / 3) + 1;
    return `Q${quarter} ${periodStart.getFullYear()}`;
  }
  if (frequency.toLowerCase().includes("annual")) {
    return `${periodStart.getFullYear()}`;
  }
  return format(periodStart, "MMMM yyyy");
}

export interface PromptTokenValues {
  siteName: string;
  periodStart: Date;
  frequency: string;
  /** Selected FactorOption label, e.g. "Diesel" or "R410A" — for prompts with a [type]/[petrol/diesel] token */
  optionLabel?: string;
}

export function resolvePrompt(promptTemplate: string, values: PromptTokenValues): string {
  const periodLabel = formatPeriodLabel(values.periodStart, values.frequency);

  return promptTemplate
    .replace(/\[Reading fleet\]/g, `${values.siteName} fleet`)
    // "[site/function]" (S3-01) — the platform only has site-level entry,
    // no separate "function" concept, so this resolves the same as [site]
    // (same judgment call as the grey-fleet/Reading-fleet tokens above).
    .replace(/\[site\/function\]/g, values.siteName)
    .replace(/\[site\]/g, values.siteName)
    .replace(/\[month\/quarter\]/g, periodLabel)
    .replace(/\[month\]/g, periodLabel)
    .replace(/\[petrol\/diesel\]/g, values.optionLabel ?? "petrol/diesel")
    .replace(/\[type\]/g, values.optionLabel ?? "type");
}
