/**
 * Tenant repository context — the mandatory first argument for every
 * customer-data repository call (Phase 1 spec §8, task T15).
 *
 * This is deliberately narrower than the request-level `OrganisationContext`
 * (T13, not yet implemented): a repository only needs to know which
 * organisation it is scoped to, who is asking, and a correlation id for
 * audit/log tracing. Callers are responsible for deriving `organisationId`
 * from a validated membership before constructing this context — it must
 * never be built from a value read directly off the request/browser.
 */

export interface TenantRepositoryContext {
  readonly organisationId: string;
  readonly userId: string;
  readonly correlationId: string;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export function createTenantRepositoryContext(input: {
  organisationId: string;
  userId: string;
  correlationId: string;
}): TenantRepositoryContext {
  if (!input.organisationId) {
    throw new TenantContextError("TenantRepositoryContext requires organisationId.");
  }
  if (!input.userId) {
    throw new TenantContextError("TenantRepositoryContext requires userId.");
  }
  if (!input.correlationId) {
    throw new TenantContextError("TenantRepositoryContext requires correlationId.");
  }
  return Object.freeze({
    organisationId: input.organisationId,
    userId: input.userId,
    correlationId: input.correlationId,
  });
}
