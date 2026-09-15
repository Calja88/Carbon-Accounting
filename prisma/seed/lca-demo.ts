/**
 * Product LCA demonstration fixture — one complete, calculated product
 * carbon footprint plus one lower-carbon scenario.
 *
 * Standalone, idempotent, manual-only (`pnpm run db:seed:lca-demo`). Never
 * wired into `db:seed` or postinstall. Follows the same shape as
 * `prisma/seed/ems-demo.ts`: it reuses the `paragon-group` organisation the
 * main seed targets and never creates a second tenant.
 *
 * The specification it writes lives in `lca-demo-fixture.ts`, which has no
 * database dependency so the figures can be asserted against the real engine
 * in `lca-demo-fixture.test.ts`.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The *workflow* is real: every figure is produced by the unmodified LCA
 * engine (`runCalculation`) from activity data x emission factor, then
 * aggregated by the engine's own lifecycle taxonomy. Nothing on the results
 * page is typed in.
 *
 * The *numbers* are not. The bill of materials is a plausible synthetic
 * construction for a generic ID-1 contactless card, and the factors it is
 * priced from are illustrative magnitudes in a factor set flagged
 * `isPlaceholder` — so the validation engine raises a hard ERROR on every
 * line that uses one, every results surface carries the placeholder banner,
 * and the assessment can never reach "ready for verification". That is the
 * intended behaviour, not a defect: it is what stops a demonstration figure
 * from being mistaken for a published product footprint.
 *
 * This is NOT a Paragon product footprint and must never be presented as
 * one. Replace the factor set with a licensed life-cycle inventory dataset
 * and the bill of materials with a real one before any figure leaves the
 * room.
 */

import bcrypt from "bcryptjs";
import {
  FactorBasis,
  FactorSourceType,
  FactorVisibility,
  LcaAllocationMethod,
  LcaAssessmentStatus,
  LcaEmissionClassification,
  LcaEvidenceKind,
  LcaFactorSelectionMode,
  PrismaClient,
  Scope,
} from "@prisma/client";
import { resolveOrganisationContext, type OrganisationContext } from "../../src/lib/organisation/context";
import { createAssessment, cloneAssessment } from "../../src/lib/lca/assessment-service";
import { assignFactor, upsertInventoryItem, upsertProcess, upsertTransportLeg } from "../../src/lib/lca/model-service";
import { upsertAssumption, upsertExclusion } from "../../src/lib/lca/registers-service";
import { createEvidence } from "../../src/lib/lca/evidence-service";
import { getLatestRun, runCalculation, runTotals } from "../../src/lib/lca/calculation-service";
import { seedLcaMethodology } from "./lca";
import { provisionSystemRoleTemplates, seedPermissionCatalogue } from "./permissions";
import {
  ASSUMPTIONS,
  BASELINE_REFERENCE,
  BATCH_CARDS,
  BOM,
  DEMO_FACTORS,
  EXCLUSIONS,
  FACTOR_SET_ID,
  FUNCTIONAL_UNIT_CARDS,
  FUNCTIONAL_UNIT_DESCRIPTION,
  GWP_BASIS,
  PRODUCT_NAME,
  PRODUCT_SKU,
  PRODUCT_VERSION_LABEL,
  SCENARIO_CHANGES,
  SCENARIO_DESCRIPTION,
  SCENARIO_REFERENCE,
  SCENARIO_TITLE,
  STAGES,
  SUPPLIERS,
  SYNTHETIC_NOTE,
  bomCsv,
  type StageKey,
} from "./lca-demo-fixture";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Ui14Demo!2026";
const DEMO_LEAD_EMAIL = "sustainability.lead@ui14-demo.example";

const FACTOR_SET_NAME = "Illustrative smart-card life-cycle factors (DEMONSTRATION — not for reporting)";
/** Rendered as the source beside every factor on the inventory page, so it has to read as one. */
const FACTOR_SET_PUBLISHER = "Synthetic demonstration fixture";

const PERIOD_START = new Date("2026-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-12-31T00:00:00.000Z");

// ---------------------------------------------------------------------------

