import { beforeEach, describe, it, expect, vi } from "vitest";
import { makeOrganisationContext, ORG_A } from "@/lib/__tests__/tenant-fixtures";
const state = vi.hoisted(() => ({ classification: "INTERNAL", documentClass: "RESTRICTED", revisionClass: "INTERNAL", indirect: false }));
const storageGet = vi.hoisted(() => vi.fn(async () => Buffer.from("fixture")));
vi.mock("@/lib/documents/storage/provider", () => ({ documentEvidenceStorage: { active: () => ({ get: storageGet }), forKey: () => ({ get: storageGet }) } }));
vi.mock("@/lib/prisma", () => {
  const revision = () => ({ id: "rev", organisationId: "org-aster-demo", documentId: "doc", classification: state.revisionClass, evidenceObjectId: "ev", document: { id: "doc", organisationId: "org-aster-demo", classification: state.documentClass } });
  const evidence = () => ({ id: "ev", organisationId: "org-aster-demo", filename: "secret.pdf", mimeType: "application/pdf", byteSize: 7, checksumSha256: "secret-hash", storageKey: "blob", storageProvider: "database", malwareScanStatus: "CLEAN", classification: state.classification,
    controlledDocumentRevision: state.indirect ? null : revision(), links: state.indirect ? [{ organisationId: "org-aster-demo", evidenceId: "ev", resourceType: "controlled_document_revision", resourceId: "rev" }] : [] });
  return { prisma: {
    evidenceObject: { findMany: vi.fn(async () => [evidence()]), findFirst: vi.fn(async () => evidence()) },
    evidenceLink: { findMany: vi.fn(async () => [{ evidenceId: "ev", evidence: evidence() }]) },
    controlledDocumentRevision: { findMany: vi.fn(async () => [revision()]), findFirst: vi.fn(async () => revision()) },
    controlledDocument: { findMany: vi.fn(async () => [{ id: "doc", organisationId: "org-aster-demo", classification: state.documentClass, revisions: [revision()], currentRevision: revision() }]), findFirst: vi.fn(async () => ({ id: "doc", organisationId: "org-aster-demo" })), findUnique: vi.fn(async () => ({ id: "doc" })) },
  } };
});
import { getEvidenceObject, listEvidenceObjects, listEvidenceForResource, listLinksForEvidenceObject, readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { getControlledDocumentDetail, getRevision, listControlledDocuments } from "@/lib/documents/document-control-service";
const viewer = makeOrganisationContext(ORG_A, { permissions: new Set(["ems.view"]) });
const manager = { ...viewer, permissions: new Set(["ems.view", "ems.controlled_document.manage"] as const) };
beforeEach(() => { state.classification = "INTERNAL"; state.documentClass = "RESTRICTED"; state.revisionClass = "INTERNAL"; state.indirect = false; storageGet.mockClear(); });
describe("effective evidence metadata and bytes protection", () => {
  it.each([false, true])("honours controlling document for direct/indirect links: %s", async indirect => {
    state.indirect = indirect;
    expect(await listEvidenceObjects(viewer)).toEqual([]);
    expect(await listEvidenceForResource(viewer, "environmental_aspect", "aspect")).toEqual([]);
    await expect(getEvidenceObject(viewer, "ev")).rejects.toThrow();
    await expect(listLinksForEvidenceObject(viewer, "ev")).rejects.toThrow();
    expect(await readEvidenceObjectBytes(viewer, "ev")).toBeNull();
    expect(storageGet).not.toHaveBeenCalled();
    await expect(getControlledDocumentDetail(viewer, "doc")).rejects.toThrow();
    await expect(getRevision(viewer, "rev", "doc")).rejects.toThrow();
    expect(await listControlledDocuments(viewer)).toEqual([]);
    expect(await listEvidenceObjects(manager)).toHaveLength(1);
    expect(await readEvidenceObjectBytes(manager, "ev")).not.toBeNull();
  });
  it("a restricted revision cannot be bypassed by an internal document/object", async () => {
    state.documentClass = "INTERNAL"; state.revisionClass = "RESTRICTED";
    expect(await listEvidenceObjects(viewer)).toHaveLength(0);
    await expect(getRevision(viewer, "rev", "doc")).rejects.toThrow();
  });
  it("object classification still applies under an internal controlling document", async () => {
    state.documentClass = "INTERNAL"; state.classification = "CONFIDENTIAL";
    expect(await listEvidenceObjects(viewer)).toHaveLength(0);
  });
});
