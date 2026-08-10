"use server";

/**
 * Phase 1 tenancy (T19) — membership administration: invite, resend/revoke
 * invitation, suspend/reactivate/remove, and role assignment.
 *
 * Every action here resolves the caller's `OrganisationContext` fresh
 * (T13/T14 — current membership state, never the legacy `User.role` claim)
 * and gates on `organisation.membership.manage` or `organisation.role.manage`.
 * Every Prisma call includes `organisationId` in its own `where`, and any
 * membership/role id read back from a form is re-checked against that
 * organisation before use — a foreign-organisation id is rejected as
 * not-found, never silently ignored.
 *
 * Invitations never send email (stubbed per the task packet): issuing or
 * resending returns a one-time plaintext accept link the admin copies and
 * shares themselves.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError, type OrganisationContext } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { issueInvitationToken } from "@/lib/organisation/invitation-service";
import {
  assertRoleManagerCoverageRemains,
  LastRoleManagerError,
  type RoleManagerCandidate,
} from "@/lib/organisation/membership-guard";

export interface MembersActionState {
  error: string | null;
  message: string | null;
  /** Set only right after issue/resend — shown once, never persisted in state across a reload. */
  inviteLink: string | null;
}

const emptyState: MembersActionState = { error: null, message: null, inviteLink: null };

async function requireMembershipManageContext(): Promise<OrganisationContext> {
  const context = await requireOrganisationContext();
  requirePermission(context, "organisation.membership.manage");
  return context;
}

async function requireRoleManageContext(): Promise<OrganisationContext> {
  const context = await requireOrganisationContext();
  requirePermission(context, "organisation.role.manage");
  return context;
}

function friendlyError(err: unknown): string {
  if (err instanceof OrganisationAccessError) return "You must be signed in.";
  if (err instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (err instanceof LastRoleManagerError) return err.message;
  throw err;
}

/** Loads every ACTIVE membership's resolved permission codes, for the last-role-manager guard. */
async function loadRoleManagerCandidates(organisationId: string): Promise<RoleManagerCandidate[]> {
  const memberships = await prisma.organisationMembership.findMany({
    where: { organisationId, status: MembershipStatus.ACTIVE },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });

  return memberships.map((m) => {
    const codes = new Set<string>();
    for (const { role } of m.roles) {
      if (!role.isActive) continue;
      for (const grant of role.permissions) codes.add(grant.permissionCode);
    }
    return { membershipId: m.id, status: m.status, permissionCodes: codes };
  });
}

function inviteLinkFor(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "";
  return `${base}/invite/${token}`;
}

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  roleIds: z.array(z.string().min(1)).min(1, "Select at least one role."),
});

export async function inviteMemberAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    roleIds: formData.getAll("roleIds"),
  });
  if (!parsed.success) {
    return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  // Roles must belong to this organisation — an id for another tenant's role
  // is rejected as not-found, not silently trusted.
  const roles = await prisma.roleDefinition.findMany({
    where: { organisationId: context.organisationId, id: { in: parsed.data.roleIds }, isActive: true },
  });
  if (roles.length !== parsed.data.roleIds.length) {
    return { ...emptyState, error: "One or more selected roles could not be found in this organisation." };
  }

  const email = parsed.data.email.toLowerCase();
  const existingMembership = await prisma.organisationMembership.findFirst({
    where: { organisationId: context.organisationId, user: { email } },
  });
  if (existingMembership) {
    return { ...emptyState, error: "This person already has a membership in this organisation." };
  }

  const { token, tokenHash, expiresAt } = issueInvitationToken();

  await prisma.$transaction(async (tx) => {
    const user =
      (await tx.user.findUnique({ where: { email } })) ??
      (await tx.user.create({
        data: {
          email,
          name: email.split("@")[0],
          // No password is issued out-of-band; this placeholder can never
          // match a bcrypt comparison, so sign-in stays locked until the
          // invitee sets their own password via the accept-invite flow.
          passwordHash: `invite-pending:${tokenHash}`,
          role: "DATA_OWNER",
        },
      }));

    const membership = await tx.organisationMembership.create({
      data: {
        organisationId: context.organisationId,
        userId: user.id,
        status: MembershipStatus.INVITED,
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: expiresAt,
      },
    });

    await tx.membershipRole.createMany({
      data: roles.map((role) => ({
        organisationId: context.organisationId,
        membershipId: membership.id,
        roleId: role.id,
        assignedByUserId: context.userId,
      })),
    });
  });

  revalidatePath("/admin/organisation/members");
  return {
    error: null,
    message: `Invited ${email}. Share the link below — no email is sent.`,
    inviteLink: inviteLinkFor(token),
  };
}

async function loadInvitedMembership(organisationId: string, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { organisationId, id: membershipId },
    include: { user: true },
  });
  if (!membership) throw new Error("Membership not found in this organisation.");
  return membership;
}

export async function resendInvitationAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await loadInvitedMembership(context.organisationId, membershipId).catch(() => null);
  if (!membership || membership.status !== MembershipStatus.INVITED) {
    return { ...emptyState, error: "Only a pending invitation can be resent." };
  }

  const { token, tokenHash, expiresAt } = issueInvitationToken();
  await prisma.organisationMembership.update({
    where: { id: membership.id },
    data: { inviteTokenHash: tokenHash, inviteTokenExpiresAt: expiresAt },
  });

  revalidatePath("/admin/organisation/members");
  return {
    error: null,
    message: `Refreshed the invitation for ${membership.user.email}.`,
    inviteLink: inviteLinkFor(token),
  };
}

