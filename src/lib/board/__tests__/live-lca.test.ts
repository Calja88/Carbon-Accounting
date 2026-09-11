/**
 * BD07: live-lca.ts is a thin, testable wiring layer over already-tested
 * primitives (`requireAssessmentInScope` has its own tenant-adversarial
 * suite in lca-repository.test.ts; the comparability judgment itself is
 * covered in live-lca-helpers.test.ts). This file only proves the wiring:
 * permission/tenant denial maps to `null`, never a partial or fabricated
 * model, and a fully comparable pair produces the expected shape.
 */
import { describe, expect, it, vi } from "vitest";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

const canViewLca = vi.fn((..._args: unknown[]) => true);
vi.mock("@/lib/rbac/authorize", async (original) => ({
  ...await original<typeof import("@/lib/rbac/authorize")>(),
  hasPermission: (...args: unknown[]) => canViewLca(...args),
}));

const requireAssessmentInScope = vi.fn((..._args: unknown[]): unknown => undefined);
vi.mock("@/lib/repositories/lca-repository", () => ({
  requireAssessmentInScope: (...args: unknown[]) => requireAssessmentInScope(...args),
}));

const getLatestRun = vi.fn((..._args: unknown[]): unknown => undefined);
const isCalculationStale = vi.fn((..._args: unknown[]): unknown => undefined);
vi.mock("@/lib/lca/calculation-service", () => ({
  getLatestRun: (...args: unknown[]) => getLatestRun(...args),
  isCalculationStale: (...args: unknown[]) => isCalculationStale(...args),
  resultsToAnalysisRows: () => [],
  runTotals: (run: { totals: { headlinePerFunctionalUnitKgCo2e: number } }) => run.totals,
}));

vi.mock("@/lib/lca/analysis", () => ({ contributionsByStage: () => [], compareScenario: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lcaProcess: { findMany: vi.fn(async () => []) },
    lcaInventoryItem: { count: vi.fn(async () => 0) },
    lcaAssessment: { findMany: vi.fn(async () => []) },
  },
}));

const { getLcaScenarioModel } = await import("@/lib/board/live-lca");

const context = {} as never;

const baseAssessment = {
  id: "assessment-baseline",
  reference: "PCF-001",
  title: "Card baseline",
  functionalUnitUnit: "card",
  functionalUnitDescription: "1 card",
  isDeclaredUnit: false,
  functionalUnitQuantity: { toString: () => "1" },
  boundary: "CRADLE_TO_GATE",
  isScenario: false,
  baselineAssessmentId: null,
};

const scenarioAssessment = {
  ...baseAssessment,
  id: "assessment-scenario",
  reference: "PCF-001-S1",
  title: "Card scenario",
  isScenario: true,
  baselineAssessmentId: "assessment-baseline",
};

describe("getLcaScenarioModel", () => {
  it("denies without lca.view — never a partial model for an unauthorised caller", async () => {
    canViewLca.mockReturnValueOnce(false);
    await expect(getLcaScenarioModel(context, "assessment-scenario")).resolves.toBeNull();
    expect(requireAssessmentInScope).not.toHaveBeenCalled();
  });

  it("returns null when the scenario itself is out of tenant/permission scope", async () => {
    requireAssessmentInScope.mockRejectedValueOnce(new TenantOwnershipError());
    await expect(getLcaScenarioModel(context, "foreign-assessment")).resolves.toBeNull();
  });

  it("returns null for a non-scenario assessment (no baseline to compare against)", async () => {
    requireAssessmentInScope.mockResolvedValueOnce(baseAssessment);
    await expect(getLcaScenarioModel(context, baseAssessment.id)).resolves.toBeNull();
  });

  it("returns null when the scenario's own baseline is out of scope", async () => {
    requireAssessmentInScope.mockResolvedValueOnce(scenarioAssessment).mockRejectedValueOnce(new TenantOwnershipError());
    await expect(getLcaScenarioModel(context, scenarioAssessment.id)).resolves.toBeNull();
  });

  it("builds a comparable model from matching, fresh baseline/scenario runs", async () => {
    requireAssessmentInScope.mockResolvedValueOnce(scenarioAssessment).mockResolvedValueOnce(baseAssessment);
    getLatestRun
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.12 }, results: [], engineVersion: "1.0.0", methodologyVersion: null, methodologySnapshot: { mode: "AUTOMATIC" } })
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.102 }, results: [], engineVersion: "1.0.0", methodologyVersion: null, methodologySnapshot: { mode: "AUTOMATIC" } });
    isCalculationStale.mockResolvedValueOnce({ stale: false, reason: null }).mockResolvedValueOnce({ stale: false, reason: null });

    const model = await getLcaScenarioModel(context, scenarioAssessment.id);
    expect(model).not.toBeNull();
    expect(model!.comparable).toBe(true);
    expect(model!.reason).toBeNull();
    expect(model!.baseline.kgPerUnit).toBe(0.12);
    expect(model!.scenario.kgPerUnit).toBe(0.102);
    expect(model!.boundary).toBe("Cradle to gate");
  });

  it("marks a boundary mismatch not comparable, without silently converting", async () => {
    requireAssessmentInScope
      .mockResolvedValueOnce({ ...scenarioAssessment, boundary: "CRADLE_TO_GRAVE" })
      .mockResolvedValueOnce(baseAssessment);
    getLatestRun
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.12 }, results: [] })
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.102 }, results: [] });
    isCalculationStale.mockResolvedValueOnce({ stale: false, reason: null }).mockResolvedValueOnce({ stale: false, reason: null });

    const model = await getLcaScenarioModel(context, scenarioAssessment.id);
    expect(model!.comparable).toBe(false);
    expect(model!.reason).toMatch(/System boundaries differ/);
  });

  it("marks an engine-version mismatch not comparable — real wiring, not just the pure helper", async () => {
    requireAssessmentInScope.mockResolvedValueOnce(scenarioAssessment).mockResolvedValueOnce(baseAssessment);
    getLatestRun
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.12 }, results: [], engineVersion: "1.0.0", methodologyVersion: null, methodologySnapshot: { mode: "AUTOMATIC" } })
      .mockResolvedValueOnce({ totals: { headlinePerFunctionalUnitKgCo2e: 0.102 }, results: [], engineVersion: "2.0.0", methodologyVersion: null, methodologySnapshot: { mode: "AUTOMATIC" } });
    isCalculationStale.mockResolvedValueOnce({ stale: false, reason: null }).mockResolvedValueOnce({ stale: false, reason: null });

    const model = await getLcaScenarioModel(context, scenarioAssessment.id);
    expect(model!.comparable).toBe(false);
    expect(model!.reason).toMatch(/engine versions differ/i);
  });
});
