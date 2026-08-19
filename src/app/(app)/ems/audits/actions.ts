"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  AuditProgrammeError,
  createAuditProgramme,
  approveAuditProgramme,
  activateAuditProgramme,
  completeAuditProgramme,
  createAuditProgrammeItem,
  type AuditScopeEntryInput,
} from "@/lib/ems/audits/programme-service";
import {
  createEmsAudit,
  rescheduleEmsAudit,
  assignAuditTeamMember,
  removeAuditTeamMember,
  startAuditPreparation,
  startAuditExecution,
} from "@/lib/ems/audits/audit-service";
import {
  createAuditProgrammeFormSchema,
  createAuditProgrammeItemFormSchema,
  createEmsAuditFormSchema,
  rescheduleEmsAuditFormSchema,
  assignAuditTeamMemberFormSchema,
} from "@/lib/ems/audits/audit-schemas";

export interface AuditActionState {
  error: string | null;
  message: string | null;
}

const emptyState: AuditActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof AuditProgrammeError) return error.message;
  throw error;
}

function revalidateAudits() {
  revalidatePath("/ems/audits");
}

function scopesFromForm(parsed: { entityIds: string[]; siteIds: string[] }): AuditScopeEntryInput[] {
  return [...parsed.entityIds.map((entityId) => ({ entityId })), ...parsed.siteIds.map((siteId) => ({ siteId }))];
}

export async function createAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createAuditProgrammeFormSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      objectives: formData.get("objectives"),
      riskBasis: formData.get("riskBasis"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      ownerMembershipId: formData.get("ownerMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
    await createAuditProgramme(context, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      objectives: parsed.data.objectives || null,
      riskBasis: parsed.data.riskBasis,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      ownerMembershipId: parsed.data.ownerMembershipId,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit programme created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await approveAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function activateAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await activateAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme activated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await completeAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme completed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createAuditProgrammeItemAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createAuditProgrammeItemFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      title: formData.get("title"),
      rationale: formData.get("rationale"),
      priority: formData.get("priority") || "MEDIUM",
      plannedStart: formData.get("plannedStart"),
      plannedEnd: formData.get("plannedEnd"),
      siteIds: formData.getAll("siteIds").map(String),
      entityIds: formData.getAll("entityIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the planned audit details." };
    await createAuditProgrammeItem(context, parsed.data.programmeId, {
      title: parsed.data.title,
      rationale: parsed.data.rationale || null,
      priority: parsed.data.priority,
      plannedStart: parsed.data.plannedStart,
      plannedEnd: parsed.data.plannedEnd,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Planned audit added to the programme." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createEmsAuditAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createEmsAuditFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      programmeItemId: formData.get("programmeItemId"),
      type: formData.get("type"),
      title: formData.get("title"),
      objectives: formData.get("objectives"),
      criteriaSummary: formData.get("criteriaSummary"),
      leadMembershipId: formData.get("leadMembershipId"),
      scheduledStart: formData.get("scheduledStart"),
      scheduledEnd: formData.get("scheduledEnd"),
      siteIds: formData.getAll("siteIds").map(String),
      entityIds: formData.getAll("entityIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the audit details." };
    await createEmsAudit(context, {
      programmeId: parsed.data.programmeId,
      programmeItemId: parsed.data.programmeItemId || null,
      type: parsed.data.type,
      title: parsed.data.title,
      objectives: parsed.data.objectives || null,
      criteriaSummary: parsed.data.criteriaSummary,
      leadMembershipId: parsed.data.leadMembershipId,
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit scheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function rescheduleEmsAuditAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = rescheduleEmsAuditFormSchema.safeParse({
      auditId: formData.get("auditId"),
      scheduledStart: formData.get("scheduledStart"),
      scheduledEnd: formData.get("scheduledEnd"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the new schedule." };
    await rescheduleEmsAudit(context, parsed.data.auditId, {
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd,
      reason: parsed.data.reason || null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit rescheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function assignAuditTeamMemberAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = assignAuditTeamMemberFormSchema.safeParse({
      auditId: formData.get("auditId"),
      membershipId: formData.get("membershipId"),
      role: formData.get("role"),
      independenceDeclared: formData.get("independenceDeclared") === "on" || formData.get("independenceDeclared") === "true",
      conflictDeclared: formData.get("conflictDeclared") === "on" || formData.get("conflictDeclared") === "true",
      conflictNotes: formData.get("conflictNotes"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the team assignment details." };
    await assignAuditTeamMember(context, parsed.data.auditId, {
      membershipId: parsed.data.membershipId,
      role: parsed.data.role,
      independenceDeclared: parsed.data.independenceDeclared,
      conflictDeclared: parsed.data.conflictDeclared,
      conflictNotes: parsed.data.conflictNotes || null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Team member assigned." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function removeAuditTeamMemberAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const memberId = String(formData.get("memberId") ?? "");
    if (!memberId) return { ...emptyState, error: "Choose a team member." };
    await removeAuditTeamMember(context, memberId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Team member removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startAuditPreparationAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await startAuditPreparation(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Audit moved to preparation." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startAuditExecutionAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await startAuditExecution(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Audit execution started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}
