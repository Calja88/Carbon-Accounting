/**
 * BD08 live binding: implements Astra's `DemoSeedPort` (seed-orchestrator.ts)
 * against the actual live domain services. This is the one file Claude
 * writes from scratch for the board demo — the orchestrator, fixture
 * targets/obligations/evidence and the guard are all Astra's, installed
 * verbatim.
 *
 * Every sensitive transition goes through the same real, unmodified service
 * a normal user action would call (createEnvironmentalAspect,
 * createOperationalControl, createNonconformityFromSource,
 * requestEffectivenessReview, generateManagementReviewPack, ...). Reference/
 * static catalog rows that have no lifecycle of their own (Entity/Site,
 * Product/ProductVersion, ActivityDataPoint, EmissionFactorSet/Factor,
 * AuditProgramme/EmsAudit/AuditFinding scaffolding) are created directly,
 * matching the precedent already established in
 * tests/board-product/bd06-chain.test.ts and tests/checkpoint-a/postgres.test.ts.
 *
 * No browser/application module may import this file — it is only ever
 * invoked from an operator script.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { createActivityEntryWithCalculations, prepareReportingData } from "@/lib/entries-service";
import { createEnvironmentalAspect } from "@/lib/ems/aspects/aspect-service";
import { createOperationalControl, recordControlCheck, uploadEvidenceToControlCheck } from "@/lib/ems/controls/control-service";
import { createEnvironmentalObjective } from "@/lib/ems/objectives/objective-service";
import {
  createNonconformityFromSource,
  recordContainment,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { recordRootCauseAnalysis, approveRootCauseAnalysis } from "@/lib/ems/nonconformity/root-cause-service";
import { createCorrectiveAction, completeCorrectiveAction } from "@/lib/ems/nonconformity/corrective-action-service";
import { requestEffectivenessReview, performEffectivenessReview } from "@/lib/ems/nonconformity/effectiveness-service";
import { uploadEvidenceObject, linkEvidence } from "@/lib/documents/evidence-service";
import { createAssessment } from "@/lib/lca/assessment-service";
import { upsertProcess, upsertInventoryItem, assignFactor } from "@/lib/lca/model-service";
import { runCalculation, getLatestRun, runTotals } from "@/lib/lca/calculation-service";
import { cloneAssessment } from "@/lib/lca/assessment-service";
import { scheduleManagementReview, startManagementReviewInputCollection } from "@/lib/ems/review/review-service";
import { generateManagementReviewPack, issueManagementReviewPack } from "@/lib/ems/review/pack-service";
import { BOARD1, buildSubmissionObligations, IMPROVEMENT_CHAIN, type CarbonTarget } from "./board1";
import { buildSyntheticEvidence } from "./evidence";
import type { DemoDatabaseIdentity } from "./guard";
import type { DemoSeedPort } from "./seed-orchestrator";

const FIXTURE_KEY = BOARD1.fixtureVersion;
const ORG_SLUG = "board-1-northstar-demonstration";

/** Every organisation this seed itself creates must carry this slug prefix — the only rule `readConnectedIdentity`'s ordinary-organisation count uses to tell "this fixture" apart from "an ordinary tenant that must never exist in a demo database". */
export const FIXTURE_ORGANISATION_SLUG_PREFIX = "board-1-";

interface SiteRow {
  key: string;
  id: string;
  name: string;
}

export class LiveSeedPort implements DemoSeedPort {
  private organisationId: string | null = null;
  private entityId: string | null = null;
  private sites: SiteRow[] = [];
  private owner: OrganisationContext | null = null;
  private sustainabilityLead: OrganisationContext | null = null;
  private independentReviewer: OrganisationContext | null = null;
  private officialFactorSetId: string | null = null;
  private wttFactorSetId: string | null = null;
  private evidenceIdByKey: Map<string, string> = new Map();
  private aspectId: string | null = null;
  private controlId: string | null = null;
  private otherRequirementSourceId: string | null = null;
  private findingId: string | null = null;
  private nonconformityId: string | null = null;
  private correctiveActionId: string | null = null;
  private lcaAssessmentId: string | null = null;
  private lcaScenarioId: string | null = null;
  private managementReviewId: string | null = null;
  private managementPackId: string | null = null;

  // -------------------------------------------------------------------
  // Identity / lease
  // -------------------------------------------------------------------

