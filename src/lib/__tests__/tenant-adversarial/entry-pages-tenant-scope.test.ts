/**
 * Phase 0 product reset, item 1: entry/page.tsx, entry/[siteId]/[code]/page.tsx
 * and entry/[siteId]/business-travel-import/page.tsx previously queried Prisma
 * directly by id with no tenant filter — a signed-in user from Organisation B
 * could view Organisation A's site list or open Organisation A's entry form
 * by guessing/reusing an id. These pages now follow the same
 * requireOrganisationContext + requireSiteInScope/tenantWhere pattern as the
 * already-correct entry/[siteId]/page.tsx and electricity-contract/page.tsx.
 * This proves the fix: a foreign-tenant site id 404s instead of rendering,
 * and the site-list query is always scoped to the caller's own organisation.
 * No live database; synthetic Aster/Birch fixtures only.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, SITE_A, orgContextA } from "@/lib/__tests__/tenant-fixtures";

// The business-travel-import page pulls in its client form, which pulls in
// its server action, which imports the real NextAuth config — pure
// dependency-graph noise for a page-level tenant-scoping test, and this
// pnpm-linked next-auth build doesn't resolve under Vitest's Node
// environment. Stub it out; no test here ever calls it.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

class FakeNotFoundError extends Error {}
class FakeRedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new FakeNotFoundError();
  },
  redirect: (url: string) => {
    throw new FakeRedirectError(url);
  },
}));

class MockOrganisationAccessError extends Error {
  constructor(readonly reason: string) {
    super(`Organisation context unavailable: ${reason}`);
  }
}

const requireOrganisationContext = vi.fn();
// Hand-rolled rather than vi.importActual: the real module pulls in
// next/headers + @/auth, which need a live request/NextAuth config this
// unit test has no business standing up.
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

const requireSiteInScope = vi.fn();
vi.mock("@/lib/repositories/carbon-repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/carbon-repository")>(
    "@/lib/repositories/carbon-repository",
  );
  return { ...actual, requireSiteInScope: (...args: unknown[]) => requireSiteInScope(...args) };
});

const entityFindMany = vi.fn(async (_args: { where: { organisationId: string } }) => [] as unknown[]);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: { findMany: (args: { where: { organisationId: string } }) => entityFindMany(args) },
  },
}));

const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const EntryFormPage = (await import("@/app/(app)/entry/[siteId]/[code]/page")).default;
const BusinessTravelImportPage = (await import("@/app/(app)/entry/[siteId]/business-travel-import/page")).default;
const EntrySiteListPage = (await import("@/app/(app)/entry/page")).default;

beforeEach(() => {
  requireOrganisationContext.mockReset();
  requireSiteInScope.mockReset();
  entityFindMany.mockClear();
});

describe("entry/[siteId]/[code]/page.tsx tenant scoping", () => {
  it("404s rather than render when the site belongs to a foreign organisation", async () => {
    requireOrganisationContext.mockResolvedValue({ ...orgContextA, organisationId: ORG_B });
    requireSiteInScope.mockRejectedValue(new TenantOwnershipError());

    await expect(EntryFormPage({ params: Promise.resolve({ siteId: SITE_A, code: "S1-01" }) })).rejects.toThrow(
      FakeNotFoundError,
    );
  });
});

describe("entry/[siteId]/business-travel-import/page.tsx tenant scoping", () => {
  it("404s rather than render when the site belongs to a foreign organisation", async () => {
    requireOrganisationContext.mockResolvedValue({ ...orgContextA, organisationId: ORG_B });
    requireSiteInScope.mockRejectedValue(new TenantOwnershipError());

    await expect(BusinessTravelImportPage({ params: Promise.resolve({ siteId: SITE_A }) })).rejects.toThrow(
      FakeNotFoundError,
    );
  });
});

describe("entry/page.tsx tenant scoping", () => {
  it("scopes the entity/site list query to the caller's own organisation", async () => {
    requireOrganisationContext.mockResolvedValue(orgContextA);

    await EntrySiteListPage();

    expect(entityFindMany).toHaveBeenCalledTimes(1);
    const { where } = entityFindMany.mock.calls[0][0];
    expect(where.organisationId).toBe(ORG_A);
  });

  it("redirects to /login when there is no organisation context", async () => {
    const { OrganisationAccessError } = await import("@/lib/organisation/session");
    requireOrganisationContext.mockRejectedValue(new OrganisationAccessError("NOT_AUTHENTICATED"));

    await expect(EntrySiteListPage()).rejects.toThrow(FakeRedirectError);
  });
});
