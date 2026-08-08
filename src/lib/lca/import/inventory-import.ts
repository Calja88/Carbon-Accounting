/**
 * Bill of materials / inventory CSV import.
 *
 * A BOM arrives as a spreadsheet, and a spreadsheet is exactly where rows go
 * missing quietly. This importer is built so that cannot happen:
 *
 *  - every input row appears in the preview with a status, including the ones
 *    that failed;
 *  - nothing is written until the importer confirms what they have seen;
 *  - rows that duplicate something already in the assessment are identified,
 *    with the choice of what to do about them left to the importer; and
 *  - a row whose factor cannot be resolved still imports, as activity data
 *    awaiting a factor, rather than being dropped or given a guessed one.
 *
 * Parsing and validation are pure functions over plain data, so both are
 * unit-tested directly.
 */

import ExcelJS from "exceljs";
import {
  LcaDataType,
  LcaEmissionClassification,
  LcaItemType,
  LcaLifecycleStage,
  LcaUncertaintyStatus,
} from "@prisma/client";
import { parseCsv, normalizeHeaderKey, toCsv } from "@/lib/csv";
import { areUnitsCompatible, findUnit } from "../units";

export const INVENTORY_TEMPLATE_COLUMNS = [
  "stage",
  "process",
  "item_type",
  "component",
  "part_number",
  "name",
  "material",
  "supplier",
  "quantity",
  "unit",
  "recycled_content_percent",
  "waste_percent",
  "data_type",
  "data_source",
  "geography",
  "classification",
  "factor_category",
  "factor_subtype",
  "factor_region",
  "manual_factor_value",
  "manual_factor_unit",
  "manual_factor_source",
  "temporal_score",
  "geographical_score",
  "technological_score",
  "completeness_score",
  "reliability_score",
  "uncertainty_percent",
  "notes",
] as const;

export type InventoryTemplateColumn = (typeof INVENTORY_TEMPLATE_COLUMNS)[number];

const HEADER_ALIASES: Record<string, InventoryTemplateColumn> = {
  stage: "stage",
  lifecycle_stage: "stage",
  process: "process",
  process_name: "process",
  item_type: "item_type",
  type: "item_type",
  component: "component",
  component_name: "component",
  assembly: "component",
  part_number: "part_number",
  part_no: "part_number",
  partno: "part_number",
  sku: "part_number",
  name: "name",
  description: "name",
  item: "name",
  item_name: "name",
  material: "material",
  material_name: "material",
  supplier: "supplier",
  supplier_name: "supplier",
  vendor: "supplier",
  quantity: "quantity",
  qty: "quantity",
  amount: "quantity",
  mass: "quantity",
  unit: "unit",
  uom: "unit",
  units: "unit",
  recycled_content_percent: "recycled_content_percent",
  recycled_content: "recycled_content_percent",
  recycled_percent: "recycled_content_percent",
  waste_percent: "waste_percent",
  scrap_percent: "waste_percent",
  yield_loss_percent: "waste_percent",
  data_type: "data_type",
  data_source: "data_source",
  source: "data_source",
  geography: "geography",
  region: "geography",
  country: "geography",
  origin: "geography",
  classification: "classification",
  carbon_classification: "classification",
  factor_category: "factor_category",
  factor: "factor_category",
  factor_subtype: "factor_subtype",
  subtype: "factor_subtype",
  subtype_key: "factor_subtype",
  factor_region: "factor_region",
  manual_factor_value: "manual_factor_value",
  factor_value: "manual_factor_value",
  manual_factor_unit: "manual_factor_unit",
  factor_unit: "manual_factor_unit",
  manual_factor_source: "manual_factor_source",
  factor_source: "manual_factor_source",
  temporal_score: "temporal_score",
  geographical_score: "geographical_score",
  geographic_score: "geographical_score",
  technological_score: "technological_score",
  completeness_score: "completeness_score",
  reliability_score: "reliability_score",
  uncertainty_percent: "uncertainty_percent",
  uncertainty: "uncertainty_percent",
  notes: "notes",
  note: "notes",
  comment: "notes",
};

export type RawInventoryRow = Partial<Record<InventoryTemplateColumn, string>>;

