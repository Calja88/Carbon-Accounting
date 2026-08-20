/** Environmental incident intake (T62) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const incidentNotificationDecisionSchema = z.enum(["NOT_REQUIRED", "REQUIRED", "UNCERTAIN"]);

export const createIncidentSeverityLevelFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Enter a severity level key.")
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits, and underscores only."),
  label: z.string().trim().min(1, "Enter a severity level label.").max(200),
  rank: z.coerce.number().int().min(0).max(1000),
  requiresEscalation: z.coerce.boolean().default(false),
});

export const upsertIncidentEscalationRuleFormSchema = z.object({
  severityLevelId: z.string().trim().min(1, "Choose a severity level."),
  recipientsPolicy: z.record(z.string(), z.unknown()),
  isActive: z.coerce.boolean().default(true),
});

export const createEnvironmentalIncidentFormSchema = z.object({
  reference: z.string().trim().min(1, "Enter an incident reference.").max(100),
  occurredAt: z.coerce.date().optional(),
  discoveredAt: z.coerce.date().optional(),
  entityId: z.string().trim().optional().or(z.literal("")),
  siteId: z.string().trim().optional().or(z.literal("")),
  processId: z.string().trim().optional().or(z.literal("")),
  aspectId: z.string().trim().optional().or(z.literal("")),
  type: z.string().trim().min(1, "Enter an incident type.").max(200),
  factualDescription: z.string().trim().min(1, "Describe what happened.").max(4000),
  immediateResponse: z.string().trim().max(4000).optional().or(z.literal("")),
  potentialReceptors: z.string().trim().max(2000).optional().or(z.literal("")),
  restricted: z.coerce.boolean().default(false),
});

export const recordIncidentCorrectionFormSchema = z.object({
  incidentId: z.string().trim().min(1),
  correctedFactualDescription: z.string().trim().max(4000).optional().or(z.literal("")),
  correctedImmediateResponse: z.string().trim().max(4000).optional().or(z.literal("")),
  correctedPotentialReceptors: z.string().trim().max(2000).optional().or(z.literal("")),
  reason: z.string().trim().min(1, "Enter a reason for this correction.").max(2000),
});

export const assignIncidentSeverityFormSchema = z.object({
  incidentId: z.string().trim().min(1),
  severityLevelId: z.string().trim().min(1, "Choose a severity level."),
});

export const recordIncidentNotificationAssessmentFormSchema = z.object({
  incidentId: z.string().trim().min(1),
  authorityOrParty: z.string().trim().min(1, "Enter the authority or party.").max(300),
  dueTrigger: z.string().trim().max(500).optional().or(z.literal("")),
  decision: incidentNotificationDecisionSchema,
  rationale: z.string().trim().min(1, "Enter the rationale for this decision.").max(4000),
});

export const closeEnvironmentalIncidentFormSchema = z.object({
  incidentId: z.string().trim().min(1),
});

export const reopenEnvironmentalIncidentFormSchema = z.object({
  incidentId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "Enter a reason for reopening this incident.").max(2000),
});
