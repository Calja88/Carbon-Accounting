/**
 * Display labels and ordering for the LCA domain enums. Kept in one place so
 * a stage reads the same on the model page, the results dashboard, the report
 * and the CSV export.
 */

import {
  LcaAllocationMethod,
  LcaAssessmentStatus,
  LcaAssuranceType,
  LcaBiogenicTreatment,
  LcaBoundary,
  LcaCorporateLinkType,
  LcaDataType,
  LcaElectricityApproach,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaMateriality,
  LcaOffsetTreatment,
  LcaPcfVerificationStatus,
  LcaRecyclingMethod,
  LcaTransportMode,
  LcaUncertaintyStatus,
} from "@prisma/client";

/** Cradle-to-grave order — every stage list in the UI follows this. */
export const LIFECYCLE_STAGE_ORDER: LcaLifecycleStage[] = [
  LcaLifecycleStage.RAW_MATERIALS,
  LcaLifecycleStage.INBOUND_TRANSPORT,
  LcaLifecycleStage.MANUFACTURING,
  LcaLifecycleStage.PACKAGING,
  LcaLifecycleStage.DISTRIBUTION,
  LcaLifecycleStage.USE_PHASE,
  LcaLifecycleStage.END_OF_LIFE,
  LcaLifecycleStage.OTHER,
];

export const STAGE_LABELS: Record<LcaLifecycleStage, string> = {
  RAW_MATERIALS: "Raw materials",
  INBOUND_TRANSPORT: "Inbound transport",
  MANUFACTURING: "Manufacturing",
  PACKAGING: "Packaging",
  DISTRIBUTION: "Distribution",
  USE_PHASE: "Use phase",
  END_OF_LIFE: "End of life",
  OTHER: "Other",
};

export const STAGE_DESCRIPTIONS: Record<LcaLifecycleStage, string> = {
  RAW_MATERIALS: "Extraction and production of the materials and components that go into the product.",
  INBOUND_TRANSPORT: "Moving materials and components from suppliers to the point of manufacture.",
  MANUFACTURING: "Converting inputs into the finished product: energy, process emissions and production waste.",
  PACKAGING: "Primary, secondary and transit packaging applied to the product.",
  DISTRIBUTION: "Moving the finished product to the customer, including storage on the way.",
  USE_PHASE: "Energy, consumables and servicing over the product's working life.",
  END_OF_LIFE: "Collection, treatment and disposal of the product once it is finished with.",
  OTHER: "Anything outside the standard stages — record what it covers in the process description.",
};

/** Stages a boundary normally covers, used to check the model for gaps. */
export const STAGES_IN_BOUNDARY: Record<LcaBoundary, LcaLifecycleStage[]> = {
  CRADLE_TO_GATE: [
    LcaLifecycleStage.RAW_MATERIALS,
    LcaLifecycleStage.INBOUND_TRANSPORT,
    LcaLifecycleStage.MANUFACTURING,
    LcaLifecycleStage.PACKAGING,
  ],
  CRADLE_TO_GRAVE: LIFECYCLE_STAGE_ORDER.filter((s) => s !== LcaLifecycleStage.OTHER),
  CRADLE_TO_CRADLE: LIFECYCLE_STAGE_ORDER.filter((s) => s !== LcaLifecycleStage.OTHER),
  GATE_TO_GATE: [LcaLifecycleStage.MANUFACTURING],
  GATE_TO_GRAVE: [
    LcaLifecycleStage.DISTRIBUTION,
    LcaLifecycleStage.USE_PHASE,
    LcaLifecycleStage.END_OF_LIFE,
  ],
  CUSTOM: [],
};

export const BOUNDARY_LABELS: Record<LcaBoundary, string> = {
  CRADLE_TO_GATE: "Cradle to gate",
  CRADLE_TO_GRAVE: "Cradle to grave",
  CRADLE_TO_CRADLE: "Cradle to cradle",
  GATE_TO_GATE: "Gate to gate",
  GATE_TO_GRAVE: "Gate to grave",
  CUSTOM: "Custom boundary",
};

