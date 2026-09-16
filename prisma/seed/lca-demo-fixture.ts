/**
 * The demonstration product LCA fixture — specification only, no database.
 *
 * Kept separate from `lca-demo.ts` (which writes it) for the same reason
 * `scripts/board-demo/board1.ts` is separate from its seeding port: the
 * numbers a demonstration rests on should be assertable without a database,
 * so `lca-demo-fixture.test.ts` can drive the real engine over this exact
 * bill of materials and prove the figures the presenter will read out are
 * the engine's own output rather than something typed into a page.
 *
 * Every quantity here is for ONE production batch of 50,000 cards. The
 * functional unit is 1,000 finished cards, so the model holds 50 of them and
 * the engine divides by that to get the per-functional-unit figure.
 *
 * Nothing in this file is a Paragon product specification or a published
 * emission factor. See the header of `lca-demo.ts`.
 */

import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaMateriality,
  LcaTransportMode,
} from "@prisma/client";
import { D } from "../../src/lib/lca/decimal";
import { FALLBACK_METHODOLOGY } from "../../src/lib/lca/methodology";
import type {
  EngineAssessment,
  EngineFactor,
  EngineInventoryItem,
  EngineProcess,
  EngineTransportLeg,
} from "../../src/lib/lca/engine/types";

export const FACTOR_SET_ID = "seed-lca-demo-smart-card-factors";
export const PRODUCT_SKU = "DEMO-CARD-ID1";
export const PRODUCT_NAME = "Contactless smart card (ID-1)";
export const PRODUCT_VERSION_LABEL = "Rev A (2026)";
export const BASELINE_REFERENCE = "PCF-DEMO-CARD-001";
export const SCENARIO_REFERENCE = "PCF-DEMO-CARD-001-S1";

export const SYNTHETIC_NOTE =
  "SYNTHETIC DEMONSTRATION VALUE — illustrative magnitude only. Not a published figure, not a licensed dataset, and not fit for reporting or for any external claim.";

/** One production batch. */
export const BATCH_CARDS = 50_000;
/** The functional unit everything is reported against. */
export const FUNCTIONAL_UNIT_CARDS = 1_000;
export const FUNCTIONAL_UNIT_DESCRIPTION =
  "1,000 finished contactless smart cards, personalised and ready for issue";

// ---------------------------------------------------------------------------
// Factors — one self-contained illustrative set, so every line on the demo
// reads its provenance from the same place.
// ---------------------------------------------------------------------------

export interface DemoFactor {
  key: string;
  category: string;
  subtypeKey: string;
  unit: string;
  co2eFactor: string;
  region: string;
  boundary: LcaFactorBoundary;
  referenceYear: number;
  dataSource: string;
}

export const GWP_BASIS = "IPCC AR6 (2021), GWP100";

