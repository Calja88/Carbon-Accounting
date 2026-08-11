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
