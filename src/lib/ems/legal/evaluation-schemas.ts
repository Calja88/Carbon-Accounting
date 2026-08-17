/** Compliance evaluation (T45) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const complianceEvaluationItemDecisionSchema = z.enum([
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NONCOMPLIANT",
  "NOT_APPLICABLE",
]);

export const complianceEvaluationFindingLinkTypeSchema = z.enum(["NONCONFORMITY", "CORRECTIVE_ACTION"]);

export const createComplianceEvaluationProgrammeFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a programme name.").max(300),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  recurrence: z.string().trim().max(100).optional().or(z.literal("")),
  leadMembershipId: z.string().trim().min(1, "Choose a lead."),
});

export const createComplianceEvaluationFormSchema = z.object({
  programmeId: z.string().trim().min(1, "Choose a programme."),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  leadMembershipId: z.string().trim().min(1, "Choose a lead."),
  entityIds: z.array(z.string().trim().min(1)).default([]),
  siteIds: z.array(z.string().trim().min(1)).default([]),
});

export const recordComplianceEvaluationItemResultFormSchema = z.object({
  evaluationItemId: z.string().trim().min(1),
  status: complianceEvaluationItemDecisionSchema,
  rationale: z.string().trim().min(1, "Enter a rationale.").max(4000),
  followUpDate: z.coerce.date().optional(),
});

export const requestComplianceEvaluationFindingLinkFormSchema = z.object({
  evaluationItemId: z.string().trim().min(1),
  linkType: complianceEvaluationFindingLinkTypeSchema,
  referenceNote: z.string().trim().min(1, "Enter a reference note.").max(2000),
});
