import { z } from "zod";

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));

export const operationalControlTypeSchema = z.enum([
  "ENGINEERING",
  "PROCEDURAL",
  "MONITORING",
  "COMPETENCE",
  "PROCUREMENT",
  "EMERGENCY",
  "OTHER",
]);

export const operationalControlFormSchema = z.object({
  controlKey: z.string().trim().regex(/^[a-z][a-z0-9_-]*$/i, "Use a stable alphanumeric control key."),
  title: z.string().trim().min(1, "Enter a control title.").max(200),
  type: operationalControlTypeSchema,
  description: optionalText,
  frequency: z.string().trim().min(1, "Describe the control frequency.").max(200),
  acceptanceCriteria: z.string().trim().min(1, "Enter acceptance criteria.").max(4000),
  effectivenessCriteria: z.string().trim().min(1, "Enter effectiveness criteria.").max(4000),
  ownerMembershipId: z.string().min(1, "Choose a responsible owner."),
  controlledDocumentRevisionId: z.string().optional().or(z.literal("")),
  reviewDueDate: z.coerce.date({ error: "Enter a valid review due date." }),
  aspectIds: z.array(z.string().min(1)).min(1, "Link at least one environmental aspect."),
  applicabilityProcessId: z.string().optional().or(z.literal("")),
  externalProviderReference: z.string().trim().max(200).optional().or(z.literal("")),
});

export const controlCheckFormSchema = z.object({
  controlId: z.string().min(1),
  scheduledAt: z.coerce.date({ error: "Enter a valid scheduled date." }),
  performedAt: z.union([z.coerce.date(), z.literal("")]).optional(),
  result: z.enum(["PENDING", "PASS", "FAIL", "NOT_APPLICABLE"]),
  notes: optionalText,
  exceptionSummary: optionalText,
  actionReference: z.string().trim().max(200).optional().or(z.literal("")),
});
