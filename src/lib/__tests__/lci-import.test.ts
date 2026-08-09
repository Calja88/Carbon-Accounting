import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LcaFactorBoundary, LciLicenseDecision, Scope } from "@prisma/client";
import {
  detectDoubleCounting,
  parseLciCsv,
  partitionDuplicates,
  sourceAllowsNumericImport,
  validateLciRows,
} from "@/lib/lci-import";

const HEADER =
  "factor_id,source_factor_id,name,description,scope,category_level_1,category_level_2,category_level_3,category_level_4,column_text,factor_value,numerator_unit,denominator_unit,original_uom,impact_category,characterisation_basis,geography,lifecycle_boundary,dataset_type,is_full_unit_process_lci,data_type,factor_status,lca_relevance,lca_use_status,requires_human_review,automated_assignment_allowed,is_placeholder,source_name,source_publisher,source_year,source_version,publication_date,source_file_updated,source_page_last_updated,valid_from,valid_to,license,license_decision,source_url,methodology_url,license_url,review_notes";

function row(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    factor_id: "UK-DESNZ-2026-TEST-1",
    source_factor_id: "1_1_1",
    name: "Test / Fuel / Diesel",
    description: "Test factor",
    scope: "Scope 1",
    category_level_1: "Fuels",
    category_level_2: "Liquid fuels",
    category_level_3: "Diesel",
    category_level_4: "",
    column_text: "",
    factor_value: "2.5",
    numerator_unit: "kg CO2e",
    denominator_unit: "litres",
    original_uom: "litres",
    impact_category: "Climate change",
    characterisation_basis: "IPCC AR5 GWP100",
    geography: "United Kingdom",
    lifecycle_boundary: "DIRECT_COMBUSTION",
    dataset_type: "GHG_CONVERSION_FACTOR",
    is_full_unit_process_lci: "NO",
    data_type: "SECONDARY",
    factor_status: "ACTIVE_PUBLIC",
    lca_relevance: "HIGH",
    lca_use_status: "RECOMMENDED_WITH_HUMAN_REVIEW",
    requires_human_review: "YES",
    automated_assignment_allowed: "NO",
    is_placeholder: "NO",
    source_name: "UK Government GHG Conversion Factors for Company Reporting 2026",
    source_publisher: "Department for Energy Security and Net Zero",
    source_year: "2026",
    source_version: "1.2",
    publication_date: "2026-06-11",
    source_file_updated: "2026-07-10",
    source_page_last_updated: "2026-07-31",
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
    license: "Open Government Licence v3.0",
    license_decision: "ALLOW_WITH_ATTRIBUTION",
    source_url: "https://example.gov.uk",
    methodology_url: "https://example.gov.uk/methodology",
    license_url: "https://nationalarchives.gov.uk/ogl",
    review_notes: "Human methodological review is required before use in a product LCA.",
  };
  const merged = { ...base, ...overrides };
  return HEADER.split(",")
    .map((h) => merged[h] ?? "")
    .map((v) => (v.includes(",") ? `"${v}"` : v))
    .join(",");
}

function csv(rows: string[]): string {
  return `${HEADER}\n${rows.join("\n")}\n`;
}

describe("parseLciCsv", () => {
  it("parses a well-formed canonical-schema CSV", () => {
    const rows = parseLciCsv(csv([row()]));
    expect(rows).toHaveLength(1);
    expect(rows[0].factor_id).toBe("UK-DESNZ-2026-TEST-1");
    expect(rows[0].factor_value).toBe("2.5");
  });

  it("strips a leading UTF-8 BOM", () => {
    const withBom = "﻿" + csv([row()]);
    const rows = parseLciCsv(withBom);
    expect(rows).toHaveLength(1);
    expect(rows[0].factor_id).toBe("UK-DESNZ-2026-TEST-1");
  });
});

