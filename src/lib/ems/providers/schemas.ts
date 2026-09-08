import { z } from "zod";

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));

export const externalProviderControlFormSchema = z.object({
  providerReference: z.string().trim().regex(/^[a-z][a-z0-9_-]*$/i, "Use a stable alphanumeric provider reference."),
  providerName: z.string().trim().min(1, "Enter the provider's name.").max(200),
  providedDescription: z.string().trim().min(1, "Describe the process, product or service provided.").max(4000),
  communicatedRequirements: z.string().trim().min(1, "Enter the environmental requirements communicated to the provider.").max(4000),
  evaluationFrequency: z.string().trim().min(1, "Describe the evaluation frequency.").max(200),
  ownerMembershipId: z.string().min(1, "Choose a responsible owner."),
  nextReviewDueDate: z.coerce.date({ error: "Enter a valid next-review date." }),
  aspectIds: z.array(z.string().min(1)).min(1, "Link at least one environmental aspect."),
});

export const externalProviderEvaluationFormSchema = z.object({
  providerControlId: z.string().min(1),
  evaluatedAt: z.coerce.date({ error: "Enter a valid evaluation date." }),
  result: z.enum(["PASS", "CONDITIONAL", "FAIL"]),
  notes: optionalText,
  actionReference: z.string().trim().max(200).optional().or(z.literal("")),
  nextReviewDueDate: z.coerce.date({ error: "Enter a valid next-review date." }),
});
