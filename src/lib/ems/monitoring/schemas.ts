import { z } from "zod";

const requiredText = (message: string, max = 4000) => z.string().trim().min(1, message).max(max);
const optionalText = z.string().trim().max(4000).optional().or(z.literal(""));
const optionalDate = z.union([z.coerce.date(), z.literal("")]).optional();

export const monitoringPlanFormSchema = z.object({
  planKey: requiredText("Enter a stable monitoring-plan key.", 100).regex(/^[a-z][a-z0-9_-]*$/i, "Use a stable alphanumeric plan key."),
  parameter: requiredText("Enter the parameter being monitored.", 200),
  method: requiredText("Enter the monitoring method.", 500),
  location: requiredText("Enter the monitoring location.", 500),
  frequency: requiredText("Enter the monitoring frequency.", 200),
  unit: requiredText("Enter an explicit unit.", 100),
  acceptanceCriteria: requiredText("Enter acceptance criteria."),
  aspectId: z.string().optional().or(z.literal("")),
  controlId: z.string().optional().or(z.literal("")),
  obligationReference: z.string().trim().max(200).optional().or(z.literal("")),
  objectiveReference: z.string().trim().max(200).optional().or(z.literal("")),
  responsibleMembershipId: requiredText("Choose a responsible member.", 200),
  instrumentRequired: z.boolean().default(false),
  equipmentId: z.string().optional().or(z.literal("")),
  reviewDueDate: optionalDate,
});

export const monitoringResultFormSchema = z.object({
  planId: requiredText("Choose a monitoring plan.", 200),
  measuredAt: z.coerce.date({ error: "Enter a valid measurement date." }),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  value: requiredText("Enter a numeric result.", 100),
  unit: requiredText("Enter the result unit.", 100),
  qualitativeResult: optionalText,
  dataQualityFlag: z.enum(["VALIDATED", "ESTIMATED", "SUSPECT", "REJECTED"]),
});

export const monitoringResultReviewFormSchema = z.object({
  resultId: requiredText("Choose a result.", 200),
  reviewNote: requiredText("Document the result review."),
});

export const monitoringEquipmentFormSchema = z.object({
  reference: requiredText("Enter an equipment reference.", 100).regex(/^[a-z0-9][a-z0-9_-]*$/i, "Use an alphanumeric equipment reference."),
  description: requiredText("Enter an equipment description.", 500),
  location: requiredText("Enter the equipment location.", 500),
  calibrationFrequency: requiredText("Enter the calibration or verification frequency.", 200),
  calibrationDueDate: z.coerce.date({ error: "Enter a valid calibration due date." }),
  ownerMembershipId: requiredText("Choose an equipment owner.", 200),
});

export const equipmentCalibrationFormSchema = z.object({
  equipmentId: requiredText("Choose monitoring equipment.", 200),
  dueDate: z.coerce.date({ error: "Enter a valid due date." }),
  performedAt: z.coerce.date({ error: "Enter a valid performed date." }),
  provider: requiredText("Enter the calibration provider.", 500),
  method: requiredText("Enter the calibration method.", 500),
  result: z.enum(["PASS", "FAIL", "OUT_OF_TOLERANCE"]),
  nextDueDate: z.coerce.date({ error: "Enter a valid next due date." }),
  responseReference: z.string().trim().max(500).optional().or(z.literal("")),
});

export const monitoringExceptionReviewFormSchema = z.object({
  resultId: z.string().optional().or(z.literal("")),
  calibrationId: z.string().optional().or(z.literal("")),
  reason: requiredText("Document why the exception review is required."),
  validityDecision: z.enum(["VALID", "PARTIALLY_VALID", "INVALID"]),
  consequence: requiredText("Document consequences and the response taken."),
  actionReference: z.string().trim().max(500).optional().or(z.literal("")),
}).refine((value) => Boolean(value.resultId) !== Boolean(value.calibrationId), {
  message: "Review exactly one monitoring result or calibration.",
});