function rowsToObjects(grid: string[][]): RawInventoryRow[] {
  if (grid.length === 0) return [];
  const headers = grid[0].map((h) => HEADER_ALIASES[normalizeHeaderKey(h)]);
  return grid.slice(1).map((cells) => {
    const row: RawInventoryRow = {};
    headers.forEach((column, i) => {
      if (column) row[column] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

export async function parseInventoryFile(buffer: ArrayBuffer, filename: string): Promise<RawInventoryRow[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    return rowsToObjects(parseCsv(new TextDecoder("utf-8").decode(buffer)));
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const grid: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text ?? ""));
      grid.push(cells);
    });
    return rowsToObjects(grid);
  }
  throw new Error(`Unsupported file type: "${filename}" — upload a .csv or .xlsx file in the inventory template format.`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ImportContextProcess {
  id: string;
  name: string;
  stage: LcaLifecycleStage;
}

export interface ImportContextFactor {
  id: string;
  category: string;
  subtypeKey: string | null;
  region: string;
  unit: string;
  co2eFactor: string;
  setName: string;
  isPlaceholder: boolean;
}

export interface ImportContextItem {
  id: string;
  processId: string;
  name: string;
  partNumber: string | null;
}

export interface InventoryImportContext {
  processes: ImportContextProcess[];
  factors: ImportContextFactor[];
  suppliers: { id: string; name: string }[];
  existingItems: ImportContextItem[];
}

export interface PreparedInventoryRow {
  processId: string;
  itemType: LcaItemType;
  name: string;
  componentName: string | null;
  partNumber: string | null;
  materialName: string | null;
  supplierId: string | null;
  supplierNameUnmatched: string | null;
  quantity: string;
  unit: string;
  recycledContentPercent: string | null;
  wastePercent: string | null;
  dataType: LcaDataType;
  dataSource: string | null;
  geography: string | null;
  classification: LcaEmissionClassification;
  emissionFactorId: string | null;
  manualFactorValue: string | null;
  manualFactorUnit: string | null;
  manualFactorSource: string | null;
  temporalScore: number | null;
  geographicalScore: number | null;
  technologicalScore: number | null;
  completenessScore: number | null;
  reliabilityScore: number | null;
  uncertaintyPercent: string | null;
  notes: string | null;
  /** Set when this row matches an inventory item already in the assessment. */
  duplicateOfItemId: string | null;
}

export type RowStatus = "ready" | "duplicate" | "error";

export interface PreviewRow {
  /** 1-based, counting data rows — matches what the importer sees in Excel. */
  rowNumber: number;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  /** The row as read from the file, for showing back what was submitted. */
  raw: RawInventoryRow;
  prepared: PreparedInventoryRow | null;
  duplicateOf: { id: string; name: string } | null;
}

export interface InventoryImportPreview {
  rows: PreviewRow[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
  warningCount: number;
  totalRows: number;
}

const ITEM_TYPE_ALIASES: Record<string, LcaItemType> = {
  material: LcaItemType.MATERIAL,
  component: LcaItemType.MATERIAL,
  raw_material: LcaItemType.MATERIAL,
  energy: LcaItemType.ENERGY,
  electricity: LcaItemType.ENERGY,
  fuel: LcaItemType.FUEL,
  transport: LcaItemType.TRANSPORT,
  freight: LcaItemType.TRANSPORT,
  manufacturing: LcaItemType.MANUFACTURING_PROCESS,
  manufacturing_process: LcaItemType.MANUFACTURING_PROCESS,
  process: LcaItemType.MANUFACTURING_PROCESS,
  packaging: LcaItemType.PACKAGING,
  waste: LcaItemType.WASTE,
  water: LcaItemType.WATER,
  use_phase: LcaItemType.USE_PHASE,
  use: LcaItemType.USE_PHASE,
  end_of_life: LcaItemType.END_OF_LIFE,
  eol: LcaItemType.END_OF_LIFE,
  supplier_pcf: LcaItemType.SUPPLIER_PCF,
  other: LcaItemType.OTHER,
};

const DATA_TYPE_ALIASES: Record<string, LcaDataType> = {
  primary: LcaDataType.PRIMARY,
  measured: LcaDataType.PRIMARY,
  supplier: LcaDataType.SUPPLIER_SPECIFIC,
  supplier_specific: LcaDataType.SUPPLIER_SPECIFIC,
  secondary: LcaDataType.SECONDARY,
  database: LcaDataType.SECONDARY,
  proxy: LcaDataType.PROXY,
  modelled: LcaDataType.MODELLED,
  modeled: LcaDataType.MODELLED,
  calculated: LcaDataType.MODELLED,
};

const CLASSIFICATION_ALIASES: Record<string, LcaEmissionClassification> = {
  fossil: LcaEmissionClassification.FOSSIL,
  biogenic: LcaEmissionClassification.BIOGENIC,
  biogenic_removal: LcaEmissionClassification.BIOGENIC_REMOVAL,
  removal: LcaEmissionClassification.BIOGENIC_REMOVAL,
  technological_removal: LcaEmissionClassification.TECHNOLOGICAL_REMOVAL,
  stored_carbon: LcaEmissionClassification.STORED_CARBON,
  offset: LcaEmissionClassification.OFFSET,
};

const STAGE_ALIASES: Record<string, LcaLifecycleStage> = {
  raw_materials: LcaLifecycleStage.RAW_MATERIALS,
  materials: LcaLifecycleStage.RAW_MATERIALS,
  inbound_transport: LcaLifecycleStage.INBOUND_TRANSPORT,
  inbound: LcaLifecycleStage.INBOUND_TRANSPORT,
  manufacturing: LcaLifecycleStage.MANUFACTURING,
  production: LcaLifecycleStage.MANUFACTURING,
  packaging: LcaLifecycleStage.PACKAGING,
  distribution: LcaLifecycleStage.DISTRIBUTION,
  outbound: LcaLifecycleStage.DISTRIBUTION,
  use_phase: LcaLifecycleStage.USE_PHASE,
  use: LcaLifecycleStage.USE_PHASE,
  end_of_life: LcaLifecycleStage.END_OF_LIFE,
  eol: LcaLifecycleStage.END_OF_LIFE,
  other: LcaLifecycleStage.OTHER,
};

function alias<T>(map: Record<string, T>, raw: string | undefined): T | undefined {
  if (!raw?.trim()) return undefined;
  return map[raw.trim().toLowerCase().replace(/[\s-]+/g, "_")];
}

function parseScore(raw: string | undefined, field: string, errors: string[]): number | null {
  if (!raw?.trim()) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    errors.push(`"${field}" must be a whole number from 1 (best) to 5 (worst); got "${raw}".`);
    return null;
  }
  return value;
}

function parsePercent(raw: string | undefined, field: string, errors: string[], max = 100): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.replace("%", "").trim();
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > max) {
    errors.push(`"${field}" must be a number between 0 and ${max}; got "${raw}".`);
    return null;
  }
  return String(value);
}

