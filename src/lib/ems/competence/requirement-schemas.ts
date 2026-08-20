/**
 * Competence requirement versioning and scope form input validation (T70)
 * — form-submitted shapes only. Scope rows are collected per-category
 * (role/process/aspect/control/obligation/emergency) rather than as a
 * generic scopeType+target row, mirroring the entityIds/siteIds/aspectIds
 * pattern already used by the T44 compliance-obligation form — each
 * category maps 1:1 onto a `CompetenceRequirementScopeType`, and
 * `requirement-service.validateScopes` still enforces "exactly one target
 * per row" server-side regardless of how the form assembled it.
 */

import { z } from "zod";

const draftFieldsShape = {
  title: z.string().trim().min(1, "Enter a title.").max(300),
  description: z.string().trim().min(1, "Enter a description.").max(4000),
  renewalRule: z.string().trim().max(2000).optional().or(z.literal("")),
  acceptableEvidence: z.string().trim().max(2000).optional().or(z.literal("")),
  roleIds: z.array(z.string().trim().min(1)).default([]),
  processIds: z.array(z.string().trim().min(1)).default([]),
  aspectIds: z.array(z.string().trim().min(1)).default([]),
  controlIds: z.array(z.string().trim().min(1)).default([]),
  obligationVersionIds: z.array(z.string().trim().min(1)).default([]),
  emergencyScenarioIds: z.array(z.string().trim().min(1)).default([]),
  emergencyRoleLabel: z.string().trim().max(200).optional().or(z.literal("")),
};

function hasAtLeastOneScope(fields: {
  roleIds: string[];
  processIds: string[];
  aspectIds: string[];
  controlIds: string[];
  obligationVersionIds: string[];
  emergencyScenarioIds: string[];
  emergencyRoleLabel?: string;
}) {
  return (
    fields.roleIds.length > 0 ||
    fields.processIds.length > 0 ||
    fields.aspectIds.length > 0 ||
    fields.controlIds.length > 0 ||
    fields.obligationVersionIds.length > 0 ||
    fields.emergencyScenarioIds.length > 0 ||
    !!fields.emergencyRoleLabel
  );
}

const scopePresenceRefinement: { message: string; path: string[] } = {
  message: "Add at least one scope.",
  path: ["roleIds"],
};

export const competenceRequirementDraftFormSchema = z
  .object(draftFieldsShape)
  .refine(hasAtLeastOneScope, scopePresenceRefinement);

export const createCompetenceRequirementFormSchema = z
  .object({ ...draftFieldsShape, requirementKey: z.string().trim().min(1, "Enter a requirement key.").max(200) })
  .refine(hasAtLeastOneScope, scopePresenceRefinement);

export const createSuccessorCompetenceRequirementVersionFormSchema = z
  .object({ ...draftFieldsShape, revisionRationale: z.string().trim().min(1, "Enter a revision rationale.").max(2000) })
  .refine(hasAtLeastOneScope, scopePresenceRefinement);
