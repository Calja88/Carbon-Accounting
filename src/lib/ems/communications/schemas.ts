import { z } from "zod";

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));

export const communicationAudienceSchema = z.enum(["INTERNAL", "EXTERNAL", "BOTH"]);

export const communicationPlanFormSchema = z.object({
  subject: z.string().trim().min(1, "Enter the communication subject.").max(200),
  audience: communicationAudienceSchema,
  triggerFrequency: z.string().trim().min(1, "Describe when this communication is triggered.").max(200),
  method: z.string().trim().min(1, "Describe the communication method.").max(200),
  approvalRequired: z.coerce.boolean().default(false),
  sourceRequirements: optionalText,
  ownerMembershipId: z.string().min(1, "Choose a responsible owner."),
});

export const communicationRecordFormSchema = z.object({
  planId: z.string().optional().or(z.literal("")),
  occurredAt: z.coerce.date({ error: "Enter a valid date." }),
  audience: communicationAudienceSchema,
  parties: z.string().trim().min(1, "Describe the parties/audience reached.").max(2000),
  contentSummary: z.string().trim().min(1, "Enter a content summary.").max(4000),
  approvedContentRevisionId: z.string().optional().or(z.literal("")),
  approverMembershipId: z.string().optional().or(z.literal("")),
  approvedAt: z.union([z.coerce.date(), z.literal("")]).optional(),
  responseFollowUp: optionalText,
});
