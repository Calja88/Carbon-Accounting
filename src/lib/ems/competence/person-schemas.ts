/**
 * Person profile and assignment form input validation (T70/UI09) — form
 * shapes only. `person-service`/`assignment-service` still re-validate
 * everything server-side (membership/entity/site ownership, active
 * requirement version, duplicate assignment) regardless of what a form
 * assembled.
 */

import { z } from "zod";

export const createPersonProfileFormSchema = z.object({
  personType: z.enum(["EMPLOYEE", "CONTRACTOR", "OTHER"]),
  displayName: z.string().trim().max(200).optional().or(z.literal("")),
  membershipId: z.string().trim().max(200).optional().or(z.literal("")),
  entityId: z.string().trim().max(200).optional().or(z.literal("")),
  siteId: z.string().trim().max(200).optional().or(z.literal("")),
  contactEmail: z.string().trim().max(320).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const updatePersonProfileFormSchema = z.object({
  displayName: z.string().trim().max(200).optional().or(z.literal("")),
  entityId: z.string().trim().max(200).optional().or(z.literal("")),
  siteId: z.string().trim().max(200).optional().or(z.literal("")),
});

export const setPersonSensitiveProfileFormSchema = z.object({
  contactEmail: z.string().trim().max(320).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const assignCompetenceRequirementFormSchema = z.object({
  requirementVersionId: z.string().trim().min(1, "Choose a requirement version."),
  personId: z.string().trim().min(1, "Choose a person."),
  dueDate: z.string().trim().max(40).optional().or(z.literal("")),
});

export const markCompetenceAssignmentGapFormSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});
