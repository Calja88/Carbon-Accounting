/**
 * Deterministic emission classification.
 *
 * The platform's own rules are authoritative. Where an activity description
 * matches one of them unambiguously, that answer is used and no model is
 * called at all — it is faster, free, reproducible, and it cannot drift.
 * AI classification exists for the genuinely ambiguous remainder (see
 * src/lib/ai/services/classify.ts).
 *
 * Rules are deliberately conservative. A rule fires only on wording that
 * could not reasonably mean something else, and a description that matches
 * two different data points is treated as ambiguous rather than resolved by
 * whichever rule happened to be listed first. Guessing here would produce a
 * confident, wrong scope — the failure mode the whole platform is built to
 * avoid.
 *
 * Pure functions, no database, no network — unit-tested directly.
 */

export interface ClassificationRule {
  /** ActivityDataPoint.code this activity belongs to. */
  dataPointCode: string;
  scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3";
  categoryLabel: string;
  /** FactorOption.subtypeKey, when the wording pins it down exactly. */
  subtypeKey?: string;
  /** All of these must appear (each entry is a set of synonyms; one of each set suffices). */
  requireAll: string[][];
  /** If any of these appear, the rule does not fire. */
  exclude?: string[];
  explanation: string;
}

const RULES: ClassificationRule[] = [
  {
    dataPointCode: "S2-01",
    scope: "SCOPE_2",
    categoryLabel: "Purchased electricity",
    requireAll: [["electricity", "kwh electricity", "electric supply", "power supply", "mpan"]],
    exclude: ["generator", "diesel", "electric car", "electric vehicle", "ev charging", "export", "generated on site"],
    explanation:
      "Classified as Scope 2 because the activity is purchased grid electricity consumed by the reporting organisation.",
  },
  {
    dataPointCode: "S1-01",
    scope: "SCOPE_1",
    categoryLabel: "Stationary combustion — natural gas",
    requireAll: [["natural gas", "mains gas", "gas supply", "gas bill", "mprn"]],
    exclude: ["lpg", "gas oil", "bottled", "refrigerant"],
    explanation:
      "Classified as Scope 1 because natural gas burned in the organisation's own facilities is direct combustion.",
  },
  {
    dataPointCode: "S1-02",
    scope: "SCOPE_1",
    categoryLabel: "Stationary combustion — backup generator",
    requireAll: [
      ["generator", "genset", "standby power"],
      ["diesel", "gas oil", "fuel"],
    ],
    explanation:
      "Classified as Scope 1 because fuel burned in a generator owned or controlled by the organisation is direct combustion.",
  },
  {
    dataPointCode: "S1-03",
    scope: "SCOPE_1",
    categoryLabel: "Mobile combustion — own fleet fuel",
    requireAll: [
      ["fleet", "company vehicle", "company van", "company car", "van fuel", "hgv"],
      ["fuel", "diesel", "petrol", "fuel card"],
    ],
    exclude: ["grey fleet", "employee-owned", "own car", "mileage claim", "expense claim"],
    explanation:
      "Classified as Scope 1 because fuel bought for vehicles the organisation owns or leases is direct combustion.",
  },
  {
    dataPointCode: "S1-04",
    scope: "SCOPE_1",
    categoryLabel: "Mobile combustion — grey fleet mileage",
    requireAll: [
      ["grey fleet", "mileage claim", "employee-owned vehicle", "own car", "personal car"],
      ["mile", "mileage", "km", "business travel", "claim"],
    ],
    explanation:
      "Classified as Scope 1 grey fleet because an employee-owned vehicle used for business is recorded here, not as Category 6 business travel.",
  },
  {
    dataPointCode: "S1-05",
    scope: "SCOPE_1",
    categoryLabel: "Fugitive emissions — refrigerant",
    requireAll: [["refrigerant", "f-gas", "fgas", "r410a", "r134a", "r404a", "r32", "air conditioning recharge"]],
    explanation:
      "Classified as Scope 1 fugitive emissions because refrigerant added to the organisation's own equipment replaces gas that has leaked.",
  },
  {
    dataPointCode: "S2-04",
    scope: "SCOPE_2",
    categoryLabel: "Purchased heat or steam",
    requireAll: [["district heat", "district heating", "purchased heat", "purchased steam", "steam supply"]],
    explanation:
      "Classified as Scope 2 because heat or steam purchased from a third party is indirect energy the organisation consumes.",
  },
  {
    dataPointCode: "S3-06",
    scope: "SCOPE_3",
    categoryLabel: "Cat 6 — Business travel",
    subtypeKey: "hotel",
    requireAll: [["hotel", "accommodation", "room night"]],
    explanation:
      "Classified as Scope 3 Category 6 because employee accommodation on business travel is a purchased service, not an owned asset.",
  },
  {
    dataPointCode: "S3-06",
    scope: "SCOPE_3",
    categoryLabel: "Cat 6 — Business travel",
    subtypeKey: "rail",
    requireAll: [["rail", "train", "railway"]],
    exclude: ["commut", "freight", "rail freight"],
    explanation:
      "Classified as Scope 3 Category 6 because rail travel on business is a third-party transport service.",
  },
  {
    dataPointCode: "S3-07",
    scope: "SCOPE_3",
    categoryLabel: "Cat 7 — Employee commuting",
    requireAll: [["commuting", "commute", "commuter"]],
    explanation:
      "Classified as Scope 3 Category 7 because travel between home and a normal place of work is employee commuting.",
  },
];

