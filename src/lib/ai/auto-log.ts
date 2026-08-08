/**
 * The auto-log decision engine.
 *
 * This is the module that decides whether the platform may write an accounting
 * entry without a person confirming it field by field. It is a pure function
 * over facts the application gathered itself — a data point that exists, a unit
 * the data point accepts, a factor that resolved to exactly one row, a site the
 * caller is authorised for, no duplicate already on file.
 *
 * What it deliberately does *not* consult: the model's own confidence number.
 * A model reporting 0.95 tells you how the sentence was phrased, not whether
 * an emission factor exists for October 2026 or whether this invoice was
 * already recorded in August. "High confidence" in this platform means the
 * checks below passed. That is the whole point of the enum being called
 * AUTO_LOG_HIGH_CONFIDENCE and of this file containing no reference to
 * `overall.confidence`.
 *
 * When a check fails the engine also produces the *minimum question* that
 * would unblock it, so the assistant can ask one focused thing ("was this
 * recycled, incinerated or landfilled?") instead of handing back a form.
 *
 * Pure: no database, no network, no Prisma imports beyond the mode enum. It is
 * unit-tested directly (src/lib/__tests__/ai-auto-log.test.ts).
 */

import { AiDataEntryMode } from "@prisma/client";

/**
 * The user telling the platform not to record something they are attaching.
 *
 * Automatic logging happens *before* any model is asked what to do — that
 * ordering is what keeps the decision deterministic — which means the user's
 * own message is the only thing that can hold it back, and it has to be read
 * here rather than inferred later. Checked against their message text only;
 * document contents never reach it.
 *
 * Deliberately narrow: it matches an explicit refusal, not a question. "What
 * does this invoice say?" is a question about a document the platform is still
 * configured to record.
 */
