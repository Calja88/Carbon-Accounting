/** Audit programme and audit execution (T60) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const auditItemPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const emsAuditTypeSchema = z.enum(["INTERNAL", "SUPPLIER", "COMPLIANCE", "SYSTEM", "PROCESS", "OTHER"]);
export const auditTeamRoleSchema = z.enum(["LEAD_AUDITOR", "AUDITOR", "TECHNICAL_EXPERT", "OBSERVER"]);

export const createAuditProgrammeFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a programme name.").max(300),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  objectives: z.string().trim().max(2000).optional().or(z.literal("")),
  riskBasis: z.string().trim().min(1, "Enter the risk basis for this programme.").max(2000),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
});

export const createAuditProgrammeItemFormSchema = z.object({
  programmeId: z.string().trim().min(1),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  rationale: z.string().trim().max(2000).optional().or(z.literal("")),
  priority: auditItemPrioritySchema.default("MEDIUM"),
  plannedStart: z.coerce.date(),
  plannedEnd: z.coerce.date(),
  siteIds: z.array(z.string().trim().min(1)).default([]),
  entityIds: z.array(z.string().trim().min(1)).default([]),
});

export const createEmsAuditFormSchema = z.object({
  programmeId: z.string().trim().min(1),
  programmeItemId: z.string().trim().optional().or(z.literal("")),
  type: emsAuditTypeSchema,
  title: z.string().trim().min(1, "Enter an audit title.").max(300),
  objectives: z.string().trim().max(2000).optional().or(z.literal("")),
  criteriaSummary: z.string().trim().min(1, "Enter a criteria summary.").max(2000),
  leadMembershipId: z.string().trim().min(1, "Choose a lead auditor."),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  siteIds: z.array(z.string().trim().min(1)).default([]),
  entityIds: z.array(z.string().trim().min(1)).default([]),
});

export const rescheduleEmsAuditFormSchema = z.object({
  auditId: z.string().trim().min(1),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  reason: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const assignAuditTeamMemberFormSchema = z.object({
  auditId: z.string().trim().min(1),
  membershipId: z.string().trim().min(1, "Choose a team member."),
  role: auditTeamRoleSchema,
  independenceDeclared: z.coerce.boolean(),
  conflictDeclared: z.coerce.boolean(),
  conflictNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

// --- Checklists, evidence, findings and frozen report (T61) ---

export const auditQuestionResultSchema = z.enum(["NOT_ASSESSED", "CONFORMS", "NONCONFORMANCE", "NOT_APPLICABLE"]);
export const auditFindingClassificationSchema = z.enum([
  "OBSERVATION",
  "OPPORTUNITY_FOR_IMPROVEMENT",
  "MINOR_NONCONFORMITY",
  "MAJOR_NONCONFORMITY",
]);

export const addChecklistItemFormSchema = z.object({
  checklistVersionId: z.string().trim().min(1),
  question: z.string().trim().min(1, "Enter the checklist question.").max(1000),
  criteriaReference: z.string().trim().max(500).optional().or(z.literal("")),
  expectedEvidence: z.string().trim().max(500).optional().or(z.literal("")),
});

export const recordQuestionResponseFormSchema = z.object({
  checklistItemId: z.string().trim().min(1),
  result: auditQuestionResultSchema,
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  auditorMembershipId: z.string().trim().min(1, "Choose the responding auditor."),
});

export const createAuditFindingFormSchema = z.object({
  auditId: z.string().trim().min(1),
  classification: auditFindingClassificationSchema,
  statement: z.string().trim().min(1, "Enter the finding statement.").max(2000),
  objectiveEvidence: z.string().trim().max(2000).optional().or(z.literal("")),
  criterionReference: z.string().trim().max(500).optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().optional().or(z.literal("")),
  dueDate: z.coerce.date().optional(),
});
