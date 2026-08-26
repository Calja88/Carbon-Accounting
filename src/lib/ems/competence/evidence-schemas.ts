/**
 * Competence evidence/assessment form input validation (T71/UI10) — form
 * shapes only. `evidence-service`/`assessment-service` still re-validate
 * everything server-side (assignment ownership, evidence status, permission)
 * regardless of what a form assembled.
 */

import { z } from "zod";

export const COMPETENCE_EVIDENCE_TYPES = ["TRAINING", "QUALIFICATION", "LICENCE", "EXPERIENCE", "ASSESSMENT", "OTHER"] as const;

export const submitCompetenceEvidenceFormSchema = z.object({
  evidenceType: z.enum(COMPETENCE_EVIDENCE_TYPES),
  issuedDate: z.string().trim().max(40).optional().or(z.literal("")),
  expiryDate: z.string().trim().max(40).optional().or(z.literal("")),
});

export const rejectCompetenceEvidenceFormSchema = z.object({
  reason: z.string().trim().min(1, "Enter a rejection reason.").max(2000),
});

export const createCompetenceAssessmentFormSchema = z.object({
  method: z.string().trim().min(1, "Enter an assessment method.").max(500),
  criteria: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const completeCompetenceAssessmentFormSchema = z.object({
  outcome: z.enum(["COMPETENT", "NOT_COMPETENT"]),
  rationale: z.string().trim().max(2000).optional().or(z.literal("")),
  reassessmentDueDate: z.string().trim().max(40).optional().or(z.literal("")),
});

export const withdrawCompetenceEvidenceFormSchema = z.object({
  reason: z.string().trim().min(1, "Record why the evidence is being withdrawn.").max(2000),
});