describe("validateLciRows", () => {
  it("imports a well-formed ACTIVE_PUBLIC / ALLOW_WITH_ATTRIBUTION row with the exact value and unit", () => {
    const rows = parseLciCsv(csv([row()]));
    const { importable, rejected } = validateLciRows(rows);
    expect(rejected).toHaveLength(0);
    expect(importable).toHaveLength(1);
    expect(importable[0]).toMatchObject({
      externalFactorId: "UK-DESNZ-2026-TEST-1",
      factorValue: 2.5,
      factorValueRaw: "2.5",
      numeratorUnit: "kg CO2e",
      denominatorUnit: "litres",
      scope: Scope.SCOPE_1,
      boundary: LcaFactorBoundary.COMBUSTION_ONLY,
      sourceLifecycleBoundary: "DIRECT_COMBUSTION",
      isLegitimateZero: false,
    });
  });

  it("never imports a DATA_UNAVAILABLE row and never coerces its missing value to zero", () => {
    const rows = parseLciCsv(
      csv([row({ factor_id: "UK-DESNZ-2026-MISSING-1", factor_status: "DATA_UNAVAILABLE", factor_value: "" })]),
    );
    const { importable, rejected } = validateLciRows(rows);
    expect(importable).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("MISSING_VALUE");
    // Explicitly: nothing with factorValue 0 was produced for this row.
    expect(importable.some((r) => r.externalFactorId === "UK-DESNZ-2026-MISSING-1")).toBe(false);
  });

  it("also rejects ACTIVE_PUBLIC rows with a blank factor_value as missing, not zero", () => {
    const rows = parseLciCsv(csv([row({ factor_id: "UK-DESNZ-2026-BLANK-1", factor_status: "ACTIVE_PUBLIC", factor_value: "" })]));
    const { importable, rejected } = validateLciRows(rows);
    expect(importable).toHaveLength(0);
    expect(rejected[0].reason).toBe("MISSING_VALUE");
  });

  it("imports a legitimate factor_value of 0 as a real, visibly-distinct zero with review_notes preserved", () => {
    const rows = parseLciCsv(
      csv([
        row({
          factor_id: "UK-DESNZ-2026-ZERO-1",
          factor_value: "0",
          review_notes: "Published as zero — biogenic CO2 excluded per methodology.",
        }),
      ]),
    );
    const { importable, rejected } = validateLciRows(rows);
    expect(rejected).toHaveLength(0);
    expect(importable).toHaveLength(1);
    expect(importable[0].factorValue).toBe(0);
    expect(importable[0].factorValueRaw).toBe("0");
    expect(importable[0].isLegitimateZero).toBe(true);
    expect(importable[0].reviewNotes).toBe("Published as zero — biogenic CO2 excluded per methodology.");
  });

  it("preserves exact numeric precision without rounding", () => {
    const rows = parseLciCsv(csv([row({ factor_id: "UK-DESNZ-2026-PRECISE-1", factor_value: "3033.38067" })]));
    const { importable } = validateLciRows(rows);
    expect(importable[0].factorValueRaw).toBe("3033.38067");
    expect(importable[0].factorValue).toBe(3033.38067);
  });

  it("rejects a row whose license_decision is not ALLOW_WITH_ATTRIBUTION even if otherwise well-formed", () => {
    const rows = parseLciCsv(
      csv([row({ factor_id: "UK-DESNZ-2026-COND-1", license_decision: "CONDITIONAL_DATASET_LEVEL_REVIEW" })]),
    );
    const { importable, rejected } = validateLciRows(rows);
    expect(importable).toHaveLength(0);
    expect(rejected[0].reason).toBe("LICENSE_NOT_ALLOWED");
  });

  it("rejects a non-ACTIVE_PUBLIC status that isn't DATA_UNAVAILABLE distinctly", () => {
    const rows = parseLciCsv(csv([row({ factor_id: "UK-DESNZ-2026-DRAFT-1", factor_status: "DRAFT" })]));
    const { rejected } = validateLciRows(rows);
    expect(rejected[0].reason).toBe("NON_ACTIVE_STATUS");
  });

  it("maps every lifecycle_boundary value present in the staged pack to a known LcaFactorBoundary", () => {
    const boundaries = [
      "TRANSPORT_OPERATION",
      "UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY",
      "DIRECT_FUGITIVE_OR_PROCESS_RELEASE",
      "END_OF_LIFE_TREATMENT",
      "CRADLE_TO_GATE_MATERIAL_PROXY",
      "DIRECT_COMBUSTION",
      "ELECTRICITY_TRANSMISSION_AND_DISTRIBUTION",
      "ELECTRICITY_GENERATION_USE",
      "SERVICE_OPERATIONAL_PROXY",
      "DIRECT_BIOENERGY_COMBUSTION_OR_RELEASE",
      "PURCHASED_HEAT_AND_STEAM",
      "WATER_SUPPLY",
      "WASTEWATER_TREATMENT",
    ];
    const rows = parseLciCsv(csv(boundaries.map((b, i) => row({ factor_id: `UK-DESNZ-2026-B-${i}`, lifecycle_boundary: b }))));
    const { importable } = validateLciRows(rows);
    expect(importable).toHaveLength(boundaries.length);
    for (const r of importable) {
      expect(r.boundary).not.toBe(LcaFactorBoundary.UNKNOWN);
      expect(r.sourceLifecycleBoundary.length).toBeGreaterThan(0);
    }
  });
});

