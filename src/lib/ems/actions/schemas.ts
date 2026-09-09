/** Action programmes and reminders (T52) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const actionProgrammeStatusSchema = z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]);
export const actionItemStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "VERIFIED", "REOPENED", "CANCELLED"]);
export const actionPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const createActionProgrammeFormSchema = z.object({
  objectiveId: z.string().trim().optional().or(z.literal("")),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  resourcesDescription: z.string().trim().max(4000).optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
});

export const setActionProgrammeStatusFormSchema = z.object({
  programmeId: z.string().trim().min(1),
  status: actionProgrammeStatusSchema,
});

export const createActionItemFormSchema = z.object({
  programmeId: z.string().trim().min(1, "Choose a programme."),
  title: z.string().trim().min(1, "Enter a title.").max(300),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priority: actionPrioritySchema.default("MEDIUM"),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date(),
  completionCriteria: z.string().trim().max(2000).optional().or(z.literal("")),
  dependsOnActionItemIds: z.array(z.string().trim().min(1)).default([]),
});

export const reassignActionItemFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
  newOwnerMembershipId: z.string().trim().min(1, "Choose a new owner."),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const setActionItemStatusFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
  status: actionItemStatusSchema,
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const recordActionProgressFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
  progressPercent: z.coerce.number().int().min(0).max(100).optional(),
  note: z.string().trim().min(1, "Enter a progress note.").max(2000),
});

export const completeActionItemFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
  completionEvidenceNote: z.string().trim().min(1, "Describe the completion evidence.").max(2000),
});

export const verifyActionItemFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
});

export const reopenActionItemFormSchema = z.object({
  actionItemId: z.string().trim().min(1),
  reopenReason: z.string().trim().min(1, "Enter a reason for reopening.").max(2000),
});
