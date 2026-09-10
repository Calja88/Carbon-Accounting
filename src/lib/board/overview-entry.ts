/**
 * The one and only server entry point for `/` and `/attention` — resolves
 * the real request-bound OrganisationContext via next-auth and hands it to
 * loadOverviewForContext (live-overview.ts). Kept in its own module because
 * next-auth transitively imports `next/server`, which fails to resolve
 * under Vitest's node environment (the same documented exception as
 * live-nav.ts/live-overview.ts's own top comment) — pulling that import
 * into live-overview.ts itself would make every real-Postgres test that
 * exercises loadOverviewForContext directly fail to even load the module.
 */
import { requireOrganisationContext } from "@/lib/organisation/session";
import { loadOverviewForContext, type OverviewSearchParams } from "./live-overview";
import type { OverviewModel } from "./contracts";

export async function getBoardOverview(searchParams: OverviewSearchParams): Promise<OverviewModel> {
  const context = await requireOrganisationContext();
  return loadOverviewForContext(context, searchParams);
}

export { InvalidBoardScopeError } from "./live-overview";
export type { OverviewSearchParams as BoardOverviewSearchParams } from "./live-overview";
