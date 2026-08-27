/**
 * Safe removal controls for Carbon & Lifecycle's activity-entry pipeline
 * (safe-deletion pass). Activity entries had no removal action at all
 * before this: `retractActivityEntry` sets EntryStatus.REJECTED so a
 * mistaken/duplicate entry stops contributing to future calculations and
 * reports (see the `status: { notIn: ["FLAGGED", "REJECTED"] } ` filters in
 * report-service.ts/analytics-service.ts), while the entry and its
 * `Calculation` rows stay in the audit trail. `deleteActivityEntry` is the
 * eligible-draft hard-delete path, blocked whenever a governed dependency
 * (a Calculation row, a commuting-survey response, or an LCA corporate-data
 * citation) exists. Synthetic Aster/Birch fixtures only; no real
 * environmental data, no live database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  activityEntries: [] as Row[],
  calculations: [] as Row[],
  commutingSurveys: [] as Row[],
  commutingSurveyResponses: [] as Row[],
  lcaCorporateDataLinks: [] as Row[],
  siteEnergyContracts: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function table(rows: Row[]) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = rows.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("not found");
      return rows.splice(index, 1)[0];
    }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], where)) { rows.splice(i, 1); count += 1; }
      }
      return { count };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    activityEntry: table(tables.activityEntries),
    calculation: table(tables.calculations),
    commutingSurvey: {
      ...table(tables.commutingSurveys),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const survey = tables.commutingSurveys.find((row) => matches(row, where));
        if (!survey) return null;
        return { ...survey, responses: tables.commutingSurveyResponses.filter((r) => r.surveyId === survey.id) };
      }),
    },
    commutingSurveyResponse: table(tables.commutingSurveyResponses),
    lcaCorporateDataLink: table(tables.lcaCorporateDataLinks),
    siteEnergyContract: table(tables.siteEnergyContracts),
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })),
}));

const entries = await import("@/lib/entries-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

beforeEach(() => {
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  vi.clearAllMocks();
  tables.activityEntries.push(
    { id: "entry-a-submitted", organisationId: ORG_A, status: "SUBMITTED", canonicalValue: { toString: () => "100" } },
    { id: "entry-a-awaiting", organisationId: ORG_A, status: "AWAITING_FACTOR", canonicalValue: { toString: () => "50" } },
  );
  tables.calculations.push({ id: "calc-1", activityEntryId: "entry-a-submitted" });
});

describe("retractActivityEntry", () => {
  it("sets an entry to REJECTED without deleting it or its calculations", async () => {
    const result = await entries.retractActivityEntry(ctxA, "entry-a-submitted", {
      reason: "Duplicate of another entry.",
      actorUserId: "user-a",
    });
    expect(result.status).toBe("REJECTED");
    expect(tables.activityEntries).toHaveLength(2);
    expect(tables.calculations).toHaveLength(1);
  });

  it("requires a reason", async () => {
    await expect(
      entries.retractActivityEntry(ctxA, "entry-a-submitted", { reason: "  ", actorUserId: "user-a" }),
    ).rejects.toThrow(entries.ActivityEntryLifecycleError);
  });

  it("refuses to retract an already-retracted entry", async () => {
    await entries.retractActivityEntry(ctxA, "entry-a-submitted", { reason: "First retraction.", actorUserId: "user-a" });
    await expect(
      entries.retractActivityEntry(ctxA, "entry-a-submitted", { reason: "Second try.", actorUserId: "user-a" }),
    ).rejects.toThrow(entries.ActivityEntryLifecycleError);
  });

  it("refuses a foreign-tenant entry id", async () => {
    await expect(
      entries.retractActivityEntry(ctxB, "entry-a-submitted", { reason: "Attempted cross-tenant retraction.", actorUserId: "user-b" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteActivityEntry", () => {
  it("hard-deletes a draft entry with no calculations", async () => {
    const result = await entries.deleteActivityEntry(ctxA, "entry-a-awaiting", "user-a");
    expect(result.id).toBe("entry-a-awaiting");
    expect(tables.activityEntries.find((e) => e.id === "entry-a-awaiting")).toBeUndefined();
  });

  it("blocks deletion of an entry with calculations", async () => {
    await expect(entries.deleteActivityEntry(ctxA, "entry-a-submitted", "user-a")).rejects.toThrow(
      entries.ActivityEntryLifecycleError,
    );
    expect(tables.activityEntries.find((e) => e.id === "entry-a-submitted")).toBeDefined();
  });

  it("blocks deletion of an entry cited by an LCA corporate-data link", async () => {
    tables.lcaCorporateDataLinks.push({ id: "link-1", activityEntryId: "entry-a-awaiting" });
    await expect(entries.deleteActivityEntry(ctxA, "entry-a-awaiting", "user-a")).rejects.toThrow(
      entries.ActivityEntryLifecycleError,
    );
  });

  it("blocks deletion of an entry derived from a commuting-survey response", async () => {
    tables.commutingSurveyResponses.push({ id: "resp-1", surveyId: "survey-1", activityEntryId: "entry-a-awaiting" });
    await expect(entries.deleteActivityEntry(ctxA, "entry-a-awaiting", "user-a")).rejects.toThrow(
      entries.ActivityEntryLifecycleError,
    );
  });

  it("refuses a foreign-tenant entry id", async () => {
    await expect(entries.deleteActivityEntry(ctxB, "entry-a-awaiting", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteCommutingSurvey", () => {
  beforeEach(() => {
    tables.commutingSurveys.push({ id: "survey-1", organisationId: ORG_A });
  });

  it("deletes a survey whose responses never resolved into activity entries", async () => {
    tables.commutingSurveyResponses.push({ id: "resp-1", surveyId: "survey-1", activityEntryId: null });
    const result = await entries.deleteCommutingSurvey(ctxA, "survey-1", "user-a");
    expect(result.id).toBe("survey-1");
    expect(tables.commutingSurveys).toHaveLength(0);
    expect(tables.commutingSurveyResponses).toHaveLength(0);
  });

  it("blocks deletion once a response has produced a calculated activity entry", async () => {
    tables.commutingSurveyResponses.push({ id: "resp-1", surveyId: "survey-1", activityEntryId: "entry-a-submitted" });
    await expect(entries.deleteCommutingSurvey(ctxA, "survey-1", "user-a")).rejects.toThrow(
      entries.ActivityEntryLifecycleError,
    );
    expect(tables.commutingSurveys).toHaveLength(1);
  });

  it("refuses a foreign-tenant survey id", async () => {
    await expect(entries.deleteCommutingSurvey(ctxB, "survey-1", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteSiteEnergyContract", () => {
  beforeEach(() => {
    tables.siteEnergyContracts.push({ id: "contract-1", organisationId: ORG_A, supplierName: "Aster Power Co" });
  });

  it("hard-deletes a tenant-owned contract", async () => {
    const result = await entries.deleteSiteEnergyContract(ctxA, "contract-1", "user-a");
    expect(result.id).toBe("contract-1");
    expect(tables.siteEnergyContracts).toHaveLength(0);
  });

  it("refuses a foreign-tenant contract id", async () => {
    await expect(entries.deleteSiteEnergyContract(ctxB, "contract-1", "user-b")).rejects.toThrow(TenantOwnershipError);
    expect(tables.siteEnergyContracts).toHaveLength(1);
  });
});
