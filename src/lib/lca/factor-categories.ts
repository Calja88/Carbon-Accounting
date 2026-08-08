/**
 * Factor category keys used by product LCA work.
 *
 * These extend the corporate list in src/lib/factor-categories.ts rather than
 * replacing it: both lists feed the same `isKnownFactorCategory` check, so the
 * existing admin factor importer (src/lib/factor-import.ts) loads life-cycle
 * inventory factors through exactly the same versioned, append-only,
 * who-uploaded-what pipeline as corporate factors. There is one factor
 * library, not two.
 *
 * As with the corporate list, this file holds *keys only* — no emission factor
 * values live here. Values arrive by import from a source a human can cite.
 */

import { LcaFactorBoundary, LcaItemType } from "@prisma/client";

export interface LcaFactorCategoryDef {
  key: string;
  label: string;
  /** Item types this category is offered for in the factor picker. */
  itemTypes: LcaItemType[];
  typicalUnit: string;
  /** Boundary a factor in this category normally carries, shown as a default hint. */
  expectedBoundary: LcaFactorBoundary;
  notes?: string;
}

export const LCA_FACTOR_CATEGORIES: LcaFactorCategoryDef[] = [
  // --- materials ---------------------------------------------------------
  {
    key: "lca_material_metal",
    label: "Metals (steel, aluminium, copper…)",
    itemTypes: [LcaItemType.MATERIAL],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE,
  },
  { key: "lca_material_plastic", label: "Plastics and polymers", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_material_paper_board", label: "Paper and board", itemTypes: [LcaItemType.MATERIAL, LcaItemType.PACKAGING], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_material_glass", label: "Glass", itemTypes: [LcaItemType.MATERIAL, LcaItemType.PACKAGING], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_material_textile", label: "Textiles and fibres", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_material_chemical", label: "Chemicals, inks, adhesives", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  {
    key: "lca_material_electronics",
    label: "Electronics (PCBs, ICs, antennae)",
    itemTypes: [LcaItemType.MATERIAL],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE,
    notes: "Electronic components are often published per item or per cm2 of board rather than per kg — check the factor's own unit before assigning it.",
  },
  { key: "lca_material_mineral", label: "Minerals, ceramics, cement", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  {
    key: "lca_material_wood",
    label: "Wood and wood-based materials",
    itemTypes: [LcaItemType.MATERIAL, LcaItemType.PACKAGING],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE,
    notes: "Biogenic carbon in wood is tracked separately on the inventory item — never netted off the fossil figure.",
  },
  { key: "lca_material_rubber", label: "Rubber and elastomers", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_material_composite", label: "Composites and laminates", itemTypes: [LcaItemType.MATERIAL], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  {
    key: "lca_material_recycled",
    label: "Recycled-route material inputs",
    itemTypes: [LcaItemType.MATERIAL, LcaItemType.PACKAGING],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE,
    notes: "Assign as the recycled-content factor on an item so its recycled share is priced from a sourced figure, not an assumed discount.",
  },
  { key: "lca_material_other", label: "Other materials", itemTypes: [LcaItemType.MATERIAL, LcaItemType.OTHER], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },

  // --- packaging ---------------------------------------------------------
  { key: "lca_packaging_material", label: "Packaging materials", itemTypes: [LcaItemType.PACKAGING], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },

  // --- energy and fuels --------------------------------------------------
  {
    key: "lca_electricity",
    label: "Electricity (by grid/geography)",
    itemTypes: [LcaItemType.ENERGY, LcaItemType.MANUFACTURING_PROCESS, LcaItemType.USE_PHASE],
    typicalUnit: "kWh",
    expectedBoundary: LcaFactorBoundary.GATE_TO_GATE,
    notes: "Hold location-based and market-based/supplier-specific electricity as separate factor rows, and record which the assessment's methodology profile calls for.",
  },
  { key: "lca_electricity_upstream", label: "Electricity — upstream (T&D, well-to-tank)", itemTypes: [LcaItemType.ENERGY, LcaItemType.USE_PHASE], typicalUnit: "kWh", expectedBoundary: LcaFactorBoundary.UPSTREAM },
  { key: "lca_heat_steam", label: "Purchased heat and steam", itemTypes: [LcaItemType.ENERGY], typicalUnit: "kWh", expectedBoundary: LcaFactorBoundary.GATE_TO_GATE },
  { key: "lca_fuel_combustion", label: "Fuels — combustion", itemTypes: [LcaItemType.FUEL], typicalUnit: "l", expectedBoundary: LcaFactorBoundary.COMBUSTION_ONLY },
  { key: "lca_fuel_upstream", label: "Fuels — upstream (well-to-tank)", itemTypes: [LcaItemType.FUEL], typicalUnit: "l", expectedBoundary: LcaFactorBoundary.WELL_TO_TANK },

  // --- manufacturing -----------------------------------------------------
  {
    key: "lca_manufacturing_process",
    label: "Manufacturing / conversion processes",
    itemTypes: [LcaItemType.MANUFACTURING_PROCESS],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.GATE_TO_GATE,
    notes: "Gate-to-gate process factors (injection moulding, lamination, plating) applied per unit of throughput.",
  },

  // --- freight -----------------------------------------------------------
  { key: "lca_freight_road", label: "Freight — road", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },
  { key: "lca_freight_rail", label: "Freight — rail", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },
  { key: "lca_freight_sea", label: "Freight — sea", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },
  { key: "lca_freight_air", label: "Freight — air", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },
  { key: "lca_freight_inland_waterway", label: "Freight — inland waterway", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },
  { key: "lca_freight_other", label: "Freight — other/custom mode", itemTypes: [LcaItemType.TRANSPORT], typicalUnit: "t.km", expectedBoundary: LcaFactorBoundary.WELL_TO_WHEEL },

  // --- waste, end of life ------------------------------------------------
  { key: "lca_eol_landfill", label: "End of life — landfill", itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  { key: "lca_eol_recycling", label: "End of life — recycling", itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  { key: "lca_eol_incineration", label: "End of life — incineration", itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  { key: "lca_eol_composting", label: "End of life — composting / anaerobic digestion", itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  { key: "lca_eol_reuse", label: "End of life — reuse / refurbishment", itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  {
    key: "lca_eol_avoided",
    label: "End of life — avoided burden / recovery credit",
    itemTypes: [LcaItemType.END_OF_LIFE, LcaItemType.WASTE],
    typicalUnit: "kg",
    expectedBoundary: LcaFactorBoundary.DOWNSTREAM,
    notes: "Only applied when the assessment's methodology profile selects an avoided-burden or circular-footprint treatment, and always reported on its own line.",
  },
  { key: "lca_waste_treatment", label: "Production waste treatment", itemTypes: [LcaItemType.WASTE], typicalUnit: "kg", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },

  // --- water and use phase ----------------------------------------------
  { key: "lca_water_supply", label: "Water supply", itemTypes: [LcaItemType.WATER], typicalUnit: "m3", expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE },
  { key: "lca_water_treatment", label: "Wastewater treatment", itemTypes: [LcaItemType.WATER], typicalUnit: "m3", expectedBoundary: LcaFactorBoundary.END_OF_LIFE },
  { key: "lca_use_phase_other", label: "Use phase — other (consumables, servicing)", itemTypes: [LcaItemType.USE_PHASE, LcaItemType.OTHER], typicalUnit: "item", expectedBoundary: LcaFactorBoundary.GATE_TO_GATE },

  // --- spend-based -------------------------------------------------------
  {
    key: "lca_spend_based",
    label: "Spend-based (EEIO) input",
    itemTypes: [LcaItemType.OTHER, LcaItemType.MATERIAL],
    typicalUnit: "GBP",
    expectedBoundary: LcaFactorBoundary.CRADLE_TO_GATE,
    notes: "A last-resort screening factor. Flagged as PROXY data and reported in the data-quality breakdown.",
  },
];

export const LCA_FACTOR_CATEGORY_KEYS = new Set(LCA_FACTOR_CATEGORIES.map((c) => c.key));

export function isLcaFactorCategory(key: string): boolean {
  return LCA_FACTOR_CATEGORY_KEYS.has(key);
}

export function lcaFactorCategoryLabel(key: string): string {
  return LCA_FACTOR_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export function lcaFactorCategoryDef(key: string): LcaFactorCategoryDef | null {
  return LCA_FACTOR_CATEGORIES.find((c) => c.key === key) ?? null;
}

/** Categories worth offering for a given inventory item type. */
export function lcaFactorCategoriesForItemType(itemType: LcaItemType): LcaFactorCategoryDef[] {
  const matching = LCA_FACTOR_CATEGORIES.filter((c) => c.itemTypes.includes(itemType));
  // An unusual item still needs to be able to reach the whole library rather
  // than being locked out of a factor that genuinely applies.
  return matching.length > 0 ? matching : LCA_FACTOR_CATEGORIES;
}

/** Default freight category per transport mode. */
export const FREIGHT_CATEGORY_BY_MODE: Record<string, string> = {
  ROAD: "lca_freight_road",
  RAIL: "lca_freight_rail",
  SEA: "lca_freight_sea",
  AIR: "lca_freight_air",
  INLAND_WATERWAY: "lca_freight_inland_waterway",
  MULTIMODAL: "lca_freight_other",
  CUSTOM: "lca_freight_other",
};

/** Default end-of-life category per route. */
export const EOL_CATEGORY_BY_ROUTE: Record<string, string> = {
  LANDFILL: "lca_eol_landfill",
  RECYCLING: "lca_eol_recycling",
  INCINERATION_ENERGY_RECOVERY: "lca_eol_incineration",
  INCINERATION_NO_RECOVERY: "lca_eol_incineration",
  REUSE: "lca_eol_reuse",
  COMPOSTING: "lca_eol_composting",
  CUSTOM: "lca_waste_treatment",
};