export const STATUS_LABELS: Record<LcaAssessmentStatus, string> = {
  DRAFT: "Draft",
  DATA_COLLECTION: "Data collection",
  CALCULATION: "Calculation",
  INTERNAL_REVIEW: "Internal review",
  READY_FOR_VERIFICATION: "Ready for verification",
  VERIFIED: "Verified",
  SUPERSEDED: "Superseded",
};

export const STATUS_ORDER: LcaAssessmentStatus[] = [
  LcaAssessmentStatus.DRAFT,
  LcaAssessmentStatus.DATA_COLLECTION,
  LcaAssessmentStatus.CALCULATION,
  LcaAssessmentStatus.INTERNAL_REVIEW,
  LcaAssessmentStatus.READY_FOR_VERIFICATION,
  LcaAssessmentStatus.VERIFIED,
  LcaAssessmentStatus.SUPERSEDED,
];

export const STATUS_TONES: Record<LcaAssessmentStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  DATA_COLLECTION: "info",
  CALCULATION: "info",
  INTERNAL_REVIEW: "warning",
  READY_FOR_VERIFICATION: "warning",
  VERIFIED: "success",
  SUPERSEDED: "neutral",
};

export const ITEM_TYPE_LABELS: Record<LcaItemType, string> = {
  MATERIAL: "Material / component",
  ENERGY: "Energy",
  FUEL: "Fuel",
  TRANSPORT: "Transport",
  MANUFACTURING_PROCESS: "Manufacturing process",
  PACKAGING: "Packaging",
  WASTE: "Production waste",
  WATER: "Water",
  USE_PHASE: "Use phase",
  END_OF_LIFE: "End of life",
  SUPPLIER_PCF: "Supplier PCF",
  OTHER: "Other",
};

export const DATA_TYPE_LABELS: Record<LcaDataType, string> = {
  PRIMARY: "Primary (measured by us)",
  SUPPLIER_SPECIFIC: "Supplier-specific",
  SECONDARY: "Secondary (published dataset)",
  PROXY: "Proxy (stand-in)",
  MODELLED: "Modelled / calculated",
};

export const DATA_TYPE_SHORT: Record<LcaDataType, string> = {
  PRIMARY: "Primary",
  SUPPLIER_SPECIFIC: "Supplier",
  SECONDARY: "Secondary",
  PROXY: "Proxy",
  MODELLED: "Modelled",
};

export const CLASSIFICATION_LABELS: Record<LcaEmissionClassification, string> = {
  FOSSIL: "Fossil",
  BIOGENIC: "Biogenic emissions",
  BIOGENIC_REMOVAL: "Biogenic removals",
  TECHNOLOGICAL_REMOVAL: "Technological removals",
  STORED_CARBON: "Carbon stored in product",
  AVOIDED_BURDEN: "Avoided burden credit",
  OFFSET: "Offsets / credits",
};

/** Which classes are gross emissions rather than credits, removals or memos. */
export const GROSS_EMISSION_CLASSIFICATIONS: LcaEmissionClassification[] = [
  LcaEmissionClassification.FOSSIL,
  LcaEmissionClassification.BIOGENIC,
];

export const ALLOCATION_LABELS: Record<LcaAllocationMethod, string> = {
  NONE: "No allocation (single output)",
  MASS: "Mass",
  PHYSICAL: "Physical (other than mass)",
  ECONOMIC: "Economic value",
  MANUAL: "Manual split",
};

export const TRANSPORT_MODE_LABELS: Record<LcaTransportMode, string> = {
  ROAD: "Road",
  RAIL: "Rail",
  SEA: "Sea",
  AIR: "Air",
  INLAND_WATERWAY: "Inland waterway",
  MULTIMODAL: "Multimodal",
  CUSTOM: "Custom",
};

