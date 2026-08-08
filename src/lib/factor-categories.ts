/**
 * Canonical list of `factorCategory` keys used across the platform —
 * ActivityDataPoint.factorCategory, EmissionFactor.category, and the
 * factor-import validator all read from this single list so they can't
 * silently drift apart (a typo'd category string is exactly the kind of
 * thing that would make a factor lookup silently fail).
 *
 * This is a list of *keys*, never emission factor *values* — no numbers
 * live here. See prisma/seed/emission-factors.ts for the (Scope 1/2 only,
 * clearly-flagged-as-placeholder) seeded values, and src/lib/factor-import.ts
 * for how real values get loaded for everything else.
 */

import { Scope } from "@prisma/client";
import { LCA_FACTOR_CATEGORY_KEYS, lcaFactorCategoryLabel } from "@/lib/lca/factor-categories";

export interface FactorCategoryDef {
  key: string;
  label: string;
  scope: Scope;
  /** GHG Protocol Scope 3 category label, for categories that are Scope 3. */
  scope3Category?: string;
  /** Typical unit this category's factors are expressed per, for the admin UI/template. */
  typicalUnit: string;
  notes?: string;
}

export const FACTOR_CATEGORIES: FactorCategoryDef[] = [
  // --- Scope 1 ---
  { key: "stationary_combustion_natural_gas", label: "Natural gas (stationary combustion)", scope: Scope.SCOPE_1, typicalUnit: "kWh" },
  { key: "stationary_combustion_diesel", label: "Diesel (backup generator)", scope: Scope.SCOPE_1, typicalUnit: "litres" },
  { key: "mobile_combustion_fuel", label: "Fleet fuel (litres by type)", scope: Scope.SCOPE_1, typicalUnit: "litres" },
  { key: "mobile_combustion_mileage", label: "Grey fleet mileage (by vehicle type)", scope: Scope.SCOPE_1, typicalUnit: "miles" },
  { key: "fugitive_refrigerant", label: "Refrigerant top-ups (F-gas)", scope: Scope.SCOPE_1, typicalUnit: "kg" },

  // --- Scope 2 ---
  { key: "grid_electricity", label: "Purchased grid electricity", scope: Scope.SCOPE_2, typicalUnit: "kWh" },
  { key: "purchased_heat_steam", label: "Purchased heat/steam", scope: Scope.SCOPE_2, typicalUnit: "kWh" },

  // --- Scope 3, Phase 1 build (Cat 1, 6, 7) ---
  {
    key: "purchased_goods_services_spend",
    label: "Purchased goods & services (spend-based, EEIO)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 1 — Purchased goods & services",
    typicalUnit: "£",
    notes: "Spend-based fallback per methodology Section 7 — replace with supplier-specific factors (sourceType SUPPLIER_SPECIFIC) as they become available.",
  },
  {
    key: "business_travel",
    label: "Business travel (rail, flights, hotel)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 6 — Business travel",
    typicalUnit: "miles / nights",
    notes: "Rail and flight subtypes are per mile; hotel is per night — see FactorOption.unit on each S3-06 option.",
  },
  {
    key: "employee_commuting",
    label: "Employee commuting (by mode)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 7 — Employee commuting",
    typicalUnit: "miles",
  },

  // --- Scope 3 Cat 3 (auto-derived — well-to-tank / T&D losses on Scope 1/2 activity) ---
  {
    key: "wtt_natural_gas",
    label: "Well-to-tank: natural gas",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 3 — Fuel- and energy-related activities",
    typicalUnit: "kWh",
    notes: "Companion factor for stationary_combustion_natural_gas — upstream emissions of extracting/transporting the gas, not the combustion itself.",
  },
  {
    key: "wtt_diesel",
    label: "Well-to-tank: diesel (generator)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 3 — Fuel- and energy-related activities",
    typicalUnit: "litres",
  },
  {
    key: "wtt_road_fuel",
    label: "Well-to-tank: road fuel (fleet, by type)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 3 — Fuel- and energy-related activities",
    typicalUnit: "litres",
  },
  {
    key: "wtt_mileage",
    label: "Well-to-tank: grey fleet mileage (by vehicle type)",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 3 — Fuel- and energy-related activities",
    typicalUnit: "miles",
  },
  {
    key: "td_losses_electricity",
    label: "Transmission & distribution losses: purchased electricity",
    scope: Scope.SCOPE_3,
    scope3Category: "Cat 3 — Fuel- and energy-related activities",
    typicalUnit: "kWh",
    notes: "Companion factor for grid_electricity — derived only from the location-based Scope 2 figure, so it isn't doubled up against the market-based duplicate.",
  },
];

export const FACTOR_CATEGORY_KEYS = new Set(FACTOR_CATEGORIES.map((c) => c.key));

/**
 * True for corporate categories *and* product-LCA categories: both are loaded
 * through the same admin factor importer into the same versioned library, so
 * the importer's "is this a category the platform knows?" check has to see
 * both lists or every life-cycle factor row would import with a warning.
 */
export function isKnownFactorCategory(key: string): boolean {
  return FACTOR_CATEGORY_KEYS.has(key) || LCA_FACTOR_CATEGORY_KEYS.has(key);
}

export function factorCategoryLabel(key: string): string {
  const corporate = FACTOR_CATEGORIES.find((c) => c.key === key);
  if (corporate) return corporate.label;
  if (LCA_FACTOR_CATEGORY_KEYS.has(key)) return lcaFactorCategoryLabel(key);
  return key;
}
