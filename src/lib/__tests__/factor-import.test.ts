import { describe, expect, it } from "vitest";
import { parseFactorFile, validateFactorRows, buildTemplateCsv } from "@/lib/factor-import";
import { Scope, FactorBasis } from "@prisma/client";

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("parseFactorFile (csv)", () => {
  it("parses a well-formed csv into row objects keyed by canonical column", async () => {
    const csv = "scope,factor_category,subtype_key,basis,region,unit,co2e_factor,notes\nSCOPE_1,stationary_combustion_natural_gas,,STANDARD,UK,kWh,0.18293,test note\n";
    const rows = await parseFactorFile(toBuffer(csv), "factors.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("SCOPE_1");
    expect(rows[0].factor_category).toBe("stationary_combustion_natural_gas");
    expect(rows[0].co2e_factor).toBe("0.18293");
    expect(rows[0].notes).toBe("test note");
  });

  it("accepts the 'category' header alias for factor_category", async () => {
    const csv = "scope,category,basis,unit,co2e_factor\nSCOPE_2,grid_electricity,LOCATION_BASED,kWh,0.207\n";
    const rows = await parseFactorFile(toBuffer(csv), "factors.csv");
    expect(rows[0].factor_category).toBe("grid_electricity");
  });

  it("handles quoted fields containing commas", async () => {
    const csv = 'scope,factor_category,basis,unit,co2e_factor,notes\nSCOPE_1,fugitive_refrigerant,STANDARD,kg,2088,"blend, verified 2026"\n';
    const rows = await parseFactorFile(toBuffer(csv), "factors.csv");
    expect(rows[0].notes).toBe("blend, verified 2026");
  });

  it("rejects unsupported file extensions", async () => {
    await expect(parseFactorFile(toBuffer("x"), "factors.pdf")).rejects.toThrow(/Unsupported file type/);
  });
});

describe("validateFactorRows", () => {
  it("accepts a fully valid row", () => {
    const { valid, errors, warnings } = validateFactorRows([
      { scope: "SCOPE_1", factor_category: "stationary_combustion_natural_gas", basis: "STANDARD", unit: "kWh", co2e_factor: "0.18293" },
    ]);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ scope: Scope.SCOPE_1, category: "stationary_combustion_natural_gas", basis: FactorBasis.STANDARD, unit: "kWh", co2eFactor: 0.18293, region: "UK" });
  });

  it("defaults basis to STANDARD and region to UK when blank", () => {
    const { valid } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "stationary_combustion_diesel", basis: "", unit: "litres", co2e_factor: "2.5" }]);
    expect(valid[0].basis).toBe(FactorBasis.STANDARD);
    expect(valid[0].region).toBe("UK");
  });

  it("rejects an invalid scope", () => {
    const { errors, valid } = validateFactorRows([{ scope: "SCOPE_9", factor_category: "x", unit: "kWh", co2e_factor: "1" }]);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/Invalid or missing "scope"/);
  });

  it("rejects a missing factor_category", () => {
    const { errors } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "", unit: "kWh", co2e_factor: "1" }]);
    expect(errors[0].message).toMatch(/Missing "factor_category"/);
  });

  it("rejects a non-numeric or negative co2e_factor", () => {
    const { errors: e1 } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "x", unit: "kWh", co2e_factor: "not-a-number" }]);
    expect(e1[0].message).toMatch(/Invalid "co2e_factor"/);

    const { errors: e2 } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "x", unit: "kWh", co2e_factor: "-1" }]);
    expect(e2[0].message).toMatch(/Invalid "co2e_factor"/);
  });

  it("rejects an invalid basis value", () => {
    const { errors } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "x", basis: "MADE_UP", unit: "kWh", co2e_factor: "1" }]);
    expect(errors[0].message).toMatch(/Invalid "basis"/);
  });

  it("warns (but doesn't block) on an unrecognised factor_category", () => {
    const { valid, errors, warnings } = validateFactorRows([
      { scope: "SCOPE_3", factor_category: "some_brand_new_category", unit: "kg", co2e_factor: "1" },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(warnings[0].message).toMatch(/isn't one of the platform's known factor categories/);
  });

  it("never fabricates a value — every valid row's co2eFactor traces back to the input string verbatim", () => {
    const { valid } = validateFactorRows([{ scope: "SCOPE_1", factor_category: "x", unit: "kWh", co2e_factor: "0.123456" }]);
    expect(valid[0].co2eFactor).toBe(0.123456);
  });
});

describe("buildTemplateCsv", () => {
  it("round-trips through the parser and validator cleanly", async () => {
    const csv = buildTemplateCsv();
    const rows = await parseFactorFile(toBuffer(csv), "template.csv");
    const { valid, errors } = validateFactorRows(rows);
    expect(errors).toHaveLength(0);
    expect(valid.length).toBeGreaterThan(0);
  });
});
