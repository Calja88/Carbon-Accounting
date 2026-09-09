/**
 * Safe transaction wrapper for tenant repositories (Phase 1 spec §8, task
 * T15). Context is a mandatory, typed argument, so a transaction can never
 * be opened without a resolved tenant, and the same context is threaded
 * into every write the callback performs.
 *
 * The Prisma client is injected rather than imported here: it keeps this
 * module free of any database dependency (so it can be unit-tested with a
 * synthetic fake) and matches the repository-contract rule that domain
 * repositories, not this primitive, own the concrete Prisma wiring.
 */

import type { TenantRepositoryContext } from "./context";

export interface TenantTransactionRunner<TxClient> {
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
}

export async function runInTenantTransaction<TxClient, T>(
  ctx: TenantRepositoryContext,
  client: TenantTransactionRunner<TxClient>,
  fn: (tx: TxClient, ctx: TenantRepositoryContext) => Promise<T>,
): Promise<T> {
  return client.$transaction((tx) => fn(tx, ctx));
}
