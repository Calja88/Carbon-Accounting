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

// ---------------------------------------------------------------------------
// Root cause, corrective action and effectiveness (T64) — form input
// validation, form-submitted shapes only.
// ---------------------------------------------------------------------------

export const rootCauseMethodSchema = z.enum(["FIVE_WHYS", "FISHBONE", "FAULT_TREE", "OTHER"]);

export const recordRootCauseAnalysisFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  method: rootCauseMethodSchema,
  analysisPayload: z.string().trim().min(1, "Describe the analysis."),
  contributors: z.string().trim().max(2000).optional().or(z.literal("")),
  conclusion: z.string().trim().min(1, "Enter the root-cause conclusion.").max(4000),
});

export const approveRootCauseAnalysisFormSchema = z.object({
  rootCauseAnalysisId: z.string().trim().min(1),
  nonconformityId: z.string().trim().min(1),
});

export const createCorrectiveActionFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  description: z.string().trim().min(1, "Describe the corrective action.").max(4000),
  completionCriteria: z.string().trim().max(2000).optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  dueDate: z.coerce.date(),
  sharedActionItemId: z.string().trim().optional().or(z.literal("")),
});

export const setCorrectiveActionStatusFormSchema = z.object({
  correctiveActionId: z.string().trim().min(1),
  nonconformityId: z.string().trim().min(1),
  status: z.enum(["IN_PROGRESS", "CANCELLED"]),
});

export const completeCorrectiveActionFormSchema = z.object({
  correctiveActionId: z.string().trim().min(1),
  nonconformityId: z.string().trim().min(1),
  completionEvidenceNote: z.string().trim().min(1, "Describe the completion evidence.").max(4000),
});

export const verifyCorrectiveActionFormSchema = z.object({
  correctiveActionId: z.string().trim().min(1),
  nonconformityId: z.string().trim().min(1),
});

export const reopenCorrectiveActionFormSchema = z.object({
  correctiveActionId: z.string().trim().min(1),
  nonconformityId: z.string().trim().min(1),
  reopenReason: z.string().trim().min(1, "Enter a reason for reopening.").max(2000),
});

export const requestEffectivenessReviewFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
});

export const effectivenessResultSchema = z.enum(["EFFECTIVE", "PARTIALLY_EFFECTIVE", "INEFFECTIVE"]);

export const performEffectivenessReviewFormSchema = z.object({
  nonconformityId: z.string().trim().min(1),
  criteria: z.string().trim().min(1, "Enter the review criteria.").max(2000),
  reviewDate: z.coerce.date(),
  result: effectivenessResultSchema,
  decision: z.string().trim().min(1, "Enter the review decision.").max(4000),
});