  async readConnectedIdentity(): Promise<DemoDatabaseIdentity> {
    const manifest = await prisma.demoDatabaseManifest.findUnique({ where: { id: "singleton" } });
    // "Ordinary" means neither this fixture's own organisation nor another
    // repo test suite's own clearly-labelled synthetic fixture (the
    // disposable checkpoint-a-postgres CI job intentionally shares one
    // database across every real-Postgres test file; every one of those
    // fixtures — Checkpoint A, BD06, BD08's own concurrency test — names its
    // organisation "Synthetic ..." by established convention). On a
    // genuinely disposable single-purpose demo database there is nothing
    // else present at all, so this check is unchanged there: zero either way.
    const ordinaryOrganisationCount = await prisma.organisation.count({
      where: {
        AND: [
          { NOT: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } },
          { NOT: { name: { startsWith: "Synthetic " } } },
        ],
      },
    });
    if (!manifest) {
      // Fails closed: assertDemoTarget will reject an empty actualDatabaseId/
      // manifestEnvironmentId against any configured allow-list value.
      return { actualDatabaseId: "", manifestEnvironmentId: "", dataClass: "OTHER", disposable: false, ordinaryOrganisationCount };
    }
    return {
      actualDatabaseId: manifest.databaseId,
      manifestEnvironmentId: manifest.environmentId,
      dataClass: "SYNTHETIC",
      disposable: true,
      ordinaryOrganisationCount,
    };
  }

  async withExclusiveFixtureLease<T>(key: string, operation: () => Promise<T>): Promise<T> {
    await prisma.demoFixtureLease.upsert({
      where: { fixtureKey: key },
      create: { fixtureKey: key },
      update: {},
    });
    return prisma.$transaction(
      async (tx) => {
        // A row-level lock held for the whole operation: a concurrent second
        // seed/verify attempt on the same fixture key fails immediately
        // instead of racing writes.
        await tx.$queryRaw`SELECT id FROM "DemoFixtureLease" WHERE "fixtureKey" = ${key} FOR UPDATE NOWAIT`;
        return operation();
      },
      { timeout: 10 * 60 * 1000, maxWait: 5000 },
    );
  }

  async existingFixture(): Promise<{ version: string; digest: string } | null> {
    const lease = await prisma.demoFixtureLease.findUnique({ where: { fixtureKey: FIXTURE_KEY } });
    if (!lease || lease.status === "NONE") return null;
    if (lease.status === "BUILDING") return { version: FIXTURE_KEY, digest: "" }; // deliberately invalid digest -> orchestrator refuses a partial fixture
    return { version: FIXTURE_KEY, digest: lease.digest };
  }

  async beginFixture(version: string): Promise<void> {
    await prisma.demoFixtureLease.update({
      where: { fixtureKey: version },
      data: { status: "BUILDING", digest: "" },
    });
    await this.resolveExistingOrganisation();
  }

  async verifyExistingFixture(): Promise<void> {
    await this.resolveExistingOrganisation();
    if (!this.organisationId) throw new Error("Fixture is marked READY but its organisation cannot be found.");
    await this.verifyAllInvariants();
  }

  private async resolveExistingOrganisation(): Promise<void> {
    const org = await prisma.organisation.findUnique({ where: { slug: ORG_SLUG } });
    if (org) {
      this.organisationId = org.id;
      const entity = await prisma.entity.findFirst({ where: { organisationId: org.id } });
      this.entityId = entity?.id ?? null;
      this.sites = await prisma.site.findMany({ where: { organisationId: org.id }, orderBy: { name: "asc" } }).then((rows) =>
        rows.map((r) => ({ key: BOARD1.sites.find((s) => s.name === r.name)?.key ?? r.name, id: r.id, name: r.name })),
      );
    }
  }

  // -------------------------------------------------------------------
  // Organisation, entity, sites, personas
  // -------------------------------------------------------------------

  async createSyntheticOrganisationAndActors(): Promise<void> {
    const org = await prisma.organisation.create({ data: { name: BOARD1.organisation, slug: ORG_SLUG } });
    this.organisationId = org.id;

    const entity = await prisma.entity.create({ data: { organisationId: org.id, name: BOARD1.organisation } });
    this.entityId = entity.id;

    for (const site of BOARD1.sites) {
      const row = await prisma.site.create({ data: { organisationId: org.id, entityId: entity.id, name: site.name } });
      this.sites.push({ key: site.key, id: row.id, name: site.name });
    }

    const grants = [
      "carbon.view",
      "carbon.report.generate",
      "carbon.report.export",
      "ems.view",
      "ems.aspect.edit",
      "ems.control.manage",
      "ems.nonconformity.manage",
      "ems.corrective_action.manage",
      "ems.corrective_action.effectiveness_review",
      "ems.objective.manage",
      "ems.management_review.manage",
    ];
    for (const code of grants) {
      await prisma.permissionDefinition.upsert({
        where: { code },
        create: { code, domain: code.split(".")[0], description: "BOARD-1 demonstration grant" },
        update: {},
      });
    }

    // Ephemeral synthetic credentials — never a fixed/shared password.
    // These personas sign in through the normal auth path in a persistent
    // environment; for the disposable Postgres CI proof, only the resolved
    // OrganisationContext is used directly.
    const persona = async (name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE", status: "ACTIVE" | "SUSPENDED", permissionCodes: string[]) => {
      const user = await prisma.user.create({
        data: {
          name: `BOARD-1 ${name}`,
          email: `board-1-${name}-${randomUUID()}@example.invalid`,
          passwordHash: createHash("sha256").update(randomUUID()).digest("hex"),
          role: "DATA_OWNER",
        },
      });
      const membership = await prisma.organisationMembership.create({
        data: { organisationId: org.id, userId: user.id, status, accessMode },
      });
      const role = await prisma.roleDefinition.create({ data: { organisationId: org.id, name: `BOARD-1 ${name}` } });
      await prisma.rolePermission.createMany({
        data: permissionCodes.map((permissionCode) => ({ organisationId: org.id, roleId: role.id, permissionCode })),
      });
      await prisma.membershipRole.create({ data: { organisationId: org.id, roleId: role.id, membershipId: membership.id } });
      if (status !== "ACTIVE") return null;
      return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org.id });
    };

    // Contributor / site manager — enters activity data (contract persona).
    await persona("contributor", "ORGANISATION_WIDE", "ACTIVE", ["carbon.view"]);
    // Sustainability lead — owns the carbon/EMS chain and the management pack.
    this.sustainabilityLead = await persona("sustainability-lead", "ORGANISATION_WIDE", "ACTIVE", grants);
    // Independent reviewer — the separate four-eyes actor for effectiveness review and pack issuance oversight.
    this.independentReviewer = await persona("independent-reviewer", "ORGANISATION_WIDE", "ACTIVE", grants);
    // Read-only persona (contract).
    await persona("read-only", "ORGANISATION_WIDE", "ACTIVE", ["carbon.view", "ems.view"]);
    // Restricted-scope persona (contract) — RESTRICTED access mode, no site grants configured, proving denial by default.
    await persona("restricted", "RESTRICTED", "ACTIVE", ["carbon.view", "ems.view"]);
    // Suspended persona (contract) — membership exists but cannot authenticate.
    await persona("suspended", "ORGANISATION_WIDE", "SUSPENDED", ["carbon.view"]);

    this.owner = this.sustainabilityLead;
    if (!this.owner || !this.independentReviewer) throw new Error("BOARD-1 persona setup failed.");
  }

  // -------------------------------------------------------------------
  // Corporate carbon: 48 real calculated targets + 192 reviewed obligations
  // -------------------------------------------------------------------

  async createAndCalculateCarbon(targets: CarbonTarget[], obligations: ReturnType<typeof buildSubmissionObligations>): Promise<void> {
    if (!this.owner || !this.entityId) throw new Error("Organisation must be created before carbon.");
    const owner = this.owner;
    const ctx = toTenantRepositoryContext(owner);

    // A single organisation-owned factor set, clearly disclosed as
    // synthetic. Scope 1/electricity calculation is hard-coded by the
    // retained engine to resolve against the most recently effective
    // OFFICIAL_DEFRA_DESNZ set (entries-service.ts's findFactorSet) — that
    // enum tag is a required engine plumbing detail, not a claim of
    // official-ness; the human-readable name/notes are unambiguous. This
    // fixture only ever runs on a positively-verified, disposable,
    // single-tenant database (assertDemoTarget's ordinaryOrganisationCount
    // check), so it can never shadow another tenant's real factor set.
    const officialSet = await prisma.emissionFactorSet.create({
      data: {
        name: "BOARD-1 demo factors — not for reporting",
        publisher: "Synthetic demonstration fixture",
        sourceType: "OFFICIAL_DEFRA_DESNZ",
        vintageYear: 2026,
        effectiveFrom: new Date("2020-01-01"),
        isPlaceholder: true,
        notes: `${BOARD1.disclosure}. These factors exist only to make the BOARD-1 fixture's headline reconcile; they must never be used for real reporting.`,
      },
    });
    this.officialFactorSetId = officialSet.id;

    const factorCategoryFor: Record<string, { scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3"; factorCategory: string; scope3Category?: string }> = {
      gas: { scope: "SCOPE_1", factorCategory: "stationary_combustion_natural_gas" },
      fleet: { scope: "SCOPE_1", factorCategory: "mobile_combustion_fuel" },
      electricity: { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      "electricity-a": { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      "electricity-b": { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      substrate: { scope: "SCOPE_3", factorCategory: "board1_purchased_goods", scope3Category: "Cat 1 — Purchased goods & services" },
      services: { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      consumables: { scope: "SCOPE_3", factorCategory: "board1_purchased_consumables", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-a": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-b": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-c": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-d": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      travel: { scope: "SCOPE_3", factorCategory: "board1_business_travel", scope3Category: "Cat 6 — Business travel" },
      commuting: { scope: "SCOPE_3", factorCategory: "board1_employee_commuting", scope3Category: "Cat 7 — Employee commuting" },
    };

    // WTT/T&D-losses companion factors so the real Category 3 derivation
    // engine (scope3-derived.ts) has something to find — a small, plausible
    // rate that leaves room under the 15%/5% travel/commuting envelope.
    const wttSet = await prisma.emissionFactorSet.create({
      data: {
        name: "BOARD-1 demo WTT/T&D factors — not for reporting",
        publisher: "Synthetic demonstration fixture",
        sourceType: "OFFICIAL_DEFRA_DESNZ",
        vintageYear: 2026,
        effectiveFrom: new Date("2020-01-02"),
        isPlaceholder: true,
        notes: `${BOARD1.disclosure}. Well-to-tank/T&D-losses companion factors for the fixture's own derived Category 3.`,
      },
    });
    this.wttFactorSetId = wttSet.id;
    await prisma.emissionFactor.createMany({
      data: [
        { factorSetId: officialSet.id, scope: "SCOPE_1", category: "stationary_combustion_natural_gas", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_1", category: "mobile_combustion_fuel", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_2", category: "grid_electricity", basis: "LOCATION_BASED", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_2", category: "grid_electricity", basis: "RESIDUAL_MIX", unit: "kg", co2eFactor: "0.5" },
        { factorSetId: wttSet.id, scope: "SCOPE_3", category: "wtt_natural_gas", basis: "STANDARD", unit: "kg", co2eFactor: "0.05" },
        { factorSetId: wttSet.id, scope: "SCOPE_3", category: "wtt_road_fuel", basis: "STANDARD", unit: "kg", co2eFactor: "0.05" },
        { factorSetId: wttSet.id, scope: "SCOPE_3", category: "td_losses_electricity", basis: "STANDARD", unit: "kg", co2eFactor: "0.05" },
      ],
    });
    // Scope 3 purchased-goods/travel/commuting factors, resolved via the
    // multi-source resolver — a plain organisation-visible library entry
    // (sourceType OFFICIAL_DEFRA_DESNZ is what resolveFactorMultiSource
    // also searches first; same disclosed, synthetic set).
    await prisma.emissionFactor.createMany({
      data: [
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_goods", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_services", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_consumables", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_business_travel", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_employee_commuting", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
      ],
    });

    const dataPointIdByCategory = new Map<string, string>();
    for (const [sourceKey, def] of Object.entries(factorCategoryFor)) {
      if (dataPointIdByCategory.has(def.factorCategory)) continue;
      const dp = await prisma.activityDataPoint.upsert({
        where: { code: `BOARD1-${def.factorCategory}` },
        create: {
          code: `BOARD1-${def.factorCategory}`,
          scope: def.scope,
          category: "BOARD-1 demonstration",
          dataPointName: `BOARD-1 ${sourceKey}`,
          promptTemplate: "Synthetic BOARD-1 fixture input.",
          unitOptions: ["kg"],
          frequency: "Monthly",
          defaultTier: "TIER_3",
          formType: "QUANTITY",
          buildPriority: "BOARD-1",
          factorCategory: def.factorCategory,
          scope3Category: def.scope3Category ?? null,
        },
        update: {},
      });
      dataPointIdByCategory.set(def.factorCategory, dp.id);
    }

    const siteById = new Map(this.sites.map((s) => [s.key, s]));

    // Phase 1: real Scope 1/2 entries + calculations for 2026 only — the
    // year the derived Category 3 mechanism and the 192 obligations cover.
    // 2025 (prior comparable) only needs to reconcile its own total, so it
    // is seeded as Scope-1/2/3 lines directly without a derive pass.
    const targets2026 = targets.filter((t) => t.year === 2026);
    const targets2025 = targets.filter((t) => t.year === 2025);

    // Each site-month's entries touch disjoint ActivityEntry rows, so
    // building them concurrently across targets is safe (real-Postgres CI
    // proved the fully sequential version correct but far too slow —
    // ~300 sequential real-service round trips exceeded a 5-minute budget).
    await Promise.all(
      targets2026.map(async (target) => {
        const site = siteById.get(target.siteKey)!;
        const periodStart = new Date(`${target.month}-01T00:00:00Z`);
        const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));

        if (target.scope1Kg > 0) {
          const [gasKg, fleetKg] = [round4(target.scope1Kg * 0.8), round4(target.scope1Kg * 0.2)];
          await Promise.all(
            ([["gas", gasKg], ["fleet", fleetKg]] as const).map(([source, kg]) => {
              if (kg <= 0) return null;
              return createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id,
                periodStart,
                periodEnd,
                rawValue: kg,
                rawUnit: "kg",
                enteredByUserId: owner.userId,
                dataQualityTier: "TIER_3",
              });
            }),
          );
        }
        if (target.scope2LocationKg > 0) {
          const electricityKeys = target.siteKey === "central-digital" ? ["electricity-a", "electricity-b"] : ["electricity"];
          const share = target.scope2LocationKg / electricityKeys.length;
          await Promise.all(
            electricityKeys.map((source) =>
              createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id,
                periodStart,
                periodEnd,
                rawValue: round4(share),
                rawUnit: "kg",
                enteredByUserId: owner.userId,
                dataQualityTier: "TIER_3",
              }),
            ),
          );
        }
      }),
    );

    // Phase 2: run the real derived-Category-3 mechanism over the whole
    // 2026 window, then read its actual persisted result per site/month.
    await prepareReportingData(owner, new Date("2026-01-01"), new Date("2026-08-31"));

    const derivedRows = await prisma.calculation.findMany({
      where: { organisationId: owner.organisationId, scope3Category: "Cat 3 — Fuel- and energy-related activities" },
      include: { activityEntry: true },
    });
    const derivedCat3BySiteMonth = new Map<string, number>();
    for (const row of derivedRows) {
      const key = `${row.activityEntry.siteId}:${monthOf(row.activityEntry.periodStart)}`;
      derivedCat3BySiteMonth.set(key, (derivedCat3BySiteMonth.get(key) ?? 0) + Number(row.resultKgCo2e));
    }

    // Phase 3: Scope 3 category 1/6/7 entries — category1 is whatever
    // scope3Allocation says is left after the *actual* derived category 3,
    // never an independently invented number. Independent per site-month,
    // so built concurrently for the same reason as Phase 1.
    const { scope3Allocation } = await import("./board1");
    await Promise.all(
      targets2026
        .filter((t) => t.scope3Kg > 0)
        .map(async (target) => {
          const site = siteById.get(target.siteKey)!;
          const periodStart = new Date(`${target.month}-01T00:00:00Z`);
          const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
          const derivedCat3Kg = derivedCat3BySiteMonth.get(`${site.id}:${target.month}`) ?? 0;
          const parts = scope3Allocation(target.scope3Kg, round4(derivedCat3Kg));

          const writes: Promise<unknown>[] = [];
          if (parts.category6Kg > 0) {
            writes.push(createActivityEntryWithCalculations(ctx, {
              activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.travel.factorCategory)!,
              siteId: site.id, periodStart, periodEnd, rawValue: parts.category6Kg, rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
            }));
          }
          if (parts.category7Kg > 0) {
            writes.push(createActivityEntryWithCalculations(ctx, {
              activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.commuting.factorCategory)!,
              siteId: site.id, periodStart, periodEnd, rawValue: parts.category7Kg, rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
            }));
          }
          if (parts.category1Kg > 0) {
            const purchasedKeys = target.siteKey === "central-digital" ? ["services-a", "services-b", "services-c", "services-d"] : ["substrate", "services", "consumables"];
            const share = parts.category1Kg / purchasedKeys.length;
            for (const source of purchasedKeys) {
              writes.push(createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id, periodStart, periodEnd, rawValue: round4(share), rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
              }));
            }
          }
          await Promise.all(writes);
        }),
    );

    // 2025 comparable window: same construction, but scope3 is entered as a
    // single "board1_purchased_goods" line per site-month (only the total
    // needs to reconcile; the fine category split is a 2026-only claim).
    await Promise.all(
      targets2025.map(async (target) => {
        const site = siteById.get(target.siteKey)!;
        const periodStart = new Date(`${target.month}-01T00:00:00Z`);
        const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
        const writes: Promise<unknown>[] = [];
        if (target.scope1Kg > 0) {
          const [gasKg, fleetKg] = [round4(target.scope1Kg * 0.8), round4(target.scope1Kg * 0.2)];
          for (const [source, kg] of [["gas", gasKg], ["fleet", fleetKg]] as const) {
            if (kg <= 0) continue;
            writes.push(createActivityEntryWithCalculations(ctx, {
              activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
              siteId: site.id, periodStart, periodEnd, rawValue: kg, rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
            }));
          }
        }
        if (target.scope2LocationKg > 0) {
          const electricityKeys = target.siteKey === "central-digital" ? ["electricity-a", "electricity-b"] : ["electricity"];
          const share = target.scope2LocationKg / electricityKeys.length;
          for (const source of electricityKeys) {
            writes.push(createActivityEntryWithCalculations(ctx, {
              activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
              siteId: site.id, periodStart, periodEnd, rawValue: round4(share), rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
            }));
          }
        }
        if (target.scope3Kg > 0) {
          writes.push(createActivityEntryWithCalculations(ctx, {
            activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.substrate.factorCategory)!,
            siteId: site.id, periodStart, periodEnd, rawValue: round4(target.scope3Kg), rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
          }));
        }
        await Promise.all(writes);
      }),
    );

    // 192 real, independently reviewable source-period obligations — plain
    // reference rows (no state machine of their own), so a single batched
    // insert is appropriate.
    await prisma.carbonSourcePeriodObligation.createMany({
      data: obligations.map((obligation) => ({
        organisationId: owner.organisationId,
        siteId: siteById.get(obligation.siteKey)!.id,
        month: obligation.month,
        sourceKey: obligation.source,
        externalKey: obligation.externalKey,
        status: "REVIEWED",
        reviewedByMembershipId: owner.membershipId,
        reviewedAt: new Date(),
      })),
    });
  }

  // -------------------------------------------------------------------
  // Evidence
  // -------------------------------------------------------------------

  async storeEvidence(files: ReturnType<typeof buildSyntheticEvidence>): Promise<void> {
    if (!this.owner) throw new Error("Organisation must be created before evidence.");
    for (const file of files) {
      const evidence = await uploadEvidenceObject(this.owner, {
        fileName: file.name,
        mimeType: file.mime,
        bytes: file.bytes,
        uploadedByUserId: this.owner.userId,
      });
      if (evidence.checksumSha256 !== file.sha256) {
        throw new Error(`Evidence checksum mismatch for "${file.key}" after persistence.`);
      }
      this.evidenceIdByKey.set(file.key, evidence.id);
    }
  }

  // -------------------------------------------------------------------
  // EMS improvement chain (real state machines, per BD06's proven pattern)
  // -------------------------------------------------------------------

  async createImprovementChain(chain: typeof IMPROVEMENT_CHAIN): Promise<void> {
    void chain; // board1.ts's IMPROVEMENT_CHAIN is documentation of the intended story; the real chain below is built through live services, not iterated from this data.
    if (!this.owner || !this.independentReviewer || !this.sites.length) throw new Error("Organisation must be created before the EMS chain.");
    const owner = this.owner;
    const reviewer = this.independentReviewer;
    const northWorks = this.sites.find((s) => s.key === "north-works")!;

    const programme = await prisma.emsProgramme.create({
      data: { organisationId: owner.organisationId, name: "BOARD-1 demonstration programme", standardsProfile: "ISO14001", standardsProfileVersion: "2015", ownerMembershipId: owner.membershipId },
    });
    const process = await prisma.activityProcess.create({
      data: { organisationId: owner.organisationId, programmeId: programme.id, name: "North Works materials handling", siteId: northWorks.id },
    });

    const aspect = await createEnvironmentalAspect(owner, {
      processId: process.id,
      name: "Solvent storage and transfer",
      description: "Fictional materials-handling process with local water/soil impact under abnormal conditions.",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "ABNORMAL",
      effect: "ADVERSE",
      actorUserId: owner.userId,
    });
    this.aspectId = aspect.id;

    const otherSource = await prisma.otherRequirementSource.create({
      data: {
        organisationId: owner.organisationId,
        type: "VOLUNTARY_COMMITMENT",
        title: "Monthly containment inspection — internal requirement",
        issuingParty: "Northstar internal policy (fictional, not a statutory obligation)",
        ownerMembershipId: owner.membershipId,
        createdByUserId: owner.userId,
      },
    });
    this.otherRequirementSourceId = otherSource.id;

    const control = await createOperationalControl(owner, {
      controlKey: `BOARD1-CTL-${randomUUID().slice(0, 8)}`,
      title: "Containment inspection procedure",
      type: "PROCEDURAL",
      description: "Named checks and retained evidence, revision 2.",
      ownerMembershipId: owner.membershipId,
      reviewDueDate: new Date("2026-12-01"),
      aspectIds: [aspect.id],
      actorUserId: owner.userId,
    });
    this.controlId = control.id;

    const inspectionEvidenceId = this.evidenceIdByKey.get("inspection");
    const procedureEvidenceId = this.evidenceIdByKey.get("procedure");
    const check = await recordControlCheck(owner, {
      controlId: control.id,
      scheduledAt: new Date("2026-08-01"),
      result: "PASS",
      actorUserId: owner.userId,
    });
    if (inspectionEvidenceId) {
      await uploadEvidenceToControlCheck(owner, { checkId: check.id, fileName: "BOARD-1-inspection.txt", mimeType: "text/plain", bytes: Buffer.from("linked"), purpose: "inspection-checklist", actorUserId: owner.userId }).catch(() => null);
    }
    if (procedureEvidenceId) {
      await linkEvidence(owner, { evidenceId: procedureEvidenceId, resourceType: "control_check", resourceId: check.id, purpose: "procedure-revision", linkedByUserId: owner.userId });
    }

    await createEnvironmentalObjective(owner, {
      title: "Improve containment assurance",
      intent: "Reduce recurrence of unrecorded containment-inspection ownership across sites.",
      ownerMembershipId: owner.membershipId,
      baselineDescription: "Inspection ownership not consistently recorded (synthetic baseline).",
      targetDate: new Date("2027-01-01"),
      evaluationMethod: "Measured assurance coverage across scheduled inspections; action completion alone does not achieve it.",
      sourceLinks: [],
      actorUserId: owner.userId,
    }).catch(() => null); // objective lifecycle is out of this chain's critical path; never blocks the mandatory NC/CAPA chain below

    const evaluationEvidenceId = this.evidenceIdByKey.get("evaluation");
    if (evaluationEvidenceId) {
      await linkEvidence(owner, { evidenceId: evaluationEvidenceId, resourceType: "other_requirement_source", resourceId: otherSource.id, purpose: "internal-requirement-evaluation", linkedByUserId: owner.userId });
    }

    const auditProgramme = await prisma.auditProgramme.create({
      data: { organisationId: owner.organisationId, name: "BOARD-1 internal audit programme", riskBasis: "Synthetic", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), ownerMembershipId: owner.membershipId, createdByUserId: owner.userId },
    });
    const audit = await prisma.emsAudit.create({
      data: { organisationId: owner.organisationId, programmeId: auditProgramme.id, type: "INTERNAL", title: "BOARD-1 internal audit", criteriaSummary: "Synthetic", leadMembershipId: owner.membershipId, scheduledStart: new Date("2026-08-01"), scheduledEnd: new Date("2026-08-02"), status: "REPORT_ISSUED", createdByUserId: owner.userId },
    });
    const finding = await prisma.auditFinding.create({
      data: { organisationId: owner.organisationId, auditId: audit.id, classification: "MINOR_NONCONFORMITY", status: "CONFIRMED", statement: "Inspection ownership is not consistently recorded in the fictional sample.", confirmedAt: new Date(), confirmedByUserId: owner.userId, createdByUserId: owner.userId },
    });
    this.findingId = finding.id;
    const auditObservationEvidenceId = this.evidenceIdByKey.get("audit-observation");
    if (auditObservationEvidenceId) {
      await linkEvidence(owner, { evidenceId: auditObservationEvidenceId, resourceType: "audit_finding", resourceId: finding.id, purpose: "audit-observation", linkedByUserId: owner.userId });
    }

    const nc = await createNonconformityFromSource(owner, {
      reference: `BOARD1-NC-${randomUUID().slice(0, 8)}`,
      sourceType: "AUDIT_FINDING",
      sourceId: finding.id,
      statement: "Containment inspection gap: ownership not consistently recorded.",
      requirementReference: "Monthly containment inspection — internal requirement",
      operationalControlId: control.id,
      ownerMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    this.nonconformityId = nc.id;

    await recordContainment(owner, nc.id, { actionTaken: "Interim manual sign-off sheet introduced at North Works.", actionTakenAt: new Date("2026-08-05"), ownerMembershipId: owner.membershipId, actorUserId: owner.userId });
    const rootCause = await recordRootCauseAnalysis(owner, nc.id, { method: "FIVE_WHYS", analysisPayload: { note: "No single named owner for the monthly check." }, conclusion: "Inspection ownership was never assigned to a named role.", actorUserId: owner.userId });
    await approveRootCauseAnalysis(owner, rootCause.id, { actorUserId: owner.userId });

    const action = await createCorrectiveAction(owner, nc.id, { description: "Name a single inspection owner and record it in the procedure.", ownerMembershipId: owner.membershipId, dueDate: new Date("2026-09-01"), actorUserId: owner.userId });
    this.correctiveActionId = action.id;
    await completeCorrectiveAction(owner, action.id, { completionEvidenceNote: "Named owner recorded; inspection schedule confirmed.", actorUserId: owner.userId });

    const completionEvidenceId = this.evidenceIdByKey.get("completion");
    if (completionEvidenceId) {
      await linkEvidence(owner, { evidenceId: completionEvidenceId, resourceType: "corrective_action", resourceId: action.id, purpose: "completion-evidence", linkedByUserId: owner.userId });
    }

    const reviewable = await requestEffectivenessReview(owner, nc.id, { actorUserId: owner.userId });
    await performEffectivenessReview(reviewer, nc.id, {
      reviewCycle: reviewable.reviewCycle,
      criteria: "Repeat inspection has a named owner, a recorded condition and a retained checklist.",
      reviewDate: new Date("2026-09-05"),
      result: "EFFECTIVE",
      decision: "Independent review confirms the containment inspection gap is closed.",
      actorUserId: reviewer.userId,
    });
    const effectivenessEvidenceId = this.evidenceIdByKey.get("effectiveness");
    if (effectivenessEvidenceId) {
      await linkEvidence(owner, { evidenceId: effectivenessEvidenceId, resourceType: "corrective_action", resourceId: action.id, purpose: "effectiveness-review-evidence", linkedByUserId: owner.userId });
    }
  }

  // -------------------------------------------------------------------
  // LCA — real engine, no corporate contamination
  // -------------------------------------------------------------------

  async createAndCalculateLca(plan: typeof BOARD1.lca): Promise<void> {
    if (!this.owner || !this.entityId) throw new Error("Organisation must be created before LCA.");
    const owner = this.owner;

    const product = await prisma.product.create({
      data: {
        entityId: this.entityId,
        organisationId: owner.organisationId,
        name: plan.product,
        sku: "BOARD1-CARD-V1",
        versions: { create: { versionLabel: "v1" } },
      },
      include: { versions: true },
    });

    const baseline = await createAssessment(owner, {
      entityId: this.entityId,
      productVersionId: product.versions[0].id,
      reference: "BOARD1-LCA-001",
      title: plan.product,
      boundary: "CRADLE_TO_GATE",
      actorUserId: owner.userId,
    });
    this.lcaAssessmentId = baseline.id;

    await this.buildLcaProcessesAndItems(owner, baseline.id, plan.baseline);
    await runCalculation({ assessmentId: baseline.id, actorUserId: owner.userId });

    const scenario = await cloneAssessment(owner, {
      sourceAssessmentId: baseline.id,
      reference: "BOARD1-LCA-001-S1",
      title: `${plan.product} — lighter substrate scenario`,
      kind: "scenario",
      actorUserId: owner.userId,
    });
    this.lcaScenarioId = scenario.id;
    await this.replaceLcaMaterialsQuantity(owner, scenario.id, plan.scenario.materials);
    await runCalculation({ assessmentId: scenario.id, actorUserId: owner.userId });
  }

  private async buildLcaProcessesAndItems(context: OrganisationContext, assessmentId: string, contributions: typeof BOARD1.lca.baseline): Promise<void> {
    const stages: { key: keyof typeof contributions; stage: LcaLifecycleStage; name: string }[] = [
      { key: "materials", stage: LcaLifecycleStage.RAW_MATERIALS, name: "Card substrate" },
      { key: "manufacture", stage: LcaLifecycleStage.MANUFACTURING, name: "Card manufacture" },
      { key: "transport", stage: LcaLifecycleStage.INBOUND_TRANSPORT, name: "Inbound transport" },
    ];
    for (const s of stages) {
      const process = await upsertProcess(context, {
        assessmentId,
        stage: s.stage,
        name: s.name,
        isIncluded: true,
        allocationMethod: LcaAllocationMethod.NONE,
        actorUserId: context.userId,
      });
      const item = await upsertInventoryItem(context, {
        assessmentId,
        processId: process.id,
        itemType: LcaItemType.MATERIAL,
        name: s.name,
        quantity: String(contributions[s.key]),
        unit: "kg",
        dataType: LcaDataType.PRIMARY,
        classification: LcaEmissionClassification.FOSSIL,
        actorUserId: context.userId,
      });
      await assignFactor(context, {
        inventoryItemId: item.id,
        assessmentId,
        mode: LcaFactorSelectionMode.MANUAL,
        manualFactorValue: "1",
        manualFactorUnit: "kg",
        manualFactorSource: "BOARD-1 demonstration — not for reporting",
        manualFactorVersion: "2026",
        actorUserId: context.userId,
      });
    }
  }

  private async replaceLcaMaterialsQuantity(context: OrganisationContext, scenarioAssessmentId: string, materialsKg: number): Promise<void> {
    const materialsProcess = await prisma.lcaProcess.findFirstOrThrow({ where: { assessmentId: scenarioAssessmentId, stage: LcaLifecycleStage.RAW_MATERIALS } });
    const item = await prisma.lcaInventoryItem.findFirstOrThrow({ where: { assessmentId: scenarioAssessmentId, processId: materialsProcess.id } });
    await upsertInventoryItem(context, {
      id: item.id,
      assessmentId: scenarioAssessmentId,
      processId: materialsProcess.id,
      itemType: LcaItemType.MATERIAL,
      name: item.name,
      quantity: String(materialsKg),
      unit: "kg",
      dataType: LcaDataType.PRIMARY,
      classification: LcaEmissionClassification.FOSSIL,
      actorUserId: context.userId,
    });
  }

  // -------------------------------------------------------------------
  // Frozen management pack
  // -------------------------------------------------------------------

  async createFrozenManagementPack(): Promise<void> {
    if (!this.owner) throw new Error("Organisation must be created before the management pack.");
    const owner = this.owner;

    const template = await prisma.managementReviewAgendaTemplate.create({
      data: { organisationId: owner.organisationId, templateKey: "board1-agenda", name: "BOARD-1 demonstration agenda" },
    });
    const version = await prisma.managementReviewAgendaTemplateVersion.create({
      data: { organisationId: owner.organisationId, templateId: template.id, version: 1, name: "v1", status: "APPROVED", preparedByUserId: owner.userId },
    });
    const review = await scheduleManagementReview(owner, {
      reference: "BOARD1-MR-2026-Q3",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-08-31"),
      cutoffDate: new Date("2026-08-31"),
      scheduledDate: new Date("2026-09-08"),
      chairMembershipId: owner.membershipId,
      coordinatorMembershipId: owner.membershipId,
      agendaTemplateVersionId: version.id,
      actorUserId: owner.userId,
    });
    this.managementReviewId = review.id;
    await startManagementReviewInputCollection(owner, review.id, owner.userId);

    // Input links require a pre-existing active ManagementReviewInputDefinition
    // (organisation-configured input catalogue) — out of BD08's scope to add.
    // A pack with zero linked inputs is still a genuine, real snapshot (the
    // same shape the pack-service test suite already exercises), not a
    // partial/fake one.

    await generateManagementReviewPack(owner, review.id, owner.userId);
    const issued = await issueManagementReviewPack(owner, review.id, owner.userId);
    this.managementPackId = issued.id;
  }

  // -------------------------------------------------------------------
  // Independent reconciliation
  // -------------------------------------------------------------------

  async verifyAllInvariants(): Promise<{ digest: string }> {
    if (!this.organisationId) throw new Error("Nothing to verify — organisation was never created.");
    const organisationId = this.organisationId;

    const primaryCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
      include: { activityEntry: true },
    });
    const derivedCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: { not: null }, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
    });

    const sum = (rows: { resultKgCo2e: unknown }[]) => rows.reduce((s, r) => s + Number(r.resultKgCo2e), 0);
    const currentTotal = round4(sum(primaryCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")) + sum(derivedCalcs));
    const marketCompanion = round4(sum(primaryCalcs.filter((c) => c.basis === "RESIDUAL_MIX" || c.basis === "MARKET_BASED")));

    if (Math.abs(currentTotal - BOARD1.currentKg) > 1) {
      throw new Error(`Reconciliation failed: current headline is ${currentTotal} kgCO2e, expected ${BOARD1.currentKg}.`);
    }
    if (Math.abs(marketCompanion - BOARD1.marketBasedScope2Kg) > 1) {
      throw new Error(`Reconciliation failed: Scope 2 market-based companion is ${marketCompanion} kgCO2e, expected ${BOARD1.marketBasedScope2Kg}.`);
    }

    const priorCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2025-01-01"), lte: new Date("2025-08-31") } } },
    });
    const priorTotal = round4(sum(priorCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")));
    if (Math.abs(priorTotal - BOARD1.previousKg) > 1) {
      throw new Error(`Reconciliation failed: prior headline is ${priorTotal} kgCO2e, expected ${BOARD1.previousKg}.`);
    }

    const obligationCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId, month: { startsWith: "2026" } } });
    const reviewedCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId, month: { startsWith: "2026" }, status: "REVIEWED" } });
    if (obligationCount !== 192 || reviewedCount !== 192) {
      throw new Error(`Reconciliation failed: ${reviewedCount}/${obligationCount} source-period obligations reviewed, expected 192/192.`);
    }

    for (const [key, expectedSha] of (await import("./evidence")).buildSyntheticEvidence().map((f) => [f.key, f.sha256] as const)) {
      const evidenceId = this.evidenceIdByKey.get(key);
      if (!evidenceId) throw new Error(`Reconciliation failed: evidence "${key}" was never stored.`);
      const row = await prisma.evidenceObject.findUniqueOrThrow({ where: { id: evidenceId } });
      if (row.checksumSha256 !== expectedSha) throw new Error(`Reconciliation failed: evidence "${key}" checksum does not match its generated bytes.`);
    }

    if (!this.lcaAssessmentId || !this.lcaScenarioId) throw new Error("Reconciliation failed: LCA assessment/scenario missing.");
    const [baselineRun, scenarioRun] = await Promise.all([getLatestRun(this.lcaAssessmentId), getLatestRun(this.lcaScenarioId)]);
    if (!baselineRun || !scenarioRun) throw new Error("Reconciliation failed: LCA baseline/scenario has no calculated run.");
    const baselinePerFu = runTotals(baselineRun).headlinePerFunctionalUnitKgCo2e;
    const scenarioPerFu = runTotals(scenarioRun).headlinePerFunctionalUnitKgCo2e;
    if (Math.abs(baselinePerFu - 0.12) > 0.0005 || Math.abs(scenarioPerFu - 0.102) > 0.0005) {
      throw new Error(`Reconciliation failed: LCA baseline/scenario is ${baselinePerFu}/${scenarioPerFu} kgCO2e/card, expected 0.120/0.102.`);
    }

    if (!this.managementPackId) throw new Error("Reconciliation failed: management pack was never issued.");
    const pack = await prisma.managementReviewPack.findUniqueOrThrow({ where: { id: this.managementPackId } });
    if (pack.status !== "ISSUED") throw new Error("Reconciliation failed: management pack is not issued.");

    if (!this.nonconformityId) throw new Error("Reconciliation failed: EMS chain nonconformity is missing.");
    const nc = await prisma.nonconformity.findUniqueOrThrow({ where: { id: this.nonconformityId } });
    if (nc.status !== "CLOSED") throw new Error(`Reconciliation failed: EMS chain nonconformity should be CLOSED, is ${nc.status}.`);

    const summary = {
      organisationId,
      currentKg: currentTotal,
      previousKg: priorTotal,
      marketBasedScope2Kg: marketCompanion,
      obligationsReviewed: `${reviewedCount}/${obligationCount}`,
      lcaBaselinePerFunctionalUnitKgCo2e: baselinePerFu,
      lcaScenarioPerFunctionalUnitKgCo2e: scenarioPerFu,
      managementPackId: pack.id,
      managementPackChecksum: pack.checksumSha256,
      nonconformityStatus: nc.status,
    };
    const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    return { digest };
  }

  async markFixtureReady(version: string, digest: string): Promise<void> {
    await prisma.demoFixtureLease.update({ where: { fixtureKey: version }, data: { status: "READY", digest } });
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
