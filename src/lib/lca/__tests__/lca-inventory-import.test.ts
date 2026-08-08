import { describe, expect, it } from "vitest";
import { LcaDataType, LcaItemType, LcaLifecycleStage } from "@prisma/client";
import {
  buildInventoryTemplateCsv,
  parseInventoryFile,
  validateInventoryRows,
  type InventoryImportContext,
  type RawInventoryRow,
} from "@/lib/lca/import/inventory-import";

const context: InventoryImportContext = {
  processes: [
    { id: "process-materials", name: "Raw materials", stage: LcaLifecycleStage.RAW_MATERIALS },
    { id: "process-mfg", name: "Manufacturing", stage: LcaLifecycleStage.MANUFACTURING },
  ],
  suppliers: [{ id: "supplier-1", name: "Example Polymers Ltd" }],
  existingItems: [{ id: "item-existing", processId: "process-materials", name: "ABS housing", partNumber: "PN-1001" }],
  factors: [
    {
      id: "factor-abs",
      category: "lca_material_plastic",
      subtypeKey: "abs",
      region: "EU",
      unit: "kg",
      co2eFactor: "3.8",
      setName: "Test library",
      isPlaceholder: false,
    },
    {
      id: "factor-pet",
      category: "lca_material_plastic",
      subtypeKey: "pet",
      region: "EU",
      unit: "kg",
      co2eFactor: "2.9",
      setName: "Test library",
      isPlaceholder: false,
    },
    {
      id: "factor-electricity",
      category: "lca_electricity",
      subtypeKey: null,
      region: "GB",
      unit: "kWh",
      co2eFactor: "0.207",
      setName: "Placeholder library",
      isPlaceholder: true,
    },
  ],
};

function row(overrides: RawInventoryRow = {}): RawInventoryRow {
  return {
    stage: "RAW_MATERIALS",
    name: "ABS trim",
    quantity: "0.045",
    unit: "kg",
    ...overrides,
  };
}

describe("parsing", () => {
  it("reads a CSV in the template format", async () => {
    const csv = "name,quantity,unit,stage\nSteel bracket,0.5,kg,RAW_MATERIALS\n";
    const rows = await parseInventoryFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, "bom.csv");

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Steel bracket");
    expect(rows[0].quantity).toBe("0.5");
  });

  it("accepts common alternative header names", async () => {
    const csv = "item name,qty,uom,lifecycle stage\nSteel bracket,0.5,kg,RAW_MATERIALS\n";
    const rows = await parseInventoryFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, "bom.csv");

    expect(rows[0].name).toBe("Steel bracket");
    expect(rows[0].quantity).toBe("0.5");
    expect(rows[0].unit).toBe("kg");
    expect(rows[0].stage).toBe("RAW_MATERIALS");
  });

  it("handles quoted fields containing commas", async () => {
    const csv = 'name,quantity,unit,notes\n"Bracket, mild steel",0.5,kg,"Mass from CAD, cross-checked"\n';
    const rows = await parseInventoryFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, "bom.csv");

    expect(rows[0].name).toBe("Bracket, mild steel");
    expect(rows[0].notes).toBe("Mass from CAD, cross-checked");
  });

  it("refuses a file type it cannot read", async () => {
    await expect(parseInventoryFile(new ArrayBuffer(0), "bom.pdf")).rejects.toThrow(/Unsupported file type/);
  });

  it("produces a template that parses back into rows", async () => {
    const csv = buildInventoryTemplateCsv();
    const rows = await parseInventoryFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, "template.csv");

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0].name).toBe("ABS housing");
    expect(rows.every((r) => r.quantity && r.unit)).toBe(true);
  });
});

