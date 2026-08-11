/**
 * Platform audit event repository (Phase 2 spec §§1-3 Audit, task T20).
 * Follows the T15 tenant-repository pattern (`tenant-scope.ts`): every read
 * bakes `organisationId` into the query itself, and a foreign-tenant id is
 * denied identically to a missing one.
 *
 * `recordAuditEvent`/`recordAuditEvents` are the *only* write functions this
 * module exports — there is deliberately no update or delete, so "the
 * application cannot update/delete events through normal repositories" is
 * true by construction, not by convention. They take a Prisma transaction
 * client (`Prisma.TransactionClient`) rather than the `prisma` singleton so
 * a caller can emit an audit event in the same transaction as the domain
 * write it describes — the atomicity the T20 acceptance criteria require
 * for membership/permission changes: both commit, or neither does.
 *
 * Integrity: each event's `contentHash` and `previousEventHash` form a
 * per-organisation hash chain (`src/lib/audit/integrity.ts`). To keep that
 * chain from forking under concurrent writes to the same organisation, the
 * write functions take a `SELECT ... FOR UPDATE` row lock on the
 * organisation for the lifetime of the caller's transaction before reading
 * the previous event — cheap (row-level, released at commit) and scoped to
 * one organisation, so it never blocks a different tenant's writes.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "./context";
import { tenantWhere, assertOwned, TenantOwnershipError } from "./tenant-scope";
import { computeContentHash } from "@/lib/audit/integrity";
import type { RecordAuditEventInput } from "@/lib/audit/types";

export { TenantOwnershipError };

type Tx = Prisma.TransactionClient;

function toJson(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Locks the organisation row for the rest of the caller's transaction, serialising this organisation's audit-chain writes without touching any other tenant. */
async function lockOrganisationForAuditChain(tx: Tx, organisationId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
}

async function nextChainLink(tx: Tx, organisationId: string): Promise<string | null> {
  const previous = await tx.auditEvent.findFirst({
    where: { organisationId },
    orderBy: { sequence: "desc" },
    select: { contentHash: true },
  });
  return previous?.contentHash ?? null;
}

/**
 * Records one audit event inside the caller's transaction. `ctx` supplies
 * the organisation the event belongs to; `input.correlationId`/`source` are
 * required explicitly rather than defaulted, so every call site states them.
 */
export async function recordAuditEvent(
  tx: Tx,
  ctx: TenantRepositoryContext,
  input: RecordAuditEventInput,
): Promise<{ id: string }> {
  const [{ id }] = await recordAuditEvents(tx, ctx, [input]);
  return { id };
}

/**
 * Records several audit events atomically, in the given order, chaining
 * each to the one before it — used when one operation touches several
 * things at once (e.g. an invite that creates a membership and assigns
 * roles) so the whole burst shares one lock acquisition.
 */
export async function recordAuditEvents(
  tx: Tx,
  ctx: TenantRepositoryContext,
  inputs: RecordAuditEventInput[],
): Promise<{ id: string }[]> {
  if (inputs.length === 0) return [];

  await lockOrganisationForAuditChain(tx, ctx.organisationId);
  let previousHash = await nextChainLink(tx, ctx.organisationId);

  const results: { id: string }[] = [];
  for (const input of inputs) {
    const occurredAt = new Date();
    const actorUserId = input.actorUserId;
    const actorType = input.actorType ?? "USER";
    const resourceId = input.resourceId ?? null;
    const before = input.before ?? null;
    const after = input.after ?? null;

    const contentHash = computeContentHash({
      organisationId: ctx.organisationId,
      actorUserId,
      actorType,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId,
      summary: input.summary,
      before,
      after,
      correlationId: input.correlationId,
      source: input.source,
      occurredAt: occurredAt.toISOString(),
    });

    const created = await tx.auditEvent.create({
      data: {
        organisationId: ctx.organisationId,
        actorUserId,
        actorType,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId,
        summary: input.summary,
        before: toJson(before),
        after: toJson(after),
        correlationId: input.correlationId,
        source: input.source,
        occurredAt,
        contentHash,
        previousEventHash: previousHash,
      },
      select: { id: true },
    });

    results.push(created);
    previousHash = contentHash;
  }

  return results;
}

export interface ListAuditEventsFilter {
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  take?: number;
}

/** Organisation-scoped read — a cross-tenant id in `resourceId`/`correlationId` simply matches nothing, never another organisation's rows. */
export async function listAuditEvents(ctx: TenantRepositoryContext, filter: ListAuditEventsFilter = {}) {
  return prisma.auditEvent.findMany({
    where: tenantWhere(ctx, {
      ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
      ...(filter.resourceId ? { resourceId: filter.resourceId } : {}),
      ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
    }),
    orderBy: { sequence: "desc" },
    take: filter.take ?? 200,
  });
}

/** Loads one audit event only if it belongs to the caller's organisation; denies a foreign-tenant id identically to a missing one. */
export async function getAuditEvent(ctx: TenantRepositoryContext, id: string) {
  const event = await prisma.auditEvent.findFirst({ where: { id } });
  return assertOwned(ctx, event);
}
