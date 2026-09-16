/**
 * Phase 4-iii close/reopen surface. Rendered with react-dom/server, matching
 * the existing route tests — this repository has no React test-renderer.
 *
 * What is asserted here is what a demo audience actually sees: which state
 * the month is in, that a closed month reads as read-only rather than
 * broken, that the confirmation says what closing does before it happens,
 * that the reason travels with the request, and that a member without the
 * approval grant gets the status without the controls.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportingPeriodPanel } from "@/app/(app)/data/reporting-period-panel";
import type { ReportingPeriodView } from "@/lib/carbon/reporting-period-view";

const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));
const SCOPE = { from: "2026-09", to: "2026-09", siteId: "site-a" };

function view(patch: Partial<ReportingPeriodView> = {}): ReportingPeriodView {
  return {
    siteId: "site-a",
    monthStart: SEPTEMBER,
    monthLabel: "September 2026",
    monthInput: "2026-09",
    state: "OPEN",
    canTransition: true,
    current: null,
    history: [],
    ...patch,
  };
}

const CLOSED = view({
  state: "CLOSED",
  current: {
    state: "CLOSED",
    at: new Date("2026-09-15T14:22:00.000Z"),
    actorName: "Dana Okafor",
    reason: "Month-end close",
  },
  history: [
    {
      state: "CLOSED",
      at: new Date("2026-09-15T14:22:00.000Z"),
      actorName: "Dana Okafor",
      reason: "Month-end close",
    },
  ],
});

function render(props: Partial<Parameters<typeof ReportingPeriodPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ReportingPeriodPanel
      view={view()}
      siteLabel="Aster Manufacturing — Aster North"
      scope={SCOPE}
      action={() => undefined}
      done={null}
      {...props}
    />,
  );
}

describe("reporting period panel", () => {
  it("shows an open month, the site it belongs to, and the close action", () => {
    const html = render();
    expect(html).toContain("Reporting period");
    expect(html).toContain("September 2026");
    expect(html).toContain("Aster Manufacturing — Aster North");
    expect(html).toContain(">Open<");
    expect(html).toContain("can still be changed");
    expect(html).toContain("Close period");
    expect(html).not.toContain("Reopen period");
  });

  it("shows a closed month as read-only, not as a failure, with who closed it and why", () => {
    const html = render({ view: CLOSED });
    expect(html).toContain(">Closed<");
    expect(html).toContain("cannot be changed while the period is closed");
    expect(html).toContain("Reports, stored figures, evidence and methodology stay readable");
    expect(html).toContain("Dana Okafor");
    expect(html).toMatch(/15 Sept? 2026, 14:22 UTC/);
    expect(html).toContain("Month-end close");
    expect(html).toContain("Reopen period");
    expect(html).not.toContain("Something went wrong");
  });

  it("warns what closing does, and carries the site, month, target state and reason", () => {
    const html = render();
    expect(html).toContain("Close September 2026 for Aster Manufacturing — Aster North?");
    expect(html).toContain("prevents activity data and accounting calculations");
    expect(html).toContain("until the period is reopened");
    expect(html).toContain('name="siteId" value="site-a"');
    expect(html).toContain('name="periodMonth" value="2026-09"');
    expect(html).toContain('name="state" value="CLOSED"');
    expect(html).toContain('name="reason"');
    expect(html).toContain("Cancel");
  });
  // Tailwind preflight zeroes `margin` on every element, which beats the UA
  // stylesheet's `dialog:modal { margin: auto }` — without `m-auto` the modal
  // renders clipped into the top-left corner of the viewport.
  it("keeps the class that centres the modal over the page", () => {
    expect(render()).toContain("m-auto");
  });

  it("warns what reopening does and asks for its own reason", () => {
    const html = render({ view: CLOSED });
    expect(html).toContain("Reopen September 2026 for Aster Manufacturing — Aster North?");
    expect(html).toContain("allows activity data and accounting calculations");
    expect(html).toContain("stay in the audit record");
    expect(html).toContain('name="state" value="OPEN"');
    expect(html).toContain("<textarea");
  });

  it("gives a member without the approval grant the status and no transition control", () => {
    const html = render({ view: view({ canTransition: false }) });
    expect(html).toContain(">Open<");
    expect(html).toContain("not change it");
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("Close period");
  });

  it("confirms a close and a reopening in plain language once each has happened", () => {
    expect(render({ view: CLOSED, done: "CLOSED" })).toContain("is now closed for");
    expect(render({ done: "OPEN" })).toContain("is open again for");
  });

  it("shows the close and reopen history it was given", () => {
    const html = render({
      view: view({
        history: [
          { state: "OPEN", at: new Date("2026-09-16T09:10:00.000Z"), actorName: "Priya Shah", reason: "Corrected supplier invoice" },
          { state: "CLOSED", at: new Date("2026-09-15T14:22:00.000Z"), actorName: "Dana Okafor", reason: "Month-end close" },
        ],
      }),
    });
    expect(html).toContain("Close and reopen history (2)");
    expect(html).toContain("Reopened");
    expect(html).toContain("Corrected supplier invoice");
    expect(html).toContain("Priya Shah");
  });

  it("lets a different month be reviewed without disturbing the collection filters", () => {
    const html = render({ scope: { ...SCOPE, from: "2026-01", to: "2026-09", scope: "SCOPE_1", status: "missing" } });
    expect(html).toContain("Month to review");
    expect(html).toContain('type="month"');
    expect(html).toContain('name="from" value="2026-01"');
    expect(html).toContain('name="scope" value="SCOPE_1"');
    expect(html).toContain('name="status" value="missing"');
  });
});
