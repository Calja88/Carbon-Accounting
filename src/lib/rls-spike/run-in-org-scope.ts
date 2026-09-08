/**
 * T1B RLS defence-in-depth spike (Docs/T1B_RLS_SPIKE_FINDINGS.md).
 *
 * `SET LOCAL` cannot take a bind parameter, so the transaction-local
 * organisation context is set with `set_config(name, value, is_local)`
 * instead — that form is a normal SQL function call, so Prisma's tagged
 * template parameterises the value safely (no string interpolation into
 * SQL). `is_local = true` scopes it to the current transaction only, which
 * is what makes reused pooled connections safe: the setting is cleared the
 * moment the transaction ends, whether by commit or rollback.
 */

import type { PrismaClient } from "@prisma/client";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function runInOrganisationScope<T>(
  client: PrismaClient,
  organisationId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organisation_id', ${organisationId}, true)`;
    return fn(tx);
  });
}

/** Runs a transaction that never sets an organisation context, to exercise the "missing context denies access" case. */
export async function runWithoutOrganisationScope<T>(
  client: PrismaClient,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => fn(tx));
}
