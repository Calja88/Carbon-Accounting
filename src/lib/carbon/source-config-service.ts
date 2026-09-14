/**
 * Phase 2A (Carbon Product Reset) — the Emission Sources configuration
 * layer: which ActivityDataPoint catalogue sources each Site is expected to
 * report, and how often.
 *
 * Two deliberate boundaries:
 *
 *  - The `ActivityDataPoint` catalogue stays GLOBAL and read-only here. This
 *    module never forks, copies or mutates it per tenant;
 *    `OrganisationSourceConfig` is the only tenant-owned state.
 *  - A configuration is a plan, never evidence. Nothing here creates a
 *    `CarbonSourcePeriodObligation` or an `ActivityEntry`, and nothing here
 *    participates in carbon arithmetic, factor resolution order or report
 *    snapshots. Phase 2B turns enabled configurations into period
 *    obligations; until then this data is read only by /sources.
 *
 * Disabling is a recorded state change, never a delete, so "this site used
 * to report this source" stays visible and re-enabling reuses the same row.
 */

import { CarbonSourceFrequency, FactorSourceType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { visibleFactorSetFilter } from "@/lib/factor-sets-service";
import {
  accessibleSiteFilter,
  requireSiteInScope,
  toTenantRepositoryContext,
} from "@/lib/repositories/carbon-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };
export { CarbonSourceFrequency };

/** A well-formed request the current configuration cannot satisfy — never a missing permission, and never a foreign tenant. */
export class SourceConfigError extends Error {}

/**
 * Managing a site's reporting plan is site-level carbon configuration, so it
 * reuses the existing `carbon.contract.manage` grant rather than inventing a
 * permission: the roles that already configure a site's carbon setup
 * (Sustainability Lead, EMS Contributor, Site Manager, Organisation
 * Administrator) hold it, while the read-only roles (Auditor, Finance) keep
 * `carbon.view` and cannot change what a site is asked to report.
 */
export const SOURCE_CONFIG_MANAGE_PERMISSION = "carbon.contract.manage" as const;

export function canManageSourceConfig(context: OrganisationContext): boolean {
  return context.permissions.has(SOURCE_CONFIG_MANAGE_PERMISSION);
}

type Db = Prisma.TransactionClient;
/** A full client (not a transaction client): the write paths open their own tenant transaction. */
type WriteDb = typeof prisma;

export interface CatalogueSource {
  id: string;
  code: string;
  scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3";
  category: string;
  dataPointName: string;
  promptTemplate: string;
  helpText: string | null;
  /** The catalogue's own unit options; the first is the typical one shown on /sources. */
  unitOptions: string[];
  /** Free-text human hint from the data map (e.g. "Annually / on contract change"), not a machine cadence. */
  catalogueFrequency: string;
  factorCategory: string;
  scope3Category: string | null;
  sortOrder: number;
}

export interface SourceConfigRow {
  id: string;
  siteId: string;
  activityDataPointId: string;
  enabled: boolean;
  frequency: CarbonSourceFrequency;
  effectiveFrom: Date;
  updatedAt: Date;
}

export interface ConfigurableSite {
  id: string;
  name: string;
  entityId: string;
  entityName: string;
}

/**
 * The global catalogue. Not tenant-filtered because it is not tenant data —
 * `carbon.view` is the gate, and the same rows are returned to every
 * organisation by design.
 */
export async function listSourceCatalogue(
  context: OrganisationContext,
  db: Db = prisma,
): Promise<CatalogueSource[]> {
  requireCarbonView(context);
  const rows = await db.activityDataPoint.findMany({
    orderBy: [{ scope: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      scope: true,
      category: true,
      dataPointName: true,
      promptTemplate: true,
      helpText: true,
      unitOptions: true,
      frequency: true,
      factorCategory: true,
      scope3Category: true,
      sortOrder: true,
    },
  });
  return rows.map(({ frequency, ...row }) => ({ ...row, catalogueFrequency: frequency }));
}

/**
 * Sites this membership may configure — organisation-owned AND inside its
 * access scope. Queried site-first rather than entity-first on purpose: a
 * RESTRICTED membership granted individual sites but no whole entity still
 * has to be able to configure those sites.
 */
export async function listConfigurableSites(
  context: OrganisationContext,
  db: Db = prisma,
): Promise<ConfigurableSite[]> {
  requireCarbonView(context);
  const ctx = toTenantRepositoryContext(context);
  const sites = await db.site.findMany({
    where: tenantWhere(ctx, { isActive: true, ...accessibleSiteFilter(context) }),
    orderBy: [{ entity: { name: 'asc' } }, { name: 'asc' }],
    select: { id: true, name: true, entityId: true, entity: { select: { name: true } } },
  });
  return sites.map((site) => ({ id: site.id, name: site.name, entityId: site.entityId, entityName: site.entity.name }));
}

/**
 * Configurations for this organisation only, further narrowed to the sites
 * this membership can actually see. `siteId` narrows that set; it never
 * widens it, and an out-of-scope id is rejected rather than quietly ignored.
 */
export async function listSiteSourceConfigs(
  context: OrganisationContext,
  options: { siteId?: string } = {},
  db: Db = prisma,
): Promise<SourceConfigRow[]> {
  requireCarbonView(context);
  const ctx = toTenantRepositoryContext(context);
  if (options.siteId) await requireSiteInScope(context, options.siteId, db);

  return db.organisationSourceConfig.findMany({
    where: tenantWhere(ctx, {
      ...(options.siteId ? { siteId: options.siteId } : {}),
      site: { ...accessibleSiteFilter(context) },
    }),
    orderBy: [{ siteId: "asc" }, { activityDataPointId: "asc" }],
    select: {
      id: true,
      siteId: true,
      activityDataPointId: true,
      enabled: true,
      frequency: true,
      effectiveFrom: true,
      updatedAt: true,
    },
  });
}

export interface SourceConfigTarget {
  siteId: string;
  activityDataPointId: string;
}

/** Shared guard for every write: manage permission, then site ownership + scope, then that the source exists in the catalogue. */
async function authoriseWrite(context: OrganisationContext, target: SourceConfigTarget, db: Db) {
  requirePermission(context, SOURCE_CONFIG_MANAGE_PERMISSION);
  await requireSiteInScope(context, target.siteId, db);
  const source = await db.activityDataPoint.findUnique({
    where: { id: target.activityDataPointId },
    select: { id: true, code: true },
  });
  if (!source) throw new SourceConfigError("That emission source is not in the catalogue.");
  return source;
}

function toRow(config: SourceConfigRow): SourceConfigRow {
  const { id, siteId, activityDataPointId, enabled, frequency, effectiveFrom, updatedAt } = config;
  return { id, siteId, activityDataPointId, enabled, frequency, effectiveFrom, updatedAt };
}

/**
 * Enables a source for a site at the given cadence. Idempotent: calling it
 * again with the same cadence leaves the same single row, and re-enabling a
 * previously disabled source reuses that row rather than creating a second,
 * contradictory configuration.
 */
export async function enableSourceForSite(
  context: OrganisationContext,
  input: SourceConfigTarget & { frequency: CarbonSourceFrequency },
  db: WriteDb = prisma,
): Promise<SourceConfigRow> {
  const source = await authoriseWrite(context, input, db);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx, txCtx) => {
    const config = await tx.organisationSourceConfig.upsert({
      where: {
        organisationSiteSource: {
          organisationId: txCtx.organisationId,
          siteId: input.siteId,
          activityDataPointId: input.activityDataPointId,
        },
      },
      // effectiveFrom is only defaulted on create — re-enabling never
      // rewrites when the site first started reporting this source.
      create: {
        organisationId: txCtx.organisationId,
        siteId: input.siteId,
        activityDataPointId: input.activityDataPointId,
        enabled: true,
        frequency: input.frequency,
      },
      update: { enabled: true, frequency: input.frequency },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_source_config.enabled",
      resourceType: "carbon_source_config",
      resourceId: config.id,
      summary: `Enabled emission source ${source.code} for site ${input.siteId} (${input.frequency})`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return toRow(config);
  });
}

/**
 * Stops expecting a source from a site. Idempotent, and a no-op returning
 * null when the site was never configured for it — there is nothing to
 * disable, and inventing a row to say so would claim a decision nobody made.
 */
export async function disableSourceForSite(
  context: OrganisationContext,
  input: SourceConfigTarget,
  db: WriteDb = prisma,
): Promise<SourceConfigRow | null> {
  const source = await authoriseWrite(context, input, db);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx, txCtx) => {
    const key = {
      organisationId: txCtx.organisationId,
      siteId: input.siteId,
      activityDataPointId: input.activityDataPointId,
    };
    const updated = await tx.organisationSourceConfig.updateMany({ where: key, data: { enabled: false } });
    if (updated.count === 0) return null;

    const config = await tx.organisationSourceConfig.findFirstOrThrow({ where: key });

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_source_config.disabled",
      resourceType: "carbon_source_config",
      resourceId: config.id,
      summary: `Disabled emission source ${source.code} for site ${input.siteId}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return toRow(config);
  });
}

/**
 * Changes the expected cadence of a source a site already reports.
 * Deliberately not an upsert: a cadence for a source this site does not
 * report would be a reporting expectation nobody chose.
 */
export async function updateSourceFrequency(
  context: OrganisationContext,
  input: SourceConfigTarget & { frequency: CarbonSourceFrequency },
  db: WriteDb = prisma,
): Promise<SourceConfigRow> {
  const source = await authoriseWrite(context, input, db);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx, txCtx) => {
    const key = {
      organisationId: txCtx.organisationId,
      siteId: input.siteId,
      activityDataPointId: input.activityDataPointId,
    };
    const updated = await tx.organisationSourceConfig.updateMany({ where: key, data: { frequency: input.frequency } });
    if (updated.count === 0) {
      throw new SourceConfigError("That source is not configured for this site yet — enable it first.");
    }

    const config = await tx.organisationSourceConfig.findFirstOrThrow({ where: key });

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_source_config.frequency_changed",
      resourceType: "carbon_source_config",
      resourceId: config.id,
      summary: `Set reporting frequency of ${source.code} for site ${input.siteId} to ${input.frequency}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return toRow(config);
  });
}

