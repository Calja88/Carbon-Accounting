/** Applicability workflow (T43) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const applicabilityDecisionSchema = z.enum(["APPLICABLE", "NOT_APPLICABLE", "UNCERTAIN"]);

export const createApplicabilityAssessmentFormSchema = z.object({
  instrumentId: z.string().trim().min(1, "Choose a legal instrument."),
  changeEventId: z.string().trim().optional().or(z.literal("")),
  supersedesAssessmentId: z.string().trim().optional().or(z.literal("")),
  decision: applicabilityDecisionSchema,
  rationale: z.string().trim().min(1, "Enter a rationale.").max(4000),
  entityIds: z.array(z.string().trim().min(1)).default([]),
  siteIds: z.array(z.string().trim().min(1)).default([]),
  processIds: z.array(z.string().trim().min(1)).default([]),
  aspectIds: z.array(z.string().trim().min(1)).default([]),
});

export const decideApplicabilityAssessmentFormSchema = z.object({
  assessmentId: z.string().trim().min(1),
  decision: applicabilityDecisionSchema,
  rationale: z.string().trim().min(1, "Enter a rationale.").max(4000),
  nextReviewAt: z.coerce.date({ error: "Enter a valid next-review date." }),
  followUpOwnerMembershipId: z.string().trim().optional().or(z.literal("")),
});
