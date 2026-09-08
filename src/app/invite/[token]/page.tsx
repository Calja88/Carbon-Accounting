import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { assertInvitationAcceptable, hashInvitationToken, InvitationTokenError } from "@/lib/organisation/invitation-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptInvitationForm } from "./accept-form";

export default async function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const tokenHash = hashInvitationToken(token);
  const membership = await prisma.organisationMembership.findUnique({
    where: { inviteTokenHash: tokenHash },
    include: { user: { select: { email: true } }, organisation: { select: { name: true } } },
  });

  let invalidReason: string | null = null;
  try {
    assertInvitationAcceptable(membership, token);
  } catch (err) {
    invalidReason = err instanceof InvitationTokenError ? err.reason : "NOT_FOUND";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Accept invitation</CardTitle>
          </CardHeader>
          <CardContent>
            {invalidReason || !membership ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  This invitation link is invalid or has expired. Ask an organisation administrator to resend it.
                </p>
                <Link href="/login" className="text-sm text-blue-700 hover:text-blue-800">
                  Go to sign in
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  You&apos;ve been invited to join <span className="font-medium text-slate-800">{membership.organisation.name}</span> as{" "}
                  <span className="font-medium text-slate-800">{membership.user.email}</span>. Set a password to activate
                  your membership.
                </p>
                <AcceptInvitationForm token={token} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
