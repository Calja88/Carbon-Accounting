/**
 * Carbon Phase 4-i: issuing a report snapshot must be auditable — who
 * issued it, over what period, against how many calculations, and at what
 * headline totals (Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md).
 *
 * The snapshot payload itself is NOT copied into the audit row: a
 * ReportSnapshot is already immutable and durable, so the event identifies
 * it rather than duplicating it.
 *
 * No live database, no live session — synthetic fixtures only.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ORG_A } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  snapshots: [] as Row[],
  audit: [] as Row[],
  nextId: 1,
}));

const PAYLOAD = vi.hoisted(() => ({
  scope1: { totalKgCo2e: 1200.5, byCategory: [] },
  scope2: { locationBasedTotalKgCo2e: 800.25, marketBasedTotalKgCo2e: 640.75, byCategory: [] },
  scope3: { totalKgCo2e: 430, byCategory: [] },
  excludedFlaggedEntries: [{ site: "Aster North", dataPoint: "S1-01", periodLabel: "Jan 2026", reason: "spike" }],
  awaitingFactorEntries: [],
  calculationIds: ["calc-1", "calc-2"],
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/rbac/carbon-access", () => ({ requireFrozenReportAccess: vi.fn() }));
vi.mock("@/lib/rbac/authorize", () => ({
  requirePermission: vi.fn(),
  PermissionDeniedError: class extends Error {},
}));
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: vi.fn(async () => ({
    organisationId: ORG_A,
    userId: "user-1",
    membershipId: "membership-1",
    organisationSlug: "aster",
    correlationId: "corr-report-1",
    permissions: new Set<string>(),
    access: { mode: "ORGANISATION_WIDE", entityIds: new Set(), siteIds: new Set() },
  })),
  OrganisationAccessError: class extends Error {},
}));
vi.mock("@/lib/report-service", () => ({ buildReportPayload: vi.fn(async () => PAYLOAD) }));
vi.mock("@/lib/entries-service", () => ({ prepareReportingData: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const prismaClient: Row = {
    auditEvent: {
      findFirst: vi.fn(async () => tables.audit[tables.audit.length - 1] ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row: Row = { id: `audit-${tables.nextId++}`, ...data };
        tables.audit.push(row);
        return row;
      }),
    },
    reportSnapshot: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row: Row = { id: `snapshot-${tables.nextId++}`, version: 3, ...data };
        tables.snapshots.push(row);
        return row;
      }),
    },
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

const { generateReportAction } = await import("@/app/(app)/reports/actions");

function periodForm(): FormData {
  const form = new FormData();
  form.set("periodStartMonth", "2026-01");
  form.set("periodEndMonth", "2026-01");
  return form;
}

/** The action ends in `redirect()`, which throws by design. */
async function issueReport(): Promise<string> {
  try {
    await generateReportAction({ error: null }, periodForm());
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("generateReportAction did not redirect");
}

describe("Phase 4-i: report snapshot issuance is audited", () => {
  beforeEach(() => {
    tables.snapshots.length = 0;
    tables.audit.length = 0;
    tables.nextId = 1;
  });

  it("emits report_snapshot.issued pointing at the snapshot it issued", async () => {
    const outcome = await issueReport();

    expect(tables.snapshots).toHaveLength(1);
    expect(outcome).toBe(`REDIRECT:/reports/${tables.snapshots[0].id}`);

    const [event] = tables.audit;
    expect(event.eventType).toBe("report_snapshot.issued");
    expect(event.resourceType).toBe("report_snapshot");
    expect(event.resourceId).toBe(tables.snapshots[0].id);
    expect(event.organisationId).toBe(ORG_A);
    expect(event.correlationId).toBe("corr-report-1");
  });

  it("records a real issuing user, not a system actor", async () => {
    await issueReport();
    expect(tables.audit[0].actorType).toBe("USER");
    expect(tables.audit[0].actorUserId).toBe("user-1");
    expect(tables.audit[0].source).toBe("web-app");
  });

  it("records the period, calculation count and headline totals on the correct bases", async () => {
    await issueReport();

    const after = tables.audit[0].after as Row;
    expect(after.version).toBe(3);
    expect(after.periodStart).toBe("2026-01-01T00:00:00.000Z");
    expect(after.periodEnd).toBe("2026-01-31T00:00:00.000Z");
    expect(after.calculationCount).toBe(2);
    expect(after.scope1TotalKgCo2e).toBe(1200.5);
    // Scope 2 is recorded on both bases — location-based is the corporate
    // headline, market-based is its companion, never conflated.
    expect(after.scope2LocationTotalKgCo2e).toBe(800.25);
    expect(after.scope2MarketTotalKgCo2e).toBe(640.75);
    expect(after.scope3TotalKgCo2e).toBe(430);
  });

  it("records the disclosure counts so an excluded entry is never invisible", async () => {
    await issueReport();
    const after = tables.audit[0].after as Row;
    expect(after.excludedFlaggedCount).toBe(1);
    expect(after.awaitingFactorCount).toBe(0);
  });

  it("does not copy the frozen payload into the audit row", async () => {
    await issueReport();
    const serialised = JSON.stringify(tables.audit[0].after);
    expect(serialised).not.toContain("byCategory");
    expect(serialised).not.toContain("Aster North");
    expect(serialised.length).toBeLessThan(600);
  });
});
