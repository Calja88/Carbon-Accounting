import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { assertPeriodAllowsMutation, ReportingPeriodClosedError, isReportingPeriodClosedError } from "../reporting-period-guard";
import { makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

describe("reporting period domain error contract", () => {
  const ctx = makeTenantContext("synthetic-org");
  const date = new Date("2040-06-30T23:59:59Z");

  it("delegates to the authoritative SQL rule using bound accounting context", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    await assertPeriodAllowsMutation({ $queryRaw } as unknown as Prisma.TransactionClient, ctx, "site-1", date);
    expect($queryRaw.mock.calls[0].slice(1)).toEqual([ctx.organisationId, "site-1", date, date]);
    expect($queryRaw.mock.calls[0][0].join("")).toContain("carbon_assert_period_allows_mutation");
  });

  it("maps PostgreSQL rejection to a stable domain error", async () => {
    const $queryRaw = vi.fn().mockRejectedValue(new Error("Prisma: REPORTING_PERIOD_CLOSED: period is closed"));
    await expect(assertPeriodAllowsMutation({ $queryRaw } as unknown as Prisma.TransactionClient, ctx, "site-1", date)).rejects.toMatchObject({
      name: "ReportingPeriodClosedError", code: "REPORTING_PERIOD_CLOSED",
    });
    expect(isReportingPeriodClosedError(new ReportingPeriodClosedError())).toBe(true);
  });

  it("never mistakes a database failure for an allowed mutation or a closed-period skip", async () => {
    const error = new Error("database unavailable");
    const $queryRaw = vi.fn().mockRejectedValue(error);
    await expect(assertPeriodAllowsMutation({ $queryRaw } as unknown as Prisma.TransactionClient, ctx, "site-1", date)).rejects.toBe(error);
    expect(isReportingPeriodClosedError(error)).toBe(false);
    expect(isReportingPeriodClosedError(null)).toBe(false);
  });
});
