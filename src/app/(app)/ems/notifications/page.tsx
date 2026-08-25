import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { listMyNotifications } from "@/lib/notifications/notification-service";
import { NOTIFICATION_TYPES, type NotificationStatus, type NotificationType } from "@/lib/notifications/types";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { getOrganisationWorkerHealth } from "@/lib/jobs/health";
import { resourceLink } from "@/lib/ems/notifications/resource-links";
import { AcknowledgeButton, DismissButton } from "./notification-actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<NotificationStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  DELIVERED: "info",
  READ: "success",
  DISMISSED: "neutral",
  SUPPRESSED: "warning",
};

const STATUS_FILTERS: NotificationStatus[] = ["DELIVERED", "READ", "DISMISSED", "SUPPRESSED"];

function isNotificationStatus(value: string | undefined): value is NotificationStatus {
  return !!value && (STATUS_FILTERS as string[]).includes(value);
}

function isNotificationType(value: string | undefined): value is NotificationType {
  return !!value && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

interface PageProps {
  searchParams: Promise<{ status?: string; type?: string }>;
}

export default async function NotificationsWorkQueuePage({ searchParams }: PageProps) {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const params = await searchParams;
  const statusFilter = isNotificationStatus(params.status) ? params.status : undefined;
  const typeFilter = isNotificationType(params.type) ? params.type : undefined;

  const canSeeJobHealth = hasPermission(context, "ems.notification.manage");

  const [notifications, workerHealth] = await Promise.all([
    listMyNotifications(context, { status: statusFilter, take: 200 }),
    canSeeJobHealth ? getOrganisationWorkerHealth(toTenantRepositoryContext(context)) : Promise.resolve(null),
  ]);

  const filtered = typeFilter ? notifications.filter((n) => n.type === typeFilter) : notifications;

  const dueCount = filtered.filter((n) => n.type.endsWith(".due") && n.status !== "DISMISSED" && n.status !== "SUPPRESSED").length;
  const overdueCount = filtered.filter(
    (n) => (n.type.endsWith(".overdue") || n.type === "expiry.expired") && n.status !== "DISMISSED" && n.status !== "SUPPRESSED",
  ).length;

  function filterHref(next: { status?: string; type?: string }) {
    const merged = { status: statusFilter, type: typeFilter, ...next };
    const qs = new URLSearchParams();
    if (merged.status) qs.set("status", merged.status);
    if (merged.type) qs.set("type", merged.type);
    const query = qs.toString();
    return query ? `/ems/notifications?${query}` : "/ems/notifications";
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My work queue</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Notifications and reminders addressed to you, from the T24 notifications and reminders service. All
          content shown here is synthetic. Only you can see or act on your own queue.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{dueCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overdue</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{overdueCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-500">Status:</span>
        <Link
          href={filterHref({ status: undefined })}
          className={`rounded-full px-3 py-1 ${!statusFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          All
        </Link>
        {STATUS_FILTERS.map((status) => (
          <Link
            key={status}
            href={filterHref({ status })}
            className={`rounded-full px-3 py-1 ${statusFilter === status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            {status}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-500">Source:</span>
        <Link
          href={filterHref({ type: undefined })}
          className={`rounded-full px-3 py-1 ${!typeFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          All
        </Link>
        {NOTIFICATION_TYPES.map((type) => (
          <Link
            key={type}
            href={filterHref({ type })}
            className={`rounded-full px-3 py-1 ${typeFilter === type ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            {type}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Notification</th>
              <th scope="col" className="px-4 py-2">Type</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Received</th>
              <th scope="col" className="px-4 py-2">Record</th>
              <th scope="col" className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {statusFilter || typeFilter
                    ? "Nothing in your queue matches this filter."
                    : "Your work queue is empty — nothing needs your attention right now."}
                </td>
              </tr>
            )}
            {filtered.map((notification) => {
              const link = resourceLink(notification.resourceType, notification.resourceId);
              return (
                <tr key={notification.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <p className="font-medium text-slate-900">{notification.title}</p>
                    <p className="text-slate-500">{notification.body}</p>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{notification.type}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[notification.status as NotificationStatus] ?? "neutral"}>
                      {notification.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {notification.deliveredAt ? new Date(notification.deliveredAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {link ? (
                      <Link href={link} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                        Open
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      {notification.status !== "READ" && notification.status !== "DISMISSED" && notification.status !== "SUPPRESSED" && (
                        <AcknowledgeButton notificationId={notification.id} />
                      )}
                      {notification.status !== "DISMISSED" && notification.status !== "SUPPRESSED" && (
                        <DismissButton notificationId={notification.id} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canSeeJobHealth && workerHealth && (
        <section aria-labelledby="notifications-job-health">
          <h2 id="notifications-job-health" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Notification delivery health
          </h2>
          <p className="mb-3 max-w-3xl text-sm text-slate-500">
            Outbox and job status for this organisation only (T21). Counts, not payload contents — no job secrets or
            provider credentials are shown here.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <HealthTile label="Pending" value={workerHealth.pendingCount} />
            <HealthTile label="Retrying" value={workerHealth.retryCount} />
            <HealthTile label="Stale lease" value={workerHealth.staleLeaseCount} tone={workerHealth.staleLeaseCount > 0 ? "warning" : "neutral"} />
            <HealthTile label="Dead-lettered" value={workerHealth.deadLetterCount} tone={workerHealth.deadLetterCount > 0 ? "danger" : "neutral"} />
            <HealthTile label="Runs (1h)" value={workerHealth.recentRunCount} />
            <HealthTile
              label="Failed (1h)"
              value={workerHealth.recentFailureCount}
              tone={workerHealth.recentFailureCount > 0 ? "danger" : "neutral"}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function HealthTile({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warning" | "danger" }) {
  const toneClasses =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