export async function revokeInvitationAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await loadInvitedMembership(context.organisationId, membershipId).catch(() => null);
  if (!membership || membership.status !== MembershipStatus.INVITED) {
    return { ...emptyState, error: "Only a pending invitation can be revoked." };
  }

  await prisma.organisationMembership.update({
    where: { id: membership.id },
    data: {
      status: MembershipStatus.REMOVED,
      removedAt: new Date(),
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: "Invitation revoked." };
}

/** Shared by suspend/remove: both take an ACTIVE membership out of the role-manager pool. */
async function assertCanDeactivate(organisationId: string, membershipId: string): Promise<void> {
  const candidates = await loadRoleManagerCandidates(organisationId);
  const projected = candidates.filter((c) => c.membershipId !== membershipId);
  assertRoleManagerCoverageRemains(projected);
}

export async function suspendMembershipAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await loadInvitedMembership(context.organisationId, membershipId).catch(() => null);
  if (!membership || membership.status !== MembershipStatus.ACTIVE) {
    return { ...emptyState, error: "Only an active membership can be suspended." };
  }

  try {
    await assertCanDeactivate(context.organisationId, membershipId);
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  await prisma.organisationMembership.update({
    where: { id: membership.id },
    data: { status: MembershipStatus.SUSPENDED, suspendedAt: new Date() },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: `Suspended ${membership.user.email}.` };
}

export async function reactivateMembershipAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await loadInvitedMembership(context.organisationId, membershipId).catch(() => null);
  if (!membership || membership.status !== MembershipStatus.SUSPENDED) {
    return { ...emptyState, error: "Only a suspended membership can be reactivated." };
  }

  await prisma.organisationMembership.update({
    where: { id: membership.id },
    data: { status: MembershipStatus.ACTIVE, suspendedAt: null },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: `Reactivated ${membership.user.email}.` };
}

export async function removeMembershipAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireMembershipManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const membershipId = String(formData.get("membershipId") ?? "");
  const membership = await loadInvitedMembership(context.organisationId, membershipId).catch(() => null);
  if (!membership || membership.status === MembershipStatus.REMOVED) {
    return { ...emptyState, error: "Membership not found." };
  }

  if (membership.status === MembershipStatus.ACTIVE) {
    try {
      await assertCanDeactivate(context.organisationId, membershipId);
    } catch (err) {
      return { ...emptyState, error: friendlyError(err) };
    }
  }

  await prisma.organisationMembership.update({
    where: { id: membership.id },
    data: {
      status: MembershipStatus.REMOVED,
      removedAt: new Date(),
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: `Removed ${membership.user.email}.` };
}

const roleAssignmentSchema = z.object({
  membershipId: z.string().min(1),
  roleId: z.string().min(1),
});

export async function assignRoleAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireRoleManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const parsed = roleAssignmentSchema.safeParse({
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { ...emptyState, error: "Choose a member and a role." };

  const [membership, role] = await Promise.all([
    prisma.organisationMembership.findFirst({
      where: { organisationId: context.organisationId, id: parsed.data.membershipId },
    }),
    prisma.roleDefinition.findFirst({
      where: { organisationId: context.organisationId, id: parsed.data.roleId, isActive: true },
    }),
  ]);
  if (!membership || !role) {
    return { ...emptyState, error: "Member or role not found in this organisation." };
  }

  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
    update: {},
    create: {
      organisationId: context.organisationId,
      membershipId: membership.id,
      roleId: role.id,
      assignedByUserId: context.userId,
    },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: `Assigned ${role.name}.` };
}

export async function unassignRoleAction(_prev: MembersActionState, formData: FormData): Promise<MembersActionState> {
  let context: OrganisationContext;
  try {
    context = await requireRoleManageContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const parsed = roleAssignmentSchema.safeParse({
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { ...emptyState, error: "Choose a member and a role." };

  const [membership, role] = await Promise.all([
    prisma.organisationMembership.findFirst({
      where: { organisationId: context.organisationId, id: parsed.data.membershipId },
    }),
    prisma.roleDefinition.findFirst({
      where: { organisationId: context.organisationId, id: parsed.data.roleId },
    }),
  ]);
  if (!membership || !role) {
    return { ...emptyState, error: "Member or role not found in this organisation." };
  }

  // If this role grants role-management and removing it from this member
  // would leave nobody able to manage roles, block it — same guard as
  // suspend/remove.
  if (membership.status === MembershipStatus.ACTIVE) {
    const rolePermissions = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const grantsRoleManagement = rolePermissions.some((p) => p.permissionCode === "organisation.role.manage");
    if (grantsRoleManagement) {
      const candidates = await loadRoleManagerCandidates(context.organisationId);
      const projected = candidates.map((c) =>
        c.membershipId === membership.id
          ? { ...c, permissionCodes: new Set([...c.permissionCodes].filter((code) => code !== "organisation.role.manage")) }
          : c,
      );
      try {
        assertRoleManagerCoverageRemains(projected);
      } catch (err) {
        return { ...emptyState, error: friendlyError(err) };
      }
    }
  }

  await prisma.membershipRole.deleteMany({
    where: { organisationId: context.organisationId, membershipId: membership.id, roleId: role.id },
  });

  revalidatePath("/admin/organisation/members");
  return { ...emptyState, message: `Unassigned ${role.name}.` };
}
