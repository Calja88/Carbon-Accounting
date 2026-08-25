/**
 * UI13 dashboard aggregation tests. No live database and no real
 * environmental data — every underlying read service is mocked so these
 * tests stay focused on what this module actually owns: composing the
 * figures those reads return, and gating a section on permission before
 * calling its read. The individual reads (tenancy, RBAC, correctness of the
 * numbers they return) are covered by their own module's test suite.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { PermissionCode } from "@/lib/rbac/permission-catalogue";

vi.mock("@/lib/ems/legal/evaluation-service", () => ({
  listOverdueOrUnevaluatedObligations: vi.fn(async () => [{}, {}]),
}));
vi.mock("@/lib/ems/controls/control-service", () => ({
  listSignificantAspectControlGaps: vi.fn(async () => [{}]),
}));
vi.mock("@/lib/ems/actions/action-service", () => ({
  listActionDashboard: vi.fn(async () => [{ overdue: true }, { overdue: false }]),
}));
vi.mock("@/lib/ems/audits/audit-service", () => ({
  listEmsAudits: vi.fn(async () => [{ status: "IN_PROGRESS" }, { status: "PLANNED" }]),
}));
vi.mock("@/lib/ems/nonconformity/nonconformity-service", () => ({
  listNonconformities: vi.fn(async () => [{ status: "OPEN" }, { status: "CLOSED" }]),
}));
vi.mock("@/lib/ems/incidents/incident-service", () => ({
  listEnvironmentalIncidents: vi.fn(async () => [
    { status: "REPORTED", reportedAt: new Date() },
    { status: "CLOSED", reportedAt: new Date(0) },
  ]),
}));
vi.mock("@/lib/ems/competence/gap-service", () => ({
  listCompetenceGaps: vi.fn(async () => [
    { severity: "GAP" },
    { severity: "OVERDUE" },
    { severity: "EXPIRED" },
  ]),
}));
vi.mock("@/lib/ems/competence/assignment-service", () => ({
  listCompetenceAssignments: vi.fn(async () => [
    { status: "COMPETENT", competentUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) },
    { status: "COMPETENT", competentUntil: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000) },
  ]),
}));
vi.mock("@/lib/ems/review/review-service", () => ({
  listManagementReviews: vi.fn(async () => [{ id: "review-1", status: "PLANNED", scheduledDate: new Date() }]),
  listOpenPriorActions: vi.fn(async () => [{}]),
}));
vi.mock("@/lib/ems/review/minutes-service", () => ({
  listManagementReviewDecisions: vi.fn(async () => [{}, {}]),
}));
vi.mock("@/lib/documents/document-control-service", () => ({
  listControlledDocuments: vi.fn(async () => [
    { currentRevision: { status: "EFFECTIVE" } },
    { currentRevision: { status: "DRAFT" } },
  ]),
}));
vi.mock("@/lib/documents/evidence-service", () => ({
  listEvidenceObjects: vi.fn(async () => [{}, {}, {}]),
  activeEvidenceStorageProviderName: vi.fn(() => "database"),
}));
vi.mock("@/lib/notifications/notification-service", () => ({
  listMyNotifications: vi.fn(async () => [{}, {}]),
}));

const { getEmsDashboardSummary } = await import("@/lib/ems/dashboard/dashboard-service");

const ALL_PERMISSIONS = new Set(["ems.view", "ems.competence.view", "ems.export"]) as unknown as Set<PermissionCode>;

describe("getEmsDashboardSummary", () => {
  it("composes every section from the underlying reads when the caller has full view permission", async () => {
    const context = makeOrganisationContext(ORG_A, { permissions: ALL_PERMISSIONS });
    const summary = await getEmsDashboardSummary(context);

    expect(summary.compliance).toEqual({ available: true, data: { overdueOrUnevaluatedCount: 2 } });
    expect(summary.aspects).toEqual({ available: true, data: { controlGapCount: 1 } });
    expect(summary.objectives).toEqual({ available: true, data: { openActionCount: 2, overdueActionCount: 1 } });
    expect(summary.audits.available).toBe(true);
    if (summary.audits.available) {
      expect(summary.audits.data.totalAudits).toBe(2);
      expect(summary.audits.data.byStatus).toEqual({ IN_PROGRESS: 1, PLANNED: 1 });
    }
    expect(summary.nonconformities).toEqual({
      available: true,
      data: { openCount: 1, byStatus: { OPEN: 1, CLOSED: 1 } },
    });
    expect(summary.incidents.available).toBe(true);
    if (summary.incidents.available) {
      expect(summary.incidents.data.openCount).toBe(1);
      expect(summary.incidents.data.last90DaysCount).toBe(1);
    }
    expect(summary.competence).toEqual({
      available: true,
      data: { gapCount: 1, overdueCount: 1, expiredCount: 1, expiringWithin60DaysCount: 1 },
    });
    expect(summary.managementReview.available).toBe(true);
    if (summary.managementReview.available) {
      expect(summary.managementReview.data.latestStatus).toBe("PLANNED");
      expect(summary.managementReview.data.openPriorActionCount).toBe(1);
      expect(summary.managementReview.data.latestDecisionCount).toBe(2);
    }
    expect(summary.documents).toEqual({
      available: true,
      data: {
        totalControlled: 2,
        effectiveCount: 1,
        inReviewOrDraftCount: 1,
        evidenceObjectCount: 3,
        activeStorageProvider: "database",
      },
    });
    expect(summary.notifications).toEqual({ available: true, data: { pendingCount: 2 } });
  });

  it("marks every ems.view-gated section unavailable for a caller without ems.view, without calling the underlying reads", async () => {
    const { listOverdueOrUnevaluatedObligations } = await import("@/lib/ems/legal/evaluation-service");
    vi.mocked(listOverdueOrUnevaluatedObligations).mockClear();

    const context = makeOrganisationContext(ORG_A, { permissions: new Set() as unknown as Set<PermissionCode> });
    const summary = await getEmsDashboardSummary(context);

    expect(summary.compliance).toEqual({ available: false, reason: "NO_PERMISSION" });
    expect(summary.audits).toEqual({ available: false, reason: "NO_PERMISSION" });
    expect(summary.managementReview).toEqual({ available: false, reason: "NO_PERMISSION" });
    expect(summary.notifications).toEqual({ available: false, reason: "NO_PERMISSION" });
    expect(listOverdueOrUnevaluatedObligations).not.toHaveBeenCalled();
  });

  it("gates competence separately on ems.competence.view", async () => {
    const context = makeOrganisationContext(ORG_A, {
      permissions: new Set(["ems.view"]) as unknown as Set<PermissionCode>,
    });
    const summary = await getEmsDashboardSummary(context);

    expect(summary.competence).toEqual({ available: false, reason: "NO_PERMISSION" });
    expect(summary.compliance).toEqual({ available: true, data: { overdueOrUnevaluatedCount: 2 } });
  });

  it("reports no scheduled review without calling per-review reads", async () => {
    const { listManagementReviews, listOpenPriorActions } = await import("@/lib/ems/review/review-service");
    vi.mocked(listManagementReviews).mockResolvedValueOnce([]);
    vi.mocked(listOpenPriorActions).mockClear();

    const context = makeOrganisationContext(ORG_A, { permissions: ALL_PERMISSIONS });
    const summary = await getEmsDashboardSummary(context);

    expect(summary.managementReview).toEqual({
      available: true,
      data: { latestStatus: null, latestScheduledDate: null, openPriorActionCount: null, latestDecisionCount: null },
    });
    expect(listOpenPriorActions).not.toHaveBeenCalled();
  });
});
