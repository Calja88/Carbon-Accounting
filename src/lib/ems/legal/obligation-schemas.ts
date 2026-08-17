/** Compliance obligation versioning and approval (T44) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const obligationApprovalDecisionSchema = z.enum(["APPROVED", "REJECTED", "RETURNED"]);
export const obligationChangeReviewDecisionSchema = z.enum(["NO_CHANGE", "REVISE", "RETIRE", "SEEK_ADVICE"]);

export const createComplianceObligationFormSchema = z.object({
  applicabilityAssessmentId: z.string().trim().min(1, "Choose an applicable assessment."),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  requirementSummary: z.string().trim().min(1, "Enter a requirement summary.").max(4000),
  provisionReferenceId: z.string().trim().optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  frequency: z.string().trim().max(200).optional().or(z.literal("")),
  triggerDescription: z.string().trim().max(2000).optional().or(z.literal("")),
  effectiveFrom: z.coerce.date().optional(),
  reviewDueDate: z.coerce.date().optional(),
  entityIds: z.array(z.string().trim().min(1)).default([]),
  siteIds: z.array(z.string().trim().min(1)).default([]),
  aspectIds: z.array(z.string().trim().min(1)).default([]),
  controlIds: z.array(z.string().trim().min(1)).default([]),
});

export const updateComplianceObligationVersionDraftFormSchema = createComplianceObligationFormSchema.omit({
  applicabilityAssessmentId: true,
});

export const decideComplianceObligationVersionFormSchema = z.object({
  obligationVersionId: z.string().trim().min(1),
  decision: obligationApprovalDecisionSchema,
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const createObligationChangeReviewFormSchema = z.object({
  changeEventId: z.string().trim().min(1, "Choose a change event."),
  obligationVersionId: z.string().trim().min(1, "Choose an obligation version."),
  impactAssessment: z.string().trim().min(1, "Enter an impact assessment.").max(4000),
  decision: obligationChangeReviewDecisionSchema.optional(),
  followUpDate: z.coerce.date().optional(),
});