async function getOrganisation() {
  return prisma.organisation.upsert({
    where: { slug: "paragon-group" },
    update: {},
    create: { name: "Paragon Group", slug: "paragon-group" },
  });
}

async function getDemoContext(organisationId: string): Promise<OrganisationContext> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_LEAD_EMAIL },
    update: { name: "Demo Sustainability Lead" },
    create: { name: "Demo Sustainability Lead", email: DEMO_LEAD_EMAIL, passwordHash, role: "SUSTAINABILITY_LEAD" },
  });

  const role = await prisma.roleDefinition.findFirstOrThrow({
    where: { organisationId, templateKey: "SUSTAINABILITY_LEAD" },
  });
  const membership = await prisma.organisationMembership.upsert({
    where: { organisationId_userId: { organisationId, userId: user.id } },
    update: { status: "ACTIVE", accessMode: "ORGANISATION_WIDE", activatedAt: new Date(), suspendedAt: null },
    create: {
      organisationId,
      userId: user.id,
      status: "ACTIVE",
      accessMode: "ORGANISATION_WIDE",
      activatedAt: new Date(),
    },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
    update: {},
    create: { organisationId, membershipId: membership.id, roleId: role.id },
  });

  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: organisationId });
}

async function seedDemoFactorSet(organisationId: string): Promise<Map<string, string>> {
  const set = await prisma.emissionFactorSet.upsert({
    where: { id: FACTOR_SET_ID },
    update: {
      name: FACTOR_SET_NAME,
      publisher: FACTOR_SET_PUBLISHER,
      notes: SYNTHETIC_NOTE,
      ownerOrganisationId: organisationId,
      visibility: FactorVisibility.ORGANISATION,
      isPlaceholder: true,
    },
    create: {
      id: FACTOR_SET_ID,
      name: FACTOR_SET_NAME,
      publisher: FACTOR_SET_PUBLISHER,
      sourceType: FactorSourceType.LCA_SECONDARY,
      vintageYear: 2024,
      effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
      isPlaceholder: true,
      // Organisation-scoped so this fixture can never appear in another
      // tenant's factor picker (factor-library.ts#visibleFactorSetFilter).
      visibility: FactorVisibility.ORGANISATION,
      ownerOrganisationId: organisationId,
      notes: SYNTHETIC_NOTE,
    },
  });

  const ids = new Map<string, string>();
  for (const factor of DEMO_FACTORS) {
    const row = await prisma.emissionFactor.upsert({
      where: {
        factorSetId_category_subtypeKey_basis: {
          factorSetId: set.id,
          category: factor.category,
          subtypeKey: factor.subtypeKey,
          basis: FactorBasis.STANDARD,
        },
      },
      update: {
        unit: factor.unit,
        co2eFactor: factor.co2eFactor,
        region: factor.region,
        boundary: factor.boundary,
        referenceYear: factor.referenceYear,
        lcaDataSource: factor.dataSource,
        notes: SYNTHETIC_NOTE,
      },
      create: {
        factorSetId: set.id,
        // Product life-cycle inputs are, from the assessing organisation's
        // own corporate perspective, upstream value-chain emissions.
        scope: Scope.SCOPE_3,
        category: factor.category,
        subtypeKey: factor.subtypeKey,
        basis: FactorBasis.STANDARD,
        region: factor.region,
        unit: factor.unit,
        co2eFactor: factor.co2eFactor,
        boundary: factor.boundary,
        gwpBasis: GWP_BASIS,
        referenceYear: factor.referenceYear,
        lcaDataSource: factor.dataSource,
        notes: SYNTHETIC_NOTE,
      },
    });
    ids.set(factor.key, row.id);
  }
  return ids;
}

function requireFactor(factorIds: Map<string, string>, key: string): string {
  const id = factorIds.get(key);
  if (!id) throw new Error(`Demo factor "${key}" was not seeded`);
  return id;
}

/**
 * Removes a previous run of this fixture so re-seeding is safe. Most children
 * cascade from LcaAssessment; the few that do not are cleared explicitly, and
 * the run pointer is released first because it is a unique foreign key.
 */
