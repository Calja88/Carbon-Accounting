"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  LcaAllocationMethod,
  LcaBiogenicTreatment,
  LcaBoundary,
  LcaElectricityApproach,
  LcaOffsetTreatment,
  LcaRecyclingMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canManageMethodology, getLcaContext } from "@/lib/lca/permissions";
import { assertEntityAccess } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import {
  assertMethodologyProfileEditable,
  assertMethodologyProfileMutable,
  countIssuedVersionsForMethodologyProfile,
  findVisibleMethodologyProfile,
  MethodologyProfileFrozenError,
} from "@/lib/repositories/lca-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { MethodologyFormState } from "@/lib/lca/form-state";


const schema = z.object({
  profileId: z.string().optional(),
  entityId: z.string().optional(),
  name: z.string().min(1, "Give the methodology profile a name."),
  version: z.string().min(1, "Give it a version."),
  summary: z.string().optional(),
  defaultBoundary: z.enum(LcaBoundary),
  gwpBasis: z.string().min(1, "State which global warming potential set the figures use."),
  defaultAllocationMethod: z.enum(LcaAllocationMethod),
  allocationRules: z.string().optional(),
  recyclingMethod: z.enum(LcaRecyclingMethod),
  recyclingRules: z.string().optional(),
  electricityApproach: z.enum(LcaElectricityApproach),
  electricityRules: z.string().optional(),
  biogenicTreatment: z.enum(LcaBiogenicTreatment),
  biogenicRules: z.string().optional(),
  removalsRules: z.string().optional(),
  offsetTreatment: z.enum(LcaOffsetTreatment),
  offsetRules: z.string().optional(),
  cutOffRules: z.string().optional(),
  cutOffThresholdPercent: z.string().optional(),
  factorHierarchy: z.string().optional(),
  dataQualityRequirements: z.string().optional(),
  minimumDataQualityScore: z.string().optional(),
  requireEvidenceForPrimary: z.string().optional(),
  standardsReferenced: z.string().optional(),
  notes: z.string().optional(),
  isDefault: z.string().optional(),
});

function toLines(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function saveMethodologyAction(
  _prev: MethodologyFormState,
  formData: FormData,
): Promise<MethodologyFormState> {
  const context = await getLcaContext();
  if (!canManageMethodology(context)) {
    return { error: "Your permissions do not allow changing methodology profiles.", success: false };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  if (data.cutOffThresholdPercent?.trim()) {
    const threshold = Number(data.cutOffThresholdPercent);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      return { error: "The cut-off threshold must be a percentage between 0 and 100.", success: false };
    }
  }
  if (data.minimumDataQualityScore?.trim()) {
    const score = Number(data.minimumDataQualityScore);
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      return { error: "The minimum data-quality score must be between 1 (best) and 5 (worst).", success: false };
    }
  }

  const values = {
    entityId: data.entityId || null,
    name: data.name,
    version: data.version,
    summary: data.summary || null,
    defaultBoundary: data.defaultBoundary,
    gwpBasis: data.gwpBasis,
    defaultAllocationMethod: data.defaultAllocationMethod,
    allocationRules: data.allocationRules || null,
    recyclingMethod: data.recyclingMethod,
    recyclingRules: data.recyclingRules || null,
    electricityApproach: data.electricityApproach,
    electricityRules: data.electricityRules || null,
    biogenicTreatment: data.biogenicTreatment,
    biogenicRules: data.biogenicRules || null,
    removalsRules: data.removalsRules || null,
    offsetTreatment: data.offsetTreatment,
    offsetRules: data.offsetRules || null,
    cutOffRules: data.cutOffRules || null,
    cutOffThresholdPercent: data.cutOffThresholdPercent?.trim() || null,
    factorHierarchy: toLines(data.factorHierarchy),
    dataQualityRequirements: data.dataQualityRequirements || null,
    minimumDataQualityScore: data.minimumDataQualityScore?.trim() || null,
    requireEvidenceForPrimary: data.requireEvidenceForPrimary === "on",
    standardsReferenced: toLines(data.standardsReferenced),
    notes: data.notes || null,
    isDefault: data.isDefault === "on",
  };

  if (data.entityId) assertEntityAccess(context!, data.entityId);

  const ctx = toTenantRepositoryContext(context!);
  if (data.entityId) {
    const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: data.entityId }) });
    if (!entity) throw new TenantOwnershipError();
  }
  let issuedVersionCount = 0;
  if (data.profileId) {
    const existing = await findVisibleMethodologyProfile(ctx, data.profileId);
    const owned = assertMethodologyProfileMutable(ctx, existing);
    if (owned.archivedAt) {
      return { error: "This methodology profile is archived. Restore it before editing.", success: false };
    }
    // Part B: tenant ownership was the only guard here. An issued assessment
    // version freezes its own methodology snapshot, so this cannot rewrite a
    // reported figure — but it could make the register disagree with the
    // methodology an issued report cites, so the normative fields are frozen.
    try {
      ({ issuedVersionCount } = await assertMethodologyProfileEditable(owned, values));
    } catch (err) {
      if (err instanceof MethodologyProfileFrozenError) return { error: err.message, success: false };
      throw err;
    }
  }

  const duplicate = await prisma.lcaMethodologyProfile.findFirst({
    where: { name: values.name, version: values.version, ...(data.profileId ? { NOT: { id: data.profileId } } : {}) },
  });
  if (duplicate) {
    return { error: `A methodology profile called "${values.name} ${values.version}" already exists.`, success: false };
  }

  const profile = data.profileId
    ? await prisma.lcaMethodologyProfile.update({ where: { id: data.profileId }, data: values })
    : await prisma.lcaMethodologyProfile.create({ data: { ...values, organisationId: context!.organisationId } });

  if (values.isDefault) {
    await prisma.lcaMethodologyProfile.updateMany({
      where: { id: { not: profile.id }, isDefault: true, organisationId: context!.organisationId },
      data: { isDefault: false },
    });
  }

  // Assessments read the profile live until they issue a version, so a change
  // here changes every draft built on it — worth recording centrally.
  const affected = await prisma.lcaAssessment.count({ where: { methodologyProfileId: profile.id } });

  await recordAuditEvent({
    entityType: "methodology",
    entityId: profile.id,
    action: data.profileId ? "updated" : "created",
    actorUserId: context!.userId,
    summary: data.profileId
      ? `Methodology profile "${profile.name} ${profile.version}" updated. ${affected} assessment(s) read this profile; drafts among them pick the change up on their next calculation, and issued versions (${issuedVersionCount}) keep the methodology frozen into them.`
      : `Methodology profile "${profile.name} ${profile.version}" created.`,
    after: values,
  });

  revalidatePath("/methodologies");
  return {
    error: null,
    success: true,
    message: data.profileId
      ? `Saved. ${affected} assessment(s) use this profile — recalculate them to apply the change.`
      : "Methodology profile created.",
  };
}

