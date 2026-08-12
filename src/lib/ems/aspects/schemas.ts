/**
 * Process/activity profile input validation (task T30). Kept to the plain
 * enum/string shapes the UI actually submits — the richer discriminated
 * significance-method config validation belongs to T32, not here.
 */

import { z } from "zod";

export const processActivityTypeSchema = z.enum(["ACTIVITY", "PRODUCT", "SERVICE"]);

export const emsLifecycleStageSchema = z.enum([
  "RAW_MATERIAL_ACQUISITION",
  "DESIGN",
  "PRODUCTION",
  "TRANSPORTATION_DELIVERY",
  "USE",
  "END_OF_LIFE_TREATMENT",
  "OTHER",
]);

export const emsOperatingConditionSchema = z.enum(["NORMAL", "ABNORMAL", "STARTUP_SHUTDOWN", "MAINTENANCE", "EMERGENCY"]);

export const createActivityProcessFormSchema = z.object({
  programmeId: z.string().min(1, "Choose an EMS programme."),
  siteId: z.string().min(1).optional().or(z.literal("")),
  name: z.string().trim().min(1, "Enter a name."),
  activityType: processActivityTypeSchema.default("ACTIVITY"),
  lifecycleStage: emsLifecycleStageSchema.optional().or(z.literal("")),
  operatingCondition: emsOperatingConditionSchema.default("NORMAL"),
});

export const applyProcessProfileTemplateFormSchema = z.object({
  programmeId: z.string().min(1, "Choose an EMS programme."),
  templateId: z.string().min(1, "Choose a template."),
  siteId: z.string().min(1, "Choose a site."),
  confirm: z.literal(true, "Confirm the checkbox to apply this template."),
});

export const aspectControlRelationshipSchema = z.enum(["DIRECT_CONTROL", "INFLUENCE"]);
export const environmentalEffectSchema = z.enum(["BENEFICIAL", "ADVERSE"]);
export const environmentalImpactExtentSchema = z.enum(["LOCAL", "GLOBAL", "LOCAL_AND_GLOBAL"]);

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));

export const environmentalAspectFormSchema = z.object({
  processId: z.string().min(1, "Choose a process/activity profile."),
  name: z.string().trim().min(1, "Enter an aspect name.").max(200),
  description: optionalText,
  sourceInputOutput: optionalText,
  scopeDescription: optionalText,
  existingControls: optionalText,
  controlRelationship: aspectControlRelationshipSchema,
  lifecycleStage: emsLifecycleStageSchema.optional().or(z.literal("")),
  operatingCondition: emsOperatingConditionSchema,
  effect: environmentalEffectSchema,
});

export const environmentalImpactFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an impact name.").max(200),
  category: z.string().trim().min(1, "Enter an impact category.").max(200),
  receptor: optionalText,
  extent: environmentalImpactExtentSchema,
  effect: environmentalEffectSchema,
  description: optionalText,
});

export const aspectImpactLinkFormSchema = z.object({
  aspectId: z.string().min(1, "Choose an aspect."),
  impactId: z.string().min(1, "Choose an impact."),
  causalDescription: optionalText,
});