async function removeAssessment(reference: string, entityId: string): Promise<void> {
  const existing = await prisma.lcaAssessment.findUnique({
    where: { entityId_reference: { entityId, reference } },
  });
  if (!existing) return;
  await prisma.lcaAssessment.update({ where: { id: existing.id }, data: { lastCalculationRunId: null } });
  await prisma.lcaEvidence.deleteMany({ where: { assessmentId: existing.id } });
  await prisma.lcaVerification.deleteMany({ where: { assessmentId: existing.id } });
  await prisma.lcaAssessmentVersion.deleteMany({ where: { assessmentId: existing.id } });
  await prisma.lcaAssessment.delete({ where: { id: existing.id } });
}

async function buildBaseline(
  context: OrganisationContext,
  entityId: string,
  productVersionId: string,
  methodologyProfileId: string,
  factorIds: Map<string, string>,
): Promise<string> {
  const assessment = await createAssessment(context, {
    entityId,
    productVersionId,
    reference: BASELINE_REFERENCE,
    title: "Contactless smart card — cradle to customer gate",
    ownerUserId: context.userId,
    methodologyProfileId,
    // CUSTOM rather than cradle-to-gate: the model deliberately carries
    // outbound distribution to the customer's receiving site, which a
    // cradle-to-gate boundary would leave out. A custom boundary must
    // describe itself, which `boundaryNotes` below does.
    boundary: "CUSTOM",
    functionalUnitDescription: FUNCTIONAL_UNIT_DESCRIPTION,
    functionalUnitQuantity: String(FUNCTIONAL_UNIT_CARDS),
    functionalUnitUnit: "item",
    isDeclaredUnit: false,
    actorUserId: context.userId,
  });

  await prisma.lcaAssessment.update({
    where: { id: assessment.id },
    data: {
      status: LcaAssessmentStatus.CALCULATION,
      goal: "Quantify the cradle-to-customer-gate carbon footprint of the standard contactless smart card, identify the largest contributors, and test a lower-carbon substrate and electricity supply against them.",
      intendedApplication:
        "Internal product design and procurement decisions, and customer tender responses once the illustrative factors have been replaced with a licensed dataset.",
      intendedAudience: "Product management, procurement, and customer sustainability teams.",
      comparativeAssertionDisclosed: false,
      scopeDescription:
        "Raw materials and components, inbound freight to the Hull site, card manufacture and its production scrap, sales packaging, and outbound distribution to the customer's receiving site.",
      boundaryNotes:
        "Cradle to customer gate. Includes raw materials, inbound transport, manufacturing, packaging and outbound distribution. The use phase and end of life are outside the boundary and are recorded in the exclusions register.",
      includedStages: STAGES.map((s) => s.stage),
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      referenceFlowDescription: `${FUNCTIONAL_UNIT_CARDS.toLocaleString("en-GB")} finished cards`,
      referenceFlowQuantity: String(FUNCTIONAL_UNIT_CARDS),
      referenceFlowUnit: "item",
      modelledOutputQuantity: String(BATCH_CARDS),
      modelledOutputUnit: "item",
      modelledOutputDescription: `One production batch of ${BATCH_CARDS.toLocaleString("en-GB")} cards, which is ${BATCH_CARDS / FUNCTIONAL_UNIT_CARDS} functional units.`,
      methodologyNotes:
        "GWP100 on IPCC AR6, cut-off treatment of recycled content, location-based electricity in the baseline. The scenario's renewable tariff is reported as a market-based alternative, not as a change to the baseline.",
      completenessNotes:
        "Every material in the bill of materials is modelled. Capital goods, site overheads outside the card line, and employee travel are outside the cut-off and are listed in the exclusions register.",
      limitations:
        "DEMONSTRATION FIXTURE. Every emission factor comes from an illustrative placeholder set, so no figure in this assessment is fit for reporting or for any external claim. The bill of materials is a synthetic construction for a generic ID-1 card, not a Paragon product specification.",
      interpretation:
        "The card body and site electricity together drive just over half the footprint, so substrate choice and electricity supply are where a reduction programme starts. The chip module is the third contributor and is supplier-controlled rather than site-controlled.",
    },
  });

  const processByStage = new Map<StageKey, string>();
  for (const stage of STAGES) {
    // createAssessment seeds a default process per stage in its boundary; a
    // CUSTOM boundary seeds none, so this both creates and reuses.
    const existing = await prisma.lcaProcess.findFirst({ where: { assessmentId: assessment.id, stage: stage.stage } });
    const process = await upsertProcess(context, {
      id: existing?.id ?? null,
      assessmentId: assessment.id,
      stage: stage.stage,
      name: stage.name,
      description: stage.description,
      isIncluded: true,
      allocationMethod: LcaAllocationMethod.NONE,
      geography: stage.geography ?? null,
      actorUserId: context.userId,
    });
    processByStage.set(stage.key, process.id);
  }

  const supplierIds = new Map<string, string>();
  for (const supplier of SUPPLIERS) {
    const row = await prisma.supplier.upsert({
      where: { entityId_name: { entityId, name: supplier.name } },
      update: { country: supplier.country, identifier: supplier.identifier },
      create: {
        entityId,
        organisationId: context.organisationId,
        name: supplier.name,
        identifier: supplier.identifier,
        country: supplier.country,
        notes: "Synthetic demonstration supplier.",
      },
    });
    supplierIds.set(supplier.name, row.id);
  }

  const itemIdsByName = new Map<string, string>();
  for (const line of BOM) {
    const processId = processByStage.get(line.stage);
    if (!processId) throw new Error(`No process seeded for stage ${line.stage}`);

    const item = await upsertInventoryItem(context, {
      assessmentId: assessment.id,
      processId,
      itemType: line.itemType,
      name: line.name,
      description: line.description,
      componentName: line.componentName ?? null,
      materialName: line.materialName ?? null,
      supplierId: line.supplier ? (supplierIds.get(line.supplier) ?? null) : null,
      quantity: line.quantity,
      unit: line.unit,
      dataType: line.dataType,
      dataSource: line.dataSource,
      geography: line.geography,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      classification: LcaEmissionClassification.FOSSIL,
      temporalScore: line.scores[0],
      geographicalScore: line.scores[1],
      technologicalScore: line.scores[2],
      completenessScore: line.scores[3],
      reliabilityScore: line.scores[4],
      actorUserId: context.userId,
    });
    itemIdsByName.set(line.name, item.id);

    if (line.factorKey) {
      await assignFactor(context, {
        inventoryItemId: item.id,
        assessmentId: assessment.id,
        mode: LcaFactorSelectionMode.LIBRARY_FACTOR,
        emissionFactorId: requireFactor(factorIds, line.factorKey),
        actorUserId: context.userId,
      });
    }

    for (const [sequence, leg] of (line.legs ?? []).entries()) {
      await upsertTransportLeg(context, {
        inventoryItemId: item.id,
        assessmentId: assessment.id,
        sequence,
        mode: leg.mode,
        originName: leg.origin,
        destinationName: leg.destination,
        distanceValue: leg.distanceKm,
        distanceUnit: "km",
        massValue: leg.massTonnes,
        massUnit: "t",
        includesReturnTrip: false,
        emissionFactorId: requireFactor(factorIds, leg.factorKey),
        assumptions: leg.assumptions,
        actorUserId: context.userId,
      });
    }
  }

  await seedRegisters(context, assessment.id, itemIdsByName);
  await seedEvidence(context, assessment.id, itemIdsByName, requireFactor(factorIds, "pvc"));

  return assessment.id;
}

