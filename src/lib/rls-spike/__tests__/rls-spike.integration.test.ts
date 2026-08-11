/**
 * T1B RLS defence-in-depth spike — live integration tests against a real,
 * local, synthetic PostgreSQL 16 instance (never Neon, never real
 * environmental/tenant data). Exercises every case in
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §9 "RLS spike tests" that this
 * minimal vertical slice can reach; see Docs/T1B_RLS_SPIKE_FINDINGS.md for
 * the one bullet ("background platform job") this slice does not cover and
 * why.
 *
 * Requires `scripts/rls-spike/setup-test-db.sh` to have been run first and
 * its two connection strings exported. Skips (rather than fails) when they
 * are absent, so `npm test` stays green in environments without a local
 * Postgres available.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRlsSpikeAppClient } from "@/lib/rls-spike/client";
import { runInOrganisationScope, runWithoutOrganisationScope } from "@/lib/rls-spike/run-in-org-scope";

const OWNER_URL = process.env.RLS_SPIKE_OWNER_DATABASE_URL;
const APP_URL = process.env.RLS_SPIKE_APP_DATABASE_URL;

const runIfConfigured = OWNER_URL && APP_URL ? describe : describe.skip;

function withConnectionLimit(url: string, limit: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", String(limit));
  return parsed.toString();
}

runIfConfigured("T1B RLS spike: RlsSpikeRecord policy", () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ORG_ALPHA = `org-alpha-${runId}`;
  const ORG_BETA = `org-beta-${runId}`;

  let ownerClient: PrismaClient;
  let appClient: PrismaClient;

  beforeAll(async () => {
    ownerClient = new PrismaClient({ datasources: { db: { url: OWNER_URL! } } });
    appClient = createRlsSpikeAppClient(APP_URL!);
    await ownerClient.$connect();
    await appClient.$connect();
  });

  afterAll(async () => {
    // Owner role is the table owner, so it bypasses RLS by default — used
    // here purely for synthetic-fixture cleanup, never for scoped access.
    await ownerClient.rlsSpikeRecord.deleteMany({ where: { organisationId: { in: [ORG_ALPHA, ORG_BETA] } } });
    await ownerClient.$disconnect();
    await appClient.$disconnect();
  });

  it("denies both reads and writes when app.organisation_id is missing", async () => {
    const rows = await runWithoutOrganisationScope(appClient, (tx) => tx.rlsSpikeRecord.findMany());
    expect(rows).toHaveLength(0);

    await expect(
      runWithoutOrganisationScope(appClient, (tx) =>
        tx.rlsSpikeRecord.create({ data: { organisationId: ORG_ALPHA, note: "no-context-insert" } }),
      ),
    ).rejects.toThrow();
  });

  it("a transaction scoped to one organisation sees only that organisation's rows", async () => {
    await runInOrganisationScope(appClient, ORG_ALPHA, (tx) =>
      tx.rlsSpikeRecord.create({ data: { organisationId: ORG_ALPHA, note: "alpha-1" } }),
    );
    await runInOrganisationScope(appClient, ORG_BETA, (tx) =>
      tx.rlsSpikeRecord.create({ data: { organisationId: ORG_BETA, note: "beta-1" } }),
    );

    const alphaRows = await runInOrganisationScope(appClient, ORG_ALPHA, (tx) => tx.rlsSpikeRecord.findMany());
    expect(alphaRows.map((r) => r.organisationId)).toEqual([ORG_ALPHA]);

    const betaRows = await runInOrganisationScope(appClient, ORG_BETA, (tx) => tx.rlsSpikeRecord.findMany());
    expect(betaRows.map((r) => r.organisationId)).toEqual([ORG_BETA]);
  });

  it("cannot write a row into a different organisation than the transaction's context", async () => {
    await expect(
      runInOrganisationScope(appClient, ORG_ALPHA, (tx) =>
        tx.rlsSpikeRecord.create({ data: { organisationId: ORG_BETA, note: "cross-tenant-insert" } }),
      ),
    ).rejects.toThrow();
  });

  it("reusing one pooled physical connection across transactions cannot leak organisation context", async () => {
    // connection_limit=1 forces every transaction on this client through
    // the same single physical backend connection — the same hazard a
    // Neon/PgBouncer transaction-mode pool creates by design.
    const pooledClient = createRlsSpikeAppClient(withConnectionLimit(APP_URL!, 1));
    try {
      await runInOrganisationScope(pooledClient, ORG_ALPHA, (tx) =>
        tx.rlsSpikeRecord.create({ data: { organisationId: ORG_ALPHA, note: "pooled-alpha" } }),
      );

      // Next transaction on the same reused connection, scoped to a
      // different organisation: must see only its own organisation.
      const betaView = await runInOrganisationScope(pooledClient, ORG_BETA, (tx) => tx.rlsSpikeRecord.findMany());
      expect(betaView.every((r) => r.organisationId === ORG_BETA)).toBe(true);
      expect(betaView.some((r) => r.organisationId === ORG_ALPHA)).toBe(false);

      // A further transaction on the same connection with no context set
      // at all must not inherit either prior transaction's setting.
      const noContextView = await runWithoutOrganisationScope(pooledClient, (tx) => tx.rlsSpikeRecord.findMany());
      expect(noContextView).toHaveLength(0);
    } finally {
      await pooledClient.$disconnect();
    }
  });

  it("a rolled-back transaction leaves no row behind and leaks no context to the next transaction", async () => {
    const doomedNote = `rollback-${runId}`;

    await expect(
      runInOrganisationScope(appClient, ORG_ALPHA, async (tx) => {
        await tx.rlsSpikeRecord.create({ data: { organisationId: ORG_ALPHA, note: doomedNote } });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    // Verified via the owner connection (bypasses RLS) so this checks the
    // row truly never persisted, not just that the app role can't see it.
    const persisted = await ownerClient.rlsSpikeRecord.findFirst({ where: { note: doomedNote } });
    expect(persisted).toBeNull();

    const noContextView = await runWithoutOrganisationScope(appClient, (tx) => tx.rlsSpikeRecord.findMany());
    expect(noContextView).toHaveLength(0);
  });

  it("the runtime application role cannot disable row level security on the table", async () => {
    // Postgres rejects this as SQLSTATE 42501 ("must be owner of table ..."):
    // ALTER TABLE ... DISABLE ROW LEVEL SECURITY requires ownership, and the
    // runtime role deliberately isn't the owner (see the next test).
    await expect(appClient.$executeRawUnsafe(`ALTER TABLE "RlsSpikeRecord" DISABLE ROW LEVEL SECURITY`)).rejects.toThrow(
      /must be owner of table/i,
    );
  });

  it("the table is owned by the migration owner role, not the runtime role", async () => {
    const [row] = await ownerClient.$queryRaw<{ tableowner: string }[]>`
      SELECT tableowner FROM pg_tables WHERE tablename = 'RlsSpikeRecord'
    `;
    expect(row.tableowner).toBe("rls_spike_owner");
    expect(row.tableowner).not.toBe("rls_spike_app");

    // Demonstrates *why* the owner role must never be used at runtime: as
    // table owner it bypasses RLS entirely, even with no context set.
    const ownerView = await ownerClient.rlsSpikeRecord.findMany({
      where: { organisationId: { in: [ORG_ALPHA, ORG_BETA] } },
    });
    const seenOrgs = new Set(ownerView.map((r) => r.organisationId));
    expect(seenOrgs.has(ORG_ALPHA) || seenOrgs.has(ORG_BETA)).toBe(true);
  });
});
