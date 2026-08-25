/** Management review and agenda template (T72/UI11) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const managementReviewAttendeeRoleSchema = z.enum(["CHAIR", "COORDINATOR", "MEMBER", "GUEST"]);

export const scheduleManagementReviewFormSchema = z.object({
  reference: z.string().trim().min(1, "Enter a reference.").max(300),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  cutoffDate: z.coerce.date(),
  scheduledDate: z.coerce.date(),
  chairMembershipId: z.string().trim().min(1, "Choose a chair."),
  coordinatorMembershipId: z.string().trim().min(1, "Choose a coordinator."),
  agendaTemplateVersionId: z.string().trim().min(1, "Choose an agenda template version."),
});

export const rescheduleManagementReviewFormSchema = z.object({
  reviewId: z.string().trim().min(1),
  scheduledDate: z.coerce.date(),
});

export const addManagementReviewAttendeeFormSchema = z.object({
  reviewId: z.string().trim().min(1),
  personId: z.string().trim().min(1, "Choose a person."),
  role: managementReviewAttendeeRoleSchema.default("MEMBER"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const linkManagementReviewInputFormSchema = z.object({
  reviewId: z.string().trim().min(1),
  inputDefinitionKey: z.string().trim().min(1, "Choose an input."),
  sourceRecordId: z.string().trim().optional().or(z.literal("")),
});

export const upsertManagementReviewInputDefinitionFormSchema = z.object({
  key: z.string().trim().min(1, "Enter a key.").max(100),
  label: z.string().trim().min(1, "Enter a label.").max(300),
  sourceType: z.enum(["COMPLIANCE_EVALUATION", "ACTION_PROGRAMME", "AUDIT_REPORT", "CORRECTIVE_ACTION", "COMPETENCE_GAP", "OTHER"]),
  required: z.coerce.boolean().default(true),
  periodRule: z.string().trim().max(300).optional().or(z.literal("")),
});

const agendaItemFormSchema = z.object({
  order: z.coerce.number().int().min(1),
  title: z.string().trim().min(1, "Every agenda item needs a title.").max(300),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  inputDefinitionKey: z.string().trim().optional().or(z.literal("")),
});

export const agendaItemsJsonSchema = z.array(agendaItemFormSchema).min(1, "Add at least one agenda item.");

export const createAgendaTemplateFormSchema = z.object({
  templateKey: z.string().trim().min(1, "Enter a template key.").max(100),
  name: z.string().trim().min(1, "Enter a template name.").max(300),
  itemsJson: z.string().trim().min(1, "Add at least one agenda item."),
});

export const updateAgendaTemplateVersionDraftFormSchema = z.object({
  versionId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Enter a template name.").max(300),
  itemsJson: z.string().trim().min(1, "Add at least one agenda item."),
});

export const createSuccessorAgendaTemplateVersionFormSchema = z.object({
  templateId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Enter a template name.").max(300),
  itemsJson: z.string().trim().min(1, "Add at least one agenda item."),
  revisionRationale: z.string().trim().min(1, "Enter a revision rationale.").max(2000),
});
