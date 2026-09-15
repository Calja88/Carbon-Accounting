/**
 * Phase 2B-i: the carbon data-collection plan. Covers period enumeration,
 * generation and its idempotency, status derivation across every status,
 * interval matching of submissions, the review/exclude/reopen decisions, and
 * the tenant and RBAC boundaries.
 *
 * No live database: an in-memory fake Prisma client is injected through the
 * services' own `db` parameter, and every fixture is synthetic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarbonSourceFrequency } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { ORG_A, ORG_B, ENTITY_A, ENTITY_B, SITE_A, SITE_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const recordAuditEvent = vi.fn(async () => ({ id: "audit-1" }));
vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...(args as [])),
}));

const {
  CollectionPlanError,
  COLLECTION_EXCLUDE_PERMISSION,
  COLLECTION_MANAGE_PERMISSION,
  computeCollectionFingerprint,
  deriveCollectionStatus,
  enumeratePeriods,
  excludeCollectionRequirement,
  generateCollectionPlan,
  getCollectionMatrix,
  reopenCollectionRequirement,
  reviewCollectionRequirement,
} = await import("@/lib/carbon/collection-plan-service");

const GAS = "adp-gas";
const ELECTRICITY = "adp-electricity";
const SITE_A2 = "site-aster-south";
const NOW = new Date("2026-09-14T00:00:00.000Z");
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

interface Row {
  [key: string]: unknown;
}

function makeStore() {
  return {
    sites: [
      { id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North", isActive: true },
      { id: SITE_A2, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster South", isActive: true },
      { id: SITE_B, organisationId: ORG_B, entityId: ENTITY_B, name: "Birch South", isActive: true },
    ] as Row[],
    configs: [] as Row[],
    requirements: [] as Row[],
    entries: [] as Row[],
    calculations: [] as Row[],
    nextId: 1,
  };
}
type Store = ReturnType<typeof makeStore>;

function inList(value: unknown, clause: unknown): boolean {
  return Array.isArray((clause as Row)?.in) && ((clause as Row).in as unknown[]).includes(value);
}
function siteMatchesAccess(site: Row | undefined, clause: Row | undefined): boolean {
  if (!site) return false;
  const or = clause?.OR as Row[] | undefined;
  if (!or) return true;
  return or.some((o) => (o.id ? inList(site.id, o.id) : o.entityId ? inList(site.entityId, o.entityId) : false));
}
function dateCmp(value: unknown, clause: Row | undefined): boolean {
  if (!clause) return true;
  const d = value as Date;
  if (clause.lte !== undefined && !(d <= (clause.lte as Date))) return false;
  if (clause.gte !== undefined && !(d >= (clause.gte as Date))) return false;
  return true;
}

function makeDb(store: Store) {
  const db = {
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    site: {
      findFirst: async ({ where }: { where: Row }) =>
        store.sites.find((s) => s.id === where.id && s.organisationId === where.organisationId) ?? null,
    },
    organisationSourceConfig: {
      findMany: async ({ where }: { where: Row }) =>
        store.configs.filter(
          (c) =>
            c.organisationId === where.organisationId &&
            (where.enabled === undefined || c.enabled === where.enabled) &&
            (!where.siteId || c.siteId === where.siteId) &&
            siteMatchesAccess(store.sites.find((s) => s.id === c.siteId), where.site as Row),
        ),
    },
    carbonCollectionRequirement: {
      findMany: async ({ where }: { where: Row }) =>
        store.requirements.filter(
          (r) =>
            r.organisationId === where.organisationId &&
            (!where.siteId || r.siteId === where.siteId) &&
            dateCmp(r.periodStart, where.periodStart as Row) &&
            dateCmp(r.periodEnd, where.periodEnd as Row) &&
            siteMatchesAccess(store.sites.find((s) => s.id === r.siteId), where.site as Row),
        ),
      findFirst: async ({ where }: { where: Row }) =>
        store.requirements.find((r) => r.id === where.id && r.organisationId === where.organisationId) ?? null,
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of data) {
          const clash = store.requirements.some(
            (r) =>
              r.organisationId === row.organisationId &&
              r.siteId === row.siteId &&
              r.activityDataPointId === row.activityDataPointId &&
              r.periodKey === row.periodKey,
          );
          if (clash) {
            if (skipDuplicates) continue;
            throw new Error("Unique constraint violated");
          }
          store.requirements.push({
            id: `req-${store.nextId++}`,
            decision: "PENDING",
            reviewFingerprint: null,
            excludedReason: null,
            excludedAt: null,
            excludedByMembershipId: null,
            reopenedAt: null,
            reopenedByMembershipId: null,
            ...row,
          });
          count += 1;
        }
        return { count };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const matched = store.requirements.filter((r) => {
          if (r.id !== where.id || r.organisationId !== where.organisationId) return false;
          const d = where.decision as Row | string | undefined;
          if (typeof d === "string") return r.decision === d;
          if (d && typeof d === "object" && "not" in d) return r.decision !== (d as Row).not;
          return true;
        });
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
    activityEntry: {
      findMany: async ({ where }: { where: Row }) =>
        store.entries.filter(
          (e) =>
            e.organisationId === where.organisationId &&
            inList(e.siteId, where.siteId) &&
            inList(e.activityDataPointId, where.activityDataPointId) &&
            dateCmp(e.periodStart, where.periodStart as Row) &&
            dateCmp(e.periodEnd, where.periodEnd as Row) &&
            siteMatchesAccess(store.sites.find((s) => s.id === e.siteId), where.site as Row),
        ),
    },
    calculation: {
      findMany: async ({ where }: { where: Row }) =>
        store.calculations.filter(
          (c) => c.organisationId === where.organisationId && inList(c.activityEntryId, where.activityEntryId),
        ),
    },
  };
  return db as unknown as Parameters<typeof generateCollectionPlan>[2];
}

const MANAGE = ["carbon.view", COLLECTION_MANAGE_PERMISSION];
const FULL = ["carbon.view", COLLECTION_MANAGE_PERMISSION, COLLECTION_EXCLUDE_PERMISSION];

function context(organisationId: string, permissions: string[] = FULL, access?: OrganisationContext["access"]) {
  return makeOrganisationContext(organisationId, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
    ...(access ? { access } : {}),
  });
}

function addConfig(store: Store, patch: Partial<Row> = {}) {
  const config = {
    id: `config-${store.configs.length + 1}`,
    organisationId: ORG_A,
    siteId: SITE_A,
    activityDataPointId: GAS,
    enabled: true,
    frequency: CarbonSourceFrequency.MONTHLY,
    effectiveFrom: utc("2020-01-01"),
    ...patch,
  };
  store.configs.push(config);
  return config;
}

const WINDOW = { periodStart: utc("2026-01-01"), periodEnd: utc("2026-03-31") };

let store: Store;
let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  store = makeStore();
  db = makeDb(store);
  recordAuditEvent.mockClear();
});

describe("period enumeration", () => {
  it("produces one period per month, quarter or year overlapping the window", () => {
    const start = utc("2026-01-01");
    const end = utc("2026-03-31");
    expect(enumeratePeriods(CarbonSourceFrequency.MONTHLY, start, end, NOW).map((p) => p.periodKey)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(enumeratePeriods(CarbonSourceFrequency.QUARTERLY, start, end, NOW).map((p) => p.periodKey)).toEqual(["2026-Q1"]);
    expect(enumeratePeriods(CarbonSourceFrequency.ANNUAL, start, end, NOW).map((p) => p.periodKey)).toEqual(["2026"]);
  });

  it("includes a quarter the window only partly covers — the data is still expected", () => {
    const keys = enumeratePeriods(CarbonSourceFrequency.QUARTERLY, utc("2026-02-01"), utc("2026-04-30"), NOW).map(
      (p) => p.periodKey,
    );
    expect(keys).toEqual(["2026-Q1", "2026-Q2"]);
  });

  it("never generates for AD_HOC", () => {
    expect(enumeratePeriods(CarbonSourceFrequency.AD_HOC, utc("2026-01-01"), utc("2026-12-31"), NOW)).toEqual([]);
  });

  it("does not generate periods that have not started — nobody is late for a future month", () => {
    const keys = enumeratePeriods(CarbonSourceFrequency.MONTHLY, utc("2026-08-01"), utc("2026-12-31"), NOW).map(
      (p) => p.periodKey,
    );
    expect(keys).toEqual(["2026-08", "2026-09"]);
  });

  it("uses inclusive UTC period ends", () => {
    const [q1] = enumeratePeriods(CarbonSourceFrequency.QUARTERLY, utc("2026-01-01"), utc("2026-03-31"), NOW);
    expect(q1.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(q1.periodEnd.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });
});

describe("generation", () => {
  it("creates one requirement per enabled source and period, and records one audit event for the run", async () => {
    addConfig(store);
    const result = await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    expect(result).toEqual({ created: 3, alreadyPresent: 0, skippedAdHoc: 0 });
    expect(store.requirements.map((r) => r.periodKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("skips AD_HOC configurations rather than inventing a cadence", async () => {
    addConfig(store, { frequency: CarbonSourceFrequency.AD_HOC });
    const result = await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    expect(result).toEqual({ created: 0, alreadyPresent: 0, skippedAdHoc: 1 });
    expect(store.requirements).toHaveLength(0);
  });

  it("ignores disabled configurations", async () => {
    addConfig(store, { enabled: false });
    expect(await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW)).toMatchObject({ created: 0 });
  });

  it("never asks for data from before the source applied to the site", async () => {
    addConfig(store, { effectiveFrom: utc("2026-03-01") });
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    expect(store.requirements.map((r) => r.periodKey)).toEqual(["2026-03"]);
  });

  it("is idempotent — a rerun creates nothing and duplicates nothing", async () => {
    addConfig(store);
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    const second = await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    expect(second).toEqual({ created: 0, alreadyPresent: 3, skippedAdHoc: 0 });
    expect(store.requirements).toHaveLength(3);
  });

  it("a rerun never overwrites a reviewed or excluded decision", async () => {
    addConfig(store);
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
    store.requirements[0].decision = "EXCLUDED";
    store.requirements[0].excludedReason = "Site closed that month";
    store.requirements[1].decision = "REVIEWED";
    store.requirements[1].reviewFingerprint = "fingerprint-1";

    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);

    expect(store.requirements).toHaveLength(3);
    expect(store.requirements[0]).toMatchObject({ decision: "EXCLUDED", excludedReason: "Site closed that month" });
    expect(store.requirements[1]).toMatchObject({ decision: "REVIEWED", reviewFingerprint: "fingerprint-1" });
  });

  it("generates a quarterly plan as quarters, not months", async () => {
    addConfig(store, { frequency: CarbonSourceFrequency.QUARTERLY });
    await generateCollectionPlan(context(ORG_A), { periodStart: utc("2026-01-01"), periodEnd: utc("2026-06-30") }, db, NOW);
    expect(store.requirements.map((r) => r.periodKey)).toEqual(["2026-Q1", "2026-Q2"]);
  });
});

describe("status derivation", () => {
  const entry = (patch: Partial<{ id: string; status: string }> = {}) => ({
    id: "entry-1",
    status: "SUBMITTED",
    canonicalValue: "100",
    canonicalUnit: "kWh",
    ...patch,
  });
  const calcs = (entryId = "entry-1") =>
    new Map([[entryId, [{ id: "calc-1", basis: "STANDARD", resultKgCo2e: "12.5" }]]]);

  it("not_required when nothing is configured and nothing was generated", () => {
    expect(deriveCollectionStatus({ requirement: null, hasEnabledConfig: false, entries: [], calculationsByEntryId: new Map() })).toBe("not_required");
  });

  it("missing when a requirement exists with no submission", () => {
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [], calculationsByEntryId: new Map() }),
    ).toBe("missing");
  });

  it("awaiting_factor for a submission with no usable factor result", () => {
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry({ status: "AWAITING_FACTOR" })], calculationsByEntryId: new Map() }),
    ).toBe("awaiting_factor");
    // Also awaiting when the entry looks fine but produced no calculation.
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry()], calculationsByEntryId: new Map() }),
    ).toBe("awaiting_factor");
  });

  it("submitted once a calculated result exists", () => {
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry()], calculationsByEntryId: calcs() }),
    ).toBe("submitted");
  });

  it("treats a FLAGGED submission as submitted and a REJECTED one as missing", () => {
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry({ status: "FLAGGED" })], calculationsByEntryId: calcs() }),
    ).toBe("submitted");
    expect(
      deriveCollectionStatus({ requirement: { decision: "PENDING", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry({ status: "REJECTED" })], calculationsByEntryId: calcs() }),
    ).toBe("missing");
  });

  it("excluded regardless of what was or was not submitted", () => {
    expect(
      deriveCollectionStatus({ requirement: { decision: "EXCLUDED", reviewFingerprint: null }, hasEnabledConfig: true, entries: [entry()], calculationsByEntryId: calcs() }),
    ).toBe("excluded");
  });

  it("reviewed only while the fingerprint still matches, and changed_since_review once it does not", () => {
    const entries = [entry()];
    const calculations = calcs();
    const fingerprint = computeCollectionFingerprint(entries, calculations);

    expect(
      deriveCollectionStatus({ requirement: { decision: "REVIEWED", reviewFingerprint: fingerprint }, hasEnabledConfig: true, entries, calculationsByEntryId: calculations }),
    ).toBe("reviewed");

    const changed = new Map([["entry-1", [{ id: "calc-1", basis: "STANDARD", resultKgCo2e: "99.9" }]]]);
    expect(
      deriveCollectionStatus({ requirement: { decision: "REVIEWED", reviewFingerprint: fingerprint }, hasEnabledConfig: true, entries, calculationsByEntryId: changed }),
    ).toBe("changed_since_review");

    // Submission withdrawn entirely after review.
    expect(
      deriveCollectionStatus({ requirement: { decision: "REVIEWED", reviewFingerprint: fingerprint }, hasEnabledConfig: true, entries: [], calculationsByEntryId: new Map() }),
    ).toBe("changed_since_review");
  });

  it("fingerprints a whole multi-entry set independently of ordering", () => {
    const a = entry({ id: "entry-a" });
    const b = entry({ id: "entry-b" });
    const map = new Map([
      ["entry-a", [{ id: "c1", basis: "STANDARD", resultKgCo2e: "1" }]],
      ["entry-b", [{ id: "c2", basis: "STANDARD", resultKgCo2e: "2" }]],
    ]);
    expect(computeCollectionFingerprint([a, b], map)).toBe(computeCollectionFingerprint([b, a], map));
  });
});

describe("matrix and submission matching", () => {
  beforeEach(async () => {
    addConfig(store, { frequency: CarbonSourceFrequency.QUARTERLY });
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
  });

  it("matches several monthly submissions to one quarterly requirement", async () => {
    for (const month of ["01", "02", "03"]) {
      store.entries.push({
        id: `entry-${month}`,
        organisationId: ORG_A,
        siteId: SITE_A,
        activityDataPointId: GAS,
        periodStart: utc(`2026-${month}-01`),
        periodEnd: utc(`2026-${month}-28`),
        status: "SUBMITTED",
        canonicalValue: "10",
        canonicalUnit: "kWh",
      });
      store.calculations.push({ id: `calc-${month}`, organisationId: ORG_A, activityEntryId: `entry-${month}`, basis: "STANDARD", resultKgCo2e: "1" });
    }

    const [row] = await getCollectionMatrix(context(ORG_A), WINDOW, db, NOW);
    expect(row.periodKey).toBe("2026-Q1");
    expect(row.entryIds.sort()).toEqual(["entry-01", "entry-02", "entry-03"]);
    expect(row.status).toBe("submitted");
  });

  it("does not match a submission for another source or a non-overlapping period", async () => {
    store.entries.push({
      id: "entry-other-source",
      organisationId: ORG_A, siteId: SITE_A, activityDataPointId: ELECTRICITY,
      periodStart: utc("2026-01-01"), periodEnd: utc("2026-01-31"),
      status: "SUBMITTED", canonicalValue: "5", canonicalUnit: "kWh",
    });
    store.entries.push({
      id: "entry-other-period",
      organisationId: ORG_A, siteId: SITE_A, activityDataPointId: GAS,
      periodStart: utc("2025-06-01"), periodEnd: utc("2025-06-30"),
      status: "SUBMITTED", canonicalValue: "5", canonicalUnit: "kWh",
    });

    const [row] = await getCollectionMatrix(context(ORG_A), WINDOW, db, NOW);
    expect(row.entryIds).toEqual([]);
    expect(row.status).toBe("missing");
  });
});

describe("review, exclude and reopen", () => {
  let requirementId: string;

  beforeEach(async () => {
    addConfig(store);
    await generateCollectionPlan(context(ORG_A), { periodStart: utc("2026-01-01"), periodEnd: utc("2026-01-31") }, db, NOW);
    requirementId = store.requirements[0].id as string;
    recordAuditEvent.mockClear();
  });

  function addSubmission(status = "SUBMITTED", withCalculation = true) {
    store.entries.push({
      id: "entry-1", organisationId: ORG_A, siteId: SITE_A, activityDataPointId: GAS,
      periodStart: utc("2026-01-01"), periodEnd: utc("2026-01-31"),
      status, canonicalValue: "100", canonicalUnit: "kWh",
    });
    if (withCalculation) {
      store.calculations.push({ id: "calc-1", organisationId: ORG_A, activityEntryId: "entry-1", basis: "STANDARD", resultKgCo2e: "12.5" });
    }
  }

  it("reviews a requirement that has a settled submission, and records the fingerprint", async () => {
    addSubmission();
    const result = await reviewCollectionRequirement(context(ORG_A), requirementId, db);
    expect(result.decision).toBe("REVIEWED");
    expect(store.requirements[0].reviewFingerprint).toEqual(expect.any(String));
    expect(store.requirements[0].reviewedByMembershipId).toBe(`membership-${ORG_A}`);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("refuses to review an empty, awaiting-factor or uncalculated requirement", async () => {
    await expect(reviewCollectionRequirement(context(ORG_A), requirementId, db)).rejects.toThrow(CollectionPlanError);

    store.entries.length = 0;
    addSubmission("AWAITING_FACTOR", false);
    await expect(reviewCollectionRequirement(context(ORG_A), requirementId, db)).rejects.toThrow(CollectionPlanError);

    store.entries.length = 0;
    store.calculations.length = 0;
    addSubmission("SUBMITTED", false);
    await expect(reviewCollectionRequirement(context(ORG_A), requirementId, db)).rejects.toThrow(CollectionPlanError);

    expect(store.requirements[0].decision).toBe("PENDING");
  });

  it("refuses a second review of the same requirement", async () => {
    addSubmission();
    await reviewCollectionRequirement(context(ORG_A), requirementId, db);
    await expect(reviewCollectionRequirement(context(ORG_A), requirementId, db)).rejects.toThrow(CollectionPlanError);
  });

  it("excludes only with a recorded reason, and refuses a second exclusion", async () => {
    await expect(excludeCollectionRequirement(context(ORG_A), requirementId, { reason: "   " }, db)).rejects.toThrow(
      CollectionPlanError,
    );
    await excludeCollectionRequirement(context(ORG_A), requirementId, { reason: "Site closed" }, db);
    expect(store.requirements[0]).toMatchObject({
      decision: "EXCLUDED",
      excludedReason: "Site closed",
      excludedByMembershipId: `membership-${ORG_A}`,
    });
    await expect(
      excludeCollectionRequirement(context(ORG_A), requirementId, { reason: "again" }, db),
    ).rejects.toThrow(CollectionPlanError);
  });

  it("reopens without erasing the original exclusion decision", async () => {
    await excludeCollectionRequirement(context(ORG_A), requirementId, { reason: "Excluded in error" }, db);
    const result = await reopenCollectionRequirement(context(ORG_A), requirementId, db);

    expect(result.decision).toBe("PENDING");
    const row = store.requirements[0];
    expect(row.decision).toBe("PENDING");
    // The exclusion provenance survives the reopen — this is the whole point.
    expect(row.excludedReason).toBe("Excluded in error");
    expect(row.excludedAt).toBeInstanceOf(Date);
    expect(row.excludedByMembershipId).toBe(`membership-${ORG_A}`);
    expect(row.reopenedAt).toBeInstanceOf(Date);
    expect(row.reopenedByMembershipId).toBe(`membership-${ORG_A}`);
  });

  it("refuses to reopen something that is not excluded", async () => {
    await expect(reopenCollectionRequirement(context(ORG_A), requirementId, db)).rejects.toThrow(CollectionPlanError);
  });
});

describe("tenant isolation", () => {
  beforeEach(async () => {
    addConfig(store);
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
  });

  it("Organisation B never sees Organisation A's collection rows", async () => {
    expect(await getCollectionMatrix(context(ORG_B), WINDOW, db, NOW)).toEqual([]);
    expect((await getCollectionMatrix(context(ORG_A), WINDOW, db, NOW)).length).toBe(3);
  });

  it("Organisation B cannot read Organisation A's rows by naming its site id", async () => {
    await expect(getCollectionMatrix(context(ORG_B), { ...WINDOW, siteId: SITE_A }, db, NOW)).rejects.toThrow(
      TenantOwnershipError,
    );
  });

  it("Organisation B cannot generate a plan for Organisation A's site", async () => {
    await expect(generateCollectionPlan(context(ORG_B), { ...WINDOW, siteId: SITE_A }, db, NOW)).rejects.toThrow(
      TenantOwnershipError,
    );
  });

  it("Organisation B cannot review, exclude or reopen Organisation A's requirement", async () => {
    const id = store.requirements[0].id as string;
    await expect(reviewCollectionRequirement(context(ORG_B), id, db)).rejects.toThrow(TenantOwnershipError);
    await expect(excludeCollectionRequirement(context(ORG_B), id, { reason: "x" }, db)).rejects.toThrow(TenantOwnershipError);
    await expect(reopenCollectionRequirement(context(ORG_B), id, db)).rejects.toThrow(TenantOwnershipError);
    expect(store.requirements[0].decision).toBe("PENDING");
  });

  it("a foreign organisation's source config never seeds a requirement", async () => {
    store.configs.length = 0;
    store.requirements.length = 0;
    addConfig(store, { organisationId: ORG_B, siteId: SITE_B });
    expect(await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW)).toMatchObject({ created: 0 });
    expect(store.requirements).toHaveLength(0);
  });

  it("a site-scoped member only sees and manages their own sites", async () => {
    const restricted = context(ORG_A, FULL, {
      mode: "RESTRICTED",
      entityIds: new Set<string>(),
      siteIds: new Set([SITE_A2]),
    });
    expect(await getCollectionMatrix(restricted, WINDOW, db, NOW)).toEqual([]);
    await expect(generateCollectionPlan(restricted, { ...WINDOW, siteId: SITE_A }, db, NOW)).rejects.toThrow(
      PermissionDeniedError,
    );
    await expect(reviewCollectionRequirement(restricted, store.requirements[0].id as string, db)).rejects.toThrow(
      PermissionDeniedError,
    );
  });
});

describe("RBAC", () => {
  beforeEach(async () => {
    addConfig(store);
    await generateCollectionPlan(context(ORG_A), WINDOW, db, NOW);
  });

  it("a view-only member can read the matrix but cannot change anything", async () => {
    const viewer = context(ORG_A, ["carbon.view"]);
    expect((await getCollectionMatrix(viewer, WINDOW, db, NOW)).length).toBe(3);

    const id = store.requirements[0].id as string;
    await expect(generateCollectionPlan(viewer, WINDOW, db, NOW)).rejects.toThrow(PermissionDeniedError);
    await expect(reviewCollectionRequirement(viewer, id, db)).rejects.toThrow(PermissionDeniedError);
    await expect(excludeCollectionRequirement(viewer, id, { reason: "x" }, db)).rejects.toThrow(PermissionDeniedError);
    await expect(reopenCollectionRequirement(viewer, id, db)).rejects.toThrow(PermissionDeniedError);
    expect(store.requirements.every((r) => r.decision === "PENDING")).toBe(true);
  });

  it("reading the matrix still requires carbon.view", async () => {
    await expect(getCollectionMatrix(context(ORG_A, []), WINDOW, db, NOW)).rejects.toThrow(PermissionDeniedError);
  });

  it("excluding needs the higher approve grant, which review alone does not confer", async () => {
    const reviewer = context(ORG_A, MANAGE);
    const id = store.requirements[0].id as string;
    await expect(excludeCollectionRequirement(reviewer, id, { reason: "x" }, db)).rejects.toThrow(PermissionDeniedError);
    await expect(reopenCollectionRequirement(reviewer, id, db)).rejects.toThrow(PermissionDeniedError);
  });

  it("uses grants the deployed carbon roles actually hold", () => {
    expect(COLLECTION_MANAGE_PERMISSION).toBe("carbon.entry.review");
    expect(COLLECTION_EXCLUDE_PERMISSION).toBe("carbon.entry.approve");
  });
});

describe("the Phase 2B-i migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260914160000_add_carbon_collection_requirement/migration.sql"),
    "utf8",
  );

  it("is purely additive and touches no existing table", () => {
    expect(sql).toContain('CREATE TYPE "CarbonCollectionDecision"');
    expect(sql).toContain('CREATE TABLE "CarbonCollectionRequirement"');
    expect(sql).toContain('CREATE UNIQUE INDEX "CarbonCollectionRequirement_org_site_source_period_key"');

    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .replace(/ON DELETE RESTRICT/g, "");
    for (const destructive of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\s+"/i, /\bINSERT\b/i]) {
      expect(statements).not.toMatch(destructive);
    }
    const alters = statements.match(/ALTER TABLE "([^"]+)"/g) ?? [];
    expect(new Set(alters)).toEqual(new Set(['ALTER TABLE "CarbonCollectionRequirement"']));
  });

  it("keeps every identifier within PostgreSQL's 63-character limit", () => {
    for (const identifier of sql.match(/"[A-Za-z_]+"/g) ?? []) {
      expect(identifier.replace(/"/g, "").length).toBeLessThanOrEqual(63);
    }
  });
});
