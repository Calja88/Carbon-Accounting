import { PrismaClient } from "@prisma/client";

/**
 * Validates DATABASE_URL when it is set, without ever including the raw
 * value in a thrown message (it may contain a password). A missing value is
 * left to PrismaClient's own lazy handling — unset in a build/test context
 * that never issues a query is not itself an error, and validating it here
 * would break that.
 */
export function assertValidDatabaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string. Check the configured value and try again.");
  }
  return url;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const databaseUrl = assertValidDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
