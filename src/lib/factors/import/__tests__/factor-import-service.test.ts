import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactorBasis, FactorVisibility, Scope } from "@prisma/client";
import { makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emissionFactorSet: { findFirst } } }));
// Any accidental invocation of the legacy importer fails this suite.
vi.mock("@/lib/entries-service", () => ({ recalculatePendingEntries: () => { throw new Error("Recalculation is forbidden"); } }));
import { previewUkGovFactorImport } from "../factor-import-service";

const context = makeOrganisationContext("org-a", { permissions: new Set(["carbon.factor.manage"]) });
const input = {
  buffer: Buffer.from("activity,category_path,factor_category,unit,co2e_factor,factor_kind,region\nSynthetic fuel,Fuels,stationary_combustion_natural_gas,kWh,0.125,direct,UK\n"),
  sourceFileName: "synthetic.csv",
  metadata: { publisher: "Synthetic fixture", year: 2026, release: "test" },
};

describe("read-only factor import service", () => {
  beforeEach(() => findFirst.mockReset());

  it("denies missing permission before parsing or reading any dataset", async () => {
    await expect(previewUkGovFactorImport(makeOrganisationContext("org-a"), { ...input, existingFactorSetId: "private" })).rejects.toThrow("Permission denied");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("previews without DB access or writes when no existing dataset is selected", async () => {
    const result = await previewUkGovFactorImport(context, input);
    expect(findFirst).not.toHaveBeenCalled();
    expect(result.counts.accepted).toBe(1);
    expect(result.commitAllowed).toBe(false);
    expect(result.existingDatasetChecked).toBe(false);
  });

  it("scopes reads in the query and returns only duplicate messages, without existing factor details", async () => {
    findFirst.mockResolvedValue({ factors: [{
      category: "stationary_combustion_natural_gas", subtypeKey: null, basis: FactorBasis.STANDARD,
      scope: Scope.SCOPE_1, region: "UK", unit: "kilowatt hour", co2eFactor: { toString: () => "0.125" },
    }] });
    const result = await previewUkGovFactorImport(context, { ...input, existingFactorSetId: "visible" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "visible", OR: [
        { visibility: FactorVisibility.PLATFORM },
        { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: "org-a" },
      ] },
      select: { factors: { select: { category: true, subtypeKey: true, basis: true, scope: true, region: true, unit: true, co2eFactor: true } } },
    });
    expect(result.counts.duplicate).toBe(1);
    expect(JSON.stringify(result)).not.toContain('"id":"visible"');
  });

  it.each(["other-tenant-private", "missing"])("denies %s identically", async (existingFactorSetId) => {
    findFirst.mockResolvedValue(null);
    await expect(previewUkGovFactorImport(context, { ...input, existingFactorSetId })).rejects.toThrow("Factor dataset is unavailable.");
  });
});