describe("validation", () => {
  it("accepts a complete row and prepares it", () => {
    const preview = validateInventoryRows([row()], context);

    expect(preview.readyCount).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].prepared?.processId).toBe("process-materials");
    expect(preview.rows[0].prepared?.itemType).toBe(LcaItemType.MATERIAL);
  });

  it("reports every input row, including the ones it cannot use", () => {
    const preview = validateInventoryRows([row(), row({ name: "" }), row({ quantity: "abc" })], context);

    expect(preview.rows).toHaveLength(3);
    expect(preview.totalRows).toBe(3);
    expect(preview.errorCount).toBe(2);
    // The failed rows are present with a reason, not dropped.
    expect(preview.rows[1].errors.length).toBeGreaterThan(0);
    expect(preview.rows[1].prepared).toBeNull();
  });

  it("rejects an unrecognised unit rather than importing something it cannot convert", () => {
    const preview = validateInventoryRows([row({ unit: "widgets" })], context);

    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0].errors[0]).toContain("not a unit this platform can convert");
  });

  it("places a row by process name when one matches", () => {
    const preview = validateInventoryRows([row({ process: "Manufacturing", stage: "" })], context);
    expect(preview.rows[0].prepared?.processId).toBe("process-mfg");
  });

  it("falls back to the stage when the process name is unknown, and says so", () => {
    const preview = validateInventoryRows([row({ process: "Nonexistent" })], context);

    expect(preview.rows[0].prepared?.processId).toBe("process-materials");
    expect(preview.rows[0].warnings.some((w) => w.includes("Nonexistent"))).toBe(true);
  });

  it("errors when neither a process nor a stage is given", () => {
    const preview = validateInventoryRows([row({ stage: "", process: "" })], context);
    expect(preview.errorCount).toBe(1);
  });

  it("errors when the stage has no process to land in", () => {
    const preview = validateInventoryRows([row({ stage: "END_OF_LIFE" })], context);
    expect(preview.rows[0].errors[0]).toContain("No process covers");
  });
});

describe("factor matching", () => {
  it("assigns a factor when exactly one matches", () => {
    const preview = validateInventoryRows(
      [row({ factor_category: "lca_material_plastic", factor_subtype: "abs" })],
      context,
    );
    expect(preview.rows[0].prepared?.emissionFactorId).toBe("factor-abs");
  });

  it("assigns nothing when several match, rather than choosing on the modeller's behalf", () => {
    const preview = validateInventoryRows([row({ factor_category: "lca_material_plastic" })], context);

    expect(preview.rows[0].prepared?.emissionFactorId).toBeNull();
    expect(preview.rows[0].warnings.some((w) => w.includes("2 factors match"))).toBe(true);
    // The row still imports — it will simply show as awaiting a factor.
    expect(preview.rows[0].status).toBe("ready");
  });

  it("assigns nothing when the unit is incompatible", () => {
    const preview = validateInventoryRows(
      [row({ unit: "kWh", factor_category: "lca_material_plastic", factor_subtype: "abs" })],
      context,
    );
    expect(preview.rows[0].prepared?.emissionFactorId).toBeNull();
  });

  it("warns when the matched factor is a placeholder", () => {
    const preview = validateInventoryRows(
      [row({ name: "Electricity", unit: "kWh", factor_category: "lca_electricity", stage: "MANUFACTURING" })],
      context,
    );

    expect(preview.rows[0].prepared?.emissionFactorId).toBe("factor-electricity");
    expect(preview.rows[0].warnings.some((w) => w.includes("placeholder"))).toBe(true);
  });

  it("warns rather than erroring when the category is unknown", () => {
    const preview = validateInventoryRows([row({ factor_category: "not_a_category" })], context);

    expect(preview.rows[0].status).toBe("ready");
    expect(preview.rows[0].warnings.some((w) => w.includes("not_a_category"))).toBe(true);
  });

  it("requires a source for a manually entered factor", () => {
    const preview = validateInventoryRows([row({ manual_factor_value: "1.2" })], context);

    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0].errors[0]).toContain("manual_factor_source");
  });

  it("accepts a sourced manual factor", () => {
    const preview = validateInventoryRows(
      [row({ manual_factor_value: "1.2", manual_factor_unit: "kg", manual_factor_source: "Publisher, 2026" })],
      context,
    );

    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].prepared?.manualFactorValue).toBe("1.2");
    expect(preview.rows[0].prepared?.manualFactorSource).toBe("Publisher, 2026");
  });

  it("rejects a manual factor whose unit cannot be applied to the quantity", () => {
    const preview = validateInventoryRows(
      [row({ manual_factor_value: "1.2", manual_factor_unit: "kWh", manual_factor_source: "Publisher" })],
      context,
    );
    expect(preview.errorCount).toBe(1);
  });
});

