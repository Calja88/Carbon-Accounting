import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { Badge } from "@/components/ui/badge";
import { listCompetenceGaps } from "@/lib/ems/competence/gap-service";
import type { OrganisationContext } from "@/lib/organisation/context";
import { RunExpiryCheckButton } from "./expiry-actions";

export const dynamic = "force-dynamic";

const UPCOMING_WINDOW_DAYS = 30;

function accessiblePersonFilter(context: OrganisationContext) {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ],
  };
}

export default async function CompetenceExpiryPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const canManage = hasPermission(context, "ems.competence.manage");
  const ctx = toTenantRepositoryContext(context);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [gaps, expiringSoon] = await Promise.all([
    listCompetenceGaps(context),
    prisma.competenceAssignment.findMany({
      where: tenantWhere(ctx, {
        status: "COMPETENT" as const,
        competentUntil: { gte: now, lte: windowEnd },
        person: accessiblePersonFilter(context),
      }),
      include: {
        person: { select: { id: true, displayName: true, membership: { select: { user: { select: { name: true } } } } } },
        requirementVersion: { select: { id: true, title: true } },
      },
      orderBy: { competentUntil: "asc" },
    }),
  ]);

  const expired = gaps.filter((gap) => gap.severity === "EXPIRED");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Competence expiry</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Competence assignments already expired, and those due to expire within {UPCOMING_WINDOW_DAYS} days.
            Expiry never deletes evidence or assessment history — it turns an assignment back into a gap. Reminders
            for approaching and passed expiry appear in the{" "}
            <Link href="/ems/notifications?type=expiry.upcoming" className="text-blue-700 underline">
              work queue
            </Link>{" "}
            using the existing notification/reminder engine; no real notifications are sent from this dashboard.
          </p>
        </div>
        {canManage && <RunExpiryCheckButton />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800">Expired</p>
          <p className="text-2xl font-semibold text-red-900">{expired.length}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Expiring within {UPCOMING_WINDOW_DAYS} days</p>
          <p className="text-2xl font-semibold text-amber-900">{expiringSoon.length}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Expired</h2>
        {expired.length === 0 ? (
          <p className="text-sm text-slate-500">No expired competence in scope.</p>
        ) : (
          <div className="space-y-2">
            {expired.map((gap) => (
              <Link
                key={gap.assignmentId}
                href={`/ems/competence/assignments/${gap.assignmentId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div>
                  <p className="font-medium text-slate-900">{gap.personDisplayName ?? "Unnamed person"}</p>
                  <p className="text-sm text-slate-500">{gap.requirementTitle}</p>
                  {gap.gapSince && <p className="text-xs text-slate-500">Expired since {gap.gapSince.toISOString().slice(0, 10)}</p>}
                </div>
                <Badge tone="danger">EXPIRED</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Expiring soon</h2>
        {expiringSoon.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing due to expire in the next {UPCOMING_WINDOW_DAYS} days.</p>
        ) : (
          <div className="space-y-2">
            {expiringSoon.map((assignment) => {
              const personName = assignment.person.displayName ?? assignment.person.membership?.user.name ?? "Unnamed person";
              return (
                <Link
                  key={assignment.id}
                  href={`/ems/competence/assignments/${assignment.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300"
                >
                  <div>
                    <p className="font-medium text-slate-900">{personName}</p>
                    <p className="text-sm text-slate-500">{assignment.requirementVersion.title}</p>
                  </div>
                  <Badge tone="warning">Valid until {assignment.competentUntil!.toISOString().slice(0, 10)}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
