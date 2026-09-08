/**
 * T83 load test: reminders/jobs throughput, resume-after-crash idempotency,
 * and dead-letter recovery at synthetic scale
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "outbox backlog/retry/dead-
 * letter/recovery"; acceptance: "jobs resume idempotently").
 *
 * Run: `DIRECT_URL=postgresql://... npx tsx scripts/load-test/outbox-throughput.ts`
 * Skips cleanly with no DB configured. Every row is synthetic and is deleted
 * at the end of the run, success or failure.
 */

import { requireLoadTestDb, reportSloLine, summarise } from "./lib/db-guard";
import type { JobHandler } from "@/lib/jobs/types";

const TENANT_COUNT = 5;
const JOBS_PER_TENANT = 400; // 2,000 synthetic jobs total
const TOPIC = "loadtest.synthetic_job";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  // Must run before any module that transitively imports `@/lib/prisma` is
  // loaded — that singleton reads `process.env.DATABASE_URL` at import
  // time, so the guard's DIRECT_URL->DATABASE_URL copy has to land first.
  requireLoadTestDb("outbox-throughput");
  const { PrismaClient } = await import("@prisma/client");
  const { enqueueTenantJob, requeueDeadLetterMessage } = await import("@/lib/jobs/outbox-service");
  const { runWorkerOnce } = await import("@/lib/jobs/worker");
  const { createTenantRepositoryContext } = await import("@/lib/repositories/context");
  const prisma = new PrismaClient();

  const orgIds = Array.from({ length: TENANT_COUNT }, (_, i) => `loadtest-org-${RUN_ID}-${i}`);

  try {
    console.log(`Seeding ${TENANT_COUNT} synthetic organisations and ${TENANT_COUNT * JOBS_PER_TENANT} outbox jobs...`);
    for (const orgId of orgIds) {
      await prisma.organisation.create({ data: { id: orgId, name: `Load test org ${orgId}`, slug: orgId } });
    }

    const enqueueStart = Date.now();
    for (const orgId of orgIds) {
      const ctx = createTenantRepositoryContext({ organisationId: orgId, userId: `loadtest-user-${orgId}`, correlationId: `loadtest-${orgId}` });
      for (let i = 0; i < JOBS_PER_TENANT; i++) {
        await prisma.$transaction((tx) =>
          enqueueTenantJob(tx, ctx, {
            topic: TOPIC,
            payload: { index: i },
            // idempotencyKey is unique per (topic, key) across the whole platform, not per tenant — see outbox-service.ts's findByIdempotencyKey — so it must include orgId here.
            idempotencyKey: `${orgId}-job-${i}`,
            correlationId: `loadtest-${orgId}-${i}`,
            source: "loadtest",
          }),
        );
      }
    }
    console.log(`Enqueue took ${Date.now() - enqueueStart}ms.`);

    // Every 10th job fails on its first attempt, forcing a RETRY -> eventual
    // success path, so throughput reflects realistic retry overhead, not
    // only the happy path.
    let attemptCount = 0;
    const handler: JobHandler = async (message) => {
      attemptCount += 1;
      const payload = message.payload as { index: number };
      if (payload.index % 10 === 0 && message.attempts === 1) {
        throw new Error("synthetic transient failure");
      }
    };

    const durations: number[] = [];
    let leased = 0;
    const processStart = Date.now();
    for (let round = 0; round < 50 && leased < TENANT_COUNT * JOBS_PER_TENANT * 1.5; round++) {
      const roundStart = Date.now();
      const summary = await runWorkerOnce({ handlers: [{ topic: TOPIC, handler }], workerId: `loadtest-worker`, batchSize: 100, retryAfterMs: 0 });
      durations.push(Date.now() - roundStart);
      leased += summary.leased;
      if (summary.leased === 0) break;
    }
    console.log(`Processing took ${Date.now() - processStart}ms across ${durations.length} worker rounds (${attemptCount} handler invocations).`);

    const remainingPending = await prisma.outboxMessage.count({ where: { topic: TOPIC, status: { in: ["PENDING", "RETRY", "LEASED"] } } });
    const completed = await prisma.outboxMessage.count({ where: { topic: TOPIC, status: "COMPLETED" } });
    console.log(`Completed: ${completed}, still pending/retry/leased: ${remainingPending} (expected 0 once retries drain).`);

    // Resume-after-crash: simulate a worker that leased a batch and crashed
    // before completing/failing any of it (lease left dangling), then prove
    // a fresh worker recovers those messages once the lease expires, with no
    // duplicate completion and no lost message.
    console.log("Simulating a crashed worker (dangling lease) and resume...");
    const crashCtx = createTenantRepositoryContext({ organisationId: orgIds[0], userId: "loadtest-crash", correlationId: "loadtest-crash" });
    const crashJobIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { id } = await prisma.$transaction((tx) =>
        enqueueTenantJob(tx, crashCtx, { topic: TOPIC, payload: { crash: true, i }, idempotencyKey: `crash-${i}`, correlationId: `crash-${i}`, source: "loadtest" }),
      );
      crashJobIds.push(id);
    }
    // Lease with a lease duration of 0 seconds so it is immediately stale, standing in for a crashed worker whose lease never gets renewed.
    await prisma.$queryRawUnsafe(
      `UPDATE "OutboxMessage" SET "status" = 'LEASED', "leaseOwner" = 'crashed-worker', "leaseUntil" = now() - interval '1 second', "attempts" = "attempts" + 1 WHERE "id" = ANY($1::text[])`,
      crashJobIds,
    );
    let resumeCompleted = 0;
    const resumeHandler: JobHandler = async () => {
      resumeCompleted += 1;
    };
    const resumeSummary = await runWorkerOnce({ handlers: [{ topic: TOPIC, handler: resumeHandler }], workerId: "loadtest-resumer", batchSize: 50 });
    const resumeOk = resumeSummary.leased === crashJobIds.length && resumeCompleted === crashJobIds.length;
    console.log(`${resumeOk ? "PASS" : "FAIL"}  resume-after-crash: leased=${resumeSummary.leased} completed=${resumeCompleted} expected=${crashJobIds.length}`);

    // Dead-letter recovery: force a message to DEAD_LETTER, then requeue it
    // and verify it processes exactly once more.
    console.log("Simulating dead-letter recovery...");
    const { id: deadLetterId } = await prisma.$transaction((tx) =>
      enqueueTenantJob(tx, crashCtx, { topic: TOPIC, payload: { poison: true }, idempotencyKey: "poison-1", correlationId: "poison-1", source: "loadtest", maxAttempts: 1 }),
    );
    const poisonHandler: JobHandler = async () => {
      throw new Error("always fails");
    };
    await runWorkerOnce({ handlers: [{ topic: TOPIC, handler: poisonHandler }], workerId: "loadtest-worker", batchSize: 10, retryAfterMs: 0 });
    const deadLettered = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: deadLetterId } });
    const requeued = await requeueDeadLetterMessage(crashCtx, deadLetterId);
    let recoveredOk = 0;
    const recoverHandler: JobHandler = async () => {
      recoveredOk += 1;
    };
    await runWorkerOnce({ handlers: [{ topic: TOPIC, handler: recoverHandler }], workerId: "loadtest-worker", batchSize: 10 });
    const deadLetterOk = deadLettered.status === "DEAD_LETTER" && requeued && recoveredOk === 1;
    console.log(`${deadLetterOk ? "PASS" : "FAIL"}  dead-letter recovery: dead-lettered=${deadLettered.status === "DEAD_LETTER"} requeued=${requeued} recovered=${recoveredOk === 1}`);

    const throughputSummary = summarise(durations);
    // SLO target from docs/operations/slo-sli.md: job batch processing p95 <= 2000ms per 100-message round on synthetic scale.
    const throughputPass = reportSloLine("outbox worker round (batchSize=100)", throughputSummary, 2000);

    const overallPass = remainingPending === 0 && resumeOk && deadLetterOk && throughputPass;
    console.log(overallPass ? "\nOverall: PASS" : "\nOverall: FAIL");
    if (!overallPass) process.exitCode = 1;
  } finally {
    console.log("Cleaning up synthetic data...");
    await prisma.jobRun.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.outboxMessage.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
