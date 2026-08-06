/**
 * Seed data mirroring the Scope 1 and Scope 2 tabs of
 * Paragon_ID_UK_Data_Requirements_Map.xlsx. `promptTemplate` is the
 * "Plain-English Prompt" column verbatim, including its own bracket
 * placeholders ([site], [type], [petrol/diesel] etc) — the platform
 * resolves those tokens at render time (see src/lib/prompts.ts). Nothing
 * here reworded the sheet's language.
 */

import { DataQualityTier, FormType, Scope } from "@prisma/client";

export interface SeedFactorOption {
  label: string;
  subtypeKey: string;
}

export interface SeedActivityDataPoint {
  code: string;
  scope: Scope;
  category: string;
  dataPointName: string;
  promptTemplate: string;
  helpText: string;
  sourceSystemHint: string;
  unitOptions: string[];
  frequency: string;
  defaultTier: DataQualityTier;
  formType: FormType;
  buildPriority: string;
  notes: string | null;
  sortOrder: number;
  factorOptions?: SeedFactorOption[];
  /** category string used to look up the matching EmissionFactor row(s) */
  factorCategory: string;
}

export const ACTIVITY_DATA_POINTS: SeedActivityDataPoint[] = [
  {
    code: "S1-01",
    scope: Scope.SCOPE_1,
    category: "Stationary combustion",
    dataPointName: "Natural gas — facilities",
    promptTemplate: "How many kWh (or m³) of natural gas did [site] use this [month/quarter]?",
    helpText:
      "Scope 1 stationary combustion — direct emissions from burning natural gas on site (methodology Section 4.1).",
    sourceSystemHint: "Utility invoice / smart meter portal",
    unitOptions: ["kWh", "m3"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 1 build",
    notes: "One entry per gas meter per site",
    sortOrder: 10,
    factorCategory: "stationary_combustion_natural_gas",
  },
  {
    code: "S1-02",
    scope: Scope.SCOPE_1,
    category: "Stationary combustion",
    dataPointName: "Backup generator fuel",
    promptTemplate: "How many litres of diesel did the backup generator at [site] use this period?",
    helpText:
      "Scope 1 stationary combustion — direct emissions from on-site backup generation (methodology Section 4.1).",
    sourceSystemHint: "Fuel delivery invoices / site log",
    unitOptions: ["litres"],
    frequency: "Quarterly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 2 build",
    notes: "Only relevant at sites with on-site generation",
    sortOrder: 20,
    factorCategory: "stationary_combustion_diesel",
  },
  {
    code: "S1-03",
    scope: Scope.SCOPE_1,
    category: "Mobile combustion",
    dataPointName: "Company-owned/leased vehicle fuel",
    promptTemplate: "How many litres of [petrol/diesel] did the [Reading fleet] use this quarter?",
    helpText:
      "Scope 1 mobile combustion — direct emissions from company-owned or leased vehicles (methodology Section 4.1).",
    sourceSystemHint: "Fuel card provider export",
    unitOptions: ["litres"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 1 build",
    notes: "Example: 3,412 litres diesel, Fleet Card Ltd, Q2 export — Reading depot",
    sortOrder: 30,
    factorCategory: "mobile_combustion_fuel",
    factorOptions: [
      { label: "Petrol", subtypeKey: "petrol" },
      { label: "Diesel", subtypeKey: "diesel" },
    ],
  },
  {
    code: "S1-04",
    scope: Scope.SCOPE_1,
    category: "Mobile combustion",
    dataPointName: "Grey fleet / mileage-based vehicles",
    promptTemplate: "How many business miles were claimed by employees using their own vehicles?",
    helpText:
      "Scope 1 mobile combustion — grey fleet mileage, converted using an average vehicle fuel economy factor (methodology Section 9).",
    sourceSystemHint: "Expenses system (mileage claims)",
    unitOptions: ["miles"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_2,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 2 build",
    notes: "Requires vehicle type/fuel to select correct factor",
    sortOrder: 40,
    factorCategory: "mobile_combustion_mileage",
    factorOptions: [
      { label: "Petrol car (average)", subtypeKey: "car_petrol_avg" },
      { label: "Diesel car (average)", subtypeKey: "car_diesel_avg" },
      { label: "Hybrid car (average)", subtypeKey: "car_hybrid_avg" },
      { label: "Electric car", subtypeKey: "car_electric" },
      { label: "Motorbike (average)", subtypeKey: "motorbike_avg" },
    ],
  },
  {
    code: "S1-05",
    scope: Scope.SCOPE_1,
    category: "Fugitive emissions",
    dataPointName: "Refrigerant top-ups (F-gas)",
    promptTemplate: "How many kg of refrigerant [type] were added to equipment at [site] this period?",
    helpText:
      "Scope 1 fugitive emissions — refrigerant leaked/topped-up, converted using the gas's global warming potential (methodology Section 4.1).",
    sourceSystemHint: "F-gas engineer service records",
    unitOptions: ["kg"],
    frequency: "As occurs",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 2 build",
    notes: "Legally-required F-gas logs are usually the best source",
    sortOrder: 50,
    factorCategory: "fugitive_refrigerant",
    factorOptions: [
      { label: "R410A", subtypeKey: "r410a" },
      { label: "R134a", subtypeKey: "r134a" },
      { label: "R32", subtypeKey: "r32" },
      { label: "R404A", subtypeKey: "r404a" },
      { label: "Other / blend not listed", subtypeKey: "other_blend" },
    ],
  },
  {
    code: "S2-01",
    scope: Scope.SCOPE_2,
    category: "Purchased electricity",
    dataPointName: "Grid electricity consumption",
    promptTemplate: "How many kWh of electricity did [site] use this [month]?",
    helpText:
      "Scope 2 purchased energy — calculated both location-based and market-based, side by side (methodology Section 5).",
    sourceSystemHint: "Utility invoice / half-hourly meter data",
    unitOptions: ["kWh"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 1 build",
    notes:
      "Example: 18,640 kWh, Oct 2026, Thames Technology — Slough site, half-hourly data via supplier portal",
    sortOrder: 60,
    factorCategory: "grid_electricity",
  },
  {
    code: "S2-02",
    scope: Scope.SCOPE_2,
    category: "Purchased electricity",
    dataPointName: "Supplier / tariff type",
    promptTemplate: "Who is the electricity supplier for [site], and is it a green/renewable tariff?",
    helpText: "Needed for the Scope 2 market-based calculation (methodology Section 5).",
    sourceSystemHint: "Supplier contract",
    unitOptions: [],
    frequency: "Annually / on contract change",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.CONTRACT_INFO,
    buildPriority: "Phase 1 build",
    notes: "Needed for market-based Scope 2 calculation",
    sortOrder: 70,
    factorCategory: "grid_electricity",
  },
  {
    code: "S2-03",
    scope: Scope.SCOPE_2,
    category: "Purchased electricity",
    dataPointName: "REGO / renewable certificates held",
    promptTemplate:
      "Does [site]'s electricity contract come with REGO certificates or equivalent guarantee of origin?",
    helpText: "Needed for the Scope 2 market-based calculation (methodology Section 5).",
    sourceSystemHint: "Supplier contract / certificate",
    unitOptions: [],
    frequency: "Annually",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.CONTRACT_INFO,
    buildPriority: "Phase 2 build",
    notes: null,
    sortOrder: 80,
    factorCategory: "grid_electricity",
  },
  {
    code: "S2-04",
    scope: Scope.SCOPE_2,
    category: "Purchased heat/steam",
    dataPointName: "District heat or steam (if applicable)",
    promptTemplate: "How many kWh of heat/steam did [site] purchase this period?",
    helpText: "Scope 2 purchased energy — district heat or steam (methodology Section 4.2).",
    sourceSystemHint: "Utility invoice",
    unitOptions: ["kWh"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Later",
    notes: "Only relevant if any site is on a district heating network",
    sortOrder: 90,
    factorCategory: "purchased_heat_steam",
  },
];
