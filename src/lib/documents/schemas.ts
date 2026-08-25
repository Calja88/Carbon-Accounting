/** Controlled documents / shared evidence (task T22, UI03) form input validation — form-submitted shapes only. */

import { z } from "zod";

const evidenceClassificationSchema = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);

export const createControlledDocumentFormSchema = z.object({
  reference: z.string().trim().min(1, "Enter a document reference.").max(100),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  category: z.string().trim().min(1, "Enter a category.").max(100),
  classification: evidenceClassificationSchema.default("INTERNAL"),
  ownerMembershipId: z.string().trim().optional().or(z.literal("")),
  reviewIntervalMonths: z.coerce.number().int().min(1).max(120).optional(),
});

export const createSuccessorRevisionFormSchema = z.object({
  documentId: z.string().trim().min(1),
  changeSummary: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const publishRevisionEffectiveFormSchema = z.object({
  revisionId: z.string().trim().min(1),
  effectiveDate: z.coerce.date().optional(),
  reviewDueDate: z.coerce.date().optional(),
});

export const approveRevisionFormSchema = z.object({
  revisionId: z.string().trim().min(1),
});

export const revisionIdFormSchema = z.object({
  revisionId: z.string().trim().min(1),
});

export const distributeRevisionFormSchema = z.object({
  revisionId: z.string().trim().min(1),
  audienceMembershipId: z.string().trim().optional().or(z.literal("")),
  audienceRole: z.string().trim().max(200).optional().or(z.literal("")),
});

export const linkExistingEvidenceFormSchema = z.object({
  revisionId: z.string().trim().min(1),
  evidenceId: z.string().trim().min(1, "Choose an evidence object."),
});
