/**
 * T83 regression test: a crashed worker's stale `LEASED` message must
 * become claimable again by `leaseNextBatch` (task T21 acceptance,
 * `outbox-service.ts`'s own `leaseNextBatch` doc comment: "a crashed
 * worker's lease expires and the message becomes claimable again without
 * any recovery step"). `leaseNextBatch` uses raw SQL
 * (`FOR UPDATE SKIP LOCKED`), which the fake in-memory `prisma` used by
 * `outbox-service.test.ts` cannot exercise meaningfully — this runs against
 * a real, local, synthetic PostgreSQL instance, matching the convention in
 * `src/lib/retention/__tests__/immutability-trigger.integration.test.ts`.
 *
 * Found by `scripts/load-test/outbox-throughput.ts`'s resume-after-crash
 * scenario: before the T83 fix, `leaseNextBatch`'s candidate query only
 * matched `status IN ('PENDING', 'RETRY')`, so a message stuck `LEASED` by
 * a worker that crashed before calling `completeJob`/`failJob` was never
 * reclaimed, even once its `leaseUntil` had long passed.
 *
 * Skips (rather than fails) when DATABASE_URL/DIRECT_URL aren't configured.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDatabaseUrl } from "../../testing/local-database-url";

const DB_URL = localDatabaseUrl(); // hosted databases are skipped, never written to — see local-database-url.ts
const runIfConfigured = DB_URL ? describe : describe.skip;

runIfConfigured("T83 leaseNextBatch resume-after-crash", () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ORG_ID = `org-t83-resume-${runId}`;
  const TOPIC = "t83.resume-test";

  let client: PrismaClient;

  beforeAll(async () => {
    client = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await client.$connect();
    await client.organisation.create({ data: { id: ORG_ID, name: "Synthetic T83 resume org", slug: ORG_ID } });
  });

  afterAll(async () => {
    await client.outboxMessage.deleteMany({ where: { organisationId: ORG_ID } }).catch(() => undefined);
    await client.organisation.delete({ where: { id: ORG_ID } }).catch(() => undefined);
    await client.$disconnect();
  });

  it("reclaims a stale LEASED message left by a crashed worker", async () => {
    const { leaseNextBatch } = await import("@/lib/jobs/outbox-service");

    const message = await client.outboxMessage.create({
      data: {
        organisationId: ORG_ID,
        topic: TOPIC,
        payload: {},
        idempotencyKey: `resume-${runId}`,
        correlationId: `resume-${runId}`,
        source: "test",
      },
    });

    // Simulate a worker that leased the message and then crashed before
    // calling completeJob/failJob — status stays LEASED, leaseUntil is in
    // the past.
    await client.$executeRawUnsafe(
      `UPDATE "OutboxMessage" SET "status" = 'LEASED', "leaseOwner" = 'crashed-worker', "leaseUntil" = now() - interval '1 second' WHERE "id" = $1`,
      message.id,
    );

    const leased = await leaseNextBatch({ topics: [TOPIC], leaseOwner: "resumer", leaseDurationSeconds: 60, batchSize: 10 });

    expect(leased.map((m) => m.id)).toContain(message.id);
    const reclaimed = leased.find((m) => m.id === message.id)!;
    expect(reclaimed.leaseOwner).toBe("resumer");
    expect(reclaimed.status).toBe("LEASED");
  });

  it("does not reclaim a message whose lease has not yet expired", async () => {
    const { leaseNextBatch } = await import("@/lib/jobs/outbox-service");

    const message = await client.outboxMessage.create({
      data: {
        organisationId: ORG_ID,
        topic: TOPIC,
        payload: {},
        idempotencyKey: `active-lease-${runId}`,
        correlationId: `active-lease-${runId}`,
        source: "test",
      },
    });
    await client.$executeRawUnsafe(
      `UPDATE "OutboxMessage" SET "status" = 'LEASED', "leaseOwner" = 'still-alive-worker', "leaseUntil" = now() + interval '5 minutes' WHERE "id" = $1`,
      message.id,
    );

    const leased = await leaseNextBatch({ topics: [TOPIC], leaseOwner: "resumer", leaseDurationSeconds: 60, batchSize: 10 });

    expect(leased.map((m) => m.id)).not.toContain(message.id);
  });
});