async function seedRegisters(
  context: OrganisationContext,
  assessmentId: string,
  itemIdsByName: Map<string, string>,
): Promise<void> {
  for (const entry of ASSUMPTIONS) {
    await upsertAssumption(context, {
      assessmentId,
      assumption: entry.assumption,
      category: entry.category,
      rationale: entry.rationale,
      source: entry.source,
      materiality: entry.materiality,
      ownerUserId: context.userId,
      inventoryItemId: entry.item ? (itemIdsByName.get(entry.item) ?? null) : null,
      actorUserId: context.userId,
    });
  }

  for (const entry of EXCLUSIONS) {
    await upsertExclusion(context, {
      assessmentId,
      excludedItem: entry.excludedItem,
      rationale: entry.rationale,
      estimatedRelevance: entry.estimatedRelevance,
      estimatedPercentOfTotal: entry.percent,
      ownerUserId: context.userId,
      actorUserId: context.userId,
    });
  }
}

async function seedEvidence(
  context: OrganisationContext,
  assessmentId: string,
  itemIdsByName: Map<string, string>,
  pvcFactorId: string,
): Promise<void> {
  await createEvidence(context, {
    assessmentId,
    title: "Demonstration bill of materials (synthetic)",
    description:
      "The synthetic bill of materials the inventory was built from, as issued with this demonstration fixture. Not a Paragon production BOM.",
    inventoryItemId: itemIdsByName.get("PVC card body core") ?? null,
    file: { fileName: "demo-card-bom-rev-a.csv", mimeType: "text/csv", bytes: bomCsv() },
    actorUserId: context.userId,
  });

  // A system record rather than a link or an upload: what is being evidenced
  // is the factor set row itself, which genuinely exists in this database.
  // Written directly because createEvidence only mints link/upload kinds.
  await prisma.lcaEvidence.create({
    data: {
      assessmentId,
      organisationId: context.organisationId,
      title: "Life-cycle factor set used for every line (DEMONSTRATION)",
      description:
        "Illustrative smart-card life-cycle factors, flagged as a placeholder set. Recorded so the provenance of every figure in this assessment is visible, and so it is unmistakable that no licensed dataset sits behind them.",
      kind: LcaEvidenceKind.SYSTEM_RECORD,
      emissionFactorId: pvcFactorId,
      uploadedByUserId: context.userId,
    },
  });
}

