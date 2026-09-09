/**
 * Transactional outbox and job framework (task T21,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Audit, outbox and notifications").
 *
 * Topics are dot-namespaced strings, not a Postgres enum, so later phases
 * (legal sync, reminders, notifications — T24/T4x) add topics without a
 * migration. `platform.*` is a reserved namespace: only those topics may
 * enqueue with a null `organisationId` (a declared, allowlisted platform
 * job). Every other topic requires an explicit tenant context — the T21
 * acceptance criterion "tenant context is explicit on tenant jobs" is
 * enforced here, at enqueue time, not left to the caller's discipline.
 *
 * `prisma/migrations/20260811150000_add_outbox_job_framework` mirrors this
 * `platform.` convention with a DB trigger, so a future direct-SQL write
 * cannot bypass it either.
 */

export const PLATFORM_JOB_TOPIC_PREFIX = "platform.";

/**
 * The only topics allowed to enqueue a platform-wide job (no organisation).
 * Declared explicitly rather than inferred from the prefix alone, so adding
 * a new platform job is a visible, reviewable change.
 *
 * `legal.sync` (task T42, `src/lib/ems/legal/legal-sync-worker.ts`) is a
 * deliberate exception to the `platform.` naming convention above: it was
 * already named without the prefix when this file first documented it (see
 * the `OutboxMessage.topic` schema comment), and `LegalSourceProvider`/
 * `LegalSyncCursor` are platform-global reference data with no organisation
 * to scope the job to — same reasoning as `platform.outbox_backlog_sweep`.
 */
export const PLATFORM_JOB_TOPICS = ["platform.outbox_backlog_sweep", "legal.sync"] as const;

export type PlatformJobTopic = (typeof PLATFORM_JOB_TOPICS)[number];

export function isPlatformJobTopic(topic: string): topic is PlatformJobTopic {
  return (PLATFORM_JOB_TOPICS as readonly string[]).includes(topic);
}

export function isReservedPlatformNamespace(topic: string): boolean {
  return topic.startsWith(PLATFORM_JOB_TOPIC_PREFIX);
}

export type OutboxMessageStatus = "PENDING" | "LEASED" | "RETRY" | "COMPLETED" | "DEAD_LETTER";
export type JobRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

/** Structured job failure — never a raw stack trace, payload dump, or secret. */
export interface JobError {
  code: string;
  message: string;
}

export class JobHandlerError extends Error implements JobError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JobHandlerError";
    this.code = code;
  }
}

/** Input to `enqueueTenantJob`/`enqueuePlatformJob`. */
export interface EnqueueJobInput {
  topic: string;
  payload: Record<string, unknown>;
  /** Unique per topic. Re-enqueueing the same (topic, idempotencyKey) returns the existing message instead of creating a duplicate. */
  idempotencyKey: string;
  /** Defaults to now — when omitted the message is immediately due. */
  availableAt?: Date;
  maxAttempts?: number;
  correlationId: string;
  source: string;
}

export interface OutboxMessageRecord {
  id: string;
  organisationId: string | null;
  topic: string;
  version: number;
  payload: unknown;
  idempotencyKey: string;
  status: OutboxMessageStatus;
  availableAt: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  correlationId: string;
  source: string;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A message handler processes one leased message and either succeeds or throws a `JobError`-shaped error. */
export type JobHandler = (message: OutboxMessageRecord) => Promise<void>;
