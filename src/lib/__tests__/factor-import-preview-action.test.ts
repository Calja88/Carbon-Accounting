/**
 * Phase 3-ii server action check. The action is the only new server entry
 * point, so this asserts what it refuses, what it forwards to the Phase 3-i
 * engine, and — most importantly — that it never reaches anything that
 * writes. Persistence modules are mocked to throw, so a commit path added by
 * accident fails this suite rather than shipping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

class MockOrganisationAccessError extends Error {}
class MockPermissionDeniedError extends Error {}

const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));
vi.mock("@/lib/rbac/authorize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac/authorize")>("@/lib/rbac/authorize");
  return { ...actual, PermissionDeniedError: MockPermissionDeniedError };
});

const previewUkGovFactorImport = vi.fn();
vi.mock("@/lib/factors/import/factor-import-service", () => ({
  previewUkGovFactorImport: (...a: unknown[]) => previewUkGovFactorImport(...a),
}));

const logEvent = vi.fn();
vi.mock("@/lib/observability/logger", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

// Nothing in a preview may touch persistence. These fail loudly if imported.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get() { throw new Error("Database access is forbidden in a preview"); } }),
}));
vi.mock("@/lib/factor-sets-service", () => ({
  commitFactorImport: () => { throw new Error("Commit is forbidden in Phase 3-ii"); },
  listFactorSets: () => { throw new Error("Unexpected dataset listing"); },
  visibleFactorSetFilter: () => ({}),
}));
vi.mock("@/lib/entries-service", () => ({
  recalculatePendingEntries: () => { throw new Error("Recalculation is forbidden"); },
}));

const { previewFactorImportAction, emptyPreviewState } = await import("@/app/(app)/admin/factors/import/actions");

const context = makeOrganisationContext("org-a", { permissions: new Set(["carbon.factor.manage"]) });

function form(file: File | null, fields: Record<string, string> = {}) {
  const data = new FormData();
  if (file) data.set("file", file);
  Object.entries(fields).forEach(([k, v]) => data.set(k, v));
  return data;
}

function candidate(patch: Record<string, unknown> = {}) {
  return {
    source: { sheet: "CSV", rowNumber: 2, cells: [], fields: {}, messages: [] },
    categoryPath: "Fuels", activity: "Natural gas", rawUnit: "kWh", canonicalUnit: "kilowatt hour",
    factorValue: "0.125", factorUnit: "kgCO2e/kWh", gas: "co2e", kind: "direct",
    identity: "abcdef0123456789", messages: [], status: "accepted",
    ...patch,
  };
}

function preview(patch: Record<string, unknown> = {}) {
  const accepted = [candidate()];
  return {
    sourceFileName: "synthetic.csv",
    metadata: { publisher: "Synthetic fixture", year: 2026, release: "test" },
    proposedFactorSet: { name: "Synthetic fixture 2026 test" },
    sheets: [{ name: "CSV", supported: true, rowsScanned: 2 }],
    totalRowsScanned: 2,
    messages: [],
    acceptedRows: accepted, warningRows: [], rejectedRows: [], duplicateRows: [],
    counts: { accepted: 1, warning: 0, rejected: 0, duplicate: 0 },
    existingDatasetChecked: false, validationPassed: true,
    commitAllowed: false, commitBlockedReasons: ["Preview only."],
    ...patch,
  };
}

beforeEach(() => {
  requireOrganisationContext.mockResolvedValue(context);
  previewUkGovFactorImport.mockReset().mockResolvedValue(preview());
  logEvent.mockClear();
});

describe("factor import preview action", () => {
  it("requires a signed-in organisation context", async () => {
    requireOrganisationContext.mockRejectedValue(new MockOrganisationAccessError("no session"));
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "f.csv")));
    expect(state).toEqual({ error: "You must be signed in.", preview: null });
    expect(previewUkGovFactorImport).not.toHaveBeenCalled();
  });

  it("rejects the request when the factor-manage grant is missing", async () => {
    previewUkGovFactorImport.mockRejectedValue(new MockPermissionDeniedError("denied"));
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "f.csv")));
    expect(state.error).toBe("You don't have permission to manage emission factors.");
    expect(state.preview).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("refuses a missing file and an unsupported extension without parsing", async () => {
    expect((await previewFactorImportAction(emptyPreviewState, form(null))).error)
      .toBe("Choose a .csv, .xlsx or .xlsm file to preview.");
    expect((await previewFactorImportAction(emptyPreviewState, form(new File(["x"], "factors.pdf")))).error)
      .toBe("Unsupported file type. Upload a .csv, .xlsx or .xlsm file.");
    expect(previewUkGovFactorImport).not.toHaveBeenCalled();
  });

  it("accepts each supported extension", async () => {
    for (const name of ["a.csv", "b.xlsx", "c.XLSM"]) {
      const state = await previewFactorImportAction(emptyPreviewState, form(new File(["x"], name)));
      expect(state.error).toBeNull();
    }
    expect(previewUkGovFactorImport).toHaveBeenCalledTimes(3);
  });

  it("refuses a file over the preview size limit before reading it", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv");
    const state = await previewFactorImportAction(emptyPreviewState, form(big));
    expect(state.error).toBe("That file is larger than the 10 MiB preview limit.");
    expect(previewUkGovFactorImport).not.toHaveBeenCalled();
  });

  it("forwards the session context, file and optional metadata to the Phase 3-i service", async () => {
    await previewFactorImportAction(
      emptyPreviewState,
      form(new File(["a"], "synthetic.csv"), { publisher: "DEFRA/DESNZ", year: "2026", release: "v1.1", existingFactorSetId: "set-1" }),
    );
    const [passedContext, input] = previewUkGovFactorImport.mock.calls[0];
    expect(passedContext).toBe(context);
    expect(input.sourceFileName).toBe("synthetic.csv");
    expect(input.metadata).toEqual({ publisher: "DEFRA/DESNZ", year: 2026, release: "v1.1" });
    expect(input.existingFactorSetId).toBe("set-1");
  });

  it("omits an unselected dataset rather than sending an empty id", async () => {
    await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "s.csv"), { existingFactorSetId: "" }));
    expect(previewUkGovFactorImport.mock.calls[0][1]).not.toHaveProperty("existingFactorSetId");
    expect(previewUkGovFactorImport.mock.calls[0][1].metadata).toEqual({ publisher: null, year: null, release: null });
  });

  it("returns a preview that reports counts and keeps commit disabled", async () => {
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "synthetic.csv")));
    expect(state.error).toBeNull();
    expect(state.preview?.commitAllowed).toBe(false);
    expect(state.preview?.commitBlockedReasons).toEqual(["Preview only."]);
    expect(state.preview?.counts).toEqual({ accepted: 1, warning: 0, rejected: 0, duplicate: 0 });
    expect(state.preview?.totalRowsScanned).toBe(2);
    expect(state.preview?.accepted.rows[0]).toMatchObject({ sheet: "CSV", rowNumber: 2, activity: "Natural gas" });
  });

  it("truncates a large group but still reports the real total", async () => {
    previewUkGovFactorImport.mockResolvedValue(preview({
      acceptedRows: Array.from({ length: 250 }, () => candidate()),
      counts: { accepted: 250, warning: 0, rejected: 0, duplicate: 0 },
    }));
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "s.csv")));
    expect(state.preview?.accepted.rows).toHaveLength(100);
    expect(state.preview?.accepted.total).toBe(250);
  });

  it("returns a safe message and logs the internal reason when the parser fails", async () => {
    previewUkGovFactorImport.mockRejectedValue(new Error("Unclosed CSV quote"));
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "broken.csv")));
    expect(state.preview).toBeNull();
    expect(state.error).toBe(
      "That file could not be read. Check it is a valid, unencrypted spreadsheet or CSV and try again.",
    );
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "factor_import_preview_failed",
      organisationId: "org-a",
      fields: { reason: "Unclosed CSV quote" },
    }));
    // The uploaded file's contents are never part of what is logged.
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("broken.csv");
  });

  it("never exposes raw source cells to the client", async () => {
    previewUkGovFactorImport.mockResolvedValue(preview({
      acceptedRows: [candidate({ source: { sheet: "CSV", rowNumber: 2, cells: ["SECRET-CELL"], fields: { notes: "SECRET-FIELD" }, messages: [] } })],
    }));
    const state = await previewFactorImportAction(emptyPreviewState, form(new File(["a"], "s.csv")));
    expect(JSON.stringify(state)).not.toContain("SECRET-CELL");
    expect(JSON.stringify(state)).not.toContain("SECRET-FIELD");
  });
});
