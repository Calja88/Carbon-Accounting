"use server";

/**
 * Phase 1 tenancy (T19) — accept-invitation flow. Public (unauthenticated)
 * route: the visitor doesn't have a session yet. No email was ever sent for
 * this invitation (stubbed); this page is reached only via the link an
 * organisation admin copied and shared themselves.
 */

import { z } from "zod";
import bcrypt from "bcryptjs";
import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashInvitationToken, assertInvitationAcceptable, InvitationTokenError } from "@/lib/organisation/invitation-service";

export interface AcceptInvitationState {
  error: string | null;
  success: boolean;
}

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export async function acceptInvitationAction(
  _prev: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again.", success: false };
  }

  const tokenHash = hashInvitationToken(parsed.data.token);
  const membership = await prisma.organisationMembership.findUnique({ where: { inviteTokenHash: tokenHash } });

  try {
    assertInvitationAcceptable(membership, parsed.data.token);
  } catch (err) {
    if (err instanceof InvitationTokenError) {
      return { error: "This invitation link is invalid or has expired.", success: false };
    }
    throw err;
  }

  // Non-null: assertInvitationAcceptable above throws NOT_FOUND when null.
  const activeMembership = membership!;
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: activeMembership.userId }, data: { passwordHash } }),
    prisma.organisationMembership.update({
      where: { id: activeMembership.id },
      data: {
        status: MembershipStatus.ACTIVE,
        activatedAt: new Date(),
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
      },
    }),
  ]);

  return { error: null, success: true };
}
