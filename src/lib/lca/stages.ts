/**
 * Life cycle stage templates.
 *
 * A new study is seeded with the stages its declared system boundary
 * implies — cradle-to-gate stops at the factory gate, cradle-to-grave runs
 * through use and end-of-life. Stages outside the boundary are created but
 * marked excluded with the reason recorded, rather than left out silently:
 * an exclusion a reader can see is a methodological statement, an exclusion
 * they can't is a hole in the study.
 *
 * Users can add, rename, include or exclude stages afterwards. This is a
 * starting point, not a constraint.
 */

import { LcaBoundaryType, LcaStageKey } from "@prisma/client";

export interface StageTemplate {
  key: LcaStageKey;
  name: string;
  description: string;
  sortOrder: number;
}

export const STAGE_TEMPLATES: StageTemplate[] = [
  {
    key: LcaStageKey.RAW_MATERIALS,
    name: "Raw materials",
    description: "Extraction and production of the materials that go into the product, up to the point they leave the supplier.",
    sortOrder: 10,
  },
  {
    key: LcaStageKey.INBOUND_TRANSPORT,
    name: "Inbound transport",
    description: "Moving materials and components from suppliers to the manufacturing site.",
    sortOrder: 20,
  },
  {
    key: LcaStageKey.MANUFACTURING,
    name: "Manufacturing",
    description: "Converting materials into the product: process energy, direct emissions, process water and production waste.",
    sortOrder: 30,
  },
  {
    key: LcaStageKey.PACKAGING,
    name: "Packaging",
    description: "Packaging materials applied to the product and the energy used to apply them.",
    sortOrder: 40,
  },
  {
    key: LcaStageKey.DISTRIBUTION,
    name: "Distribution",
    description: "Moving the finished product to the customer, including any warehousing in between.",
    sortOrder: 50,
  },
  {
    key: LcaStageKey.USE,
    name: "Use",
    description: "Energy, consumables and maintenance over the product's service life.",
    sortOrder: 60,
  },
  {
    key: LcaStageKey.END_OF_LIFE,
    name: "End of life",
    description: "Collection, treatment, recycling, recovery or disposal once the product is discarded.",
    sortOrder: 70,
  },
];

/** Which stages a boundary type includes by default. */
const BOUNDARY_INCLUDES: Record<LcaBoundaryType, LcaStageKey[]> = {
  CRADLE_TO_GATE: [
    LcaStageKey.RAW_MATERIALS,
    LcaStageKey.INBOUND_TRANSPORT,
    LcaStageKey.MANUFACTURING,
    LcaStageKey.PACKAGING,
  ],
  CRADLE_TO_GRAVE: STAGE_TEMPLATES.map((s) => s.key),
  GATE_TO_GATE: [LcaStageKey.MANUFACTURING],
  CRADLE_TO_CRADLE: STAGE_TEMPLATES.map((s) => s.key),
  OTHER: STAGE_TEMPLATES.map((s) => s.key),
};

const BOUNDARY_LABELS: Record<LcaBoundaryType, string> = {
  CRADLE_TO_GATE: "cradle-to-gate",
  CRADLE_TO_GRAVE: "cradle-to-grave",
  GATE_TO_GATE: "gate-to-gate",
  CRADLE_TO_CRADLE: "cradle-to-cradle",
  OTHER: "the declared",
};

export interface SeededStage extends StageTemplate {
  included: boolean;
  exclusionReason: string | null;
}

/**
 * The stage list for a boundary type, with excluded stages carrying an
 * explicit, editable reason.
 */
export function stagesForBoundary(boundary: LcaBoundaryType): SeededStage[] {
  const included = new Set(BOUNDARY_INCLUDES[boundary]);
  return STAGE_TEMPLATES.map((template) => ({
    ...template,
    included: included.has(template.key),
    exclusionReason: included.has(template.key)
      ? null
      : `Outside the ${BOUNDARY_LABELS[boundary]} system boundary declared for this study. Edit this reason if the exclusion has a different basis.`,
  }));
}

export const BOUNDARY_TYPE_LABELS: Record<LcaBoundaryType, string> = {
  CRADLE_TO_GATE: "Cradle-to-gate",
  CRADLE_TO_GRAVE: "Cradle-to-grave",
  GATE_TO_GATE: "Gate-to-gate",
  CRADLE_TO_CRADLE: "Cradle-to-cradle",
  OTHER: "Other (described in notes)",
};

export const ALLOCATION_METHOD_LABELS: Record<string, string> = {
  NOT_APPLICABLE: "Not applicable — no co-products",
  NONE_SUBDIVISION: "Avoided by subdivision",
  MASS: "Mass allocation",
  ECONOMIC: "Economic allocation",
  ENERGY: "Energy content allocation",
  PHYSICAL_CAUSALITY: "Other physical causality",
  SYSTEM_EXPANSION: "System expansion / substitution",
  OTHER: "Other (described in rationale)",
};

export const FLOW_TYPE_LABELS: Record<string, string> = {
  MATERIAL: "Material",
  ENERGY: "Energy",
  FUEL: "Fuel",
  ELECTRICITY: "Electricity",
  WATER: "Water",
  TRANSPORT: "Transport",
  WASTE: "Waste",
  EMISSION: "Direct emission",
  PRODUCT: "Product",
  CO_PRODUCT: "Co-product",
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  NOT_REVIEWED: "No critical review",
  INTERNAL_REVIEW: "Internal review",
  EXTERNAL_REVIEW: "External expert review",
  PANEL_REVIEW: "Interested-party panel review",
};
