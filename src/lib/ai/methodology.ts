/**
 * The platform's own approved methodology, as structured, retrievable notes.
 *
 * Two reasons this exists rather than pasting a methodology document into
 * every prompt: cost and correctness. Cost, because a whole document per
 * request is wasteful and pushes out the actual data. Correctness, because a
 * model's background knowledge of "how GHG accounting works" is generic,
 * while these are the rules *this* application implements — and where the two
 * disagree, these win for anything the platform calculates.
 *
 * Every entry below states something the codebase actually does, with the
 * file that does it. Nothing here is a standards requirement invented for the
 * prompt: where the methodology is unconfirmed or a simplification, the entry
 * says so, because a reviewer needs to know that as much as the model does.
 */

export type MethodologyTopic =
  | "boundary"
  | "scopes"
  | "factors"
  | "calculation"
  | "data-quality"
  | "scope3"
  | "reporting"
  | "lca"
  | "limitations";

export interface MethodologyNote {
  id: string;
  topic: MethodologyTopic;
  title: string;
  body: string;
  /** Where in this repository the rule is implemented, for traceability. */
  implementedIn?: string;
  /** True when the platform itself flags this as unconfirmed or provisional. */
  provisional?: boolean;
  keywords: string[];
}

export const METHODOLOGY_NOTES: MethodologyNote[] = [
  {
    id: "boundary-operational-control",
    topic: "boundary",
    title: "Consolidation approach",
    body: "The Group consolidates under operational control, covering Paragon ID, RFID Discovery and Thames Technology. The report labels this approach as recommended and not yet formally confirmed, so it should never be described as settled.",
    implementedIn: "src/lib/report-service.ts",
    provisional: true,
    keywords: ["boundary", "consolidation", "operational control", "entities", "group"],
  },
  {
    id: "scope2-dual-reporting",
    topic: "scopes",
    title: "Scope 2 dual reporting",
    body: "Every Scope 2 electricity entry produces two figures side by side: location-based (UK grid average) and market-based. Headline totals use the location-based figure so the market-based companion is never double-counted; the market-based total is reported alongside. Where a site holds a REGO certificate or a green tariff the market-based factor applies, otherwise the residual-mix factor is used.",
    implementedIn: "src/lib/calc-engine.ts (calculateScope2Dual, selectMarketBasis)",
    keywords: ["scope 2", "market based", "location based", "rego", "green tariff", "residual mix", "electricity"],
  },
  {
    id: "scope2-heat-single-figure",
    topic: "scopes",
    title: "Purchased heat and steam",
    body: "Only electricity gets true dual location/market reporting. Purchased heat and steam are calculated as a single standard figure and rolled into the Scope 2 total, because no market-based instrument mechanism for purchased heat is described in the Group methodology.",
    provisional: true,
    keywords: ["heat", "steam", "district heating", "scope 2"],
  },
  {
    id: "factor-resolution-order",
    topic: "factors",
    title: "Which emission factor is used",
    body: "Factors resolve in a fixed order for the period being reported, not the date the calculation runs: a supplier-specific set for a named supplier first (recorded at the highest data-quality tier), then the official DEFRA/DESNZ set, then the EEIO spend-based set as a fallback for spend-based categories. If none of the three has a matching factor the entry is saved with status AWAITING_FACTOR and disclosed in reports as awaiting an emission factor — never estimated, never silently dropped.",
    implementedIn: "src/lib/entries-service.ts (resolveFactorMultiSource)",
    keywords: ["emission factor", "defra", "desnz", "eeio", "supplier specific", "awaiting factor", "spend based"],
  },
  {
    id: "factor-versioning",
    topic: "factors",
    title: "Factors are versioned, never edited",
    body: "A new year's factors are imported as a new EmissionFactorSet with its own effective window; existing sets are never edited in place. Each Calculation snapshots the factor value, unit, source and vintage onto its own row, so a historical report stays reproducible even after the catalogue changes.",
    implementedIn: "src/lib/factor-sets-service.ts, prisma/schema.prisma (Calculation)",
    keywords: ["versioning", "vintage", "snapshot", "audit", "reproducible", "factor set"],
  },
  {
    id: "calculation-equation",
    topic: "calculation",
    title: "How an emissions figure is produced",
    body: "activity quantity in the canonical unit x emission factor in kgCO2e per that unit = kgCO2e. The engine refuses to apply a factor whose unit does not match the input unit rather than converting silently. The full equation is stored on the calculation row as text.",
    implementedIn: "src/lib/calc-engine.ts (calculateEmission)",
    keywords: ["calculation", "equation", "formula", "kgco2e", "unit", "conversion"],
  },
  {
    id: "gas-unit-conversion",
    topic: "calculation",
    title: "Natural gas m3 to kWh",
    body: "Gas entered in cubic metres is converted with kWh = m3 x 1.02264 (volume correction) x 39.5 (calorific value, MJ/m3) / 3.6. These are UK national-average constants, not the figures on any specific bill, and the platform flags that as an assumption.",
    implementedIn: "src/lib/units.ts",
    provisional: true,
    keywords: ["gas", "m3", "cubic metres", "kwh", "calorific", "conversion"],
  },
  {
    id: "data-quality-tiers",
    topic: "data-quality",
    title: "Data quality tiers",
    body: "Each entry carries a tier: Tier 1 is directly metered or invoiced, Tier 2 is calculated from records, Tier 3 is estimated or extrapolated. Report percentages are weighted against Scope 1 + Scope 2 location-based + Scope 3, so a Scope 2 entry's market-based duplicate is not counted twice.",
    implementedIn: "src/lib/report-service.ts",
    keywords: ["data quality", "tier", "metered", "estimated", "reliability"],
  },
  {
    id: "plausibility-check",
    topic: "data-quality",
    title: "Plausibility flagging",
    body: "An entry whose value moves more than 300% against the previous period for the same site and data point is flagged for review and excluded from report totals until resolved, listed separately as excluded pending review. The 300% threshold is the methodology's single illustrative example, not a confirmed Group policy, and a decrease can never exceed -100%, so this default only ever fires on increases.",
    implementedIn: "src/lib/plausibility.ts",
    provisional: true,
    keywords: ["plausibility", "anomaly", "flagged", "threshold", "outlier", "review"],
  },
  {
    id: "scope3-categories-built",
    topic: "scope3",
    title: "Which Scope 3 categories exist here",
    body: "Only Categories 1 (purchased goods and services, spend-based), 3 (fuel- and energy-related activities, auto-derived), 6 (business travel) and 7 (employee commuting, survey-based) are implemented. Categories 2, 4, 5, 8 and 9 are planned but not built; 10 and 13-15 were screened as not material. Never imply the platform currently reports a category it does not.",
    implementedIn: "src/lib/factor-categories.ts",
    keywords: ["scope 3", "categories", "cat 1", "cat 3", "cat 6", "cat 7", "materiality", "screening"],
  },
  {
    id: "cat3-derivation",
    topic: "scope3",
    title: "Category 3 is derived, not entered",
    body: "Well-to-tank and transmission-and-distribution-loss figures are derived automatically from existing Scope 1 and Scope 2 activity data, with each derived row linked back to the calculation it came from. Only stationary and mobile combustion fuel, grey fleet mileage and location-based grid electricity have a companion; refrigerants and purchased heat do not.",
    implementedIn: "src/lib/scope3-derived.ts, src/lib/entries-service.ts (deriveCategory3Calculations)",
    keywords: ["cat 3", "well to tank", "wtt", "t&d", "transmission", "distribution", "derived", "upstream"],
  },
  {
    id: "commuting-extrapolation",
    topic: "scope3",
    title: "Employee commuting extrapolation",
    body: "Commuting distance = headcount x share of headcount using a mode x average one-way distance x 2 x commuting days in the period. The commuting-days figure is always entered by whoever runs the survey and is never assumed by the platform. Plausibility checking deliberately does not apply to survey-derived entries.",
    implementedIn: "src/lib/commuting.ts",
    keywords: ["commuting", "cat 7", "survey", "headcount", "extrapolation", "modal split"],
  },
  {
    id: "business-travel-units",
    topic: "scope3",
    title: "Business travel units",
    body: "Business travel is recorded by distance (km for rail and flights) or nights for hotels, not by number of journeys, because published factors are per passenger-km or per room-night. Car mileage for business use is grey fleet — Scope 1 — not Category 6.",
    implementedIn: "src/lib/expensein-import.ts",
    keywords: ["business travel", "cat 6", "flights", "rail", "hotel", "grey fleet", "mileage"],
  },
  {
    id: "reporting-snapshots",
    topic: "reporting",
    title: "Reports are immutable snapshots",
    body: "Generating a report creates a new append-only snapshot with its own frozen payload and links to the exact calculations included. Existing snapshots are never overwritten, so a figure quoted from a past report can always be traced to the data behind it.",
    implementedIn: "src/lib/report-service.ts, prisma/schema.prisma (ReportSnapshot)",
    keywords: ["report", "snapshot", "audit", "immutable", "version"],
  },
  {
    id: "flagged-exclusion",
    topic: "reporting",
    title: "What is excluded from totals",
    body: "Flagged entries are excluded from report totals and listed as excluded pending review. Entries awaiting an emission factor are also outside the totals and are disclosed separately. Both are surfaced in every report rather than being silently omitted.",
    implementedIn: "src/lib/report-service.ts",
    keywords: ["excluded", "flagged", "awaiting factor", "disclosure", "completeness"],
  },
  {
    id: "lca-authority",
    topic: "lca",
    title: "How LCA works in this platform",
    body: "A product LCA is a structured assessment: goal and scope, a methodology profile, processes and inventory items. Every item resolves to a factor from the platform's approved catalogue, a supplier PCF or a recorded manual factor, and the deterministic LCA engine calculates from that, applies allocation, and aggregates by stage and process. Product assessment totals are never added to the corporate inventory — they answer different questions. The AI never produces an LCA number; it helps the user build and interpret the assessment.",
    implementedIn: "src/lib/lca/engine, src/lib/lca/calculation-service.ts",
    keywords: ["lca", "life cycle", "inventory", "lci", "functional unit", "system boundary", "allocation"],
  },
  {
    id: "lca-claims",
    topic: "lca",
    title: "What an LCA here may be called",
    body: "The platform structures an assessment to support alignment with recognised LCA principles including ISO 14040 and 14044 and product GHG accounting practice. It does not perform critical review, verification or certification, and an assessment must never be described as ISO compliant, verified or certified unless a real review has taken place and been recorded against it (LcaVerification).",
    keywords: ["iso 14040", "iso 14044", "critical review", "verification", "certification", "compliance", "epd"],
  },
  {
    id: "limitations-known",
    topic: "limitations",
    title: "Known limitations to disclose",
    body: "No UK residual-mix electricity factor is imported, so market-based and location-based Scope 2 read the same for sites with no green instrument. Hotel stays use the UK factor regardless of destination. Generic 'other refrigerant blend' has no factor and shows as awaiting one. There is no base year set yet, so no base-year comparison is available. Say so plainly when any of these bears on an answer.",
    provisional: true,
    keywords: ["limitations", "residual mix", "hotel", "refrigerant", "base year", "gaps"],
  },
];

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "is", "are", "was", "were", "what", "why", "how",
  "our", "my", "we", "this", "that", "it", "do", "does", "did", "can", "should", "would", "about", "with", "from",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.&-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Keyword retrieval over the notes above. Deliberately simple and
 * dependency-free: with a few dozen curated notes, a scored keyword match
 * picks the right three or four reliably, and there is nothing to go stale or
 * to re-index. If the note set ever grows into the hundreds this is the place
 * to swap in real search.
 */
export function retrieveMethodologyNotes(query: string, limit = 4): MethodologyNote[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored = METHODOLOGY_NOTES.map((note) => {
    const haystack = `${note.title} ${note.body} ${note.keywords.join(" ")}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (note.keywords.some((k) => k.includes(token))) score += 3;
      else if (haystack.includes(token)) score += 1;
    }
    return { note, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.note);
}

export function notesByTopic(topic: MethodologyTopic): MethodologyNote[] {
  return METHODOLOGY_NOTES.filter((n) => n.topic === topic);
}

/** Renders notes for a prompt, keeping the provisional flag visible. */
export function formatMethodologyNotes(notes: MethodologyNote[]): string {
  if (notes.length === 0) return "";
  return notes
    .map((n) => {
      const flag = n.provisional ? " [PROVISIONAL — this platform flags this as unconfirmed]" : "";
      const impl = n.implementedIn ? ` (implemented in ${n.implementedIn})` : "";
      return `- ${n.title}${flag}: ${n.body}${impl}`;
    })
    .join("\n");
}
