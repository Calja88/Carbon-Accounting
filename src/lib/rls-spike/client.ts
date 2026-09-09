/**
 * T1B RLS defence-in-depth spike (Docs/T1B_RLS_SPIKE_FINDINGS.md).
 *
 * Deliberately separate from src/lib/prisma.ts: that singleton is the real
 * runtime client and must never be pointed at spike credentials. This
 * module only ever talks to RlsSpikeRecord, a table with no relation to the
 * real schema.
 *
 * `RLS_SPIKE_APP_DATABASE_URL` is the non-owner, non-superuser runtime role
 * (mirrors Neon's pooled DATABASE_URL). It is intentionally the only role
 * this module can construct a client for — there is no owner-role export
 * here, so spike application code can't accidentally run as the role that
 * bypasses RLS.
 */

import { PrismaClient } from "@prisma/client";

export function createRlsSpikeAppClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
