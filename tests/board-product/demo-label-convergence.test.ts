/**
 * The BOARD demo's user-facing labels, after commit 3e94741 moved them from
 * "BOARD-1" to "Demo".
 *
 * Asserted against the convergence rules themselves — no database — so a
 * change that would put the old wording back, rename something technical,
 * reach into immutable history, or make the alignment non-idempotent fails
 * here rather than on the demo screen. The live database is converged by
 * `pnpm run db:board-demo:align-catalogue`, whose own target guard is covered
 * in `demo-db-target-guard.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_LABEL_PREFIX,
  DISPLAY_LITERALS,
  TRACKED_COUNTS,
  demoDataPointName,
  demoDisplayCategory,
} from "../../scripts/board-demo/demo-label-fixture";
import { assertDemoDatabaseTarget } from "../../scripts/board-demo/db-target-guard";

/** Every source key the fixture's catalogue rows are named for. */
const SOURCE_KEYS = ["gas", "fleet", "electricity", "substrate", "services", "consumables", "travel", "commuting"];

/** The fixture's `factorCategory` values — the emission-factor lookup keys. */
const FACTOR_CATEGORIES = [
  "stationary_combustion_natural_gas",
  "mobile_combustion_fuel",
  "grid_electricity",
  "board1_purchased_goods",
  "board1_purchased_services",
  "board1_purchased_consumables",
  "board1_business_travel",
  "board1_employee_commuting",
];

describe("data-entry source names", () => {
  it("renames every BOARD-1 source to Demo <source>", () => {
    for (const key of SOURCE_KEYS) {
      expect(demoDataPointName(`BOARD-1 ${key}`)).toBe(`Demo ${key}`);
    }
  });

  it("is idempotent — a second run finds nothing to do", () => {
    for (const key of SOURCE_KEYS) {
      const once = demoDataPointName(`BOARD-1 ${key}`);
      expect(demoDataPointName(once)).toBe(once);
    }
  });

  it("leaves a name that never carried the prefix alone", () => {
    // The shared catalogue (prisma/seed/activity-data-points.ts) lives in the
    // same table; only the fixture's own BOARD1-* rows are in scope, and even
    // within those a non-matching name must pass through untouched.
    expect(demoDataPointName("Grid electricity consumption")).toBe("Grid electricity consumption");
    expect(demoDataPointName("Natural gas — facilities")).toBe("Natural gas — facilities");
  });

  it("only rewrites a leading prefix, never a BOARD-1 mention inside the name", () => {
    expect(demoDataPointName("Metered BOARD-1 gas")).toBe("Metered BOARD-1 gas");
  });
});

describe("display category", () => {
  it("drops the board1_ scaffolding prefix from the label a user reads", () => {
    expect(demoDisplayCategory("board1_purchased_goods")).toBe("purchased goods");
    expect(demoDisplayCategory("board1_business_travel")).toBe("business travel");
    expect(demoDisplayCategory("board1_employee_commuting")).toBe("employee commuting");
  });

  it("leaves a category that never carried the prefix unchanged apart from word spacing", () => {
    expect(demoDisplayCategory("grid_electricity")).toBe("grid electricity");
    expect(demoDisplayCategory("stationary_combustion_natural_gas")).toBe("stationary combustion natural gas");
  });

  it("strips only a leading board1_, never one in the middle of the key", () => {
    expect(demoDisplayCategory("purchased_board1_goods")).toBe("purchased board1 goods");
  });

  it("keeps every category distinct, so Scope 3 coverage cannot collapse into one bucket", () => {
    const labels = FACTOR_CATEGORIES.map(demoDisplayCategory);
    expect(new Set(labels).size).toBe(FACTOR_CATEGORIES.length);
  });

  it("is derived from the lookup key, so it is stable across runs", () => {
    for (const category of FACTOR_CATEGORIES) {
      expect(demoDisplayCategory(category)).toBe(demoDisplayCategory(category));
    }
  });

  it("exposes no BOARD-1 wording at all", () => {
    for (const category of FACTOR_CATEGORIES) {
      expect(demoDisplayCategory(category)).not.toMatch(/board[-_ ]?1/i);
    }
  });
});

