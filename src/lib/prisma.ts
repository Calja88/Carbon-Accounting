import { PrismaClient } from "@prisma/client";

/**
 * Validate the optional pooled runtime URL without ever echoing it in an
 * error. Missing configuration remains lazy so `next build`, Prisma Client
 * generation, and unit tests can run without opening a database connection.
 */
export function assertValidDatabaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("invalid protocol");
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string. Check the configured value.");
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