export const DEMO_FACTORS: DemoFactor[] = [
  { key: "pvc", category: "lca_material_plastic", subtypeKey: "pvc_rigid_sheet", unit: "kg", co2eFactor: "3.1", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — rigid PVC sheet, primary route" },
  { key: "petg", category: "lca_material_composite", subtypeKey: "petg_overlay_film", unit: "kg", co2eFactor: "2.9", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — PET-G overlay film" },
  { key: "ink", category: "lca_material_chemical", subtypeKey: "offset_litho_ink", unit: "kg", co2eFactor: "3.4", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — offset lithographic ink and varnish" },
  { key: "adhesive", category: "lca_material_other", subtypeKey: "hot_melt_adhesive", unit: "kg", co2eFactor: "2.6", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — hot-melt laminating adhesive" },
  { key: "chip", category: "lca_material_electronics", subtypeKey: "rfid_chip_module", unit: "kg", co2eFactor: "45", region: "GLO", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — assembled contactless chip module" },
  { key: "aluminium", category: "lca_material_metal", subtypeKey: "aluminium_primary", unit: "kg", co2eFactor: "12", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — primary aluminium foil" },
  { key: "rpet", category: "lca_material_recycled", subtypeKey: "rpet_sheet_recycled", unit: "kg", co2eFactor: "1.9", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — recycled PET sheet, closed-loop route" },
  { key: "carton", category: "lca_material_paper_board", subtypeKey: "carton_board", unit: "kg", co2eFactor: "0.8", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — folding carton board" },
  { key: "ldpe", category: "lca_packaging_material", subtypeKey: "ldpe_film", unit: "kg", co2eFactor: "2.1", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — LDPE shrink and pallet film" },
  { key: "grid", category: "lca_electricity", subtypeKey: "grid_gb_location", unit: "kWh", co2eFactor: "0.207", region: "GB", boundary: LcaFactorBoundary.GATE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — GB grid, location-based" },
  { key: "rego", category: "lca_electricity", subtypeKey: "grid_gb_rego_backed", unit: "kWh", co2eFactor: "0.04", region: "GB", boundary: LcaFactorBoundary.GATE_TO_GATE, referenceYear: 2024, dataSource: "Illustrative — GB market-based, REGO-backed renewable tariff" },
  { key: "grid_wtt", category: "lca_electricity_upstream", subtypeKey: "grid_gb_wtt_td", unit: "kWh", co2eFactor: "0.045", region: "GB", boundary: LcaFactorBoundary.UPSTREAM, referenceYear: 2024, dataSource: "Illustrative — GB well-to-tank and transmission/distribution losses" },
  { key: "gas", category: "lca_fuel_combustion", subtypeKey: "natural_gas", unit: "kWh", co2eFactor: "0.183", region: "GB", boundary: LcaFactorBoundary.COMBUSTION_ONLY, referenceYear: 2024, dataSource: "Illustrative — natural gas, combustion only" },
  { key: "efw", category: "lca_eol_incineration", subtypeKey: "energy_from_waste", unit: "kg", co2eFactor: "0.9", region: "GB", boundary: LcaFactorBoundary.END_OF_LIFE, referenceYear: 2024, dataSource: "Illustrative — mixed plastic waste to energy recovery" },
  { key: "road", category: "lca_freight_road", subtypeKey: "hgv_average", unit: "t.km", co2eFactor: "0.107", region: "EU", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024, dataSource: "Illustrative — average laden HGV" },
  { key: "sea", category: "lca_freight_sea", subtypeKey: "container_ship", unit: "t.km", co2eFactor: "0.016", region: "GLO", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024, dataSource: "Illustrative — deep-sea container ship" },
];

export function demoFactor(key: string): DemoFactor {
  const factor = DEMO_FACTORS.find((f) => f.key === key);
  if (!factor) throw new Error(`Demo factor "${key}" is not defined`);
  return factor;
}

// ---------------------------------------------------------------------------
// Lifecycle model
// ---------------------------------------------------------------------------

export type StageKey = "raw" | "inbound" | "manufacturing" | "packaging" | "distribution";

export const STAGES: { key: StageKey; stage: LcaLifecycleStage; name: string; description: string; geography?: string }[] = [
  { key: "raw", stage: LcaLifecycleStage.RAW_MATERIALS, name: "Card body, inlay and print materials", description: "Everything that ends up in the finished card." },
  { key: "inbound", stage: LcaLifecycleStage.INBOUND_TRANSPORT, name: "Inbound freight to Hull", description: "Moving bought-in materials and components to the manufacturing site." },
  { key: "manufacturing", stage: LcaLifecycleStage.MANUFACTURING, name: "Card manufacture, Hull", description: "Printing, lamination, punching, personalisation and the scrap they produce.", geography: "GB — Hull site" },
  { key: "packaging", stage: LcaLifecycleStage.PACKAGING, name: "Packing and palletising", description: "Carriers, cases, film and pallet wrap applied before dispatch." },
  { key: "distribution", stage: LcaLifecycleStage.DISTRIBUTION, name: "Outbound distribution", description: "Delivery of the finished cards to the customer's receiving site." },
];

export const SUPPLIERS = [
  { name: "Demo Polymer Sheet Supplies BV", country: "NL", identifier: "DEMO-SUP-001" },
  { name: "Demo Microelectronics Ltd", country: "CN", identifier: "DEMO-SUP-002" },
  { name: "Demo Print Chemicals Ltd", country: "GB", identifier: "DEMO-SUP-003" },
  { name: "Demo Packaging Converters Ltd", country: "GB", identifier: "DEMO-SUP-004" },
];

export interface DemoLeg {
  mode: LcaTransportMode;
  origin: string;
  destination: string;
  distanceKm: string;
  massTonnes: string;
  factorKey: string;
  assumptions: string;
}

export interface DemoLine {
  stage: StageKey;
  name: string;
  description: string;
  itemType: LcaItemType;
  quantity: string;
  unit: string;
  /** Null for transport lines, whose figures come from their legs instead. */
  factorKey: string | null;
  legs?: DemoLeg[];
  materialName?: string;
  componentName?: string;
  supplier?: string;
  dataType: LcaDataType;
  dataSource: string;
  geography: string;
  /** Pedigree scores — temporal, geographical, technological, completeness, reliability. 1 is best. */
  scores: [number, number, number, number, number];
}

/**
 * Quantities are for one batch of 50,000 cards.
 *
 * Manufacturing loss is modelled explicitly as a scrap line to energy
 * recovery rather than as a per-item `wastePercent` gross-up, so the same
 * loss is never counted twice.
 */
export const BOM: DemoLine[] = [
  {
    stage: "raw",
    name: "PVC card body core",
    description: "Two 280 micron rigid PVC core sheets per card, 4.70 g per card across the batch.",
    itemType: LcaItemType.MATERIAL,
    quantity: "235",
    unit: "kg",
    factorKey: "pvc",
    materialName: "Rigid PVC",
    componentName: "Card body",
    supplier: "Demo Polymer Sheet Supplies BV",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Demonstration bill of materials, Rev A",
    geography: "EU",
    scores: [1, 2, 2, 1, 2],
  },
  {
    stage: "raw",
    name: "PET-G overlay laminate",
    description: "Front and back clear overlay, 0.68 g per card.",
    itemType: LcaItemType.MATERIAL,
    quantity: "34",
    unit: "kg",
    factorKey: "petg",
    materialName: "PET-G",
    componentName: "Overlay",
    supplier: "Demo Polymer Sheet Supplies BV",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Demonstration bill of materials, Rev A",
    geography: "EU",
    scores: [1, 2, 2, 1, 2],
  },
  {
    stage: "raw",
    name: "Offset litho ink and varnish",
    description: "Four-colour process plus protective varnish, 0.19 g per card.",
    itemType: LcaItemType.MATERIAL,
    quantity: "9.5",
    unit: "kg",
    factorKey: "ink",
    materialName: "Printing ink",
    componentName: "Print",
    supplier: "Demo Print Chemicals Ltd",
    dataType: LcaDataType.SECONDARY,
    dataSource: "Ink consumption averaged over the 2026 print campaign",
    geography: "GB",
    scores: [2, 1, 3, 2, 3],
  },
  {
    stage: "raw",
    name: "Contactless chip module",
    description: "Assembled ISO/IEC 14443 chip module, 0.22 g per card.",
    itemType: LcaItemType.MATERIAL,
    quantity: "11",
    unit: "kg",
    factorKey: "chip",
    materialName: "Assembled electronics",
    componentName: "Inlay",
    supplier: "Demo Microelectronics Ltd",
    dataType: LcaDataType.SUPPLIER_SPECIFIC,
    dataSource: "Component datasheet supplied with the demonstration BOM",
    geography: "GLO",
    scores: [2, 3, 2, 2, 2],
  },
  {
    stage: "raw",
    name: "Aluminium etched antenna",
    description: "Etched aluminium antenna on a PET carrier, 0.104 g per card.",
    itemType: LcaItemType.MATERIAL,
    quantity: "5.2",
    unit: "kg",
    factorKey: "aluminium",
    materialName: "Aluminium",
    componentName: "Inlay",
    supplier: "Demo Microelectronics Ltd",
    dataType: LcaDataType.SUPPLIER_SPECIFIC,
    dataSource: "Component datasheet supplied with the demonstration BOM",
    geography: "EU",
    scores: [2, 2, 2, 2, 2],
  },
  {
    stage: "raw",
    name: "Hot-melt laminating adhesive",
    description: "Adhesive bonding the inlay between the core sheets, 0.072 g per card.",
    itemType: LcaItemType.MATERIAL,
    quantity: "3.6",
    unit: "kg",
    factorKey: "adhesive",
    materialName: "Adhesive",
    componentName: "Card body",
    supplier: "Demo Print Chemicals Ltd",
    dataType: LcaDataType.SECONDARY,
    dataSource: "Line consumption records, 2026",
    geography: "EU",
    scores: [2, 2, 3, 2, 3],
  },
  {
    stage: "inbound",
    name: "Inbound freight — chip modules and antennae",
    description: "Sea freight from the module supplier's plant, then road from the port of entry.",
    itemType: LcaItemType.TRANSPORT,
    quantity: "1",
    unit: "item",
    factorKey: null,
    legs: [
      {
        mode: LcaTransportMode.SEA,
        origin: "Shenzhen",
        destination: "Felixstowe",
        distanceKm: "19400",
        massTonnes: "0.0162",
        factorKey: "sea",
        assumptions: "Port-to-port routing distance, which allows for real routing over the great-circle distance.",
      },
      {
        mode: LcaTransportMode.ROAD,
        origin: "Felixstowe",
        destination: "Hull",
        distanceKm: "320",
        massTonnes: "0.0162",
        factorKey: "road",
        assumptions: "Single laden leg; the empty return is already inside the average laden HGV factor.",
      },
    ],
    supplier: "Demo Microelectronics Ltd",
    dataType: LcaDataType.MODELLED,
    dataSource: "Routing model over the supplier's declared plant location",
    geography: "GLO",
    scores: [2, 3, 3, 3, 3],
  },
  {
    stage: "inbound",
    name: "Inbound freight — card substrate and overlay",
    description: "Road freight of core sheet and overlay film from the polymer supplier.",
    itemType: LcaItemType.TRANSPORT,
    quantity: "1",
    unit: "item",
    factorKey: null,
    legs: [
      {
        mode: LcaTransportMode.ROAD,
        origin: "Rotterdam",
        destination: "Hull",
        distanceKm: "780",
        massTonnes: "0.269",
        factorKey: "road",
        assumptions: "Door-to-door road distance including the ferry crossing, carried as road freight.",
      },
    ],
    supplier: "Demo Polymer Sheet Supplies BV",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Carrier consignment notes for the batch",
    geography: "EU",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "manufacturing",
    name: "Site electricity — printing, lamination, punching, personalisation",
    description: "Metered electricity for the card line, apportioned to this batch by machine running hours.",
    itemType: LcaItemType.ENERGY,
    quantity: "3150",
    unit: "kWh",
    factorKey: "grid",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Site half-hourly metering, apportioned by machine running hours",
    geography: "GB",
    scores: [1, 1, 1, 2, 1],
  },
  {
    stage: "manufacturing",
    name: "Site electricity — upstream losses",
    description: "Well-to-tank and transmission/distribution losses on the same 3,150 kWh.",
    itemType: LcaItemType.ENERGY,
    quantity: "3150",
    unit: "kWh",
    factorKey: "grid_wtt",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Same metered consumption as the line above",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "manufacturing",
    name: "Natural gas — lamination press heating",
    description: "Gas bringing the lamination presses to temperature, apportioned to this batch.",
    itemType: LcaItemType.FUEL,
    quantity: "1240",
    unit: "kWh",
    factorKey: "gas",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Site gas meter, apportioned by press cycles",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "manufacturing",
    name: "Production scrap to energy recovery",
    description: "Edge trim, set-up waste and rejected cards sent to energy-from-waste.",
    itemType: LcaItemType.WASTE,
    quantity: "21",
    unit: "kg",
    factorKey: "efw",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Waste transfer notes for the batch",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "packaging",
    name: "Carton board — card carriers and outer cases",
    description: "Printed carrier cards and corrugated outer cases, 1.24 g per card.",
    itemType: LcaItemType.PACKAGING,
    quantity: "62",
    unit: "kg",
    factorKey: "carton",
    materialName: "Carton board",
    supplier: "Demo Packaging Converters Ltd",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Packaging specification, Rev A",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "packaging",
    name: "LDPE shrink film and pallet wrap",
    description: "Shrink film on each carton plus pallet stretch wrap, 0.38 g per card.",
    itemType: LcaItemType.PACKAGING,
    quantity: "19",
    unit: "kg",
    factorKey: "ldpe",
    materialName: "LDPE",
    supplier: "Demo Packaging Converters Ltd",
    dataType: LcaDataType.PRIMARY,
    dataSource: "Packaging specification, Rev A",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
  {
    stage: "distribution",
    name: "Outbound freight — finished cards to customer",
    description: "Palletised delivery from the Hull site to the customer's distribution centre.",
    itemType: LcaItemType.TRANSPORT,
    quantity: "1",
    unit: "item",
    factorKey: null,
    legs: [
      {
        mode: LcaTransportMode.ROAD,
        origin: "Hull",
        destination: "Customer distribution centre",
        distanceKm: "410",
        massTonnes: "0.381",
        factorKey: "road",
        assumptions: "Finished goods plus packaging, single laden leg on a shared vehicle.",
      },
    ],
    dataType: LcaDataType.PRIMARY,
    dataSource: "Outbound consignment notes for the batch",
    geography: "GB",
    scores: [1, 1, 2, 2, 2],
  },
];

// ---------------------------------------------------------------------------
// Scenario — the only thing that changes is which factor two lines are priced
// from. Quantities, the functional unit and every other line stay identical,
// so the comparison is genuinely like for like.
// ---------------------------------------------------------------------------

export const SCENARIO_CHANGES: { lineName: string; factorKey: string; rationale: string }[] = [
  {
    lineName: "PVC card body core",
    factorKey: "rpet",
    rationale: "Card body switched from virgin rigid PVC to a recycled PET sheet at the same 4.70 g per card.",
  },
  {
    lineName: "Site electricity — printing, lamination, punching, personalisation",
    factorKey: "rego",
    rationale:
      "Site electricity moved to a REGO-backed renewable tariff (market-based). Upstream transmission and distribution losses are unchanged and stay on the grid factor.",
  },
];

export const SCENARIO_TITLE = "Contactless smart card — recycled body and renewable tariff";

export const SCENARIO_DESCRIPTION =
  "Two supply-side changes on the same functional unit: a recycled PET card body in place of virgin rigid PVC, and a REGO-backed renewable electricity tariff for the Hull line. Nothing else in the model moves, and the baseline assessment is untouched.";

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

export const ASSUMPTIONS: {
  assumption: string;
  category: string;
  rationale: string;
  source: string;
  materiality: LcaMateriality;
  item?: string;
}[] = [
  {
    assumption: "The card body is 4.70 g of rigid PVC per card.",
    category: "Activity data",
    rationale: "Taken from the demonstration bill of materials for the ID-1 format at a 760 micron finished thickness.",
    source: "Demonstration bill of materials, Rev A (synthetic)",
    materiality: LcaMateriality.HIGH,
    item: "PVC card body core",
  },
  {
    assumption: "The contactless chip module is 0.22 g per card.",
    category: "Activity data",
    rationale: "Component mass from the supplier datasheet accompanying the demonstration BOM; not independently weighed.",
    source: "Supplier component datasheet (synthetic)",
    materiality: LcaMateriality.HIGH,
    item: "Contactless chip module",
  },
  {
    assumption: "Site electricity and gas are apportioned to this batch by machine running hours and press cycles.",
    category: "Allocation",
    rationale:
      "The Hull site runs several product lines through shared metering, so consumption is split by the time each line actually ran rather than by output value.",
    source: "Site metering and production scheduling records",
    materiality: LcaMateriality.HIGH,
    item: "Site electricity — printing, lamination, punching, personalisation",
  },
  {
    assumption: "Inbound sea freight is carried at a port-to-port routing distance of 19,400 km.",
    category: "Transport",
    rationale:
      "A routing distance rather than a great-circle distance, because a container does not travel in a straight line. The leg is roughly 0.2% of the footprint, so the distance is not worth refining further.",
    source: "Routing model over the supplier's declared plant location",
    materiality: LcaMateriality.LOW,
    item: "Inbound freight — chip modules and antennae",
  },
  {
    assumption: "Ink and varnish are priced from a generic printing-chemical factor.",
    category: "Proxy substitution",
    rationale: "No supplier-specific footprint has been supplied for the ink system, so a generic chemical factor stands in until one is.",
    source: "Illustrative smart-card life-cycle factor set",
    materiality: LcaMateriality.MEDIUM,
    item: "Offset litho ink and varnish",
  },
  {
    assumption: "Every emission factor in this assessment is an illustrative placeholder.",
    category: "Emission factor",
    rationale:
      "No licensed life-cycle inventory dataset is loaded on this environment. The figures exercise the calculation, aggregation and reporting chain and must not be presented as a product footprint.",
    source: "Illustrative smart-card life-cycle factor set (DEMONSTRATION)",
    materiality: LcaMateriality.HIGH,
  },
];

export const EXCLUSIONS: { excludedItem: string; rationale: string; estimatedRelevance: string; percent: string | null }[] = [
  {
    excludedItem: "Use phase",
    rationale:
      "A contactless card is passive: it draws no energy of its own and is powered by the reader for the moment it is presented. Outside the declared boundary.",
    estimatedRelevance: "Negligible — no energy or consumables are attributable to the card in use.",
    percent: "0",
  },
  {
    excludedItem: "End of life",
    rationale:
      "Disposal depends on the customer's own take-back or waste route, which is not known at the point of sale. Outside the declared cradle-to-customer-gate boundary.",
    estimatedRelevance: "Expected to be small relative to materials and manufacturing, but not quantified here.",
    percent: null,
  },
  {
    excludedItem: "Capital goods — printing presses, lamination and punching lines",
    rationale: "Excluded under the methodology profile's cut-off rules, which place capital equipment outside the product model.",
    estimatedRelevance: "Estimated below the 1% cut-off threshold when amortised over the equipment's output.",
    percent: "1",
  },
];

// ---------------------------------------------------------------------------
// Derived artefacts
// ---------------------------------------------------------------------------

/** Real bytes, attached as evidence so the download on the evidence page works. */
export function bomCsv(): Buffer {
  const rows = BOM.map((line) => {
    const stage = STAGES.find((s) => s.key === line.stage)?.stage ?? "";
    const perCard =
      line.itemType === LcaItemType.TRANSPORT
        ? "n/a - freight work"
        : `${(Number(line.quantity) / BATCH_CARDS).toPrecision(3)} ${line.unit}`;
    return [line.name, stage, line.componentName ?? "", line.quantity, line.unit, perCard, line.dataType, line.dataSource]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",");
  });
  return Buffer.from(
    [
      `# SYNTHETIC DEMONSTRATION BILL OF MATERIALS - one batch of ${BATCH_CARDS} cards.`,
      "# Not a Paragon production BOM. Illustrative quantities only.",
      "Line,Lifecycle stage,Component,Quantity,Unit,Per card,Data type,Source",
      ...rows,
      "",
    ].join("\n"),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Engine input builder
// ---------------------------------------------------------------------------

/**
 * Builds the engine's own input shape from this fixture, mirroring the field
 * mapping `calculation-service.ts#toEngineAssessment` applies to the stored
 * rows for the fields this fixture actually uses. It exists so the numbers
 * can be asserted without a database; the seeded assessment goes through the
 * real stored path, not this one.
 */
export function buildEngineAssessment(variant: "baseline" | "scenario"): EngineAssessment {
  const overrides = new Map(
    variant === "scenario" ? SCENARIO_CHANGES.map((change) => [change.lineName, change.factorKey] as const) : [],
  );

  const processes: EngineProcess[] = STAGES.map((stage) => ({
    id: `process-${stage.key}`,
    parentProcessId: null,
    stage: stage.stage,
    name: stage.name,
    isIncluded: true,
    allocationMethod: LcaAllocationMethod.NONE,
    allocationPercent: D(100),
    allocationRationale: null,
    outputs: [],
  }));

  const items: EngineInventoryItem[] = BOM.map((line, index) => {
    const factorKey = overrides.get(line.name) ?? line.factorKey;
    const legs: EngineTransportLeg[] = (line.legs ?? []).map((leg, sequence) => ({
      id: `leg-${index}-${sequence}`,
      sequence,
      mode: leg.mode,
      modeDescription: null,
      originName: leg.origin,
      destinationName: leg.destination,
      distanceValue: D(leg.distanceKm),
      distanceUnit: "km",
      massValue: D(leg.massTonnes),
      massUnit: "t",
      loadFactorPercent: null,
      includesReturnTrip: false,
      factor: toEngineFactor(leg.factorKey),
      assumptions: leg.assumptions,
    }));

    return {
      id: `item-${index}`,
      processId: `process-${line.stage}`,
      itemType: line.itemType,
      name: line.name,
      classification: LcaEmissionClassification.FOSSIL,
      quantity: D(line.quantity),
      unit: line.unit,
      adjustmentFactor: D(1),
      adjustmentRationale: null,
      wastePercent: null,
      recycledContentPercent: null,
      dataType: line.dataType,
      supplierName: line.supplier ?? null,
      materialName: line.materialName ?? null,
      componentName: line.componentName ?? null,
      geography: line.geography,
      factor: factorKey ? toEngineFactor(factorKey) : null,
      recycledFactor: null,
      biogenicUptakePerUnit: null,
      storedCarbonPerUnit: null,
      dataQuality: {
        temporal: line.scores[0],
        geographical: line.scores[1],
        technological: line.scores[2],
        completeness: line.scores[3],
        reliability: line.scores[4],
      },
      uncertaintyPercent: null,
      isExcluded: false,
      exclusionReason: null,
      transportLegs: legs,
      endOfLifeRoutes: [],
    };
  });

  return {
    id: `assessment-${variant}`,
    reference: variant === "baseline" ? BASELINE_REFERENCE : SCENARIO_REFERENCE,
    title: variant === "baseline" ? PRODUCT_NAME : SCENARIO_TITLE,
    functionalUnit: {
      description: FUNCTIONAL_UNIT_DESCRIPTION,
      quantity: D(FUNCTIONAL_UNIT_CARDS),
      unit: "item",
      isDeclaredUnit: false,
      declaredUnitDescription: null,
      referenceFlowDescription: `${FUNCTIONAL_UNIT_CARDS} finished cards`,
      referenceFlowQuantity: D(FUNCTIONAL_UNIT_CARDS),
      referenceFlowUnit: "item",
      modelledOutputQuantity: D(BATCH_CARDS),
      modelledOutputUnit: "item",
    },
    methodology: { ...FALLBACK_METHODOLOGY },
    processes,
    items,
  };
}

function toEngineFactor(key: string): EngineFactor {
  const factor = demoFactor(key);
  return {
    emissionFactorId: `factor-${factor.key}`,
    selectionMode: LcaFactorSelectionMode.LIBRARY_FACTOR,
    value: D(factor.co2eFactor),
    unit: factor.unit,
    source: factor.dataSource,
    version: String(factor.referenceYear),
    boundary: factor.boundary,
    geography: factor.region,
    year: factor.referenceYear,
    gwpBasis: GWP_BASIS,
    // The seeded factor set is flagged as a placeholder, and the engine
    // carries that flag through to every result line and export.
    isPlaceholder: true,
    uncertaintyPercent: null,
  };
}
