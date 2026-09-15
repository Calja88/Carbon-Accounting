/**
 * Phase 2A: the Emission Sources configuration layer. Covers the service's
 * writes (enable / disable / change cadence, all idempotent, one row per
 * organisation+site+source), its tenant and RBAC boundaries, and the
 * read-only factor-availability lookup — including that another tenant's
 * supplier-specific factor set never shows up as available.
 *
 * No live database: an in-memory fake Prisma client is injected through the
 * services' own `db` parameter, and every fixture is synthetic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CarbonSourceFrequency, FactorSourceType } from "@prisma/client";
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
  SOURCE_CONFIG_MANAGE_PERMISSION,
  SourceConfigError,
  disableSourceForSite,
  enableSourceForSite,
  getFactorAvailability,
  listConfigurableSites,
  listSiteSourceConfigs,
  listSourceCatalogue,
  suggestedFrequency,
  updateSourceFrequency,
} = await import("@/lib/carbon/source-config-service");

// ---------------------------------------------------------------------------
// Synthetic fixtures + a fake Prisma client covering only the query shapes
// this service actually issues.
// ---------------------------------------------------------------------------

const GAS = "adp-gas";
const ELECTRICITY = "adp-electricity";

interface Row {
  [key: string]: unknown;
}

function makeStore() {
  return {
    entities: [
      { id: ENTITY_A, organisationId: ORG_A, name: "Aster Manufacturing" },
      { id: ENTITY_B, organisationId: ORG_B, name: "Birch Services" },
    ] as Row[],
    sites: [
      { id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A, name: "Aster North", isActive: true },
      { id: "site-aster-south", organisationId: ORG_A, entityId: ENTITY_A, name: "Aster South", isActive: true },
      { id: SITE_B, organisationId: ORG_B, entityId: ENTITY_B, name: "Birch South", isActive: true },
    ] as Row[],
    dataPoints: [
      {
        id: GAS, code: "S1-01", scope: "SCOPE_1", category: "Stationary combustion",
        dataPointName: "Natural gas — facilities", promptTemplate: "How much gas did [site] use in [period]?",
        helpText: "Gas burned on site is a direct emission.", unitOptions: ["kWh", "m3"],
        frequency: "Monthly", factorCategory: "natural_gas", scope3Category: null, sortOrder: 1,
      },
      {
        id: ELECTRICITY, code: "S2-01", scope: "SCOPE_2", category: "Purchased electricity",
        dataPointName: "Grid electricity", promptTemplate: "How much electricity did [site] use in [period]?",
        helpText: null, unitOptions: ["kWh"],
        frequency: "Monthly", factorCategory: "grid_electricity", scope3Category: null, sortOrder: 1,
      },
    ] as Row[],
    configs: [] as Row[],
    factorSets: [] as Row[],
    factors: [] as Row[],
    nextId: 1,
  };
}

type Store = ReturnType<typeof makeStore>;

function inList(value: unknown, clause: unknown): boolean {
  return Array.isArray((clause as Row)?.in) && ((clause as Row).in as unknown[]).includes(value);
}

/** `accessibleSiteFilter` is either `{}` (organisation-wide) or `{ OR: [{ id: { in } }, { entityId: { in } }] }`. */
function siteMatchesAccess(site: Row | undefined, clause: Row | undefined): boolean {
  if (!site) return false;
  const or = clause?.OR as Row[] | undefined;
  if (!or) return true;
  return or.some((option) =>
    option.id ? inList(site.id, option.id) : option.entityId ? inList(site.entityId, option.entityId) : false,
  );
}

function configKeyMatches(config: Row, where: Row): boolean {
  return (
    config.organisationId === where.organisationId &&
    config.siteId === where.siteId &&
    config.activityDataPointId === where.activityDataPointId
  );
}

