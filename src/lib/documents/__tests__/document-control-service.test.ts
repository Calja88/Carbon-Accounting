/**
 * Controlled document / revision lifecycle tests (task T22). No live
 * database — Prisma is replaced with an in-memory fake, and the audit/
 * outbox side-effects (already covered by their own T20/T21 test suites)
 * are stubbed so these tests stay focused on the state machine itself:
 * successor-revision creation, approved-revision immutability, and
 * four-eyes self-approval denial.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

interface DocumentRow {
  id: string;
  organisationId: string;
  reference: string;
  title: string;
  category: string;
  classification: string;
  ownerMembershipId: string | null;
  reviewIntervalMonths: number | null;
  currentRevisionId: string | null;
}

interface RevisionRow {
  id: string;
  documentId: string;
  organisationId: string;
  revisionNumber: number;
  status: string;
  changeSummary: string | null;
  evidenceObjectId: string | null;
  checksumSha256: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  classification: string;
  preparedByUserId: string | null;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  effectiveDate: Date | null;
  reviewDueDate: Date | null;
  obsoleteDate: Date | null;
  supersedesRevisionId: string | null;
}

const { documents, revisions, evidenceObjects, evidenceLinks, resetTables, nextIdRef } = vi.hoisted(() => {
  const documents: DocumentRow[] = [];
  const revisions: RevisionRow[] = [];
  const evidenceObjects: { id: string; organisationId: string; filename: string; checksumSha256: string; mimeType: string; byteSize: number }[] = [];
  const evidenceLinks: { id: string; evidenceId: string; organisationId: string; resourceType: string; resourceId: string; linkedByUserId: string | null }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    documents.length = 0;
    revisions.length = 0;
    evidenceObjects.length = 0;
    evidenceLinks.length = 0;
    nextIdRef.n = 1;
  }
  return { documents, revisions, evidenceObjects, evidenceLinks, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "not" in (value as Record<string, unknown>)) {
      return record[key] !== (value as { not: unknown }).not;
    }
    return record[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const controlledDocument = {
    create: vi.fn(async ({ data }: { data: Partial<DocumentRow> }) => {
      const row = { id: nextId("document"), currentRevisionId: null, ownerMembershipId: null, reviewIntervalMonths: null, ...data } as DocumentRow;
      documents.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<DocumentRow> }) => {
      const row = documents.find((d) => d.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return documents.find((d) => matches(d, where)) ?? null;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return documents.find((d) => d.id === where.id) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return documents.filter((d) => matches(d, where));
    }),
  };

  const controlledDocumentRevision = {
    create: vi.fn(async ({ data }: { data: Partial<RevisionRow> }) => {
      const row = {
        id: nextId("revision"),
        changeSummary: null,
        evidenceObjectId: null,
        checksumSha256: null,
        mimeType: null,
        sizeBytes: null,
        preparedByUserId: null,
        reviewedByUserId: null,
        approvedByUserId: null,
        reviewedAt: null,
        approvedAt: null,
        effectiveDate: null,
        reviewDueDate: null,
        obsoleteDate: null,
        supersedesRevisionId: null,
        ...data,
      } as RevisionRow;
      revisions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<RevisionRow> }) => {
      const row = revisions.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      if (row.status !== "DRAFT" && row.status !== "IN_REVIEW") {
        const contentFields: (keyof RevisionRow)[] = [
          "documentId",
          "revisionNumber",
          "evidenceObjectId",
          "checksumSha256",
          "mimeType",
          "sizeBytes",
          "changeSummary",
          "classification",
        ];
        if (data.status && ["DRAFT", "IN_REVIEW"].includes(data.status)) {
          throw new Error("ControlledDocumentRevision cannot move back to draft/review once approved");
        }
        for (const field of contentFields) {
          if (field in data && data[field] !== row[field]) {
            throw new Error(`ControlledDocumentRevision content is immutable once ${row.status}`);
          }
        }
      }
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return revisions.find((r) => matches(r, where)) ?? null;
    }),
  };

  const evidenceObject = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return evidenceObjects.find((e) => matches(e, where)) ?? null;
    }),
  };

  const evidenceLink = {
    upsert: vi.fn(async ({ create }: { create: { evidenceId: string; organisationId: string; resourceType: string; resourceId: string; linkedByUserId: string } }) => {
      const row = { id: nextId("link"), ...create };
      evidenceLinks.push(row);
      return row;
    }),
  };

  // No revision in this file is ever SharePoint-linked (task SP04's own
  // tests cover that) — approveRevision's resolveApprovalPin() call always
  // finds nothing here, so approval proceeds exactly as it did before SP04.
  const externalFileReference = {
    findFirst: vi.fn(async () => null),
  };

  const prisma = {
    controlledDocument,
    controlledDocumentRevision,
    evidenceObject,
    evidenceLink,
    externalFileReference,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return { prisma };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

vi.mock("@/lib/jobs/outbox-service", () => ({
  enqueueTenantJob: vi.fn(async () => ({ id: "job-1" })),
}));

const { prisma } = await import("@/lib/prisma");

const {
  createControlledDocument,
  submitRevisionForReview,
  recordRevisionReview,
  approveRevision,
  publishRevisionEffective,
  createSuccessorRevision,
  attachEvidenceToRevision,
  DocumentControlError,
} = await import("@/lib/documents/document-control-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  userId: "user-author",
  permissions: new Set(["ems.controlled_document.manage", "ems.controlled_document.approve"]) as unknown as ReturnType<
    typeof makeOrganisationContext
  >["permissions"],
});

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
});

describe("createControlledDocument", () => {
  it("creates a document with a draft revision 1 and points currentRevisionId at it", async () => {
    const { document, revision } = await createControlledDocument(orgContextA, {
      reference: "POL-ENV-001",
      title: "Environmental Policy",
      category: "policy",
      actorUserId: "user-author",
    });
    expect(revision.revisionNumber).toBe(1);
    expect(revision.status).toBe("DRAFT");
    expect(document.currentRevisionId).toBe(revision.id);
  });
});

async function draftToApproved(reviewerId = "user-reviewer", approverId = "user-approver") {
  const { document, revision } = await createControlledDocument(orgContextA, {
    reference: "POL-ENV-002",
    title: "Waste Policy",
    category: "policy",
    actorUserId: "user-author",
  });
  await submitRevisionForReview(orgContextA, revision.id, "user-author");
  await recordRevisionReview(orgContextA, revision.id, reviewerId);
  const approved = await approveRevision(orgContextA, revision.id, { actorUserId: approverId });
  return { document, revision: approved };
}

describe("approveRevision", () => {
  it("requires the revision to have been reviewed first", async () => {
    const { revision } = await createControlledDocument(orgContextA, {
      reference: "POL-ENV-003",
      title: "Draft only",
      category: "policy",
      actorUserId: "user-author",
    });
    await submitRevisionForReview(orgContextA, revision.id, "user-author");
    await expect(approveRevision(orgContextA, revision.id, { actorUserId: "user-approver" })).rejects.toThrow(
      /reviewed before it can be approved/,
    );
  });

  it("denies the author approving their own revision when four-eyes is enabled (default)", async () => {
    const { revision } = await createControlledDocument(orgContextA, {
      reference: "POL-ENV-004",
      title: "Self approval",
      category: "policy",
      actorUserId: "user-author",
    });
    await submitRevisionForReview(orgContextA, revision.id, "user-author");
    await recordRevisionReview(orgContextA, revision.id, "user-reviewer");
    await expect(approveRevision(orgContextA, revision.id, { actorUserId: "user-author" })).rejects.toThrow();
  });

  it("allows a different approver than the author", async () => {
    const { revision } = await draftToApproved();
    expect(revision.status).toBe("APPROVED");
  });
});

describe("approved revision immutability", () => {
  it("rejects content edits once a revision is APPROVED", async () => {
    const { revision } = await draftToApproved();
    await expect(
      attachEvidenceToRevision(orgContextA, revision.id, "evidence-x", "user-author"),
    ).rejects.toThrow(/no longer be edited/);
  });

  it("rejects moving an APPROVED revision back to DRAFT", async () => {
    const { revision } = await draftToApproved();
    await expect(
      prisma.controlledDocumentRevision.update({ where: { id: revision.id }, data: { status: "DRAFT" } }),
    ).rejects.toThrow();
  });
});

describe("publishRevisionEffective / successor revisions", () => {
  it("publishes an approved revision effective and obsoletes the previous effective revision", async () => {
    const { document, revision: first } = await draftToApproved();
    await publishRevisionEffective(orgContextA, first.id, { actorUserId: "user-approver" });

    const successor = await createSuccessorRevision(orgContextA, { documentId: document.id, actorUserId: "user-author" });
    expect(successor.revisionNumber).toBe(2);
    expect(successor.supersedesRevisionId).toBe(first.id);
    expect(successor.status).toBe("DRAFT");

    await submitRevisionForReview(orgContextA, successor.id, "user-author");
    await recordRevisionReview(orgContextA, successor.id, "user-reviewer");
    const approvedSuccessor = await approveRevision(orgContextA, successor.id, { actorUserId: "user-approver" });
    const published = await publishRevisionEffective(orgContextA, approvedSuccessor.id, { actorUserId: "user-approver" });

    expect(published.status).toBe("EFFECTIVE");
    const obsoletedFirst = revisions.find((r) => r.id === first.id);
    expect(obsoletedFirst?.status).toBe("OBSOLETE");
  });

  it("refuses a successor when the current revision is still draft/in-review", async () => {
    const { document } = await createControlledDocument(orgContextA, {
      reference: "POL-ENV-005",
      title: "Still drafting",
      category: "policy",
      actorUserId: "user-author",
    });
    await expect(
      createSuccessorRevision(orgContextA, { documentId: document.id, actorUserId: "user-author" }),
    ).rejects.toThrow(DocumentControlError);
  });
});
