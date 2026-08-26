import { z } from "zod";

const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));

export const emergencyScenarioFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a scenario name.").max(200),
  aspectId: z.string().optional().or(z.literal("")),
  processId: z.string().optional().or(z.literal("")),
  siteId: z.string().optional().or(z.literal("")),
  triggerDescription: z.string().trim().min(1, "Describe the trigger.").max(4000),
  receptors: z.string().trim().min(1, "Describe the affected receptors.").max(2000),
  credibleConsequence: z.string().trim().min(1, "Describe the credible consequence.").max(4000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  controlsSummary: optionalText,
  reviewDueDate: z.coerce.date({ error: "Enter a valid review due date." }),
});

export const emergencyPlanFormSchema = z.object({
  scenarioId: z.string().min(1, "Choose a scenario."),
  controlledDocumentRevisionId: z.string().min(1, "Choose an approved or effective controlled-document revision."),
  roles: z.string().trim().min(1, "Describe response roles and responsibilities.").max(4000),
  resources: z.string().trim().min(1, "Describe available resources.").max(4000),
  communicationPlanId: z.string().optional().or(z.literal("")),
  effectiveDate: z.coerce.date({ error: "Enter a valid effective date." }),
  reviewDueDate: z.coerce.date({ error: "Enter a valid review due date." }),
});

export const emergencyExerciseFormSchema = z.object({
  scenarioId: z.string().min(1, "Choose a scenario."),
  planId: z.string().min(1, "Choose the exact plan version being exercised."),
  type: z.enum(["TABLETOP", "DRILL", "FULL_SCALE"]),
  exerciseDate: z.coerce.date({ error: "Enter a valid exercise date." }),
  participantMembershipIds: z.array(z.string().min(1)).min(1, "Record at least one participant."),
  objectives: z.string().trim().min(1, "Describe the exercise objectives.").max(4000),
  outcome: z.enum(["SUCCESSFUL", "PARTIAL", "FAILED"]),
  observations: optionalText,
  lessons: optionalText,
});

export const emergencyExerciseActionFormSchema = z.object({
  exerciseId: z.string().min(1),
  description: z.string().trim().min(1, "Describe the follow-up action.").max(2000),
  ownerMembershipId: z.string().optional().or(z.literal("")),
  dueDate: z.union([z.coerce.date(), z.literal("")]).optional(),
  actionReference: z.string().trim().max(200).optional().or(z.literal("")),
  incidentReference: z.string().trim().max(200).optional().or(z.literal("")),
  nonconformityReference: z.string().trim().max(200).optional().or(z.literal("")),
});

export const retireEmergencyPlanFormSchema = z.object({
  planId: z.string().min(1),
  reason: z.string().trim().min(1, "Record why the emergency plan is being retired.").max(2000),
});
