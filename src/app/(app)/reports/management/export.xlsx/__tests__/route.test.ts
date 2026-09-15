/**
 * Phase 5B — the export route.
 *
 * The workbook's contents are proved in management-report-export.test.ts.
 * What is proved here is the route's own job: that the reader's selection
 * reaches the one authoritative loader unchanged, that the server — not the
 * button — decides who may export, and that every failure leaves the caller
 * with a sentence rather than a stack trace.
 *
 * Prisma is never reached: `loadManagementReport` is replaced, exactly as the
 * other service-level tests replace their data access.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { buildManagementReport } from "@/lib/carbon/management-report";
import { input } from "@/lib/carbon/__tests__/management-report-fixture";

// The session module reaches next-auth, which will not load under the node
// test environment, so it is replaced outright rather than partially — the
// error class included, so the route's `instanceof` checks still hold.
const { requireOrganisationContext, loadManagementReport, logEvent, OrganisationAccessError } = vi.hoisted(() => {
  class OrganisationAccessError extends Error {
    constructor(message = "No session.") {
      super(message);
      this.name = "OrganisationAccessError";
    }
  }
  return {
    requireOrganisationContext: vi.fn(),
    loadManagementReport: vi.fn(),
    logEvent: vi.fn(),
    OrganisationAccessError,
  };
});

vi.mock("@/lib/organisation/session", () => ({ requireOrganisationContext, OrganisationAccessError }));
vi.mock("@/lib/carbon/live-management-report", () => ({ loadManagementReport }));
vi.mock("@/lib/observability/logger", () => ({ logEvent }));

const { GET } = await import("../route");

/** A context carrying only the permissions a test names. */
function contextWith(permissions: string[]) {
  return {
    organisationId: "org-synthetic",
    organisationSlug: "synthetic",
    correlationId: "corr-1",
    permissions: new Set(permissions),
    access: { mode: "ORGANISATION_WIDE" as const },
  };
}

const FULL_ACCESS = contextWith(["carbon.view", "carbon.report.export"]);

function request(query = "from=2026-01&to=2026-02"): NextRequest {
  return new NextRequest(`https://carbon.test/reports/management/export.xlsx?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganisationContext.mockResolvedValue(FULL_ACCESS);
  loadManagementReport.mockResolvedValue(buildManagementReport(input()));
});

describe("the export route produces the file", () => {
  it("returns a real xlsx workbook", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map((ws) => ws.name)).toContain("Summary");
  });

  it("offers it as a download under a name that states the period", async () => {
    const response = await GET(request());
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="carbon-management-report-2026-01-to-2026-02.xlsx"',
    );
  });

  it("does not let a management position be cached", async () => {
    expect((await GET(request())).headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("the export is the report the reader is looking at", () => {
  it("passes the selected reporting period to the one authoritative loader", async () => {
    await GET(request("from=2026-03&to=2026-08"));
    expect(loadManagementReport).toHaveBeenCalledWith(FULL_ACCESS, { from: "2026-03", to: "2026-08", siteId: undefined });
  });

  it("passes the selected site filter through unchanged", async () => {
    await GET(request("from=2026-01&to=2026-02&siteId=alpha"));
    expect(loadManagementReport).toHaveBeenCalledWith(FULL_ACCESS, { from: "2026-01", to: "2026-02", siteId: "alpha" });
  });

  it("builds nothing of its own — the workbook comes from the loader's report", async () => {
    const filtered = buildManagementReport(input({ siteFilterName: "Alpha Works", selectedSiteId: "alpha" }));
    loadManagementReport.mockResolvedValue(filtered);
    const response = await GET(request("from=2026-01&to=2026-02&siteId=alpha"));
    expect(response.headers.get("Content-Disposition")).toContain("carbon-management-report-alpha-works-2026-01-to-2026-02.xlsx");
  });
});

describe("the server decides who may export", () => {
  it("refuses a reader who may see the report but not export it", async () => {
    requireOrganisationContext.mockResolvedValue(contextWith(["carbon.view"]));
    const response = await GET(request());
    expect(response.status).toBe(404);
    // Refused before any work is done, not after building a file.
    expect(loadManagementReport).not.toHaveBeenCalled();
  });

  it("refuses a reader with no carbon access at all", async () => {
    requireOrganisationContext.mockResolvedValue(contextWith([]));
    expect((await GET(request())).status).toBe(404);
    expect(loadManagementReport).not.toHaveBeenCalled();
  });

  it("asks an unauthenticated caller to sign in", async () => {
    requireOrganisationContext.mockRejectedValue(new OrganisationAccessError("No session."));
    expect((await GET(request())).status).toBe(401);
  });

  it("still refuses when the loader itself denies permission", async () => {
    loadManagementReport.mockRejectedValue(new PermissionDeniedError("MISSING_PERMISSION"));
    expect((await GET(request())).status).toBe(404);
  });

  it("refuses a site outside the reader's scope rather than widening the export", async () => {
    loadManagementReport.mockRejectedValue(new TenantOwnershipError());
    const response = await GET(request("from=2026-01&to=2026-02&siteId=someone-elses-site"));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("That site is not available in this report.");
  });
});

describe("failure is handled cleanly", () => {
  it("returns a useful sentence and leaks no internals when the report cannot be built", async () => {
    loadManagementReport.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe("This report could not be exported. Try again, and report it if it persists.");
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("Error");
  });

  it("logs the real fault server-side, where it is fixable", async () => {
    loadManagementReport.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    await GET(request());
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: "management report export failed",
        organisationId: "org-synthetic",
        fields: expect.objectContaining({ errorMessage: "connect ECONNREFUSED 10.0.0.1:5432" }),
      }),
    );
  });

  it("does not log a refusal as a fault", async () => {
    loadManagementReport.mockRejectedValue(new PermissionDeniedError("MISSING_PERMISSION"));
    await GET(request());
    expect(logEvent).not.toHaveBeenCalled();
  });
});
