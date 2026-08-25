/**
 * EMS programme foundation form schemas (task T23 UI, UI02). Validates the
 * server-action form inputs before they reach `programme-service.ts` /
 * `context-service.ts` / `change-service.ts` — mirrors the
 * `src/lib/ems/controls/schemas.ts` pattern used by every other EMS module.
 */

import { z } from "zod";

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));
const optionalId = z.string().optional().or(z.literal(""));

export const emsCertificationIntentSchema = z.enum(["NONE", "PLANNED", "CERTIFIED_EXTERNALLY"]);

export const createProgrammeFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a programme name.").max(200),
  standardsProfile: z.string().trim().min(1, "Enter a standards profile identifier.").max(100),
  standardsProfileVersion: z.string().trim().min(1, "Enter the standards profile version.").max(50),
  certificationIntent: emsCertificationIntentSchema,
  ownerMembershipId: optionalId,
});

export const createScopeVersionFormSchema = z.object({
  programmeId: z.string().min(1),
  statement: z.string().trim().min(1, "Enter a scope statement.").max(4000),
  exclusions: optionalText,
  exclusionsRationale: optionalText,
});

export const contextIssueTypeSchema = z.enum(["INTERNAL", "EXTERNAL", "ENVIRONMENTAL_CONDITION"]);
export const contextIssueDirectionSchema = z.enum(["AFFECTS_ORGANISATION", "AFFECTED_BY_ORGANISATION", "BOTH"]);

export const contextIssueFormSchema = z.object({
  programmeId: z.string().min(1),
  type: contextIssueTypeSchema,
  title: z.string().trim().min(1, "Enter a title.").max(200),
  description: optionalText,
  direction: contextIssueDirectionSchema,
  significance: optionalText,
  ownerMembershipId: optionalId,
  reviewDate: z.union([z.coerce.date(), z.literal("")]).optional(),
});

export const interestedPartyInfluenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const interestedPartyFormSchema = z.object({
  programmeId: z.string().min(1),
  name: z.string().trim().min(1, "Enter a party name.").max(200),
  type: z.string().trim().min(1, "Enter a party type.").max(100),
  influence: z.union([interestedPartyInfluenceSchema, z.literal("")]).optional(),
  relationshipOwnerMembershipId: optionalId,
});

export const interestedPartyRequirementFormSchema = z.object({
  interestedPartyId: z.string().min(1),
  summary: z.string().trim().min(1, "Enter a requirement summary.").max(2000),
  sourceReference: optionalText,
  isMandatory: z.coerce.boolean().optional(),
  evaluationDate: z.union([z.coerce.date(), z.literal("")]).optional(),
  reviewDate: z.union([z.coerce.date(), z.literal("")]).optional(),
});

export const emsRiskOpportunityKindSchema = z.enum(["RISK", "OPPORTUNITY"]);

export const emsRiskOpportunityFormSchema = z.object({
  programmeId: z.string().min(1),
  kind: emsRiskOpportunityKindSchema,
  category: z.string().trim().min(1, "Enter a category.").max(200),
  description: z.string().trim().min(1, "Describe the risk or opportunity.").max(4000),
  consequence: optionalText,
  likelihood: optionalText,
  ratingScaleVersion: z.string().trim().min(1, "Enter the rating scale version in use.").max(50),
  initialRatingValue: z.string().trim().min(1, "Enter an initial rating value."),
  ownerMembershipId: optionalId,
});

export const residualRatingFormSchema = z.object({
  riskOpportunityId: z.string().min(1),
  residualRatingValue: z.string().trim().min(1, "Enter a residual rating value."),
  status: z.enum(["OPEN", "MONITORING", "CLOSED"]).optional(),
});

export const changeAssessmentFormSchema = z.object({
  programmeId: z.string().min(1),
  proposedChange: z.string().trim().min(1, "Describe the proposed change.").max(4000),
  triggerType: z.string().trim().min(1, "Enter a trigger type.").max(100),
  triggerDate: z.union([z.coerce.date(), z.literal("")]).optional(),
});

export const submitChangeAssessmentFormSchema = z.object({
  assessmentId: z.string().min(1),
  assessmentNotes: z.string().trim().min(1, "Enter assessment notes."),
});

export const approveChangeAssessmentFormSchema = z.object({
  assessmentId: z.string().min(1),
  decision: z.string().trim().min(1, "Enter the decision."),
});

export const implementChangeAssessmentFormSchema = z.object({
  assessmentId: z.string().min(1),
});

export const effectivenessReviewFormSchema = z.object({
  assessmentId: z.string().min(1),
  review: z.string().trim().min(1, "Enter the effectiveness review."),
});