// ---------------------------------------------------------------------------
// Factor availability (read-only)
// ---------------------------------------------------------------------------

/**
 * Which kinds of emission factor exist for a catalogue source in the
 * selected period. This is a READ of the factor library, not a resolution:
 * it deliberately does not rank the kinds, because ranking them here would
 * restate — and risk contradicting — the resolution order that
 * `entries-service` owns.
 */
export type FactorKind = "OFFICIAL" | "SUPPLIER_SPECIFIC" | "SPEND_BASED";

export interface FactorAvailability {
  available: boolean;
  kinds: FactorKind[];
}

const KIND_BY_SOURCE_TYPE: Partial<Record<FactorSourceType, FactorKind>> = {
  [FactorSourceType.OFFICIAL_DEFRA_DESNZ]: "OFFICIAL",
  [FactorSourceType.SUPPLIER_SPECIFIC]: "SUPPLIER_SPECIFIC",
  [FactorSourceType.EEIO_SPEND_BASED]: "SPEND_BASED",
  // LCA_SECONDARY is the product-LCA library, not a corporate reporting
  // factor, so it never counts as availability on this screen.
};

const KIND_ORDER: FactorKind[] = ["OFFICIAL", "SUPPLIER_SPECIFIC", "SPEND_BASED"];

/**
 * Availability per `ActivityDataPoint.factorCategory`, as at `asOf` (the end
 * of the selected period), across the factor sets this organisation can
 * actually see. `visibleFactorSetFilter` is what stops another tenant's
 * supplier-specific set from ever appearing as "available" here.
 *
 * A category missing from the returned map has no visible factor at all —
 * the caller must render that as "Awaiting factor", never as zero and never
 * as an error.
 */