function makeDb(store: Store) {
  const db = {
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    site: {
      findFirst: async ({ where }: { where: Row }) =>
        store.sites.find((s) => s.id === where.id && s.organisationId === where.organisationId) ?? null,
      findMany: async ({ where }: { where: Row }) =>
        store.sites
          .filter(
            (s) =>
              s.organisationId === where.organisationId &&
              s.isActive === where.isActive &&
              siteMatchesAccess(s, where),
          )
          .map((s) => ({
            id: s.id,
            name: s.name,
            entityId: s.entityId,
            entity: { name: store.entities.find((e) => e.id === s.entityId)!.name },
          })),
    },
    activityDataPoint: {
      findMany: async () => store.dataPoints,
      findUnique: async ({ where }: { where: Row }) => store.dataPoints.find((d) => d.id === where.id) ?? null,
    },
    organisationSourceConfig: {
      findMany: async ({ where }: { where: Row }) =>
        store.configs.filter(
          (c) =>
            c.organisationId === where.organisationId &&
            (!where.siteId || c.siteId === where.siteId) &&
            siteMatchesAccess(store.sites.find((s) => s.id === c.siteId), where.site as Row),
        ),
      findFirstOrThrow: async ({ where }: { where: Row }) => {
        const found = store.configs.find((c) => configKeyMatches(c, where));
        if (!found) throw new Error("No OrganisationSourceConfig found");
        return found;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const matched = store.configs.filter((c) => configKeyMatches(c, where));
        for (const config of matched) Object.assign(config, data, { updatedAt: new Date() });
        return { count: matched.length };
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const key = where.organisationSiteSource as Row;
        const existing = store.configs.find((c) => configKeyMatches(c, key));
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const created = {
          id: `config-${store.nextId++}`,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        store.configs.push(created);
        return created;
      },
    },
    emissionFactorSet: {
      findMany: async ({ where }: { where: Row }) => {
        const asOf = (where.effectiveFrom as Row).lte as Date;
        const [dateClause, visibilityClause] = where.AND as Row[];
        return store.factorSets.filter((set) => {
          if (!inList(set.sourceType, where.sourceType)) return false;
          if ((set.effectiveFrom as Date) > asOf) return false;
          const dateOk = (dateClause.OR as Row[]).some((option) =>
            "effectiveTo" in option && option.effectiveTo === null
              ? set.effectiveTo == null
              : set.effectiveTo != null && (set.effectiveTo as Date) >= ((option.effectiveTo as Row).gte as Date),
          );
          if (!dateOk) return false;
          return (visibilityClause.OR as Row[]).some(
            (option) =>
              set.visibility === option.visibility &&
              (!("ownerOrganisationId" in option) || set.ownerOrganisationId === option.ownerOrganisationId),
          );
        });
      },
    },
    emissionFactor: {
      findMany: async ({ where }: { where: Row }) =>
        store.factors.filter((f) => inList(f.factorSetId, where.factorSetId) && inList(f.category, where.category)),
    },
  };
  return db as unknown as Parameters<typeof enableSourceForSite>[2];
}

const MANAGE = ["carbon.view", "carbon.entry.review"];

function context(organisationId: string, permissions: string[] = MANAGE, access?: OrganisationContext["access"]) {
  return makeOrganisationContext(organisationId, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
    ...(access ? { access } : {}),
  });
}

let store: Store;
let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  store = makeStore();
  db = makeDb(store);
  recordAuditEvent.mockClear();
});

