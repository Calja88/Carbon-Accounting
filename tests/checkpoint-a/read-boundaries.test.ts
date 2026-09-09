import { beforeEach, it, expect, vi } from "vitest";
import { makeOrganisationContext, ORG_A } from "@/lib/__tests__/tenant-fixtures";
const mocks = vi.hoisted(() => ({ detail: vi.fn(), snapshot: vi.fn(), context: vi.fn(), assessment: vi.fn() }));
vi.mock("@/lib/organisation/session", () => ({ requireOrganisationContext: mocks.context, OrganisationAccessError: class extends Error {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  lcaEvidence: { findFirst: vi.fn(async () => ({ id: "evidence", organisationId: "org-aster-demo", assessmentId: "assessment" })), findUnique: mocks.detail },
  lcaAssessment: { findFirst: mocks.assessment },
  reportSnapshot: { findFirst: mocks.snapshot },
} }));
import { getEvidence } from "@/lib/lca/evidence-service";
import { GET } from "@/app/(app)/reports/[id]/audit-trail.csv/route";
const viewer = makeOrganisationContext(ORG_A, { permissions: new Set(["carbon.view", "lca.view"]) });
beforeEach(() => { vi.clearAllMocks(); mocks.assessment.mockResolvedValue({ id: "assessment", organisationId: ORG_A, entityId: "entity-b" }); });
it("LCA metadata is denied by its actual assessment entity before detailed metadata is loaded", async () => {
  const restricted = { ...viewer, access: { mode: "RESTRICTED" as const, entityIds: new Set(["entity-a"]), siteIds: new Set<string>() } };
  await expect(getEvidence(restricted, "evidence")).rejects.toThrow();
  expect(mocks.detail).not.toHaveBeenCalled();
});
it("LCA mixed-parent evidence is denied before detailed metadata", async () => {
  await expect(getEvidence(viewer, "evidence", "other-assessment")).rejects.toThrow();
  expect(mocks.detail).not.toHaveBeenCalled();
});
it("CSV requires its own export permission before reading a snapshot", async () => {
  mocks.context.mockResolvedValue(viewer);
  const result = await GET(undefined as never, { params: Promise.resolve({ id: "report" }) });
  expect(result.status).toBe(404); expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("CSV denies restricted membership even with export permission", async () => {
  mocks.context.mockResolvedValue({ ...viewer, permissions: new Set(["carbon.view", "carbon.report.export"]), access: { mode: "RESTRICTED", entityIds: new Set(["entity-a"]), siteIds: new Set(["site-a"]) } });
  expect((await GET(undefined as never, { params: Promise.resolve({ id: "report" }) })).status).toBe(404);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
