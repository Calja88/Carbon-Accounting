import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { FACTOR_SET, FACTORS } from "./emission-factors";
import { ACTIVITY_DATA_POINTS } from "./activity-data-points";

const prisma = new PrismaClient();

async function seedEntitiesAndSites() {
  const entities = [
    { name: "Paragon ID" },
    { name: "RFID Discovery" },
    { name: "Thames Technology" },
  ];

  const entityRecords: Record<string, string> = {};
  for (const e of entities) {
    const rec = await prisma.entity.upsert({
      where: { name: e.name },
      update: {},
      create: e,
    });
    entityRecords[e.name] = rec.id;
  }

  // NOTE: neither source document lists an actual site register — these
  // are illustrative sites drawn from incidental worked examples in the
  // methodology/data map (e.g. "Reading depot", "Thames Technology —
  // Slough site"). Treat as demo data; replace via the admin UI with the
  // Group's real site list before production use.
  const sites: { entity: string; name: string; address?: string }[] = [
    { entity: "Paragon ID", name: "Reading Office & Depot", address: "Reading, UK" },
    { entity: "Paragon ID", name: "London Office", address: "London, UK" },
    { entity: "RFID Discovery", name: "RFID Discovery — Main Site", address: "UK" },
    { entity: "Thames Technology", name: "Slough Site", address: "Slough, UK" },
  ];

  const siteRecords: Record<string, string> = {};
  for (const s of sites) {
    const rec = await prisma.site.upsert({
      where: { entityId_name: { entityId: entityRecords[s.entity], name: s.name } },
      update: {},
      create: { entityId: entityRecords[s.entity], name: s.name, address: s.address },
    });
    siteRecords[s.name] = rec.id;
  }

  return { entityRecords, siteRecords };
}

async function seedUsers() {
  const demoPassword = await bcrypt.hash("ChangeMe123!", 10);

  const users = [
    { name: "Alex Sustainability", email: "sustainability.lead@paragon-id.example", role: Role.SUSTAINABILITY_LEAD },
    { name: "Sam Data Owner", email: "data.owner@paragon-id.example", role: Role.DATA_OWNER },
    { name: "Jordan Finance", email: "finance@paragon-id.example", role: Role.FINANCE },
    { name: "Admin User", email: "admin@paragon-id.example", role: Role.ADMIN },
  ];

  const userRecords: Record<string, string> = {};
  for (const u of users) {
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: demoPassword },
    });
    userRecords[u.email] = rec.id;
  }
  return userRecords;
}

async function seedEmissionFactors() {
  const set = await prisma.emissionFactorSet.upsert({
    where: { id: "seed-factor-set-2024-placeholder" },
    update: { ...FACTOR_SET },
    create: {
      id: "seed-factor-set-2024-placeholder",
      ...FACTOR_SET,
    },
  });

  for (const f of FACTORS) {
    await prisma.emissionFactor.upsert({
      where: {
        factorSetId_category_subtypeKey_basis: {
          factorSetId: set.id,
          category: f.category,
          subtypeKey: f.subtypeKey ?? "",
          basis: f.basis,
        },
      },
      update: {
        scope: f.scope,
        unit: f.unit,
        co2eFactor: f.co2eFactor,
        notes: f.notes,
      },
      create: {
        factorSetId: set.id,
        scope: f.scope,
        category: f.category,
        subtypeKey: f.subtypeKey,
        basis: f.basis,
        unit: f.unit,
        co2eFactor: f.co2eFactor,
        notes: f.notes,
      },
    });
  }

  return set.id;
}

async function seedActivityDataPoints() {
  for (const dp of ACTIVITY_DATA_POINTS) {
    const record = await prisma.activityDataPoint.upsert({
      where: { code: dp.code },
      update: {
        scope: dp.scope,
        category: dp.category,
        dataPointName: dp.dataPointName,
        promptTemplate: dp.promptTemplate,
        helpText: dp.helpText,
        sourceSystemHint: dp.sourceSystemHint,
        unitOptions: dp.unitOptions,
        frequency: dp.frequency,
        defaultTier: dp.defaultTier,
        formType: dp.formType,
        buildPriority: dp.buildPriority,
        notes: dp.notes,
        sortOrder: dp.sortOrder,
        factorCategory: dp.factorCategory,
      },
      create: {
        code: dp.code,
        scope: dp.scope,
        category: dp.category,
        dataPointName: dp.dataPointName,
        promptTemplate: dp.promptTemplate,
        helpText: dp.helpText,
        sourceSystemHint: dp.sourceSystemHint,
        unitOptions: dp.unitOptions,
        frequency: dp.frequency,
        defaultTier: dp.defaultTier,
        formType: dp.formType,
        buildPriority: dp.buildPriority,
        notes: dp.notes,
        sortOrder: dp.sortOrder,
        factorCategory: dp.factorCategory,
      },
    });

    for (const opt of dp.factorOptions ?? []) {
      await prisma.factorOption.upsert({
        where: {
          activityDataPointId_subtypeKey: {
            activityDataPointId: record.id,
            subtypeKey: opt.subtypeKey,
          },
        },
        update: { label: opt.label },
        create: {
          activityDataPointId: record.id,
          label: opt.label,
          subtypeKey: opt.subtypeKey,
        },
      });
    }
  }
}

async function main() {
  console.log("Seeding entities and sites...");
  await seedEntitiesAndSites();

  console.log("Seeding users...");
  await seedUsers();

  console.log("Seeding emission factor set + factors...");
  await seedEmissionFactors();

  console.log("Seeding activity data point catalog...");
  await seedActivityDataPoints();

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
