/**
 * Notifications and reminders (task T24, Docs/PHASE2_EMS_FOUNDATION_SPEC.md
 * §3 "Audit, outbox and notifications", §7 "P2-07").
 *
 * `NotificationType`/`ReminderEvent` are dot-namespaced strings, not a
 * Postgres enum, mirroring `OutboxMessage.topic` (T21) — later phases
 * (T32/T33/T41/T44/T50/T70, all of which depend on T24) add new types
 * without a schema migration.
 *
 * Message text is generated only from `NOTIFICATION_TEMPLATES` below, keyed
 * by type, and takes a resource type *label* — never a raw record field,
 * name, value, or free-text summary. This is what the T24 acceptance
 * criterion "no sensitive record detail leaks into generic notification
 * text" is enforced by: a caller cannot pass arbitrary body text into a
 * notification, only a type and a resourceType/resourceId pair.
 */

export const NOTIFICATION_TYPES = [
  "review.due",
  "review.overdue",
  "approval.requested",
  "approval.completed",
  "expiry.upcoming",
  "expiry.expired",
  "action.overdue",
  "legal_change.detected",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isKnownNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export type NotificationStatus = "PENDING" | "DELIVERED" | "READ" | "DISMISSED" | "SUPPRESSED";
export type NotificationChannel = "IN_APP" | "EMAIL";

/** Generic, non-disclosing label for a resource type shown in notification copy. Unknown types fall back to "record" rather than leaking the raw string. */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ems_scope_version: "an EMS scope version",
  controlled_document: "a controlled document",
  change_assessment: "a change assessment",
  compliance_obligation: "a compliance obligation",
  legal_source: "a legal register source",
  action: "an EMS action",
  objective: "an EMS objective",
  audit_report: "an internal audit report",
  competence_record: "a competence record",
};

function resourceLabel(resourceType: string): string {
  return RESOURCE_TYPE_LABELS[resourceType] ?? "a record";
}

/** Fixed, generic per-type message templates. This is the only place notification copy is generated. */
export const NOTIFICATION_TEMPLATES: Record<NotificationType, (resourceType: string) => { title: string; body: string }> = {
  "review.due": (resourceType) => ({
    title: "Review due",
    body: `${capitalise(resourceLabel(resourceType))} is due for review. Open it in the app for details.`,
  }),
  "review.overdue": (resourceType) => ({
    title: "Review overdue",
    body: `${capitalise(resourceLabel(resourceType))} is overdue for review. Open it in the app for details.`,
  }),
  "approval.requested": (resourceType) => ({
    title: "Approval requested",
    body: `${capitalise(resourceLabel(resourceType))} is waiting for your approval. Open it in the app for details.`,
  }),
  "approval.completed": (resourceType) => ({
    title: "Approval completed",
    body: `${capitalise(resourceLabel(resourceType))} you were following has been approved. Open it in the app for details.`,
  }),
  "expiry.upcoming": (resourceType) => ({
    title: "Expiry approaching",
    body: `${capitalise(resourceLabel(resourceType))} is approaching its expiry date. Open it in the app for details.`,
  }),
  "expiry.expired": (resourceType) => ({
    title: "Expired",
    body: `${capitalise(resourceLabel(resourceType))} has expired. Open it in the app for details.`,
  }),
  "action.overdue": (resourceType) => ({
    title: "Action overdue",
    body: `${capitalise(resourceLabel(resourceType))} assigned to you is overdue. Open it in the app for details.`,
  }),
  "legal_change.detected": (resourceType) => ({
    title: "Legal change detected",
    body: `A legal or regulatory change may affect ${resourceLabel(resourceType)}. Open it in the app for details.`,
  }),
};

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Recipient-resolution policy for a `ReminderRule`, resolved against live
 * membership state at evaluation time (spec §3 "resolved ... never a stored
 * membership id list") — never a fixed, stored list of membership ids.
 */
export type RecipientsPolicy =
  | { kind: "membership"; membershipId: string }
  | { kind: "permission"; permission: string };

export function isRecipientsPolicy(value: unknown): value is RecipientsPolicy {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "membership") return typeof v.membershipId === "string";
  if (v.kind === "permission") return typeof v.permission === "string";
  return false;
}

/** A candidate reminder subject supplied by the caller's own domain (T30+/T40+ etc.) — T24 has no aspect/obligation/etc. models of its own. */
export interface ReminderSubject {
  resourceId: string;
  /** The date the reminder's offset is measured against (e.g. a review/expiry date). */
  referenceDate: Date;
  /** True when the resource has been reassigned since the rule/notification was created — suppresses stale reminders addressed to the previous owner. */
  reassigned?: boolean;
  /** True when the resource is closed/completed/withdrawn — suppresses further reminders entirely. */
  closed?: boolean;
  /** Overrides `ReminderRule.recipientsPolicy` for this one subject, e.g. "owner" resolution that varies per resource. */
  recipientsPolicy?: RecipientsPolicy;
}
