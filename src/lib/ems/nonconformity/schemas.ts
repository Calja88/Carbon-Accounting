/** Nonconformity workflow (T63) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const nonconformitySourceTypeSchema = z.enum([
  "AUDIT_FINDING",
  "INCIDENT",
  "COMPLIANCE_EVALUATION_ITEM",
  "CONTROL_CHECK",
  "COMPLAINT",
  "MANUAL",
]);

export const createNonconformityClassificationFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Enter a classification key.")
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits, and underscores only."),
  label: z.string().trim().min(1, "Enter a classification label.").max(200),
  rank: z.coerce.number().int().min(0).max(1000),
});

export const upsertNonconformityClosurePolicyFormSchema = z.object({
  requireContainment: z.coerce.boolean().default(true),
  requireRootCauseApproval: z.coerce.boolean().default(false),
  requireCorrectiveActionsComplete: z.coerce.boolean().default(false),
  requireEffectivenessReview: z.coerce.boolean().default(false),
});

export const createNonconformityFromSourceFormSchema = z.object({
  reference: z.string().trim().min(1, "Enter a nonconformity reference.").max(100),
  sourceType: nonconformitySourceTypeSchema,
  sourceId: z.string().trim().optional().or(z.literal("")),
  sourceReferenceNote: z.string().trim().max(2000).optional().or(z.literal("")),
  statement: z.string().trim().min(1, "Describe the nonconformity.").max(4000),
  requirementReference: z.string().trim().min(1, "Enter the requirement reference.").max(2000),
  complianceObligationId: z.string().trim().optional().or(z.literal("")),
  operationalControlId: z.string().trim().optional().or(z.literal("")),
  classificationId: z.string().trim().optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().optional().or(z.literal("")),
  dueDate: z.coerce.date().optional(),
});

export const linkAdditionalSourceFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  sourceType: nonconformitySourceTypeSchema,
  sourceId: z.string().trim().optional().or(z.literal("")),
  sourceReferenceNote: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const recordContainmentFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  actionTaken: z.string().trim().min(1, "Describe the containment action taken.").max(4000),
  actionTakenAt: z.coerce.date(),
  ownerMembershipId: z.string().trim().min(1, "Choose a containment owner."),
});

export const reviewContainmentAdequacyFormSchema = z.object({
  containmentId: z.string().trim().min(1),
  adequate: z.coerce.boolean(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const assignNonconformityClassificationFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  classificationId: z.string().trim().min(1, "Choose a classification."),
});

export const closeNonconformityFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
});

export const reopenNonconformityFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "Enter a reason for reopening this nonconformity.").max(2000),
});
