import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertDisposableFactorTarget } from "./disposable-target";

const root = path.resolve(import.meta.dirname, "../..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(path.join(root, "prisma/migrations/20260915160000_official_factor_publication_contracts/migration.sql"), "utf8");
describe("additive publication schema", () => {
  it("uses only additive top-level DDL, including new integrity functions/triggers", () => {
    const ddl = migration.replace(/--[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$/g, "'FUNCTION_BODY'");
    const statements = ddl.split(";").map(s => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(100);
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE (?:TABLE|TYPE|(?:UNIQUE )?INDEX|FUNCTION|(?:CONSTRAINT )?TRIGGER|EXTENSION)|ALTER TABLE [\w".]+\s+ADD )/);
      expect(statement).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/);
    }
  });
  it("keeps old runtime columns and adds nullable metadata without a backfill/default", () => {
    expect(migration).toMatch(/ADD COLUMN\s+"officialManagement" "of_set_management"/);
    expect(migration).not.toMatch(/"officialManagement"[^;]*NOT NULL/);
    expect(migration).not.toMatch(/"officialManagement"[^;]*DEFAULT/);
    expect(schema).toMatch(/co2eFactor\s+Decimal\s+@db.Decimal\(18, 8\)/);
    expect(schema).toContain('@@unique([factorSetId, category, subtypeKey, basis])');
  });
  it("uses LF and explicitly short PostgreSQL object names", () => {
    expect(migration).not.toContain("\r");
    const names = [...migration.matchAll(/\b(?:CONSTRAINT|(?:UNIQUE )?INDEX|FUNCTION|TRIGGER|TABLE|TYPE)\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(100);
    for (const name of names) expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
  });
  it("does not collide enum names with PostgreSQL table row types", () => {
    const tables = [...migration.matchAll(/CREATE TABLE "(\w+)"/g)].map(m => m[1]);
    const enums = [...migration.matchAll(/CREATE TYPE "(\w+)"/g)].map(m => m[1]);
    for (const name of enums) expect(tables).not.toContain(name);
  });
  it("retains every design model and enum value, including CO2e measures", () => {
    const doc = readFileSync(path.join(root, "Docs/PHASE3_V_FACTOR_PUBLICATION_SCHEMA.md"), "utf8");
    for (const match of doc.matchAll(/^\| `(\w+)` \/ `of_\w+` \|/gm)) expect(schema).toContain(`model ${match[1]} {`);
    const enums = doc.slice(doc.indexOf("## 4. Enum definitions"), doc.indexOf("## 5."));
    for (const match of enums.matchAll(/^\| `(Official\w+)` \| (.+)$/gm)) {
      const body = new RegExp(`enum ${match[1]} \\{([\\s\\S]*?)\\}`).exec(schema)?.[1];
      expect(body).toBeDefined();
      for (const value of match[2].matchAll(/`([A-Z0-9_]+)`/g)) expect(body).toMatch(new RegExp(`\\b${value[1]}\\b`));
    }
  });
  it("includes null-safe key verification, immutable sealing and exclusion", () => {
    for (const term of ["of_factor_lookup_uq", "of_mf_lookup_uq", "of_subtype_key", "of_requirement_key_ck", "of_num_pair_ck", "of_item_value_ck", "of_manifest_seal_complete_trg", "of_window_no_overlap_excl"]) expect(migration).toContain(term);
  });
});

describe("production/shared-target refusal before connecting", () => {
  const now = Date.parse("2026-09-15T15:00:00Z");
  const receipt = {
    projectId: "cool-cake-20837205", branchId: "br-synthetic-child", parentBranchId: "br-cold-grass-aroam3e1",
    branchName: "phase3vi-contracts-synthetic", endpointId: "ep-synthetic-test-ar123",
    directUrl: "postgresql://test:test@ep-synthetic-test-ar123.c-4.us-west-2.aws.neon.tech/test?sslmode=require",
    pooledUrl: "postgresql://test:test@ep-synthetic-test-ar123-pooler.c-4.us-west-2.aws.neon.tech/test?sslmode=require",
    createdAt: "2026-09-15T14:00:00Z", expiresAt: "2026-09-16T14:00:00Z",
  };
  it("accepts an explicit fresh disposable receipt", () => expect(assertDisposableFactorTarget(receipt, now).branchId).toBe(receipt.branchId));
  it.each([
    { projectId: "twilight-breeze-25854149" }, { branchId: "br-cold-grass-aroam3e1" }, { branchName: "phase2a-preview-2026-09-14" },
    { directUrl: "postgresql://secret:secret@ep-production.c-5.us-east-2.aws.neon.tech/prod" },
    { pooledUrl: "" }, { expiresAt: "2026-09-14T00:00:00Z" }, { endpointId: "ep-other-test-ar456" },
  ])("refuses %j without printing credentials", change => {
    let message = "";
    try { assertDisposableFactorTarget({ ...receipt, ...change }, now); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/receipt|stale|mismatch/); expect(message).not.toContain("secret"); expect(message).not.toContain("postgresql://");
  });
});
