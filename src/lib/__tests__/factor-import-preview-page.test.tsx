/**
 * Phase 3-ii route check for /admin/factors/import. Renders the real server
 * component and the real preview component with the action layer stubbed, so
 * this asserts what the page shows: the preview-only notice, upload controls
 * only for a holder of the factor-manage grant, honest counts and row groups,
 * and a commit control that is disabled in the markup rather than by styling.
 *
 * Rendered with react-dom/server, matching the existing board component tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { OrganisationContext } from "@/lib/organisation/context";
import type { FactorImportPreviewState } from "@/app/(app)/admin/factors/import/actions";

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

class MockOrganisationAccessError extends Error {}
const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

const listFactorSets = vi.fn();
vi.mock("@/lib/factor-sets-service", () => ({
  listFactorSets: (...a: unknown[]) => listFactorSets(...a),
  commitFactorImport: () => { throw new Error("Commit is forbidden in Phase 3-ii"); },
}));

// The server action pulls in NextAuth via the session module; the component
// only needs a function reference to hand to <form action={...}>.
const previewFactorImportAction = vi.fn();
vi.mock("@/app/(app)/admin/factors/import/actions", () => ({
  previewFactorImportAction,
  emptyPreviewState: { error: null, preview: null },
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// useActionState drives the component's whole output; substituting its result
// is what lets a populated preview be rendered without a live server action.
let actionState: FactorImportPreviewState = { error: null, preview: null };
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: () => [actionState, previewFactorImportAction, false] };
});

const ImportPage = (await import("@/app/(app)/admin/factors/import/page")).default;
const { ImportPreview } = await import("@/app/(app)/admin/factors/import/import-preview");

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

function row(patch: Record<string, unknown> = {}) {
  return {
    sheet: "Fuels", rowNumber: 42, categoryPath: "Fuels / Gaseous", activity: "Natural gas",
    rawUnit: "kWh", canonicalUnit: "kilowatt hour", factorValue: "0.125", factorUnit: "kgCO2e/kWh",
    gas: "co2e", kind: "direct", identity: "abcdef012345", messages: [],
    ...patch,
  };
}

const populated: FactorImportPreviewState = {
  error: null,
  preview: {
    sourceFileName: "synthetic-factors.csv",
    metadata: { publisher: "DEFRA/DESNZ", year: 2026, release: "v1.1" },
    proposedName: "DEFRA/DESNZ 2026 v1.1",
    sheets: [
      { name: "Fuels", supported: true, rowsScanned: 12 },
      { name: "Cover sheet", supported: false, rowsScanned: 4 },
    ],
    totalRowsScanned: 16,
    counts: { accepted: 7, warning: 2, rejected: 3, duplicate: 1 },
    messages: [{ severity: "warning", code: "EXISTING_DATASET_NOT_CHECKED", message: "No existing dataset selected; database duplicate checks were not performed." }],
    existingDatasetChecked: false,
    validationPassed: false,
    commitAllowed: false,
    commitBlockedReasons: ["Phase 3-i is preview-only.", "Resolve validation errors, mappings and warnings before approval."],
    accepted: { rows: [row()], total: 7 },
    warning: { rows: [row({ sheet: "Fuels", rowNumber: 51, canonicalUnit: null, messages: [{ severity: "warning", code: "UNIT_NOT_RECOGNISED", message: "Unit could not be mapped to a canonical unit." }] })], total: 2 },
    rejected: { rows: [row({ rowNumber: 66, factorValue: null, messages: [{ severity: "error", code: "CONFLICT_WITHIN_FILE", message: "Rows collide at the same source or factor lookup key; no row was chosen." }] })], total: 3 },
    duplicate: { rows: [row({ rowNumber: 70, messages: [{ severity: "warning", code: "DUPLICATE_WITHIN_FILE", message: "Identical factor already proposed in this file; excluded." }] })], total: 1 },
  },
};

const renderPage = async () => renderToStaticMarkup(await ImportPage());
const renderPreview = (state: FactorImportPreviewState) => {
  actionState = state;
  return renderToStaticMarkup(<ImportPreview existingSets={[{ id: "set-1", name: "UK Gov 2025", factorCount: 300 }]} />);
};

beforeEach(() => {
  requireOrganisationContext.mockResolvedValue(context(["carbon.factor.view", "carbon.factor.manage"]));
  listFactorSets.mockReset().mockResolvedValue([{ id: "set-1", name: "UK Gov 2025", _count: { factors: 300 } }]);
  actionState = { error: null, preview: null };
});

describe("/admin/factors/import", () => {
  it("renders the header, the preview-only notice and the upload form for an authorised user", async () => {
    const html = await renderPage();
    expect(html).toContain("UK factor import preview");
    expect(html).toContain("Preview only.");
    expect(html).toContain("No factors will be created or changed.");
    expect(html).toContain("Commit and import stay disabled");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,.xlsx,.xlsm"');
    expect(html).toContain("Preview import");
  });

  it("redirects a user who cannot even view factors", async () => {
    requireOrganisationContext.mockResolvedValue(context([]));
    await expect(renderPage()).rejects.toBeInstanceOf(FakeRedirectError);
  });

  it("hides the upload controls from a viewer without the factor-manage grant", async () => {
    requireOrganisationContext.mockResolvedValue(context(["carbon.factor.view"]));
    const html = await renderPage();
    expect(html).toContain("UK factor import preview");
    expect(html).toContain("needs the emission factor management grant");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Preview import");
    // A viewer must not be shown other organisations' dataset names either.
    expect(listFactorSets).not.toHaveBeenCalled();
    expect(html).not.toContain("UK Gov 2025");
  });

  it("shows an initial state before any file is previewed", () => {
    const html = renderPreview({ error: null, preview: null });
    expect(html).toContain("No file previewed yet");
    expect(html).not.toContain("What it found");
  });

  it("shows a safe error and no preview when the action fails", () => {
    const html = renderPreview({ error: "Unsupported file type. Upload a .csv, .xlsx or .xlsm file.", preview: null });
    expect(html).toContain("Unsupported file type.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("What it found");
  });

  it("renders the file, detected metadata, sheets and scanned rows", () => {
    const html = renderPreview(populated);
    expect(html).toContain("synthetic-factors.csv");
    expect(html).toContain("DEFRA/DESNZ");
    expect(html).toContain("2026");
    expect(html).toContain("v1.1");
    expect(html).toContain("Fuels");
    expect(html).toContain("Cover sheet");
    expect(html).toContain("Not a recognised factor sheet — skipped");
    expect(html).toContain("database duplicate checks were not run");
  });

  it("renders every summary count", () => {
    const html = renderPreview(populated);
    for (const label of ["Scanned", "Accepted", "Warnings", "Rejected", "Duplicates"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(">16<");
    expect(html).toContain(">7<");
    expect(html).toContain(">3<");
  });

  it("offers a group for accepted, warning, rejected and duplicate rows with their totals", () => {
    const html = renderPreview(populated);
    expect(html).toContain("Accepted (7)");
    expect(html).toContain("Warnings (2)");
    expect(html).toContain("Rejected (3)");
    expect(html).toContain("Duplicates &amp; conflicts (1)");
  });

  it("renders row detail with sheet, source row, units, factor and messages", () => {
    const html = renderPreview(populated);
    expect(html).toContain("row 42");
    expect(html).toContain("Fuels / Gaseous");
    expect(html).toContain("Natural gas");
    expect(html).toContain("kWh");
    expect(html).toContain("→ kilowatt hour");
    expect(html).toContain("0.125");
    expect(html).toContain("co2e");
  });

  it("shows file-level messages honestly", () => {
    const html = renderPreview(populated);
    expect(html).toContain("File-level messages");
    expect(html).toContain("database duplicate checks were not performed");
    expect(html).toContain("EXISTING_DATASET_NOT_CHECKED");
  });

  it("truncates a long group but reports the real total", () => {
    const html = renderPreview(populated);
    expect(html).toContain("Showing the first 1 of 7 rows.");
  });

  it("disables the import control and explains why", () => {
    const html = renderPreview(populated);
    expect(html).toContain("Import factors — disabled");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Import factors — disabled/);
    expect(html).toContain("Phase 3-i is preview-only.");
    expect(html).toContain("2026-full-set.xlsx");
  });

  it("still blocks commit when the file passes validation", () => {
    const html = renderPreview({
      ...populated,
      preview: { ...populated.preview!, validationPassed: true, commitBlockedReasons: ["Phase 3-i is preview-only."] },
    });
    expect(html).toContain("passed validation, and it still cannot be imported");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("says so plainly when a file has no recognisable factor rows", () => {
    const html = renderPreview({
      ...populated,
      preview: {
        ...populated.preview!,
        counts: { accepted: 0, warning: 0, rejected: 0, duplicate: 0 },
        accepted: { rows: [], total: 0 }, warning: { rows: [], total: 0 },
        rejected: { rows: [], total: 0 }, duplicate: { rows: [], total: 0 },
      },
    });
    expect(html).toContain("No factor rows were recognised in this file");
  });
});
