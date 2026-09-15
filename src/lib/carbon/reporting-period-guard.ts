import type { Prisma } from "@prisma/client";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export class ReportingPeriodClosedError extends Error {
  readonly code = "REPORTING_PERIOD_CLOSED";

  constructor() {
    super("This reporting period is closed. Reopen the period before changing accounting data.");
    this.name = "ReportingPeriodClosedError";
  }
}

/** Recognises both the domain error and PostgreSQL/Prisma trigger errors. */
export function isReportingPeriodClosedError(error: unknown): boolean {
  return error instanceof ReportingPeriodClosedError ||
    (error instanceof Error && error.message.includes("REPORTING_PERIOD_CLOSED"));
}

/**
 * Call inside the SAME transaction as the write. SQL owns the rule; row
 * triggers call the identical function for direct/bulk/secondary writes.
 * Ordinary entries belong to their periodStart month, even when they span
 * months. Only effective-date inputs (energy contracts) supply a range end.
 */
export async function assertPeriodAllowsMutation(
  tx: Prisma.TransactionClient,
  ctx: TenantRepositoryContext,
  siteId: string,
  accountingDate: Date,
  effectiveThrough: Date = accountingDate,
): Promise<void> {
  try {
    await tx.$queryRaw`SELECT carbon_assert_period_allows_mutation(
      ${ctx.organisationId}::text, ${siteId}::text,
      ${accountingDate}::timestamp, ${effectiveThrough}::timestamp
    )::text`;
  } catch (error) {
    if (isReportingPeriodClosedError(error)) throw new ReportingPeriodClosedError();
    throw error;
  }
}
