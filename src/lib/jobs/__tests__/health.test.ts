/**
 * Tests for the T21 worker health snapshot — asserts it queries
 * organisation-scoped filters for the tenant view and unscoped filters for
 * the platform view, matching "Organisation B records do not affect A
 * dashboard counts" (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §6).
 */

import { describe, expect, it, vi } from "vitest";
import { contextA, ORG_A } from "@/lib/__tests__/tenant-fixtures";

const { outboxCount, jobRunCount } = vi.hoisted(() => ({
  outboxCount: vi.fn(async (args: { where: Record<string, unknown> }) => {
    void args;
    return 0;
  }),
  jobRunCount: vi.fn(async (args: { where: Record<string, unknown> }) => {
    void args;
    return 0;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { outboxMessage: { count: outboxCount }, jobRun: { count: jobRunCount } },
}));

const { getPlatformWorkerHealth, getOrganisationWorkerHealth } = await import("@/lib/jobs/health");

describe("getOrganisationWorkerHealth", () => {
  it("scopes every count query to the caller's organisation", async () => {
    outboxCount.mockClear();
    jobRunCount.mockClear();
    await getOrganisationWorkerHealth(contextA);

    for (const call of outboxCount.mock.calls) {
      expect(call[0].where.organisationId).toBe(ORG_A);
    }
    for (const call of jobRunCount.mock.calls) {
      expect(call[0].where.organisationId).toBe(ORG_A);
    }
  });
});

describe("getPlatformWorkerHealth", () => {
  it("does not filter by organisationId", async () => {
    outboxCount.mockClear();
    jobRunCount.mockClear();
    await getPlatformWorkerHealth();

    for (const call of outboxCount.mock.calls) {
      expect(call[0].where.organisationId).toBeUndefined();
    }
  });

  it("returns the aggregated snapshot shape", async () => {
    outboxCount
      .mockResolvedValueOnce(3) // pending
      .mockResolvedValueOnce(1) // retry
      .mockResolvedValueOnce(2) // stale lease
      .mockResolvedValueOnce(1); // dead letter
    jobRunCount.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

    const snapshot = await getPlatformWorkerHealth();
    expect(snapshot).toEqual({
      pendingCount: 3,
      retryCount: 1,
      staleLeaseCount: 2,
      deadLetterCount: 1,
      recentRunCount: 10,
      recentFailureCount: 4,
    });
  });
});