const DECLINE_PATTERNS: RegExp[] = [
  /\b(do\s*n[o']?t|don't|do not|never)\s+(automatically\s+)?(log|record|add|save|create|enter|post)\b/i,
  /\bwithout\s+(logging|recording|creating|adding)\b/i,
  /\bjust\s+(read|check|look at|tell me about|summarise|summarize)\b/i,
  /\b(no|don't)\s+entr(y|ies)\b/i,
  /\bdon'?t\s+create\s+an?\s+entry\b/i,
];

export function userDeclinedAutoLog(userMessage: string): boolean {
  return DECLINE_PATTERNS.some((pattern) => pattern.test(userMessage));
}

/** What caused this candidate to be considered. */
export type AutoLogTrigger =
  /** The platform read a document and found something loggable in it. */
  | "DOCUMENT"
  /** The user asked for it in so many words ("log 1,500 litres of diesel"). */
  | "USER_INSTRUCTION";

export type AutoLogCheckId =
  | "source_usable"
  | "quantity_present"
  | "unit_recognised"
  | "period_known"
  | "category_determined"
  | "subtype_determined"
  | "site_authorised"
  | "factor_resolved"
  | "factor_unit_compatible"
  | "values_consistent"
  | "no_duplicate"
  | "evidence_retained";

export interface AutoLogCheck {
  id: AutoLogCheckId;
  /** Short statement of what was checked, written for a reviewer or auditor. */
  label: string;
  passed: boolean;
  /** Why it failed, or the value that satisfied it. */
  detail: string | null;
}

export interface AutoLogFactorFacts {
  /** Exactly one factor resolved through the platform's normal resolution order. */
  resolved: boolean;
  /** More than one plausible factor, with nothing to choose between them. */
  ambiguous: boolean;
  /** Human labels of the candidates, for the "which one?" question. */
  candidateLabels: string[];
  /** The factor's unit matches the canonical unit the entry would be stored in. */
  unitCompatible: boolean;
  reason: string | null;
}

export interface AutoLogDuplicateFacts {
  suspected: boolean;
  reason: string | null;
  existingEntryIds: string[];
}

/**
 * Everything the engine judges, gathered by the caller from the database and
 * the validated extraction. Every field is a fact, never an opinion.
 */
export interface AutoLogFacts {
  /** The extraction succeeded / the user's statement parsed into a candidate. */
  sourceUsable: boolean;
  sourceUnusableReason: string | null;

  quantity: number | null;
  unit: string | null;
  /** Units the resolved data point (or its chosen sub-type) actually accepts. */
  acceptedUnits: string[];

  /** "YYYY-MM" or "YYYY-MM-DD", matching the data point's frequency. */
  periodInput: string | null;

  dataPointCode: string | null;
  dataPointName: string | null;

  /** True when the data point offers sub-types and one must be chosen. */
  requiresSubtype: boolean;
  subtypeKey: string | null;
  subtypeOptions: { key: string; label: string }[];

  siteId: string | null;
  siteAuthorised: boolean;

  factor: AutoLogFactorFacts;
  duplicate: AutoLogDuplicateFacts;

  /** Figures on the document that contradict each other, stated plainly. */
  conflicts: string[];

  /** The document this came from, when it came from one. */
  sourceDocumentId: string | null;
  extractionId: string | null;
}

export interface AutoLogDecision {
  allowed: boolean;
  checks: AutoLogCheck[];
  /** Failed check labels, most blocking first — shown on the review card. */
  blockers: string[];
  /**
   * The single most useful question to put to the user, or null when nothing
   * they could say would unblock it (a missing emission factor, for instance,
   * is an administrator's import, not an answer).
   */
  question: string | null;
  /** Why auto-logging was withheld even though every check passed. */
  withheldReason: string | null;
}

function check(id: AutoLogCheckId, label: string, passed: boolean, detail: string | null = null): AutoLogCheck {
  return { id, label, passed, detail };
}

function listOptions(options: { key: string; label: string }[]): string {
  const labels = options.map((o) => o.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * Unit comparison is case- and spacing-insensitive because a document says
 * "KWH" and the catalogue says "kWh" — but it is never *lenient*: "kwh" and
 * "kw" remain different units, and an unrecognised unit fails the check rather
 * than being coerced into the nearest match.
 */
function unitMatches(unit: string, accepted: string[]): boolean {
  const normalised = unit.trim().toLowerCase();
  return accepted.some((a) => a.trim().toLowerCase() === normalised);
}

/**
 * Runs every condition and reports each one individually, so the result card
 * and the audit trail can show what was checked, not just the verdict.
 */
export function evaluateAutoLog(
  facts: AutoLogFacts,
  options: { mode: AiDataEntryMode; trigger: AutoLogTrigger },
): AutoLogDecision {
  const checks: AutoLogCheck[] = [];

  checks.push(
    check(
      "source_usable",
      "The document or instruction could be read",
      facts.sourceUsable,
      facts.sourceUnusableReason,
    ),
  );

  const quantityOk = facts.quantity !== null && Number.isFinite(facts.quantity) && facts.quantity > 0;
  checks.push(
    check(
      "quantity_present",
      "An unambiguous quantity was found",
      quantityOk,
      quantityOk ? `${facts.quantity}` : "No single, positive quantity could be read.",
    ),
  );

  const unitOk = Boolean(facts.unit) && facts.acceptedUnits.length > 0 && unitMatches(facts.unit!, facts.acceptedUnits);
  checks.push(
    check(
      "unit_recognised",
      "The unit is one this platform records",
      unitOk,
      unitOk
        ? facts.unit
        : facts.unit
          ? `"${facts.unit}" isn't a unit this data point accepts (${facts.acceptedUnits.join(", ") || "none configured"}).`
          : "No unit was found.",
    ),
  );

  checks.push(
    check(
      "period_known",
      "The reporting period is known",
      Boolean(facts.periodInput),
      facts.periodInput ?? "No billing period or date could be read.",
    ),
  );

  checks.push(
    check(
      "category_determined",
      "The activity maps to one of this platform's data points",
      Boolean(facts.dataPointCode),
      facts.dataPointCode ? `${facts.dataPointCode} — ${facts.dataPointName ?? ""}`.trim() : "No data point fits this activity.",
    ),
  );

  const subtypeOk = !facts.requiresSubtype || Boolean(facts.subtypeKey);
  checks.push(
    check(
      "subtype_determined",
      "The sub-type is determined",
      subtypeOk,
      subtypeOk
        ? (facts.subtypeKey ?? "not required for this data point")
        : `${facts.dataPointCode ?? "This data point"} needs a type to be chosen before a factor can be applied.`,
    ),
  );

  checks.push(
    check(
      "site_authorised",
      "The site is one you're authorised for",
      Boolean(facts.siteId) && facts.siteAuthorised,
      facts.siteId ? (facts.siteAuthorised ? facts.siteId : "That site is outside your access.") : "No site was identified.",
    ),
  );

  checks.push(
    check(
      "factor_resolved",
      "Exactly one emission factor applies",
      facts.factor.resolved && !facts.factor.ambiguous,
      facts.factor.reason ??
        (facts.factor.ambiguous
          ? `More than one factor could apply: ${facts.factor.candidateLabels.join("; ")}.`
          : facts.factor.resolved
            ? "Resolved from this platform's factor library."
            : "No emission factor is available for this activity and period."),
    ),
  );

  checks.push(
    check(
      "factor_unit_compatible",
      "The factor's unit matches the recorded quantity",
      facts.factor.resolved && facts.factor.unitCompatible,
      facts.factor.resolved && !facts.factor.unitCompatible
        ? "The available factor is expressed per a different unit, so the calculation would not be valid."
        : null,
    ),
  );

  checks.push(
    check(
      "values_consistent",
      "The figures on the document agree with each other",
      facts.conflicts.length === 0,
      facts.conflicts.length > 0 ? facts.conflicts.join(" ") : null,
    ),
  );

  checks.push(
    check(
      "no_duplicate",
      "Nothing matching this is already recorded",
      !facts.duplicate.suspected,
      facts.duplicate.reason,
    ),
  );

  // Evidence is only required of something that came from a document. A
  // figure the user stated in chat has the conversation and the AiInteraction
  // as its provenance, which is what the audit trail records for it.
  const evidenceOk = options.trigger === "USER_INSTRUCTION" || Boolean(facts.sourceDocumentId);
  checks.push(
    check(
      "evidence_retained",
      "The source document is retained and linked",
      evidenceOk,
      evidenceOk ? (facts.sourceDocumentId ?? "stated in the assistant") : "The evidence document is no longer available.",
    ),
  );

  const failed = checks.filter((c) => !c.passed);
  const passedAll = failed.length === 0;

  // REVIEW_ALL never blocks a person's own explicit instruction — that person
  // has already made the accounting decision, and the checks above still have
  // to pass before anything is written. What it blocks is the platform acting
  // on a document nobody asked it to act on.
  const modeAllows = options.mode === AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE || options.trigger === "USER_INSTRUCTION";

  return {
    allowed: passedAll && modeAllows,
    checks,
    blockers: failed.map((c) => c.detail ?? c.label),
    question: passedAll ? null : questionFor(failed[0], facts),
    withheldReason:
      passedAll && !modeAllows
        ? "AI data entry mode is set to review everything, so this is held for you to accept rather than recorded automatically."
        : null,
  };
}

/**
 * The one question worth asking about the first thing that failed.
 *
 * Returns null where no answer from the user would help — a missing emission
 * factor needs an administrator to import one, and a suspected duplicate needs
 * a decision about the existing entry, not a fact about this one.
 */
function questionFor(failure: AutoLogCheck | undefined, facts: AutoLogFacts): string | null {
  if (!failure) return null;

  switch (failure.id) {
    case "quantity_present":
      return "I couldn't read a single clear quantity off this. What figure should I record, and in what unit?";
    case "unit_recognised":
      return facts.acceptedUnits.length > 0
        ? `I couldn't match the unit to one this platform records. Should this be in ${facts.acceptedUnits.join(" or ")}?`
        : "What unit is that figure in?";
    case "period_known":
      return "Which period does this cover? A month (for example 2026-07) is enough.";
    case "category_determined":
      return "I can't tell which activity this belongs to. What is it a record of?";
    case "subtype_determined":
      return facts.subtypeOptions.length > 0
        ? `${facts.dataPointName ?? "This entry"} needs a type before I can apply a factor. Was it ${listOptions(facts.subtypeOptions)}?`
        : "What type of activity was this?";
    case "site_authorised":
      return facts.siteId ? null : "Which site should I record this against?";
    case "values_consistent":
      return "The figures on this document don't agree with each other, so I haven't recorded anything. Which one is right?";
    case "source_usable":
    case "factor_resolved":
    case "factor_unit_compatible":
    case "no_duplicate":
    case "evidence_retained":
    default:
      return null;
  }
}