export async function getFactorAvailability(
  context: OrganisationContext,
  asOf: Date,
  factorCategories: string[],
  db: Db = prisma,
): Promise<Map<string, FactorAvailability>> {
  requireCarbonView(context);
  const result = new Map<string, FactorAvailability>();
  if (factorCategories.length === 0) return result;

  const sets = await db.emissionFactorSet.findMany({
    where: {
      sourceType: { in: Object.keys(KIND_BY_SOURCE_TYPE) as FactorSourceType[] },
      effectiveFrom: { lte: asOf },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }, visibleFactorSetFilter(context)],
    },
    select: { id: true, sourceType: true },
  });
  if (sets.length === 0) return result;

  const kindBySetId = new Map<string, FactorKind>();
  for (const set of sets) {
    const kind = KIND_BY_SOURCE_TYPE[set.sourceType];
    if (kind) kindBySetId.set(set.id, kind);
  }

  const factors = await db.emissionFactor.findMany({
    where: { factorSetId: { in: [...kindBySetId.keys()] }, category: { in: [...new Set(factorCategories)] } },
    select: { category: true, factorSetId: true },
  });

  const kindsByCategory = new Map<string, Set<FactorKind>>();
  for (const factor of factors) {
    const kind = kindBySetId.get(factor.factorSetId);
    if (!kind) continue;
    const kinds = kindsByCategory.get(factor.category) ?? new Set<FactorKind>();
    kinds.add(kind);
    kindsByCategory.set(factor.category, kinds);
  }

  for (const [category, kinds] of kindsByCategory) {
    result.set(category, { available: true, kinds: KIND_ORDER.filter((kind) => kinds.has(kind)) });
  }
  return result;
}

export const FACTOR_KIND_LABEL: Record<FactorKind, string> = {
  OFFICIAL: "Official factor",
  SUPPLIER_SPECIFIC: "Supplier-specific factor",
  SPEND_BASED: "Spend-based estimate",
};

export const FREQUENCY_LABEL: Record<CarbonSourceFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annually",
  AD_HOC: "As it occurs",
};

/**
 * The cadence to pre-select when a source has never been configured, read
 * from the catalogue's own free-text hint. Anything the data map does not
 * clearly state as a calendar cadence falls to AD_HOC rather than being
 * guessed into a monthly expectation nobody agreed to.
 */
export function suggestedFrequency(catalogueFrequency: string): CarbonSourceFrequency {
  const hint = catalogueFrequency.toLowerCase();
  if (hint.includes("month")) return CarbonSourceFrequency.MONTHLY;
  if (hint.includes("quarter")) return CarbonSourceFrequency.QUARTERLY;
  if (hint.includes("annual") || hint.includes("year")) return CarbonSourceFrequency.ANNUAL;
  return CarbonSourceFrequency.AD_HOC;
}