describe("catalogue and site reads", () => {
  it("returns the global catalogue with its free-text cadence hint preserved", async () => {
    const catalogue = await listSourceCatalogue(context(ORG_A), db);
    expect(catalogue.map((s) => s.code)).toEqual(["S1-01", "S2-01"]);
    expect(catalogue[0].catalogueFrequency).toBe("Monthly");
  });

  it("lists only the sites the membership can configure", async () => {
    const restricted = context(ORG_A, MANAGE, {
      mode: "RESTRICTED",
      entityIds: new Set<string>(),
      siteIds: new Set([SITE_A]),
    });
    expect((await listConfigurableSites(restricted, db)).map((s) => s.id)).toEqual([SITE_A]);
    expect((await listConfigurableSites(context(ORG_A), db)).map((s) => s.id).sort()).toEqual(
      [SITE_A, "site-aster-south"].sort(),
    );
  });

  it("requires carbon.view to read anything", async () => {
    await expect(listSourceCatalogue(context(ORG_A, []), db)).rejects.toThrow(PermissionDeniedError);
    await expect(listSiteSourceConfigs(context(ORG_A, []), {}, db)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("enable / disable / frequency", () => {
  it("enables a source for a site and records it once", async () => {
    const config = await enableSourceForSite(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY },
      db,
    );
    expect(config).toMatchObject({ siteId: SITE_A, activityDataPointId: GAS, enabled: true, frequency: "MONTHLY" });
    expect(store.configs).toHaveLength(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — enabling twice keeps one row per organisation/site/source", async () => {
    const input = { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY };
    const first = await enableSourceForSite(context(ORG_A), input, db);
    const second = await enableSourceForSite(context(ORG_A), input, db);
    expect(second.id).toBe(first.id);
    expect(store.configs).toHaveLength(1);
  });

  it("re-enabling a disabled source reuses the row and keeps its original effectiveFrom", async () => {
    const input = { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY };
    const first = await enableSourceForSite(context(ORG_A), input, db);
    await disableSourceForSite(context(ORG_A), { siteId: SITE_A, activityDataPointId: GAS }, db);
    const again = await enableSourceForSite(context(ORG_A), input, db);
    expect(again.id).toBe(first.id);
    expect(again.enabled).toBe(true);
    expect(again.effectiveFrom).toEqual(first.effectiveFrom);
    expect(store.configs).toHaveLength(1);
  });

  it("disables without deleting, and is a no-op when the source was never configured", async () => {
    await enableSourceForSite(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY },
      db,
    );
    const disabled = await disableSourceForSite(context(ORG_A), { siteId: SITE_A, activityDataPointId: GAS }, db);
    expect(disabled?.enabled).toBe(false);
    expect(store.configs).toHaveLength(1);

    recordAuditEvent.mockClear();
    const never = await disableSourceForSite(context(ORG_A), { siteId: SITE_A, activityDataPointId: ELECTRICITY }, db);
    expect(never).toBeNull();
    expect(store.configs).toHaveLength(1);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("changes the cadence of a configured source, and refuses one that is not configured", async () => {
    await enableSourceForSite(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY },
      db,
    );
    const updated = await updateSourceFrequency(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.QUARTERLY },
      db,
    );
    expect(updated.frequency).toBe("QUARTERLY");

    await expect(
      updateSourceFrequency(
        context(ORG_A),
        { siteId: SITE_A, activityDataPointId: ELECTRICITY, frequency: CarbonSourceFrequency.ANNUAL },
        db,
      ),
    ).rejects.toThrow(SourceConfigError);
  });

  it("suggests a cadence from the catalogue hint, and never guesses a calendar cadence it cannot read", () => {
    expect(suggestedFrequency("Monthly")).toBe("MONTHLY");
    expect(suggestedFrequency("Quarterly")).toBe("QUARTERLY");
    expect(suggestedFrequency("Annually / on contract change")).toBe("ANNUAL");
    expect(suggestedFrequency("As occurs")).toBe("AD_HOC");
  });
});

describe("tenant isolation", () => {
  beforeEach(async () => {
    await enableSourceForSite(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY },
      db,
    );
  });

  it("Organisation B never sees Organisation A's site source configs", async () => {
    expect(await listSiteSourceConfigs(context(ORG_B), {}, db)).toEqual([]);
    expect((await listSiteSourceConfigs(context(ORG_A), {}, db)).map((c) => c.siteId)).toEqual([SITE_A]);
  });

  it("Organisation B cannot read Organisation A's configs by naming its site id", async () => {
    await expect(listSiteSourceConfigs(context(ORG_B), { siteId: SITE_A }, db)).rejects.toThrow(TenantOwnershipError);
  });

  it("Organisation B cannot enable or disable a source on Organisation A's site", async () => {
    const target = { siteId: SITE_A, activityDataPointId: ELECTRICITY };
    await expect(
      enableSourceForSite(context(ORG_B), { ...target, frequency: CarbonSourceFrequency.MONTHLY }, db),
    ).rejects.toThrow(TenantOwnershipError);
    await expect(disableSourceForSite(context(ORG_B), { siteId: SITE_A, activityDataPointId: GAS }, db)).rejects.toThrow(
      TenantOwnershipError,
    );
    expect(store.configs).toHaveLength(1);
    expect(store.configs[0].enabled).toBe(true);
  });

  it("a site-scoped member of the same organisation cannot manage a site outside their scope", async () => {
    const restricted = context(ORG_A, MANAGE, {
      mode: "RESTRICTED",
      entityIds: new Set<string>(),
      siteIds: new Set(["site-aster-south"]),
    });
    await expect(
      enableSourceForSite(
        restricted,
        { siteId: SITE_A, activityDataPointId: ELECTRICITY, frequency: CarbonSourceFrequency.MONTHLY },
        db,
      ),
    ).rejects.toThrow(PermissionDeniedError);
    expect(await listSiteSourceConfigs(restricted, {}, db)).toEqual([]);
  });
});

describe("RBAC", () => {
  it("manages behind a grant the carbon roles actually hold", () => {
    // carbon.contract.manage reads well but is granted to nobody in the
    // deployed role sets, so /sources was read-only for every user
    // including the Sustainability Lead. carbon.entry.review is part of
    // CARBON_ENTRY_FULL and is what those roles really carry.
    expect(SOURCE_CONFIG_MANAGE_PERMISSION).toBe("carbon.entry.review");
  });

  it("a view-only member can read configurations but cannot change one", async () => {
    await enableSourceForSite(
      context(ORG_A),
      { siteId: SITE_A, activityDataPointId: GAS, frequency: CarbonSourceFrequency.MONTHLY },
      db,
    );
    const viewer = context(ORG_A, ["carbon.view"]);

    expect((await listSiteSourceConfigs(viewer, {}, db)).map((c) => c.activityDataPointId)).toEqual([GAS]);
    const target = { siteId: SITE_A, activityDataPointId: GAS };
    await expect(
      enableSourceForSite(viewer, { ...target, frequency: CarbonSourceFrequency.ANNUAL }, db),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(disableSourceForSite(viewer, target, db)).rejects.toThrow(PermissionDeniedError);
    await expect(
      updateSourceFrequency(viewer, { ...target, frequency: CarbonSourceFrequency.ANNUAL }, db),
    ).rejects.toThrow(PermissionDeniedError);
    expect(store.configs[0]).toMatchObject({ enabled: true, frequency: "MONTHLY" });
  });
});

describe("factor availability", () => {
  const asOf = new Date("2026-06-30T00:00:00.000Z");

  function addSet(id: string, sourceType: FactorSourceType, visibility: string, ownerOrganisationId: string | null) {
    store.factorSets.push({
      id,
      sourceType,
      visibility,
      ownerOrganisationId,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
    });
  }

  it("reports the kinds of factor that exist, and awaits one where none does", async () => {
    addSet("set-official", FactorSourceType.OFFICIAL_DEFRA_DESNZ, "PLATFORM", null);
    store.factors.push({ factorSetId: "set-official", category: "natural_gas" });

    const availability = await getFactorAvailability(context(ORG_A), asOf, ["natural_gas", "grid_electricity"], db);
    expect(availability.get("natural_gas")).toEqual({ available: true, kinds: ["OFFICIAL"] });
    // Absent, so the page renders "Awaiting factor" — never a zero.
    expect(availability.get("grid_electricity")).toBeUndefined();
  });

  it("ignores a factor set that is not in effect for the selected period", async () => {
    store.factorSets.push({
      id: "set-future",
      sourceType: FactorSourceType.OFFICIAL_DEFRA_DESNZ,
      visibility: "PLATFORM",
      ownerOrganisationId: null,
      effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
      effectiveTo: null,
    });
    store.factors.push({ factorSetId: "set-future", category: "natural_gas" });

    expect((await getFactorAvailability(context(ORG_A), asOf, ["natural_gas"], db)).size).toBe(0);
  });

  it("never leaks another organisation's supplier-specific factor set as available", async () => {
    addSet("set-b-supplier", FactorSourceType.SUPPLIER_SPECIFIC, "ORGANISATION", ORG_B);
    store.factors.push({ factorSetId: "set-b-supplier", category: "grid_electricity" });

    expect((await getFactorAvailability(context(ORG_A), asOf, ["grid_electricity"], db)).size).toBe(0);
    expect((await getFactorAvailability(context(ORG_B), asOf, ["grid_electricity"], db)).get("grid_electricity")).toEqual({
      available: true,
      kinds: ["SUPPLIER_SPECIFIC"],
    });
  });

  it("reports every kind available without ranking them, so it cannot restate factor resolution order", async () => {
    addSet("set-official", FactorSourceType.OFFICIAL_DEFRA_DESNZ, "PLATFORM", null);
    addSet("set-spend", FactorSourceType.EEIO_SPEND_BASED, "PLATFORM", null);
    addSet("set-a-supplier", FactorSourceType.SUPPLIER_SPECIFIC, "ORGANISATION", ORG_A);
    for (const factorSetId of ["set-official", "set-spend", "set-a-supplier"]) {
      store.factors.push({ factorSetId, category: "natural_gas" });
    }

    expect((await getFactorAvailability(context(ORG_A), asOf, ["natural_gas"], db)).get("natural_gas")).toEqual({
      available: true,
      kinds: ["OFFICIAL", "SUPPLIER_SPECIFIC", "SPEND_BASED"],
    });
  });
});

describe("the Phase 2A migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "prisma/migrations/20260914120000_add_organisation_source_config/migration.sql"),
    "utf8",
  );

  it("is purely additive — it creates the new type, table and indexes and touches nothing else", () => {
    expect(sql).toContain('CREATE TYPE "CarbonSourceFrequency"');
    expect(sql).toContain('CREATE TABLE "OrganisationSourceConfig"');
    expect(sql).toContain('CREATE UNIQUE INDEX "OrganisationSourceConfig_org_site_source_key"');
    // Scan the statements only: SQL comments explain the intent, and
    // "ON DELETE RESTRICT" is a constraint clause on the new table rather
    // than a row deletion.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .replace(/ON DELETE RESTRICT/g, "");
    for (const destructive of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\s+"/i, /\bINSERT\b/i]) {
      expect(statements).not.toMatch(destructive);
    }
    // The only ALTER is the new table adding its own foreign keys.
    const alters = sql.match(/ALTER TABLE "([^"]+)"/g) ?? [];
    expect(new Set(alters)).toEqual(new Set(['ALTER TABLE "OrganisationSourceConfig"']));
  });
});
