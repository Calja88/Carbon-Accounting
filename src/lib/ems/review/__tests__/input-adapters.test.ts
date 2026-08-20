/**
 * Management review input adapter tests (task T72). No live database —
 * `@/lib/prisma` is replaced with an in-memory fake per source table. Each
 * adapter must resolve only already-issued/frozen source rows (never a
 * draft one) and bake `organisationId` into its own query. All figures are
 * synthetic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  evaluations: [] as Row[],
  reports: [] as Row[],
  correctiveActions: [] as Row[],
  effectivenessReviews: [] as Row[],
  assignments: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const operators = value as { in?: unknown[]; lte?: Date };
      if (operators.in) return operators.in.includes(row[key]);
      if (operators.lte) return (row[key] as Date) <= operators.lte;
      return false;
    }
    return row[key] === value;
  });
}

function findManyModel(rows: Row[]) {
  return {
    findMany: vi.fn(async ({ where, orderBy, take }: { where: Row; orderBy?: Row; take?: number }) => {
      let candidates = rows.filter((r) => matches(r, where));
      if (orderBy) {
        const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
        candidates = [...candidates].sort((a, b) => {
          const av = (a[key] as Date | number) ?? 0;
          const bv = (b[key] as Date | number) ?? 0;
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          return direction === "desc" ? -cmp : cmp;
        });
      }
      return take ? candidates.slice(0, take) : candidates;
    }),
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceEvaluation: findManyModel(tables.evaluations),
    auditReportRevision: findManyModel(tables.reports),
    correctiveAction: findManyModel(tables.correctiveActions),
    effectivenessReview: findManyModel(tables.effectivenessReviews),
    competenceAssignment: findManyModel(tables.assignments),
  },
}));

const { complianceEvaluationAdapter } = await import("@/lib/ems/review/input-adapters/compliance-evaluation");
const { auditReportAdapter } = await import("@/lib/ems/review/input-adapters/audit-report");
const { correctiveActionAdapter } = await import("@/lib/ems/review/input-adapters/corrective-action");
const { competenceGapAdapter } = await import("@/lib/ems/review/input-adapters/competence-gap");

const ctxA = makeTenantContext(ORG_A);
const CUTOFF = new Date("2026-06-15");

beforeEach(() => {
  tables.evaluations.length = 0;
  tables.reports.length = 0;
  tables.correctiveActions.length = 0;
  tables.effectivenessReviews.length = 0;
  tables.assignments.length = 0;
});

describe("complianceEvaluationAdapter", () => {
  it("resolves only ISSUED evaluations at or before the cutoff, tenant-scoped", async () => {
    tables.evaluations.push(
      { id: "eval-issued", organisationId: ORG_A, status: "ISSUED", issuedAt: new Date("2026-06-01"), periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-01"), programmeId: "programme-1" },
      { id: "eval-draft", organisationId: ORG_A, status: "IN_PROGRESS", issuedAt: null, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-01"), programmeId: "programme-1" },
      { id: "eval-future", organisationId: ORG_A, status: "ISSUED", issuedAt: new Date("2026-07-01"), periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-07-01"), programmeId: "programme-1" },
      { id: "eval-other-org", organisationId: ORG_B, status: "ISSUED", issuedAt: new Date("2026-06-01"), periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-01"), programmeId: "programme-b" },
    );

    const results = await complianceEvaluationAdapter.resolveCandidates(ctxA, CUTOFF);
    expect(results.map((r) => r.sourceRecordId)).toEqual(["eval-issued"]);
    expect(results[0].sourceType).toBe("COMPLIANCE_EVALUATION");
  });
});

describe("auditReportAdapter", () => {
  it("resolves only ISSUED report revisions with their revision number as the version label", async () => {
    tables.reports.push(
      { id: "report-issued", organisationId: ORG_A, status: "ISSUED", auditId: "audit-1", revisionNumber: 2, issuedAt: new Date("2026-05-01"), checksumSha256: "abc" },
      { id: "report-draft", organisationId: ORG_A, status: "DRAFT", auditId: "audit-2", revisionNumber: 1, issuedAt: null, checksumSha256: null },
    );

    const results = await auditReportAdapter.resolveCandidates(ctxA, CUTOFF);
    expect(results).toHaveLength(1);
    expect(results[0].sourceRecordId).toBe("report-issued");
    expect(results[0].sourceVersionLabel).toBe("revision 2");
  });
});

describe("correctiveActionAdapter", () => {
  it("attaches the most recent effectiveness review result to its corrective action", async () => {
    tables.correctiveActions.push({
      id: "capa-1",
      organisationId: ORG_A,
      nonconformityId: "nc-1",
      status: "VERIFIED",
      updatedAt: new Date("2026-05-01"),
      createdAt: new Date("2026-01-01"),
      dueDate: new Date("2026-02-01"),
    });
    tables.effectivenessReviews.push({
      id: "review-1",
      organisationId: ORG_A,
      nonconformityId: "nc-1",
      reviewDate: new Date("2026-05-15"),
      result: "EFFECTIVE",
    });

    const results = await correctiveActionAdapter.resolveCandidates(ctxA, CUTOFF);
    expect(results).toHaveLength(1);
    expect(results[0].summary.effectivenessResult).toBe("EFFECTIVE");
  });
});

describe("competenceGapAdapter", () => {
  it("resolves assignments currently in GAP or EXPIRED status only", async () => {
    tables.assignments.push(
      { id: "assignment-gap", organisationId: ORG_A, personId: "person-1", requirementVersionId: "req-v1", status: "GAP", gapSince: new Date("2026-03-01"), updatedAt: new Date("2026-03-01") },
      { id: "assignment-competent", organisationId: ORG_A, personId: "person-2", requirementVersionId: "req-v1", status: "COMPETENT", gapSince: null, updatedAt: new Date("2026-03-01") },
    );

    const results = await competenceGapAdapter.resolveCandidates(ctxA, CUTOFF);
    expect(results.map((r) => r.sourceRecordId)).toEqual(["assignment-gap"]);
    expect(results[0].isStale).toBe(false);
  });
});