export interface DeterministicClassification {
  matched: true;
  dataPointCode: string;
  scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3";
  categoryLabel: string;
  subtypeKey: string | null;
  explanation: string;
  /** The rule's own wording, so the UI can show why it fired. */
  source: "platform-rule";
}

export interface NoDeterministicMatch {
  matched: false;
  /** Present when more than one rule fired — genuinely ambiguous, not unknown. */
  ambiguousBetween: string[];
}

export type ClassificationRuleResult = DeterministicClassification | NoDeterministicMatch;

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function ruleMatches(rule: ClassificationRule, haystack: string): boolean {
  if (rule.exclude?.some((term) => haystack.includes(normalise(term).trim()))) return false;
  return rule.requireAll.every((synonyms) => synonyms.some((term) => haystack.includes(normalise(term).trim())));
}

/**
 * Applies the platform's own rules to a free-text activity description.
 *
 * Returns a match only when exactly one rule fires. Two rules firing means
 * the description is ambiguous — reported as such so the caller can ask AI
 * (or a person) rather than picking one arbitrarily.
 */
export function classifyDeterministically(description: string): ClassificationRuleResult {
  const haystack = normalise(description);
  if (haystack.trim().length === 0) return { matched: false, ambiguousBetween: [] };

  const hits = RULES.filter((rule) => ruleMatches(rule, haystack));

  if (hits.length === 1) {
    const rule = hits[0];
    return {
      matched: true,
      dataPointCode: rule.dataPointCode,
      scope: rule.scope,
      categoryLabel: rule.categoryLabel,
      subtypeKey: rule.subtypeKey ?? null,
      explanation: rule.explanation,
      source: "platform-rule",
    };
  }

  // Several rules that all point at the same data point and subtype are not
  // actually a conflict.
  if (hits.length > 1) {
    const distinct = new Set(hits.map((h) => `${h.dataPointCode}:${h.subtypeKey ?? ""}`));
    if (distinct.size === 1) {
      const rule = hits[0];
      return {
        matched: true,
        dataPointCode: rule.dataPointCode,
        scope: rule.scope,
        categoryLabel: rule.categoryLabel,
        subtypeKey: rule.subtypeKey ?? null,
        explanation: rule.explanation,
        source: "platform-rule",
      };
    }
    return { matched: false, ambiguousBetween: Array.from(distinct) };
  }

  return { matched: false, ambiguousBetween: [] };
}

export const CLASSIFICATION_RULE_COUNT = RULES.length;