const archiveSchema = z.object({
  profileId: z.string().min(1),
  reason: z.string().trim().min(1, "Record why the profile is being archived.").max(2000),
});

/**
 * Archives a methodology profile — the lifecycle exit a profile has never
 * had.
 *
 * A profile is IMMUTABLE_ISSUED by association: assessments reference it
 * live, and issued assessment versions cite it by name and version inside a
 * frozen snapshot. Deleting it would orphan those citations, so archival is
 * the only safe exit: `archivedAt` takes the profile out of selection for
 * new assessments while every existing reference keeps resolving.
 *
 * Refused while assessments still read the profile live, so archiving can
 * never silently leave a draft assessment pointing at a retired methodology.
 */
export async function archiveMethodologyAction(
  _prev: MethodologyFormState,
  formData: FormData,
): Promise<MethodologyFormState> {
  const context = await getLcaContext();
  if (!canManageMethodology(context)) {
    return { error: "Your permissions do not allow changing methodology profiles.", success: false };
  }
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }

  const ctx = toTenantRepositoryContext(context!);
  const existing = await findVisibleMethodologyProfile(ctx, parsed.data.profileId);
  let owned;
  try {
    owned = assertMethodologyProfileMutable(ctx, existing);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That methodology profile no longer exists.", success: false };
    throw err;
  }
  if (owned.archivedAt) return { error: "This methodology profile is already archived.", success: false };

  const liveAssessments = await prisma.lcaAssessment.count({
    where: { methodologyProfileId: owned.id, organisationId: context!.organisationId },
  });
  if (liveAssessments > 0) {
    return {
      error: `${liveAssessments} assessment(s) still use "${owned.name} ${owned.version}". Move them to another profile before archiving it.`,
      success: false,
    };
  }

  const issuedVersionCount = await countIssuedVersionsForMethodologyProfile(owned.id);
  const archived = await prisma.lcaMethodologyProfile.update({
    where: { id: owned.id },
    data: { archivedAt: new Date(), isDefault: false },
  });

  await recordAuditEvent({
    entityType: "methodology",
    entityId: archived.id,
    action: "archived",
    actorUserId: context!.userId,
    summary: `Methodology profile "${archived.name} ${archived.version}" archived: ${parsed.data.reason.trim()}. `
      + `${issuedVersionCount} issued assessment version(s) keep their frozen methodology snapshot.`,
    before: { archivedAt: null, isDefault: owned.isDefault },
    after: { archivedAt: archived.archivedAt, isDefault: false },
  });

  revalidatePath("/methodologies");
  return { error: null, success: true, message: "Methodology profile archived." };
}
