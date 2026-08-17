/** Other requirements and manual legal sources (T46) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const otherRequirementSourceTypeSchema = z.enum([
  "PERMIT",
  "CONSENT",
  "REGULATOR_NOTICE",
  "CONTRACT",
  "CUSTOMER_REQUIREMENT",
  "VOLUNTARY_COMMITMENT",
]);

export const otherRequirementSourceStatusSchema = z.enum(["ACTIVE", "EXPIRED", "SUPERSEDED", "WITHDRAWN"]);

export const createOtherRequirementSourceFormSchema = z.object({
  type: otherRequirementSourceTypeSchema,
  title: z.string().trim().min(1, "Enter a title.").max(300),
  issuingParty: z.string().trim().min(1, "Enter the issuing party or authority.").max(300),
  reference: z.string().trim().max(200).optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  issuedAt: z.coerce.date().optional(),
  effectiveFrom: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  nextReviewAt: z.coerce.date().optional(),
});

export const updateOtherRequirementSourceFormSchema = createOtherRequirementSourceFormSchema;

export const changeOtherRequirementSourceStatusFormSchema = z.object({
  sourceId: z.string().trim().min(1),
  status: otherRequirementSourceStatusSchema,
});
