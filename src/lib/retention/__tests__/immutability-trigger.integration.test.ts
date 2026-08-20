/**
 * T81 live integration test: verifies the database itself — not just the
 * application layer — refuses to mutate `AuditEvent` (T20, pre-existing)
 * and `LegalHold` (T81) rows outside the one allowed transition. This is
 * the "runtime role cannot mutate audit events/issued records" adversarial
 * check (Docs/PHASE8_HARDENING_READINESS_SPEC.md §11), run against a real,
 * local, synthetic PostgreSQL instance — never Neon, never real data.
 *
 * Skips (rather than fails) when DATABASE_URL/DIRECT_URL aren't configured,
 * matching the T1B RLS-spike integration test's convention, so `npm test`
 * stays green without a local Postgres available.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const runIfConfigured = DB_URL ? describe : describe.skip;

runIfConfigured("T81 append-only/immutability triggers", () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ORG_ID = `org-t81-trigger-${runId}`;
  const USER_ID = `user-t81-trigger-${runId}`;

  let client: PrismaClient;

  beforeAll(async () => {
    client = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await client.$connect();
    await client.organisation.create({ data: { id: ORG_ID, name: "Synthetic T81 trigger org", slug: ORG_ID } });
    await client.user.create({
      data: { id: USER_ID, name: "Synthetic user", email: `${runId}@example.invalid`, passwordHash: "x", role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await client.legalHold.deleteMany({ where: { organisationId: ORG_ID } }).catch(() => undefined);
    await client.auditEvent.deleteMany({ where: { organisationId: ORG_ID } }).catch(() => undefined);
    await client.user.delete({ where: { id: USER_ID } }).catch(() => undefined);
    await client.organisation.delete({ where: { id: ORG_ID } }).catch(() => undefined);
    await client.$disconnect();
  });

  it("rejects UPDATE and DELETE on AuditEvent even from a client with no application-layer guard", async () => {
    const event = await client.auditEvent.create({
      data: {
        organisationId: ORG_ID,
        actorUserId: USER_ID,
        eventType: "organisation.created",
        resourceType: "organisation",
        resourceId: ORG_ID,
        summary: "Synthetic event for trigger test.",
        correlationId: "corr-1",
        source: "test",
        contentHash: "deadbeef",
        previousEventHash: null,
      },
    });

    await expect(
      client.$executeRawUnsafe(`UPDATE "AuditEvent" SET "summary" = 'tampered' WHERE "id" = $1`, event.id),
    ).rejects.toThrow(/append-only/);

    await expect(client.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "id" = $1`, event.id)).rejects.toThrow(/append-only/);
  });

  it("allows only the release transition on LegalHold and rejects every other mutation", async () => {
    const hold = await client.legalHold.create({
      data: { organisationId: ORG_ID, reason: "Synthetic litigation hold", createdByUserId: USER_ID },
    });

    // The one allowed transition: ACTIVE -> RELEASED with release metadata.
    const released = await client.legalHold.update({
      where: { id: hold.id },
      data: { status: "RELEASED", releasedByUserId: USER_ID, releasedAt: new Date(), releaseReason: "Matter closed" },
    });
    expect(released.status).toBe("RELEASED");

    // Releasing an already-released hold is rejected.
    await expect(
      client.legalHold.update({ where: { id: hold.id }, data: { status: "RELEASED" } }),
    ).rejects.toThrow(/already released/);

    // Rewriting the reason/scope, even alongside a legitimate-looking release, is rejected.
    const secondHold = await client.legalHold.create({
      data: { organisationId: ORG_ID, reason: "Original reason", createdByUserId: USER_ID },
    });
    await expect(
      client.legalHold.update({ where: { id: secondHold.id }, data: { reason: "Rewritten reason" } }),
    ).rejects.toThrow(/immutable except for release/);

    // Deletion is rejected outright, released or not.
    await expect(client.legalHold.delete({ where: { id: released.id } })).rejects.toThrow(/cannot be deleted/);
  });
});