describe("partitionDuplicates", () => {
  it("reports an already-present (factor_id, source_version) pair as a duplicate and skips it, not overwrites it", () => {
    const rows = parseLciCsv(csv([row({ factor_id: "UK-DESNZ-2026-DUP-1", source_version: "1.2" })]));
    const { importable } = validateLciRows(rows);
    const existing = new Set(["UK-DESNZ-2026-DUP-1 1.2"]);
    const { toImport, duplicates } = partitionDuplicates(importable, existing);
    expect(toImport).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ factorId: "UK-DESNZ-2026-DUP-1", sourceVersion: "1.2" });
  });

  it("treats a new source_version for a known factor_id as new, not a duplicate", () => {
    const rows = parseLciCsv(csv([row({ factor_id: "UK-DESNZ-2026-DUP-1", source_version: "1.3" })]));
    const { importable } = validateLciRows(rows);
    const existing = new Set(["UK-DESNZ-2026-DUP-1 1.2"]); // only the older version is "already in the DB"
    const { toImport, duplicates } = partitionDuplicates(importable, existing);
    expect(toImport).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });
});

describe("sourceAllowsNumericImport", () => {
  it("only ALLOW_WITH_ATTRIBUTION permits numeric import", () => {
    expect(sourceAllowsNumericImport(LciLicenseDecision.ALLOW_WITH_ATTRIBUTION)).toBe(true);
    expect(sourceAllowsNumericImport(LciLicenseDecision.CONDITIONAL_DATASET_LEVEL_REVIEW)).toBe(false);
    expect(sourceAllowsNumericImport(LciLicenseDecision.BLOCK)).toBe(false);
    expect(sourceAllowsNumericImport(LciLicenseDecision.METADATA_ONLY)).toBe(false);
  });
});

describe("detectDoubleCounting", () => {
  it("warns when both a direct-combustion and a WTT factor are selected for the same category", () => {
    const warnings = detectDoubleCounting([
      { externalFactorId: "A", sourceLifecycleBoundary: "DIRECT_COMBUSTION", categoryKey: "Fuels/Gaseous fuels/Butane" },
      { externalFactorId: "B", sourceLifecycleBoundary: "UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY", categoryKey: "Fuels/Gaseous fuels/Butane" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ directFactorId: "A", wttFactorId: "B" });
  });

  it("does not warn when only a direct factor, only a WTT factor, or different categories are selected", () => {
    expect(
      detectDoubleCounting([{ externalFactorId: "A", sourceLifecycleBoundary: "DIRECT_COMBUSTION", categoryKey: "X" }]),
    ).toHaveLength(0);
    expect(
      detectDoubleCounting([{ externalFactorId: "B", sourceLifecycleBoundary: "UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY", categoryKey: "X" }]),
    ).toHaveLength(0);
    expect(
      detectDoubleCounting([
        { externalFactorId: "A", sourceLifecycleBoundary: "DIRECT_COMBUSTION", categoryKey: "X" },
        { externalFactorId: "B", sourceLifecycleBoundary: "UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY", categoryKey: "Y" },
      ]),
    ).toHaveLength(0);
  });
});

describe("real-file format regression", () => {
  it("parses and validates the first 50 rows of the staged uk_desnz_2026_lca_recommended.csv without error", () => {
    const filePath = path.join(process.cwd(), "data/lci-import/uk-desnz-2026/uk_desnz_2026_lca_recommended.csv");
    const text = fs.readFileSync(filePath, "utf-8");
    const lines = text.split(/\r?\n/);
    const slice = [lines[0], ...lines.slice(1, 51)].join("\n");
    const rows = parseLciCsv(slice);
    expect(rows.length).toBeGreaterThan(0);
    const { importable, rejected } = validateLciRows(rows);
    // Every row in the LCA-recommended file is ACTIVE_PUBLIC + ALLOW_WITH_ATTRIBUTION.
    expect(rejected).toHaveLength(0);
    expect(importable.length).toBe(rows.length);
    for (const r of importable) {
      expect(r.numeratorUnit).toBe("kg CO2e");
      expect(Number.isFinite(r.factorValue)).toBe(true);
    }
  });
});