describe("one-off display literals", () => {
  const find = (table: string, column: string) =>
    DISPLAY_LITERALS.find((literal) => literal.table === table && literal.column === column);

  it("renames the factor set shown on /admin/factors", () => {
    expect(find("EmissionFactorSet", "name")).toMatchObject({
      before: "BOARD-1 demo factors — not for reporting",
      after: "Demo factors — not for reporting",
    });
  });

  it("renames the EMS, compliance, audit programme and agenda headings", () => {
    expect(find("EmsProgramme", "name")?.after).toBe("Demo programme");
    expect(find("ComplianceEvaluationProgramme", "name")?.after).toBe("Demo compliance evaluation programme");
    expect(find("AuditProgramme", "name")?.after).toBe("Demo internal audit programme");
    expect(find("ManagementReviewAgendaTemplate", "name")?.after).toBe("Demo agenda");
  });

  it("renames the audit title and the cited LCA factor source", () => {
    expect(find("EmsAudit", "title")?.after).toBe("Demo internal audit");
    expect(find("LcaInventoryItem", "manualFactorSource")?.after).toBe("Demo — not for reporting");
  });

  it("leaves no BOARD-1 wording in anything it writes", () => {
    for (const literal of DISPLAY_LITERALS) {
      expect(literal.before).toMatch(/BOARD-1/);
      expect(literal.after).not.toMatch(/board[-_ ]?1/i);
    }
  });

  it("is idempotent — no replacement contains the value it replaces", () => {
    for (const literal of DISPLAY_LITERALS) {
      expect(literal.after).not.toContain(literal.before);
      expect(literal.before).not.toBe(literal.after);
    }
  });

  it("targets one column per table/column pair, so a rerun cannot double-apply", () => {
    const pairs = DISPLAY_LITERALS.map((l) => `${l.table}.${l.column}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("immutable history and technical identity", () => {
  /**
   * The hash-chained and sealed records. `AuditEvent` is chained on
   * `contentHash`/`previousEventHash`; the ISSUED `ManagementReviewPack` has
   * its `checksumSha256` re-verified against its payload on every read; the
   * frozen audit-report and closure snapshots are the record of what was
   * actually issued. All of them still say "BOARD-1", and must keep saying it.
   */
  const IMMUTABLE_TABLES = [
    "AuditEvent",
    "ManagementReviewPack",
    "AuditReportRevision",
    "NonconformityClosure",
    "ComplianceEvaluationRevision",
    "DemoFixtureLease",
    "DemoDatabaseManifest",
  ];

  it("never writes to a hash-chained, sealed or fixture-identity table", () => {
    for (const literal of DISPLAY_LITERALS) {
      expect(IMMUTABLE_TABLES).not.toContain(literal.table);
    }
  });

  it("writes only name, title and cited-source columns — never a key, figure, status or checksum", () => {
    const allowed = ["name", "title", "manualFactorSource"];
    for (const literal of DISPLAY_LITERALS) {
      expect(allowed).toContain(literal.column);
    }
  });

  it("rewrites a prefix that no technical identifier carries", () => {
    // Every retained identifier is either "BOARD1-"/"board1_" (no space) or
    // a persona name the lookups key off — none of which this prefix matches.
    expect(DEMO_LABEL_PREFIX.from).toBe("BOARD-1 ");
    for (const identifier of [
      "BOARD-1", // BOARD1.fixtureVersion / DemoFixtureLease.fixtureKey / buildPriority
      "BOARD1-grid_electricity",
      "board1_purchased_goods",
      "board-1-northstar-demonstration",
      "BOARD-1:north-works:2026-01:gas",
      "BOARD1-LCA-001",
      "BOARD1-PACK-2026-Q3",
      "BOARD1-CA-EXT",
      "board1-agenda",
      "BOARD-1-invoice.txt",
    ]) {
      expect(demoDataPointName(identifier)).toBe(identifier);
    }
  });

  it("does not rename the persona identities every lookup keys off", () => {
    // run.ts derives the rehearsal manifest's persona keys from these, and
    // align-demo-catalogue.ts, the probes and six test files find them by name.
    for (const persona of ["BOARD-1 sustainability-lead", "BOARD-1 independent-reviewer", "BOARD-1 suspended"]) {
      expect(DISPLAY_LITERALS.some((l) => l.before === persona)).toBe(false);
    }
  });
});

describe("data preservation", () => {
  it("tracks every accounting table the convergence must not move", () => {
    for (const model of [
      "activityEntry", "calculation", "activityDataPoint", "emissionFactorSet",
      "organisationSourceConfig", "carbonCollectionRequirement", "product", "lcaAssessment",
    ]) {
      expect(TRACKED_COUNTS).toContain(model);
    }
  });

  it("tracks the immutable record counts too, so a rename cannot append to history", () => {
    expect(TRACKED_COUNTS).toContain("auditEvent");
    expect(TRACKED_COUNTS).toContain("managementReviewPack");
  });
});

describe("the convergence refuses anything but the approved demo target", () => {
  // Full coverage lives in demo-db-target-guard.test.ts; this is the one
  // assertion that ties that guard to this script's own call site.
  it("refuses the known production database", () => {
    expect(() =>
      assertDemoDatabaseTarget({
        APP_DATA_MODE: "synthetic",
        BOARD_DEMO_DATA_MODE: "synthetic",
        BOARD_DEMO_DEPLOYMENT_CLASS: "private-demo",
        BOARD_DEMO_DATABASE_ID: "twilight-breeze-25854149",
        BOARD_DEMO_ALLOWED_DATABASE_ID: "twilight-breeze-25854149",
        BOARD_DEMO_ENVIRONMENT_ID: "board-demo-local-2026-09-11",
        DATABASE_URL: "postgresql://neondb_owner:pw@ep-prod.example.neon.tech/neondb?sslmode=require",
        DIRECT_URL: "postgresql://neondb_owner:pw@ep-prod.example.neon.tech/neondb?sslmode=require",
      }),
    ).toThrow();
  });
});
