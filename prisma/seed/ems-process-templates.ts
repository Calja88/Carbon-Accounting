import { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

/**
 * Structural starter templates for Hull, Rayleigh, and Milton Keynes
 * operations (task T30, Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2: "Starter
 * template names only: Hull manufacturing/e-ID/mass-transit/smart
 * bureau/software; Rayleigh metal-card/smart bureau; Milton Keynes
 * office/SaaS"). Platform content, not tenant data: no organisationId, no
 * environmental values, no aspects — structure only.
 */
interface TemplateItemSeed {
  name: string;
  description?: string;
  activityType?: "ACTIVITY" | "PRODUCT" | "SERVICE";
  suggestedLifecycleStage?:
    | "RAW_MATERIAL_ACQUISITION"
    | "DESIGN"
    | "PRODUCTION"
    | "TRANSPORTATION_DELIVERY"
    | "USE"
    | "END_OF_LIFE_TREATMENT"
    | "OTHER";
  suggestedOperatingCondition?: "NORMAL" | "ABNORMAL" | "STARTUP_SHUTDOWN" | "MAINTENANCE" | "EMERGENCY";
}

interface TemplateSeed {
  key: string;
  name: string;
  siteLabel: string;
  description: string;
  items: TemplateItemSeed[];
}

export const EMS_PROCESS_PROFILE_TEMPLATES: TemplateSeed[] = [
  {
    key: "hull_manufacturing",
    name: "Hull — Manufacturing",
    siteLabel: "Hull",
    description: "Structural starter for card and label manufacturing operations at the Hull site.",
    items: [
      { name: "Goods-in and materials storage", activityType: "ACTIVITY", suggestedLifecycleStage: "RAW_MATERIAL_ACQUISITION" },
      { name: "Card/label production line", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Print and finishing", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Quality inspection", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Despatch and outbound logistics", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
      { name: "Plant maintenance", activityType: "ACTIVITY", suggestedOperatingCondition: "MAINTENANCE" },
    ],
  },
  {
    key: "hull_eid",
    name: "Hull — eID",
    siteLabel: "Hull",
    description: "Structural starter for electronic identity document production at the Hull site.",
    items: [
      { name: "Chip and inlay assembly", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Personalisation", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Secure data handling", activityType: "ACTIVITY", suggestedOperatingCondition: "NORMAL" },
      { name: "Despatch to issuing authority", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
    ],
  },
  {
    key: "hull_mass_transit",
    name: "Hull — Mass Transit",
    siteLabel: "Hull",
    description: "Structural starter for mass-transit ticketing product operations at the Hull site.",
    items: [
      { name: "Ticket media production", activityType: "PRODUCT", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Encoding and testing", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Packing and despatch", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
    ],
  },
  {
    key: "hull_smart_bureau",
    name: "Hull — Smart Bureau",
    siteLabel: "Hull",
    description: "Structural starter for smart-card personalisation bureau services at the Hull site.",
    items: [
      { name: "Bureau intake and validation", activityType: "SERVICE", suggestedLifecycleStage: "DESIGN" },
      { name: "Personalisation bureau run", activityType: "SERVICE", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Secure despatch", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
    ],
  },
  {
    key: "hull_software",
    name: "Hull — Software",
    siteLabel: "Hull",
    description: "Structural starter for software development and support operations at the Hull site.",
    items: [
      { name: "Software development", activityType: "SERVICE", suggestedLifecycleStage: "DESIGN" },
      { name: "Hosting and operations", activityType: "SERVICE", suggestedOperatingCondition: "NORMAL" },
      { name: "Customer support", activityType: "SERVICE", suggestedLifecycleStage: "USE" },
    ],
  },
  {
    key: "rayleigh_metal_card",
    name: "Rayleigh — Metal Card",
    siteLabel: "Rayleigh",
    description: "Structural starter for metal card manufacturing operations at the Rayleigh site.",
    items: [
      { name: "Metal stock preparation", activityType: "ACTIVITY", suggestedLifecycleStage: "RAW_MATERIAL_ACQUISITION" },
      { name: "Machining and forming", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Surface finishing", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Despatch and outbound logistics", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
    ],
  },
  {
    key: "rayleigh_smart_bureau",
    name: "Rayleigh — Smart Bureau",
    siteLabel: "Rayleigh",
    description: "Structural starter for smart-card personalisation bureau services at the Rayleigh site.",
    items: [
      { name: "Bureau intake and validation", activityType: "SERVICE", suggestedLifecycleStage: "DESIGN" },
      { name: "Personalisation bureau run", activityType: "SERVICE", suggestedLifecycleStage: "PRODUCTION" },
      { name: "Secure despatch", activityType: "ACTIVITY", suggestedLifecycleStage: "TRANSPORTATION_DELIVERY" },
    ],
  },
  {
    key: "milton_keynes_office",
    name: "Milton Keynes — Office",
    siteLabel: "Milton Keynes",
    description: "Structural starter for general office operations at the Milton Keynes site.",
    items: [
      { name: "Office administration", activityType: "ACTIVITY", suggestedOperatingCondition: "NORMAL" },
      { name: "Facilities management", activityType: "ACTIVITY", suggestedOperatingCondition: "NORMAL" },
      { name: "Business travel", activityType: "ACTIVITY", suggestedOperatingCondition: "NORMAL" },
    ],
  },
  {
    key: "milton_keynes_saas",
    name: "Milton Keynes — SaaS",
    siteLabel: "Milton Keynes",
    description: "Structural starter for SaaS product development and hosting operations at the Milton Keynes site.",
    items: [
      { name: "Product development", activityType: "SERVICE", suggestedLifecycleStage: "DESIGN" },
      { name: "Cloud hosting and operations", activityType: "SERVICE", suggestedOperatingCondition: "NORMAL" },
      { name: "Customer support", activityType: "SERVICE", suggestedLifecycleStage: "USE" },
    ],
  },
];

/** Idempotent upsert of the platform's structural starter templates (T30). */
export async function seedEmsProcessProfileTemplates(prisma: Db) {
  for (const template of EMS_PROCESS_PROFILE_TEMPLATES) {
    const record = await prisma.processProfileTemplate.upsert({
      where: { key: template.key },
      update: { name: template.name, siteLabel: template.siteLabel, description: template.description },
      create: { key: template.key, name: template.name, siteLabel: template.siteLabel, description: template.description },
    });

    for (const [index, item] of template.items.entries()) {
      const existing = await prisma.processTemplateItem.findFirst({
        where: { templateId: record.id, name: item.name, parentId: null },
      });
      const data = {
        templateId: record.id,
        name: item.name,
        description: item.description ?? null,
        activityType: item.activityType ?? "ACTIVITY",
        suggestedLifecycleStage: item.suggestedLifecycleStage ?? null,
        suggestedOperatingCondition: item.suggestedOperatingCondition ?? "NORMAL",
        sortOrder: index,
      };
      if (existing) {
        await prisma.processTemplateItem.update({ where: { id: existing.id }, data });
      } else {
        await prisma.processTemplateItem.create({ data });
      }
    }
  }
}
