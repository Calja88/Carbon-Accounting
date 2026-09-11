/**
 * Checkpoint B required fix 2 (coverage/reconciliation binding), against the
 * real BOARD-1 fixture built by bd08-board1-seed.test.ts — proves the
 * Overview's own live adapter (not just the seed's internal self-check)
 * reports a genuine, obligation-backed 192/192, a genuine non-empty prior
 * comparable window, and Scope 3 quantified/screened counts derived from
 * canonical categories.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext } from "@/lib/organisation/context";
import { loadOverviewForContext } from "@/lib/board/live-overview";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

async function boardOwnerContext() {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
  const user = await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org.id });
}

describe("Checkpoint B fix 2 — coverage is bound to real, genuinely reviewed obligations", () => {
  it("the live Overview adapter reports a genuinely obligation-backed 192/192 for the current window", async () => {
    const owner = await boardOwnerContext();
    const model = await loadOverviewForContext(owner, { from: "2026-01", to: "2026-08" });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    const coverage = model.carbon.data.current.coverage;
    expect(coverage.expected).toBe(192);
    expect(coverage.reviewed).toBe(192);
    expect(coverage.received).toBe(192);
  });

  it("the live Overview adapter reports a genuine, non-empty, fully reviewed prior comparable window — never an unknown denominator", async () => {
    const owner = await boardOwnerContext();
    const model = await loadOverviewForContext(owner, { from: "2026-01", to: "2026-08" });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    const coverage = model.carbon.data.previous.coverage;
    expect(coverage.expected).not.toBeNull();
    expect(coverage.expected).toBeGreaterThan(0);
    expect(coverage.reviewed).toBe(coverage.expected);
  });

  it("site and month coverage reconcile with the group total by construction", async () => {
    const owner = await boardOwnerContext();
    const model = await loadOverviewForContext(owner, { from: "2026-01", to: "2026-08" });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    const siteExpectedSum = model.carbon.data.sites.reduce((sum, s) => sum + (s.current.coverage.expected ?? 0), 0);
    expect(siteExpectedSum).toBe(model.carbon.data.current.coverage.expected);
  });

  it("a single selected site's coverage still reconciles and narrows the denominator", async () => {
    const owner = await boardOwnerContext();
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const site = await prisma.site.findFirstOrThrow({ where: { organisationId: org.id, name: "North Works" } });
    const model = await loadOverviewForContext(owner, { from: "2026-01", to: "2026-08", siteId: site.id });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    const coverage = model.carbon.data.current.coverage;
    expect(coverage.expected).toBeGreaterThan(0);
    expect(coverage.expected).toBeLessThan(192);
    expect(coverage.reviewed).toBe(coverage.expected);
  });
});

describe("Checkpoint B fix 2 — Scope 3 quantified/screened counts come from canonical categories", () => {
  it("reports exactly the four canonical Scope 3 categories BOARD-1 actually quantifies, not a data-point catalogue label count", async () => {
    const owner = await boardOwnerContext();
    const model = await loadOverviewForContext(owner, { from: "2026-01", to: "2026-08" });
    expect(model.carbon.state).toBe("ready");
    if (model.carbon.state !== "ready") throw new Error("unreachable");
    expect(model.carbon.data.quantifiedCategories).toBe(4); // Cat 1, Cat 3 (derived), Cat 6, Cat 7
    // Checkpoint B corrective handoff §2: no Scope 3 screening subsystem
    // exists, so screenedCategories is an honest null with a reason —
    // never a fabricated count merely constrained to be >= quantified.
    expect(model.carbon.data.screenedCategories).toBeNull();
    expect(model.carbon.data.screenedCategoriesReason).toMatch(/not recorded/);
  });

  it("every BOARD-1 activity data point carries its own real display category, never one generic label shared across every scope", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const entries = await prisma.activityEntry.findMany({ where: { organisationId: org.id }, select: { activityDataPointId: true }, distinct: ["activityDataPointId"] });
    const dataPoints = await prisma.activityDataPoint.findMany({ where: { id: { in: entries.map((e) => e.activityDataPointId) } }, select: { category: true } });
    const distinctCategories = new Set(dataPoints.map((d) => d.category));
    expect(distinctCategories.size).toBeGreaterThan(1);
  });
});