async function buildScenario(
  context: OrganisationContext,
  baselineId: string,
  factorIds: Map<string, string>,
): Promise<string> {
  // cloneAssessment takes a full, independent copy — the baseline's own rows
  // are never written to by anything below.
  const scenario = await cloneAssessment(context, {
    sourceAssessmentId: baselineId,
    reference: SCENARIO_REFERENCE,
    title: SCENARIO_TITLE,
    kind: "scenario",
    scenarioDescription: SCENARIO_DESCRIPTION,
    copyRegisters: true,
    actorUserId: context.userId,
  });

  for (const change of SCENARIO_CHANGES) {
    const item = await prisma.lcaInventoryItem.findFirstOrThrow({
      where: { assessmentId: scenario.id, name: change.lineName },
    });
    await assignFactor(context, {
      inventoryItemId: item.id,
      assessmentId: scenario.id,
      mode: LcaFactorSelectionMode.LIBRARY_FACTOR,
      emissionFactorId: requireFactor(factorIds, change.factorKey),
      manualFactorRationale: change.rationale,
      actorUserId: context.userId,
    });
    await prisma.lcaInventoryItem.update({
      where: { id: item.id },
      data: { notes: `Scenario change: ${change.rationale}` },
    });
  }

  await prisma.lcaAssessment.update({
    where: { id: scenario.id },
    data: { status: LcaAssessmentStatus.CALCULATION },
  });

  return scenario.id;
}