describe("duplicates", () => {
  it("spots a row matching an existing line by part number", () => {
    const preview = validateInventoryRows([row({ name: "Something else", part_number: "PN-1001" })], context);

    expect(preview.duplicateCount).toBe(1);
    expect(preview.rows[0].duplicateOf?.name).toBe("ABS housing");
    // It is still prepared, so the importer can choose to update or add it.
    expect(preview.rows[0].prepared).not.toBeNull();
  });

  it("spots a row matching by name when there is no part number", () => {
    const preview = validateInventoryRows([row({ name: "ABS housing" })], context);
    expect(preview.duplicateCount).toBe(1);
  });

  it("does not treat a same-named line in a different process as a duplicate", () => {
    const preview = validateInventoryRows([row({ name: "ABS housing", stage: "MANUFACTURING" })], context);
    expect(preview.duplicateCount).toBe(0);
  });
});

describe("field parsing", () => {
  it("validates percentage ranges", () => {
    expect(validateInventoryRows([row({ recycled_content_percent: "150" })], context).errorCount).toBe(1);
    expect(validateInventoryRows([row({ waste_percent: "100" })], context).errorCount).toBe(1);
    expect(validateInventoryRows([row({ recycled_content_percent: "30%" })], context).errorCount).toBe(0);
  });

  it("validates data-quality scores", () => {
    expect(validateInventoryRows([row({ temporal_score: "0" })], context).errorCount).toBe(1);
    expect(validateInventoryRows([row({ temporal_score: "6" })], context).errorCount).toBe(1);
    expect(validateInventoryRows([row({ temporal_score: "3" })], context).rows[0].prepared?.temporalScore).toBe(3);
  });

  it("links a supplier by name, and keeps an unmatched name rather than dropping it", () => {
    const matched = validateInventoryRows([row({ supplier: "Example Polymers Ltd" })], context);
    expect(matched.rows[0].prepared?.supplierId).toBe("supplier-1");

    const unmatched = validateInventoryRows([row({ supplier: "Unknown Supplier Ltd" })], context);
    expect(unmatched.rows[0].prepared?.supplierId).toBeNull();
    expect(unmatched.rows[0].prepared?.notes).toContain("Unknown Supplier Ltd");
    expect(unmatched.rows[0].warnings.some((w) => w.includes("not on the supplier list"))).toBe(true);
  });

  it("defaults an unrecognised item type to material and says so", () => {
    const preview = validateInventoryRows([row({ item_type: "gadget" })], context);

    expect(preview.rows[0].prepared?.itemType).toBe(LcaItemType.MATERIAL);
    expect(preview.rows[0].warnings.some((w) => w.includes("gadget"))).toBe(true);
  });

  it("defaults an unrecognised data type to secondary and says so", () => {
    const preview = validateInventoryRows([row({ data_type: "vibes" })], context);

    expect(preview.rows[0].prepared?.dataType).toBe(LcaDataType.SECONDARY);
    expect(preview.rows[0].warnings.some((w) => w.includes("vibes"))).toBe(true);
  });

  it("warns about a zero quantity without blocking the import", () => {
    const preview = validateInventoryRows([row({ quantity: "0" })], context);

    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0].warnings.some((w) => w.includes("contributes nothing"))).toBe(true);
  });

  it("strips thousands separators from a quantity", () => {
    const preview = validateInventoryRows([row({ quantity: "1,250" })], context);
    expect(preview.rows[0].prepared?.quantity).toBe("1250");
  });
});
