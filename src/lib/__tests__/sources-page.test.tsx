/**
 * Phase 2A route check for /sources. Renders the real server component with
 * the service layer stubbed, so this asserts what the page does with what it
 * is given: honest empty states (never the "Section unavailable" error card),
 * a real error card when the catalogue genuinely fails to load, an enabled
 * source shown with its cadence, a disabled one shown as switched off rather
 * than omitted, and no management controls for a view-only member.
 *
 * Rendered with react-dom/server, matching the existing board component
 * tests — this repository has no React test-renderer dependency.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { OrganisationContext } from "@/lib/organisation/context";

class FakeRedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
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
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

// The server action pulls in NextAuth via the session module; the page only
// needs a function reference to hand to <form action={...}>.
vi.mock("@/app/(app)/sources/actions", () => ({ configureSourceAction: () => undefined }));

const listConfigurableSites = vi.fn();
const listSourceCatalogue = vi.fn();
const listSiteSourceConfigs = vi.fn();
const getFactorAvailability = vi.fn();
vi.mock("@/lib/carbon/source-config-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/carbon/source-config-service")>(
    "@/lib/carbon/source-config-service",
  );
  return {
    ...actual,
    listConfigurableSites: (...a: unknown[]) => listConfigurableSites(...a),
    listSourceCatalogue: (...a: unknown[]) => listSourceCatalogue(...a),
    listSiteSourceConfigs: (...a: unknown[]) => listSiteSourceConfigs(...a),
    getFactorAvailability: (...a: unknown[]) => getFactorAvailability(...a),
  };
});

const logEvent = vi.fn();
vi.mock("@/lib/observability/logger", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const SourcesPage = (await import("@/app/(app)/sources/page")).default;

const GAS = "adp-gas";
const catalogueSource = {
  id: GAS,
  code: "S1-01",
  scope: "SCOPE_1" as const,
  category: "Stationary combustion",
  dataPointName: "Natural gas — facilities",
  promptTemplate: "How much gas did this site use?",
  helpText: "Gas burned on site is a direct emission.",
  unitOptions: ["kWh"],
  catalogueFrequency: "Monthly",
  factorCategory: "natural_gas",
  scope3Category: null,
  sortOrder: 1,
};
const site = { id: SITE_A, name: "Aster North", entityId: "entity-aster", entityName: "Aster Manufacturing" };

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  requireOrganisationContext.mockResolvedValue(context(["carbon.view", "carbon.entry.review"]));
  listConfigurableSites.mockResolvedValue([site]);
  listSourceCatalogue.mockResolvedValue([catalogueSource]);
  listSiteSourceConfigs.mockResolvedValue([]);
  getFactorAvailability.mockResolvedValue(new Map());
  logEvent.mockClear();
});

describe("/sources", () => {
  it("renders the catalogue with its site and period controls", async () => {
    const html = await render();
    expect(html).toContain("Emission Sources");
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("S1-01");
    expect(html).toContain("Aster North");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a real setup state, not an error card, when no site is in scope", async () => {
    listConfigurableSites.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No sites available to you yet");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a real setup state, not an error card, when the catalogue is empty", async () => {
    listSourceCatalogue.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No emission source catalogue yet");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a real error card when the catalogue genuinely fails to load, and logs the real exception", async () => {
    listSourceCatalogue.mockRejectedValue(new Error('relation "OrganisationSourceConfig" does not exist'));
    const html = await render();
    expect(html).toContain("Section unavailable");
    expect(html).not.toContain("No emission source catalogue yet");

    // Without this the card is all anyone ever sees and the fault cannot be
    // diagnosed. The real message stays server-side; it is never rendered.
    expect(logEvent).toHaveBeenCalledTimes(1);
    const entry = logEvent.mock.calls[0][0];
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("sources catalogue load failed");
    expect(entry.organisationId).toBe(ORG_A);
    expect(entry.fields.errorMessage).toContain("OrganisationSourceConfig");
    expect(entry.fields.stack).toBeTruthy();
    expect(html).not.toContain("OrganisationSourceConfig");
  });

  it("does not log when the page renders normally", async () => {
    await render();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("shows an enabled source with its cadence, and a disabled one honestly", async () => {
    listSiteSourceConfigs.mockResolvedValue([
      { id: "c1", siteId: SITE_A, activityDataPointId: GAS, enabled: true, frequency: "QUARTERLY", effectiveFrom: new Date(), updatedAt: new Date() },
    ]);
    expect(await render()).toContain("Quarterly");

    listSiteSourceConfigs.mockResolvedValue([
      { id: "c1", siteId: SITE_A, activityDataPointId: GAS, enabled: false, frequency: "QUARTERLY", effectiveFrom: new Date(), updatedAt: new Date() },
    ]);
    const disabled = await render();
    expect(disabled).toContain("Switched off for Aster North");
    expect(disabled).toContain("Natural gas — facilities");
  });

  it("says a source is awaiting a factor rather than implying a zero", async () => {
    expect(await render()).toContain("Awaiting factor");

    getFactorAvailability.mockResolvedValue(new Map([["natural_gas", { available: true, kinds: ["OFFICIAL"] }]]));
    const available = await render();
    expect(available).toContain("Factor available");
    expect(available).toContain("Official factor");
  });

  it("hides every management control from a member without the manage permission", async () => {
    requireOrganisationContext.mockResolvedValue(context(["carbon.view"]));
    const html = await render();
    expect(html).toContain("Natural gas — facilities");
    expect(html).not.toContain("Report this source");
    expect(html).not.toContain("Stop reporting");
    expect(html).not.toContain('name="intent"');
  });

  it("sends a visitor with no organisation context to sign in", async () => {
    requireOrganisationContext.mockRejectedValue(new MockOrganisationAccessError("NOT_AUTHENTICATED"));
    await expect(render()).rejects.toThrow(FakeRedirectError);
  });
});