export function validateInventoryRows(
  rows: RawInventoryRow[],
  context: InventoryImportContext,
): InventoryImportPreview {
  const processByName = new Map(context.processes.map((p) => [p.name.trim().toLowerCase(), p]));
  const processByStage = new Map<LcaLifecycleStage, ImportContextProcess>();
  for (const p of context.processes) {
    if (!processByStage.has(p.stage)) processByStage.set(p.stage, p);
  }
  const supplierByName = new Map(context.suppliers.map((s) => [s.name.trim().toLowerCase(), s]));

  const previewRows: PreviewRow[] = rows.map((raw, index) => {
    const rowNumber = index + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = raw.name?.trim() ?? "";
    if (!name) errors.push('"name" is required — every line needs something to call it.');

    // Process: by name first, then by stage.
    let process = raw.process ? processByName.get(raw.process.trim().toLowerCase()) : undefined;
    if (!process && raw.process?.trim()) {
      warnings.push(`No process called "${raw.process}" exists in this assessment; the row has been placed by stage instead.`);
    }
    if (!process) {
      const stage = alias(STAGE_ALIASES, raw.stage);
      if (stage) {
        process = processByStage.get(stage);
        if (!process) errors.push(`No process covers the ${stage.replace(/_/g, " ").toLowerCase()} stage — add one before importing.`);
      } else if (raw.stage?.trim()) {
        errors.push(`"${raw.stage}" is not a lifecycle stage this platform recognises.`);
      } else {
        errors.push('Give either a "process" that exists in this assessment, or a "stage" to place the row in.');
      }
    }

    const quantityRaw = raw.quantity?.trim() ?? "";
    const quantity = Number(quantityRaw.replace(/,/g, ""));
    if (!quantityRaw) errors.push('"quantity" is required.');
    else if (!Number.isFinite(quantity)) errors.push(`"quantity" must be a number; got "${quantityRaw}".`);
    else if (quantity <= 0) warnings.push(`Quantity is ${quantity}, which contributes nothing to the footprint.`);

    const unitRaw = raw.unit?.trim() ?? "";
    if (!unitRaw) errors.push('"unit" is required.');
    else if (!findUnit(unitRaw)) errors.push(`"${unitRaw}" is not a unit this platform can convert. Use a recognised unit, or convert the figure before importing.`);

    const itemType = alias(ITEM_TYPE_ALIASES, raw.item_type) ?? LcaItemType.MATERIAL;
    if (raw.item_type?.trim() && !alias(ITEM_TYPE_ALIASES, raw.item_type)) {
      warnings.push(`"${raw.item_type}" is not an item type this platform recognises; the row has been imported as a material.`);
    }

    const dataType = alias(DATA_TYPE_ALIASES, raw.data_type) ?? LcaDataType.SECONDARY;
    if (raw.data_type?.trim() && !alias(DATA_TYPE_ALIASES, raw.data_type)) {
      warnings.push(`"${raw.data_type}" is not a data type this platform recognises; the row has been imported as secondary data.`);
    }

    const classification = alias(CLASSIFICATION_ALIASES, raw.classification) ?? LcaEmissionClassification.FOSSIL;

    const recycledContentPercent = parsePercent(raw.recycled_content_percent, "recycled_content_percent", errors);
    const wastePercent = parsePercent(raw.waste_percent, "waste_percent", errors, 99.999);

    const temporalScore = parseScore(raw.temporal_score, "temporal_score", errors);
    const geographicalScore = parseScore(raw.geographical_score, "geographical_score", errors);
    const technologicalScore = parseScore(raw.technological_score, "technological_score", errors);
    const completenessScore = parseScore(raw.completeness_score, "completeness_score", errors);
    const reliabilityScore = parseScore(raw.reliability_score, "reliability_score", errors);

    const uncertaintyRaw = raw.uncertainty_percent?.trim();
    let uncertaintyPercent: string | null = null;
    if (uncertaintyRaw) {
      const value = Number(uncertaintyRaw.replace("%", ""));
      if (!Number.isFinite(value) || value < 0) errors.push(`"uncertainty_percent" must be a number of 0 or more; got "${uncertaintyRaw}".`);
      else uncertaintyPercent = String(value);
    }

    // Supplier
    let supplierId: string | null = null;
    let supplierNameUnmatched: string | null = null;
    if (raw.supplier?.trim()) {
      const supplier = supplierByName.get(raw.supplier.trim().toLowerCase());
      if (supplier) supplierId = supplier.id;
      else {
        supplierNameUnmatched = raw.supplier.trim();
        warnings.push(`Supplier "${raw.supplier}" is not on the supplier list; the name has been kept in the notes and can be linked after import.`);
      }
    }

    // Factor: library lookup, or a manually entered sourced value.
    let emissionFactorId: string | null = null;
    let manualFactorValue: string | null = null;
    let manualFactorUnit: string | null = null;
    let manualFactorSource: string | null = null;

    const manualValueRaw = raw.manual_factor_value?.trim();
    if (manualValueRaw) {
      const value = Number(manualValueRaw);
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`"manual_factor_value" must be a number of 0 or more; got "${manualValueRaw}".`);
      } else if (!raw.manual_factor_source?.trim()) {
        errors.push('A manually entered factor needs a "manual_factor_source" — an unsourced factor cannot be traced back to anything.');
      } else {
        const factorUnit = raw.manual_factor_unit?.trim() || unitRaw;
        if (!findUnit(factorUnit)) {
          errors.push(`"manual_factor_unit" ("${factorUnit}") is not a unit this platform recognises.`);
        } else if (unitRaw && findUnit(unitRaw) && !areUnitsCompatible(factorUnit, unitRaw)) {
          errors.push(`A factor per ${factorUnit} cannot be applied to a quantity in ${unitRaw}.`);
        } else {
          manualFactorValue = String(value);
          manualFactorUnit = factorUnit;
          manualFactorSource = raw.manual_factor_source.trim();
        }
      }
    } else if (raw.factor_category?.trim()) {
      const category = raw.factor_category.trim();
      const subtype = raw.factor_subtype?.trim() || null;
      const region = raw.factor_region?.trim() || null;

      let candidates = context.factors.filter((f) => f.category === category);
      if (candidates.length === 0) {
        warnings.push(`No factor in the library has the category "${category}". The row has been imported with no factor assigned, and will show as awaiting one.`);
      } else {
        if (subtype) candidates = candidates.filter((f) => (f.subtypeKey ?? "") === subtype);
        if (region) candidates = candidates.filter((f) => f.region.toLowerCase() === region.toLowerCase());
        if (unitRaw && findUnit(unitRaw)) candidates = candidates.filter((f) => areUnitsCompatible(f.unit, unitRaw));

        if (candidates.length === 1) {
          emissionFactorId = candidates[0].id;
          if (candidates[0].isPlaceholder) {
            warnings.push(`The matched factor comes from "${candidates[0].setName}", which is a placeholder set. It cannot be used in a reported figure until a real factor set is imported.`);
          }
        } else if (candidates.length > 1) {
          warnings.push(
            `${candidates.length} factors match category "${category}"${subtype ? ` and subtype "${subtype}"` : ""}. No factor has been assigned — pick one on the item after import rather than have the importer choose.`,
          );
        } else {
          warnings.push(
            `Nothing in the library matches category "${category}"${subtype ? `, subtype "${subtype}"` : ""}${region ? `, region "${region}"` : ""} with a unit compatible with ${unitRaw || "the row's unit"}. The row has been imported with no factor assigned.`,
          );
        }
      }
    }

    // Duplicate detection
    const partNumber = raw.part_number?.trim() || null;
    const duplicate = process
      ? context.existingItems.find(
          (existing) =>
            existing.processId === process.id &&
            (partNumber
              ? (existing.partNumber ?? "").toLowerCase() === partNumber.toLowerCase()
              : existing.name.trim().toLowerCase() === name.toLowerCase()),
        )
      : undefined;

    const status: RowStatus = errors.length > 0 ? "error" : duplicate ? "duplicate" : "ready";

    const notes = [raw.notes?.trim(), supplierNameUnmatched ? `Supplier as imported: ${supplierNameUnmatched}` : null]
      .filter(Boolean)
      .join("\n") || null;

    const prepared: PreparedInventoryRow | null =
      errors.length > 0 || !process
        ? null
        : {
            processId: process.id,
            itemType,
            name,
            componentName: raw.component?.trim() || null,
            partNumber,
            materialName: raw.material?.trim() || null,
            supplierId,
            supplierNameUnmatched,
            quantity: String(quantity),
            unit: unitRaw,
            recycledContentPercent,
            wastePercent,
            dataType,
            dataSource: raw.data_source?.trim() || null,
            geography: raw.geography?.trim() || null,
            classification,
            emissionFactorId,
            manualFactorValue,
            manualFactorUnit,
            manualFactorSource,
            temporalScore,
            geographicalScore,
            technologicalScore,
            completenessScore,
            reliabilityScore,
            uncertaintyPercent,
            notes,
            duplicateOfItemId: duplicate?.id ?? null,
          };

    return {
      rowNumber,
      status,
      errors,
      warnings,
      raw,
      prepared,
      duplicateOf: duplicate ? { id: duplicate.id, name: duplicate.name } : null,
    };
  });

  return {
    rows: previewRows,
    totalRows: previewRows.length,
    readyCount: previewRows.filter((r) => r.status === "ready").length,
    duplicateCount: previewRows.filter((r) => r.status === "duplicate").length,
    errorCount: previewRows.filter((r) => r.status === "error").length,
    warningCount: previewRows.reduce((sum, r) => sum + r.warnings.length, 0),
  };
}

