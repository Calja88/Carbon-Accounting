import { RoleTemplateKey } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isKnownPermissionCode } from "@/lib/rbac/permission-catalogue";
import { SYSTEM_ROLE_TEMPLATES, getRoleTemplate } from "@/lib/rbac/role-templates";

describe("system role templates", () => {
  it("defines exactly the six templates in RoleTemplateKey", () => {
    const templateKeys = SYSTEM_ROLE_TEMPLATES.map((t) => t.templateKey).sort();
    const enumKeys = Object.values(RoleTemplateKey).sort();
    expect(templateKeys).toEqual(enumKeys);
  });

  it("only grants known, non-duplicated permission codes per template", () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      expect(new Set(template.permissionCodes).size).toBe(template.permissionCodes.length);
      for (const code of template.permissionCodes) {
        expect(isKnownPermissionCode(code)).toBe(true);
      }
    }
  });

  it("grants ems.compliance_obligation.approve to Sustainability Lead only", () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const hasApprove = template.permissionCodes.includes("ems.compliance_obligation.approve");
      expect(hasApprove).toBe(template.templateKey === RoleTemplateKey.SUSTAINABILITY_LEAD);
    }
  });

  it("grants ems.competence.sensitive.view to Sustainability Lead only", () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const hasSensitiveView = template.permissionCodes.includes("ems.competence.sensitive.view");
      expect(hasSensitiveView).toBe(template.templateKey === RoleTemplateKey.SUSTAINABILITY_LEAD);
    }
  });

  it("gives Organisation Administrator role-management but not compliance-obligation approval", () => {
    const admin = getRoleTemplate(RoleTemplateKey.ORGANISATION_ADMINISTRATOR);
    expect(admin.permissionCodes).toContain("organisation.role.manage");
    expect(admin.permissionCodes).not.toContain("ems.compliance_obligation.approve");
  });

  it("withholds LCA approve/issue from Organisation Administrator by default", () => {
    const admin = getRoleTemplate(RoleTemplateKey.ORGANISATION_ADMINISTRATOR);
    expect(admin.permissionCodes).not.toContain("lca.assessment.approve");
    expect(admin.permissionCodes).not.toContain("lca.version.issue");
  });

  it("throws for an unregistered template key", () => {
    expect(() => getRoleTemplate("NOT_A_TEMPLATE" as RoleTemplateKey)).toThrow();
  });
});
