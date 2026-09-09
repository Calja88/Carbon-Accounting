import { describe, expect, it } from "vitest";
import { resourceLink } from "../resource-links";

describe("resourceLink", () => {
  it("links a controlled document straight to its detail page", () => {
    expect(resourceLink("controlled_document", "doc_1")).toBe("/ems/documents/doc_1");
  });

  it("links an audit report straight to its detail page", () => {
    expect(resourceLink("audit_report", "audit_1")).toBe("/ems/audits/audit_1");
  });

  it("links a known list-only resource type to its list page, ignoring the resource id", () => {
    expect(resourceLink("compliance_obligation", "obl_1")).toBe("/ems/legal/obligations");
  });

  it("links a competence record straight to its assignment detail page", () => {
    expect(resourceLink("competence_record", "cr_1")).toBe("/ems/competence/assignments/cr_1");
  });

  it("returns null for an unmapped resource type rather than guessing a URL", () => {
    expect(resourceLink("nonexistent_resource_type", "x_1")).toBeNull();
  });
});
