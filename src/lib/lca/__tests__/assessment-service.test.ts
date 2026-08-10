import { beforeEach, describe, expect, it, vi } from "vitest";

// buildVersionPayload is the freezing step behind issueVersion: it snapshots
// the live assessment (plus its collaborators' state) into the payload that
// gets written onto an LcaAssessmentVersion. Every collaborator here is
// mocked with synthetic fixtures so the suite needs no database at all.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lcaAssumption: { findMany: vi.fn().mockResolvedValue([]) },
    lcaExclusion: { findMany: vi.fn().mockResolvedValue([]) },
    lcaEvidence: { findMany: vi.fn().mockResolvedValue([]) },
    lcaVerification: { findMany: vi.fn().mockResolvedValue([]) },
    lcaCorporateDataLink: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/lca/calculation-service", () => ({
  loadAssessmentOrThrow: vi.fn(),
  getLatestRun: vi.fn().mockResolvedValue(null),
  isCalculationStale: vi.fn().mockResolvedValue({ stale: false, reason: null }),
  resultsToAnalysisRows: vi.fn().mockReturnValue([]),
  runTotals: vi.fn(),
}));

vi.mock("@/lib/lca/validation-service", () => ({
  runValidation: vi.fn().mockResolvedValue({ issues: [], errorCount: 0, warningCount: 0, advisoryCount: 0 }),
}));

vi.mock("@/lib/lca/readiness-service", () => ({
  buildReadinessReport: vi.fn().mockResolvedValue({ overall: "NOT_READY", checks: [] }),
}));

vi.mock("@/lib/lca/methodology", () => ({
  toMethodologyConfig: vi.fn().mockReturnValue(null),
}));

import { loadAssessmentOrThrow } from "@/lib/lca/calculation-service";
import { buildVersionPayload } from "@/lib/lca/assessment-service";

function assessmentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "assessment-1",
    methodologyProfile: null,
    reference: "PCF-TEST-001",
    title: "Original title",
    headlinePerFunctionalUnitKgCo2e: 6.88,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(loadAssessmentOrThrow).mockReset();
});

// ---------------------------------------------------------------------------
// Regression invariant L-04: an issued LCA version is frozen. buildVersionPayload
// is the mechanism behind issueVersion that snapshots the live assessment —
// editing the live record afterwards must never reach into an already-built
// payload.
// ---------------------------------------------------------------------------

describe("issued version payload is frozen (invariant L-04)", () => {
  it("deep-clones the assessment into the payload, unaffected by a later live edit to the same record", async () => {
    const liveAssessment = assessmentFixture();
    vi.mocked(loadAssessmentOrThrow).mockResolvedValue(liveAssessment as never);

    const payload = await buildVersionPayload("assessment-1");

    // Someone edits the live assessment after the version payload was built
    // (this is exactly what "issued version is frozen" guards against).
    (liveAssessment as { title: string }).title = "Edited after issuing";
    (liveAssessment as { headlinePerFunctionalUnitKgCo2e: number }).headlinePerFunctionalUnitKgCo2e = 999;

    expect((payload.assessment as { title: string }).title).toBe("Original title");
    expect((payload.assessment as { headlinePerFunctionalUnitKgCo2e: number }).headlinePerFunctionalUnitKgCo2e).toBe(
      6.88,
    );
  });

  it("produces independent payloads across two calls, so an earlier issued version cannot be mutated by a later one", async () => {
    vi.mocked(loadAssessmentOrThrow).mockResolvedValueOnce(assessmentFixture({ title: "Version 1 state" }) as never);
    const first = await buildVersionPayload("assessment-1");

    vi.mocked(loadAssessmentOrThrow).mockResolvedValueOnce(assessmentFixture({ title: "Version 2 state" }) as never);
    const second = await buildVersionPayload("assessment-1");

    expect((first.assessment as { title: string }).title).toBe("Version 1 state");
    expect((second.assessment as { title: string }).title).toBe("Version 2 state");
    expect(first.assessment).not.toBe(second.assessment);
  });
});
