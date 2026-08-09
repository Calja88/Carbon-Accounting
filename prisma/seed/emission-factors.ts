/**
 * PLACEHOLDER EMISSION FACTORS — NOT VERIFIED FOR ACTUAL REPORTING.
 *
 * No live DEFRA/DESNZ "UK Government GHG Conversion Factors for Company
 * Reporting" file was supplied with this build. These values are
 * representative, publicly-known UK factor magnitudes seeded so the
 * calculation engine, audit trail and reports can be exercised end-to-end.
 *
 * Before this platform is used for real reporting, replace this file's
 * contents (or add a new EmissionFactorSet via the same shape) with an
 * import of the actual current-year published DEFRA/DESNZ factor set, and
 * flip `isPlaceholder` to false on that set.
 */

import { FactorBasis, Scope } from "@prisma/client";

export const FACTOR_SET = {
  name: "UK Gov GHG Conversion Factors for Company Reporting — 2024",
  publisher: "DEFRA/DESNZ (placeholder — not yet imported from an official source file)",
  vintageYear: 2024,
  effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
  effectiveTo: null as Date | null,
  isPlaceholder: true,
  notes:
    "Representative placeholder values only. Replace with the actual current-year DEFRA/DESNZ GHG Conversion Factors for Company Reporting before this platform is used for real reporting or assurance.",
};

export interface SeedFactor {
  scope: Scope;
  category: string;
  subtypeKey: string | null;
  basis: FactorBasis;
  unit: string;
  co2eFactor: string; // kept as string for Prisma Decimal precision
  notes?: string;
}

const PLACEHOLDER_NOTE = "Placeholder value — verify against current DEFRA/DESNZ factors.";

export const FACTORS: SeedFactor[] = [
  // --- Scope 1: stationary combustion ---
  {
    scope: Scope.SCOPE_1,
    category: "stationary_combustion_natural_gas",
    subtypeKey: null,
    basis: FactorBasis.STANDARD,
    unit: "kWh",
    co2eFactor: "0.18293",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "stationary_combustion_diesel",
    subtypeKey: null,
    basis: FactorBasis.STANDARD,
    unit: "litres",
    co2eFactor: "2.51233",
    notes: PLACEHOLDER_NOTE,
  },

  // --- Scope 1: mobile combustion — fuel-card fleet (litres by fuel type) ---
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_fuel",
    subtypeKey: "petrol",
    basis: FactorBasis.STANDARD,
    unit: "litres",
    co2eFactor: "2.16326",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_fuel",
    subtypeKey: "diesel",
    basis: FactorBasis.STANDARD,
    unit: "litres",
    co2eFactor: "2.51233",
    notes: PLACEHOLDER_NOTE,
  },

  // --- Scope 1: mobile combustion — grey fleet (miles by vehicle type) ---
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_mileage",
    subtypeKey: "car_petrol_avg",
    basis: FactorBasis.STANDARD,
    unit: "miles",
    co2eFactor: "0.28140",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_mileage",
    subtypeKey: "car_diesel_avg",
    basis: FactorBasis.STANDARD,
    unit: "miles",
    co2eFactor: "0.26710",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_mileage",
    subtypeKey: "car_hybrid_avg",
    basis: FactorBasis.STANDARD,
    unit: "miles",
    co2eFactor: "0.17410",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_mileage",
    subtypeKey: "car_electric",
    basis: FactorBasis.STANDARD,
    unit: "miles",
    co2eFactor: "0.06200",
    notes: PLACEHOLDER_NOTE + " Electric-mile factor reflects UK grid intensity, not a Scope 1 tailpipe emission — retained here for calc-engine consistency since the platform still asks for a single mileage figure regardless of powertrain.",
  },
  {
    scope: Scope.SCOPE_1,
    category: "mobile_combustion_mileage",
    subtypeKey: "motorbike_avg",
    basis: FactorBasis.STANDARD,
    unit: "miles",
    co2eFactor: "0.15560",
    notes: PLACEHOLDER_NOTE,
  },

  // --- Scope 1: fugitive emissions (refrigerants, kg x GWP) ---
  {
    scope: Scope.SCOPE_1,
    category: "fugitive_refrigerant",
    subtypeKey: "r410a",
    basis: FactorBasis.STANDARD,
    unit: "kg",
    co2eFactor: "2088",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "fugitive_refrigerant",
    subtypeKey: "r134a",
    basis: FactorBasis.STANDARD,
    unit: "kg",
    co2eFactor: "1430",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "fugitive_refrigerant",
    subtypeKey: "r32",
    basis: FactorBasis.STANDARD,
    unit: "kg",
    co2eFactor: "675",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "fugitive_refrigerant",
    subtypeKey: "r404a",
    basis: FactorBasis.STANDARD,
    unit: "kg",
    co2eFactor: "3922",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_1,
    category: "fugitive_refrigerant",
    subtypeKey: "other_blend",
    basis: FactorBasis.STANDARD,
    unit: "kg",
    co2eFactor: "2000",
    notes: PLACEHOLDER_NOTE + " Generic average GWP used when the specific blend isn't listed — flag for follow-up with the correct refrigerant identity.",
  },

  // --- Scope 2: purchased electricity (dual reporting) ---
  {
    scope: Scope.SCOPE_2,
    category: "grid_electricity",
    subtypeKey: null,
    basis: FactorBasis.LOCATION_BASED,
    unit: "kWh",
    co2eFactor: "0.20705",
    notes: PLACEHOLDER_NOTE + " UK grid-average location-based factor.",
  },
  {
    scope: Scope.SCOPE_2,
    category: "grid_electricity",
    subtypeKey: null,
    basis: FactorBasis.RESIDUAL_MIX,
    unit: "kWh",
    co2eFactor: "0.24500",
    notes: PLACEHOLDER_NOTE + " Used for the market-based figure when a site holds no REGO/green tariff instrument.",
  },
  {
    scope: Scope.SCOPE_2,
    category: "grid_electricity",
    subtypeKey: null,
    basis: FactorBasis.MARKET_BASED,
    unit: "kWh",
    co2eFactor: "0.00000",
    notes:
      PLACEHOLDER_NOTE +
      " Zero-rated market-based factor applied when a site's contract is REGO-backed or on a green tariff — a simplification; a real supplier-specific residual factor should replace this once available.",
  },

  // --- Scope 3 Category 5: waste generated in operations (per tonne, by treatment route) ---
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "recycled",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "21.3",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "composted",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "10.2",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "anaerobic_digestion",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "9.5",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "incinerated_energy_recovery",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "21.4",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "incinerated_no_energy_recovery",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "21.4",
    notes: PLACEHOLDER_NOTE,
  },
  {
    scope: Scope.SCOPE_3,
    category: "waste_operations",
    subtypeKey: "landfill",
    basis: FactorBasis.STANDARD,
    unit: "tonnes",
    co2eFactor: "586.9",
    notes: PLACEHOLDER_NOTE,
  },

  // --- Scope 2: purchased heat/steam ---
  {
    scope: Scope.SCOPE_2,
    category: "purchased_heat_steam",
    subtypeKey: null,
    basis: FactorBasis.STANDARD,
    unit: "kWh",
    co2eFactor: "0.17100",
    notes: PLACEHOLDER_NOTE,
  },
];
