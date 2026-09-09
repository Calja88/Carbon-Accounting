import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOGUE, PERMISSION_CODES, isKnownPermissionCode } from "@/lib/rbac/permission-catalogue";

describe("permission catalogue", () => {
  it("has no duplicate codes", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it("gives every entry a non-empty domain and description", () => {
    for (const p of PERMISSION_CATALOGUE) {
      expect(p.domain.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.code.startsWith(`${p.domain}.`)).toBe(true);
    }
  });

  it("marks the required sensitive permissions", () => {
    const sensitiveCodes = new Set(
      PERMISSION_CATALOGUE.filter((p) => p.isSensitive).map((p) => p.code),
    );
    expect(sensitiveCodes.has("organisation.role.manage")).toBe(true);
    expect(sensitiveCodes.has("ems.compliance_obligation.approve")).toBe(true);
    expect(sensitiveCodes.has("ems.audit_report.issue")).toBe(true);
    expect(sensitiveCodes.has("ems.corrective_action.effectiveness_review")).toBe(true);
    expect(sensitiveCodes.has("ems.management_review.approve")).toBe(true);
    expect(sensitiveCodes.has("carbon.report.export")).toBe(true);
    expect(sensitiveCodes.has("lca.export")).toBe(true);
    expect(sensitiveCodes.has("ems.export")).toBe(true);
    expect(sensitiveCodes.has("audit.export")).toBe(true);
  });

  it("recognises known codes and rejects unknown ones", () => {
    expect(isKnownPermissionCode("ems.compliance_obligation.approve")).toBe(true);
    expect(isKnownPermissionCode("not.a.real.code")).toBe(false);
  });
});
