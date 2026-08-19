/** Objectives and metric definitions (T50) form input validation — form-submitted shapes only. */

import { z } from "zod";

export const objectiveApprovalDecisionSchema = z.enum(["APPROVED", "REJECTED", "RETURNED"]);
export const objectiveSourceLinkTypeSchema = z.enum(["POLICY", "ASPECT_ASSESSMENT", "OBLIGATION_VERSION", "RISK_OPPORTUNITY"]);
export const objectiveMetricSourceTypeSchema = z.enum(["MANUAL", "CORPORATE_CARBON", "PRODUCT_LCA", "MONITORING", "DERIVED_APPROVED_FORMULA"]);

export const objectiveSourceLinkFormSchema = z.object({
  linkType: objectiveSourceLinkTypeSchema,
  policyRecordId: z.string().trim().optional().or(z.literal("")),
  aspectAssessmentId: z.string().trim().optional().or(z.literal("")),
  obligationVersionId: z.string().trim().optional().or(z.literal("")),
  riskOpportunityId: z.string().trim().optional().or(z.literal("")),
});

export const createEnvironmentalObjectiveFormSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(300),
  intent: z.string().trim().min(1, "Enter an intent.").max(4000),
  ownerMembershipId: z.string().trim().min(1, "Choose an owner."),
  baselineDescription: z.string().trim().min(1, "Enter a baseline description.").max(4000),
  baselineDate: z.coerce.date().optional(),
  targetValue: z.coerce.number().optional(),
  targetQualitative: z.string().trim().max(2000).optional().or(z.literal("")),
  unit: z.string().trim().max(100).optional().or(z.literal("")),
  targetDate: z.coerce.date(),
  evaluationMethod: z.string().trim().min(1, "Enter an evaluation method.").max(2000),
  sourceLinks: z.array(objectiveSourceLinkFormSchema).default([]),
});

export const updateEnvironmentalObjectiveVersionDraftFormSchema = createEnvironmentalObjectiveFormSchema;

export const createSuccessorObjectiveVersionFormSchema = createEnvironmentalObjectiveFormSchema.extend({
  revisionRationale: z.string().trim().min(1, "Enter a revision rationale.").max(2000),
});

export const decideEnvironmentalObjectiveVersionFormSchema = z.object({
  objectiveVersionId: z.string().trim().min(1),
  decision: objectiveApprovalDecisionSchema,
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const decideObjectiveAchievementFormSchema = z.object({
  objectiveVersionId: z.string().trim().min(1),
  achieved: z.boolean(),
  rationale: z.string().trim().min(1, "Enter a rationale.").max(2000),
});

export const cancelObjectiveVersionFormSchema = z.object({
  objectiveVersionId: z.string().trim().min(1),
  rationale: z.string().trim().min(1, "Enter a rationale.").max(2000),
});

export const createObjectiveMetricDefinitionFormSchema = z.object({
  objectiveId: z.string().trim().min(1, "Choose an objective."),
  name: z.string().trim().min(1, "Enter a metric name.").max(300),
  sourceType: objectiveMetricSourceTypeSchema,
  unit: z.string().trim().min(1, "Enter a unit.").max(100),
  frequency: z.string().trim().min(1, "Enter a measurement frequency.").max(200),
  boundaryDescription: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const updateObjectiveMetricVersionDraftFormSchema = createObjectiveMetricDefinitionFormSchema.omit({ objectiveId: true });

export const createSuccessorObjectiveMetricVersionFormSchema = updateObjectiveMetricVersionDraftFormSchema;

export const approveObjectiveMetricVersionFormSchema = z.object({
  metricVersionId: z.string().trim().min(1),
});