export type DuplicateStrategy = "skip" | "update" | "create_new";

export const DUPLICATE_STRATEGY_LABELS: Record<DuplicateStrategy, string> = {
  skip: "Skip duplicates — leave the existing lines exactly as they are",
  update: "Update duplicates — overwrite the existing lines with the imported values",
  create_new: "Import anyway — add them as additional lines alongside the existing ones",
};

/** The downloadable template, with a worked example row of each main kind. */
export function buildInventoryTemplateCsv(): string {
  const header = [...INVENTORY_TEMPLATE_COLUMNS];
  const rows: string[][] = [
    [
      "RAW_MATERIALS", "Raw materials and components", "MATERIAL", "Housing", "PN-1001", "ABS housing", "ABS",
      "Example Polymers Ltd", "0.045", "kg", "30", "4", "PRIMARY", "Engineering BOM rev C", "DE", "FOSSIL",
      "lca_material_plastic", "abs", "EU", "", "", "", "2", "2", "2", "1", "2", "15",
      "Mass from the CAD model, cross-checked against a weighed sample",
    ],
    [
      "MANUFACTURING", "Manufacturing", "ENERGY", "", "", "Injection moulding electricity", "", "",
      "1250", "kWh", "", "", "PRIMARY", "Sub-meter reading, line 3", "GB", "FOSSIL",
      "lca_electricity", "", "GB", "", "", "", "1", "1", "2", "2", "1", "5",
      "Metered for the production run this assessment models",
    ],
    [
      "PACKAGING", "Packaging", "PACKAGING", "Transit", "PK-22", "Corrugated carton", "Corrugated board", "",
      "0.12", "kg", "85", "", "SECONDARY", "Packaging specification", "GB", "FOSSIL",
      "", "", "", "0.72", "kg", "Publisher, dataset name and year go here", "3", "2", "3", "2", "3", "25",
      "Example of a manually entered, sourced factor rather than a library lookup",
    ],
  ];
  return toCsv(header, rows);
}

