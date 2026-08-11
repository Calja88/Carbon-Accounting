/**
 * Phase 2 (T20) — integrity metadata for the append-only audit log.
 *
 * Every `AuditEvent` stores `contentHash` (a hash of its own safe fields)
 * and `previousEventHash` (the prior event's `contentHash` for the same
 * organisation, or null for the first). Recomputing `contentHash` for every
 * stored row and checking that each row's `previousEventHash` matches the
 * previous row's `contentHash` detects tampering, reordering, or deletion —
 * even though the application itself never performs an update or delete
 * (enforced separately: no such repository method exists, and the
 * database trigger in this table's migration rejects both regardless).
 *
 * Pure and DB-agnostic on purpose, so the hash can be recomputed by a
 * verification job without touching Prisma.
 */

import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, so field order at the call site never changes the hash. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** The fields hashed into `contentHash` — everything that identifies "what happened", excluding the hash chain fields themselves. */
export interface AuditEventHashInput {
  organisationId: string;
  actorUserId: string | null;
  actorType: string;
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  correlationId: string;
  source: string;
  occurredAt: string; // ISO 8601, so the hash is stable across Date object identity
}

export function computeContentHash(input: AuditEventHashInput): string {
  return createHash("sha256").update(canonicalStringify(input)).digest("hex");
}