async function report(label: string, assessmentId: string): Promise<number> {
  const run = await getLatestRun(assessmentId);
  if (!run) throw new Error(`${label} produced no calculation run`);
  const totals = runTotals(run);
  console.log(
    `  ${label}: ${totals.headlineModelKgCo2e.toFixed(2)} kgCO2e across the batch ` +
      `= ${totals.headlinePerFunctionalUnitKgCo2e.toFixed(3)} kgCO2e per ${FUNCTIONAL_UNIT_CARDS.toLocaleString("en-GB")} cards ` +
      `(${run.results.length} result lines, functional unit ${totals.functionalUnitResolved ? "resolved" : "UNRESOLVED"})`,
  );
  return totals.headlinePerFunctionalUnitKgCo2e;
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.LCA_DEMO_SEED_CONFIRM !== "yes") {
    throw new Error(
      "Refusing to write demonstration LCA data to a production environment. Set LCA_DEMO_SEED_CONFIRM=yes only if this database is a disposable demo.",
    );
  }

  console.log("Resolving organisation, permissions and the demonstration actor...");
  const organisation = await getOrganisation();
  await seedPermissionCatalogue(prisma);
  await provisionSystemRoleTemplates(prisma, organisation.id);

  const entity = await prisma.entity.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: "Paragon ID" } },
    update: {},
    create: { organisationId: organisation.id, name: "Paragon ID" },
  });
  const site = await prisma.site.upsert({
    where: { organisationId_entityId_name: { organisationId: organisation.id, entityId: entity.id, name: "Hull Site" } },
    update: {},
    create: { organisationId: organisation.id, entityId: entity.id, name: "Hull Site", address: "Hull, UK" },
  });

  const context = await getDemoContext(organisation.id);

  console.log("Seeding the methodology profile and the illustrative factor set...");
  await seedLcaMethodology(prisma);
  const methodology = await prisma.lcaMethodologyProfile.findFirstOrThrow({
    where: { archivedAt: null, OR: [{ organisationId: organisation.id }, { organisationId: null }] },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  const factorIds = await seedDemoFactorSet(organisation.id);

  console.log("Seeding the product and its version...");
  const productFields = {
    name: PRODUCT_NAME,
    category: "Identification cards",
    description:
      "Synthetic demonstration product: a personalised ID-1 contactless card with a printed PVC body, a clear overlay, and an RFID inlay.",
    notes: "DEMONSTRATION PRODUCT — synthetic specification created to exercise the product LCA workflow. Not a Paragon product.",
  };
  const product = await prisma.product.upsert({
    where: { entityId_sku: { entityId: entity.id, sku: PRODUCT_SKU } },
    update: productFields,
    create: { entityId: entity.id, organisationId: organisation.id, sku: PRODUCT_SKU, ...productFields },
  });
  const version = await prisma.productVersion.upsert({
    where: { productId_versionLabel: { productId: product.id, versionLabel: PRODUCT_VERSION_LABEL } },
    update: { description: "First modelled build: virgin PVC card body, grid electricity at the Hull line." },
    create: {
      productId: product.id,
      versionLabel: PRODUCT_VERSION_LABEL,
      description: "First modelled build: virgin PVC card body, grid electricity at the Hull line.",
      effectiveFrom: PERIOD_START,
      isActive: true,
    },
  });
  const existingLocation = await prisma.productManufacturingLocation.findFirst({
    where: { productVersionId: version.id, name: "Hull card line" },
  });
  if (!existingLocation) {
    await prisma.productManufacturingLocation.create({
      data: {
        productVersionId: version.id,
        name: "Hull card line",
        country: "GB",
        siteId: site.id,
        isPrimary: true,
        notes: "Printing, lamination, punching and personalisation.",
      },
    });
  }

  console.log("Rebuilding the demonstration assessment and scenario...");
  // Scenario first — it holds a foreign key onto the baseline.
  await removeAssessment(SCENARIO_REFERENCE, entity.id);
  await removeAssessment(BASELINE_REFERENCE, entity.id);

  const baselineId = await buildBaseline(context, entity.id, version.id, methodology.id, factorIds);
  await runCalculation({ assessmentId: baselineId, actorUserId: context.userId });
  const baselinePerFu = await report("Baseline", baselineId);

  const scenarioId = await buildScenario(context, baselineId, factorIds);
  await runCalculation({ assessmentId: scenarioId, actorUserId: context.userId });
  const scenarioPerFu = await report("Scenario", scenarioId);

  const saving = baselinePerFu - scenarioPerFu;
  console.log(
    [
      "",
      `Scenario saving: ${saving.toFixed(3)} kgCO2e per ${FUNCTIONAL_UNIT_CARDS.toLocaleString("en-GB")} cards ` +
        `(${((saving / baselinePerFu) * 100).toFixed(1)}%), baseline untouched.`,
      "",
      "Demonstration LCA seeded.",
      `  Product   /products/${product.id}`,
      `  Baseline  /assessments/${baselineId}`,
      `  Results   /assessments/${baselineId}/results`,
      `  Scenarios /assessments/${baselineId}/scenarios`,
      `  Sign in as ${DEMO_LEAD_EMAIL}`,
      "",
      "Every factor is an illustrative placeholder. The assessment is deliberately blocked from verification and",
      "carries a placeholder warning on every results surface. Do not present these figures as a product footprint.",
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