/** Column-by-column guidance, rendered on the import page. */
export const INVENTORY_TEMPLATE_GUIDE: { column: InventoryTemplateColumn; required: boolean; guidance: string }[] = [
  { column: "stage", required: false, guidance: "Lifecycle stage, e.g. RAW_MATERIALS. Used to place the row when no process name is given." },
  { column: "process", required: false, guidance: "Name of a process already in this assessment. Takes precedence over stage." },
  { column: "item_type", required: false, guidance: "MATERIAL, ENERGY, FUEL, TRANSPORT, MANUFACTURING_PROCESS, PACKAGING, WASTE, WATER, USE_PHASE, END_OF_LIFE or OTHER. Defaults to MATERIAL." },
  { column: "component", required: false, guidance: "Sub-assembly or component this line belongs to." },
  { column: "part_number", required: false, guidance: "Your part number. Used to spot rows that already exist." },
  { column: "name", required: true, guidance: "What the line is." },
  { column: "material", required: false, guidance: "Material name, used for the material contribution breakdown." },
  { column: "supplier", required: false, guidance: "Must match a supplier already on the supplier list to be linked; otherwise kept in the notes." },
  { column: "quantity", required: true, guidance: "Quantity per the modelled output — not per finished product, unless those are the same thing." },
  { column: "unit", required: true, guidance: "Any unit the platform recognises (kg, g, t, kWh, MJ, l, m3, m2, item, t.km…)." },
  { column: "recycled_content_percent", required: false, guidance: "0–100. Recorded as a disclosure; it only changes the figure if a recycled-route factor is assigned." },
  { column: "waste_percent", required: false, guidance: "0–99.999. Manufacturing loss: the input is grossed up by quantity / (1 - waste%)." },
  { column: "data_type", required: false, guidance: "PRIMARY, SUPPLIER_SPECIFIC, SECONDARY, PROXY or MODELLED. Defaults to SECONDARY." },
  { column: "data_source", required: false, guidance: "Where the figure came from." },
  { column: "geography", required: false, guidance: "Where the input actually comes from, checked against the factor's own geography." },
  { column: "classification", required: false, guidance: "FOSSIL, BIOGENIC, BIOGENIC_REMOVAL, TECHNOLOGICAL_REMOVAL, STORED_CARBON or OFFSET. Defaults to FOSSIL." },
  { column: "factor_category", required: false, guidance: "Library category to look a factor up in. Only assigned when exactly one factor matches." },
  { column: "factor_subtype", required: false, guidance: "Narrows the library lookup." },
  { column: "factor_region", required: false, guidance: "Narrows the library lookup by the factor's own region." },
  { column: "manual_factor_value", required: false, guidance: "kgCO2e per unit, where the factor is not in the library. Requires manual_factor_source." },
  { column: "manual_factor_unit", required: false, guidance: "The unit the manual factor is expressed per. Defaults to the row's own unit." },
  { column: "manual_factor_source", required: false, guidance: "Publication, dataset or document the manual factor came from. Required whenever a manual value is given." },
  { column: "temporal_score", required: false, guidance: "Data quality, 1 (best) to 5 (worst)." },
  { column: "geographical_score", required: false, guidance: "Data quality, 1 to 5." },
  { column: "technological_score", required: false, guidance: "Data quality, 1 to 5." },
  { column: "completeness_score", required: false, guidance: "Data quality, 1 to 5." },
  { column: "reliability_score", required: false, guidance: "Data quality, 1 to 5." },
  { column: "uncertainty_percent", required: false, guidance: "Percentage uncertainty on this line, if known." },
  { column: "notes", required: false, guidance: "Anything a reviewer would want to know." },
];

/** Uncertainty status implied by whether a percentage was supplied. */
export function uncertaintyStatusFor(percent: string | null): LcaUncertaintyStatus {
  return percent === null ? LcaUncertaintyStatus.NOT_ASSESSED : LcaUncertaintyStatus.ESTIMATED;
}
