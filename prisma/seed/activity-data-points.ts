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
  /** Per-option unit override — see FactorOption.unit in schema.prisma. */
  unit?: string;
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
  /** GHG Protocol Scope 3 category label — set for Scope 3 data points only. */
  scope3Category?: string;
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

  // ---------------------------------------------------------------------
  // Scope 3 — value chain. Only the categories tagged "Phase 1 build" in
  // the data map (Cat 1, 6, 7) — the brief's own phased plan (v2/v3) puts
  // the rest (Cat 2, 4, 5, 8, 9) in a later build. Cat 3 has no row here:
  // per data map S3-03 it is calculated automatically from Scope 1/2
  // entries, not a separate form (see src/lib/scope3-derived.ts).
  // ---------------------------------------------------------------------
  {
    code: "S3-01",
    scope: Scope.SCOPE_3,
    category: "Cat 1 — Purchased goods & services",
    dataPointName: "Supplier spend by category",
    promptTemplate:
      "How much did [site/function] spend with suppliers this period, broken down by category (components, packaging, services etc.)?",
    helpText:
      "Scope 3 Category 1 — purchased goods and services, calculated from spend using EEIO factors until supplier-specific data is available (methodology Sections 7 and 9).",
    sourceSystemHint: "Finance / ERP system (nominal ledger)",
    unitOptions: ["£"],
    frequency: "Quarterly",
    defaultTier: DataQualityTier.TIER_3,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 1 build",
    notes:
      "Spend-based (EEIO factors) until supplier-specific data available. Spend categories below are illustrative, not confirmed against Paragon's chart of accounts — see README assumptions.",
    sortOrder: 100,
    factorCategory: "purchased_goods_services_spend",
    scope3Category: "Cat 1 — Purchased goods & services",
    factorOptions: [
      { label: "Components & electronics (incl. RFID inlays)", subtypeKey: "components_electronics" },
      { label: "Packaging", subtypeKey: "packaging" },
      { label: "IT & software", subtypeKey: "it_software" },
      { label: "Professional & other services", subtypeKey: "services_general" },
      { label: "Other purchased goods & services", subtypeKey: "other_goods_services" },
    ],
  },
  {
    code: "S3-05",
    scope: Scope.SCOPE_3,
    category: "Cat 5 — Waste generated in operations",
    dataPointName: "Waste generated in operations",
    promptTemplate: "How much waste did [site] send for treatment this period, and how was it treated?",
    helpText:
      "Scope 3 Category 5 — waste generated in operations, calculated from weight and treatment route (methodology Section 9). The EWC code identifies the waste; it does not determine the treatment route, so the route must be confirmed separately.",
    sourceSystemHint: "Waste Transfer Note (WTN) / waste invoice",
    unitOptions: ["kg", "tonnes"],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_1,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 2 build",
    notes: "One entry per waste stream/treatment route per WTN. Treatment route must be confirmed — never inferred from the EWC code alone.",
    sortOrder: 105,
    factorCategory: "waste_operations",
    scope3Category: "Cat 5 — Waste generated in operations",
    factorOptions: [
      { label: "Recycled", subtypeKey: "recycled" },
      { label: "Composted", subtypeKey: "composted" },
      { label: "Anaerobic digestion", subtypeKey: "anaerobic_digestion" },
      { label: "Incinerated — with energy recovery", subtypeKey: "incinerated_energy_recovery" },
      { label: "Incinerated — without energy recovery", subtypeKey: "incinerated_no_energy_recovery" },
      { label: "Landfill", subtypeKey: "landfill" },
    ],
  },
  {
    code: "S3-06",
    scope: Scope.SCOPE_3,
    category: "Cat 6 — Business travel",
    dataPointName: "Travel bookings",
    promptTemplate: "What business travel (rail, air, hotel) was booked/expensed this period?",
    helpText: "Scope 3 Category 6 — business travel (methodology Section 9, activity-based method).",
    sourceSystemHint: "Travel booking system / expenses",
    unitOptions: [],
    frequency: "Monthly",
    defaultTier: DataQualityTier.TIER_2,
    formType: FormType.QUANTITY,
    buildPriority: "Phase 1 build",
    notes:
      "Example: 14 rail return journeys London-Reading, 2 domestic flights, expenses export Aug 2026. Recorded by distance (km) or nights, not journey count — see README assumptions for why. km, not miles, to match DEFRA/DESNZ's native passenger.km publication for rail/flights directly (no manual unit conversion).",
    sortOrder: 110,
    factorCategory: "business_travel",
    scope3Category: "Cat 6 — Business travel",
    factorOptions: [
      { label: "Rail", subtypeKey: "rail", unit: "km" },
      { label: "Domestic flight", subtypeKey: "flight_domestic", unit: "km" },
      { label: "Short-haul international flight", subtypeKey: "flight_short_haul", unit: "km" },
      { label: "Long-haul international flight", subtypeKey: "flight_long_haul", unit: "km" },
      { label: "Hotel stay", subtypeKey: "hotel", unit: "nights" },
    ],
  },
  {
    code: "S3-07",
    scope: Scope.SCOPE_3,
    category: "Cat 7 — Employee commuting",
    dataPointName: "Commuting survey",
    promptTemplate: "How do employees typically travel to work, and what distance?",
    helpText:
      "Scope 3 Category 7 — employee commuting, survey-based and extrapolated across headcount (methodology Section 9).",
    sourceSystemHint: "Annual HR commuting survey",
    unitOptions: [],
    frequency: "Annually",
    defaultTier: DataQualityTier.TIER_3,
    formType: FormType.SURVEY,
    buildPriority: "Phase 1 build",
    notes: "Survey template built as part of the platform — see README assumptions for the extrapolation formula used.",
    sortOrder: 120,
    factorCategory: "employee_commuting",
    scope3Category: "Cat 7 — Employee commuting",
    factorOptions: [
      { label: "Car — petrol (average)", subtypeKey: "commute_car_petrol_avg" },
      { label: "Car — diesel (average)", subtypeKey: "commute_car_diesel_avg" },
      { label: "Car — electric", subtypeKey: "commute_car_electric" },
      { label: "Motorbike", subtypeKey: "commute_motorbike" },
      { label: "Bus", subtypeKey: "commute_bus" },
      { label: "Rail / underground", subtypeKey: "commute_rail" },
      { label: "Cycling or walking", subtypeKey: "commute_active" },
      { label: "Works from home (no commute)", subtypeKey: "commute_wfh" },
    ],
  },
];