export const EOL_ROUTE_LABELS: Record<LcaEndOfLifeRouteType, string> = {
  LANDFILL: "Landfill",
  RECYCLING: "Recycling",
  INCINERATION_ENERGY_RECOVERY: "Incineration with energy recovery",
  INCINERATION_NO_RECOVERY: "Incineration without energy recovery",
  REUSE: "Reuse",
  COMPOSTING: "Composting / anaerobic digestion",
  CUSTOM: "Custom route",
};

export const FACTOR_BOUNDARY_LABELS: Record<LcaFactorBoundary, string> = {
  UNKNOWN: "Not stated",
  CRADLE_TO_GATE: "Cradle to gate",
  CRADLE_TO_GRAVE: "Cradle to grave",
  GATE_TO_GATE: "Gate to gate",
  UPSTREAM: "Upstream only",
  DOWNSTREAM: "Downstream only",
  COMBUSTION_ONLY: "Combustion only",
  WELL_TO_TANK: "Well to tank",
  WELL_TO_WHEEL: "Well to wheel",
  END_OF_LIFE: "End of life",
};

export const FACTOR_MODE_LABELS: Record<LcaFactorSelectionMode, string> = {
  NONE: "No factor assigned",
  LIBRARY_FACTOR: "Factor library",
  SUPPLIER_PCF: "Supplier PCF",
  MANUAL: "Manually entered factor",
};

export const UNCERTAINTY_LABELS: Record<LcaUncertaintyStatus, string> = {
  NOT_ASSESSED: "Not assessed",
  QUALITATIVE: "Described qualitatively",
  ESTIMATED: "Estimated range",
  QUANTIFIED: "Quantified",
};

export const MATERIALITY_LABELS: Record<LcaMateriality, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const ASSURANCE_LABELS: Record<LcaAssuranceType, string> = {
  NONE: "None",
  INTERNAL_REVIEW: "Internal review",
  CRITICAL_REVIEW: "Independent critical review",
  LIMITED_ASSURANCE: "Limited assurance",
  REASONABLE_ASSURANCE: "Reasonable assurance",
};

export const PCF_VERIFICATION_LABELS: Record<LcaPcfVerificationStatus, string> = {
  UNVERIFIED: "Unverified",
  SELF_DECLARED: "Self-declared by supplier",
  SECOND_PARTY_REVIEWED: "Second-party reviewed",
  THIRD_PARTY_VERIFIED: "Third-party verified",
};

export const RECYCLING_METHOD_LABELS: Record<LcaRecyclingMethod, string> = {
  CUT_OFF: "Cut-off (recycled input carries no upstream burden; no credit for recycling out)",
  AVOIDED_BURDEN: "Avoided burden (credit for material recovered at end of life)",
  CIRCULAR_FOOTPRINT_FORMULA: "Circular footprint formula (shared burden between lives)",
  MANUAL: "Manual, described in the methodology notes",
};

export const BIOGENIC_LABELS: Record<LcaBiogenicTreatment, string> = {
  EXCLUDED: "Excluded from the assessment",
  REPORTED_SEPARATELY: "Reported separately from fossil emissions",
  INCLUDED_IN_TOTAL: "Included in the headline total",
};

export const ELECTRICITY_LABELS: Record<LcaElectricityApproach, string> = {
  LOCATION_BASED: "Location-based (grid average)",
  MARKET_BASED: "Market-based (contractual instruments)",
  DUAL_REPORTED: "Both, reported side by side",
};

export const OFFSET_LABELS: Record<LcaOffsetTreatment, string> = {
  EXCLUDED: "Excluded entirely",
  DISCLOSED_SEPARATELY: "Disclosed separately, never netted off the footprint",
};

export const CORPORATE_LINK_LABELS: Record<LcaCorporateLinkType, string> = {
  FACILITY_ENERGY: "Facility energy (Scope 1/2 record)",
  SUPPLIER_RECORD: "Supplier record",
  SCOPE3_ACTIVITY: "Scope 3 activity data",
  OTHER: "Other corporate record",
};

export function enumOptions<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
