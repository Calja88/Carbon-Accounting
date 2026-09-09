import type { Prisma } from "@prisma/client";
import type { TenantRepositoryContext } from "./context";
import { TenantOwnershipError } from "./tenant-scope";

/** Transaction-scoped locks. Parameterized values; no interpolated identifiers. */
export async function lockActivityEntry(tx: Prisma.TransactionClient, ctx: TenantRepositoryContext, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ActivityEntry" WHERE "id" = ${id} AND "organisationId" = ${ctx.organisationId} FOR UPDATE`;
  if (rows.length !== 1) throw new TenantOwnershipError();
}
export async function lockNonconformity(tx: Prisma.TransactionClient, ctx: TenantRepositoryContext, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Nonconformity" WHERE "id" = ${id} AND "organisationId" = ${ctx.organisationId} FOR UPDATE`;
  if (rows.length !== 1) throw new TenantOwnershipError();
}
