/**
 * Checkpoint B required fix 7 (EMS chain / evidence binding), against the
 * real BOARD-1 fixture built by bd08-board1-seed.test.ts.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext } from "@/lib/organisation/context";
import { getAspectChainRecord, getControlChainRecord, getObligationChainRecord } from "@/lib/board/live-records";
import { loadOverviewForContext } from "@/lib/board/live-overview";
import { reopenNonconformity } from "@/lib/ems/nonconformity/nonconformity-service";
import { completeCorrectiveAction, verifyCorrectiveAction } from "@/lib/ems/nonconformity/corrective-action-service";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

async function boardOwnerContext() {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
  const user = await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org.id });
}

describe("Checkpoint B fix 7 — internal requirement -> obligation revision -> evaluation chain", () => {
  it("the obligation version is ACTIVE and the evaluation item has a genuine, evidenced, issued outcome", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const obligation = await prisma.complianceObligation.findFirstOrThrow({ where: { organisationId: org.id } });
    const version = await prisma.complianceObligationVersion.findFirstOrThrow({ where: { organisationId: org.id, obligationId: obligation.id } });
    expect(version.status).toBe("ACTIVE");
    expect(version.otherRequirementSourceId).not.toBeNull();

    const item = await prisma.complianceEvaluationItem.findFirstOrThrow({ where: { organisationId: org.id, obligationVersionId: version.id } });
    expect(item.status).toBe("PARTIALLY_COMPLIANT");
    expect(item.evaluatedAt).not.toBeNull();
    expect(item.rationale).toBeTruthy();

    const evaluation = await prisma.complianceEvaluation.findUniqueOrThrow({ where: { id: item.evaluationId } });
    expect(evaluation.status).toBe("ISSUED");

    const evidenceLink = await prisma.evidenceLink.findFirstOrThrow({ where: { organisationId: org.id, resourceType: "compliance_evaluation_item", resourceId: item.id } });
    expect(evidenceLink.evidenceId).toBeTruthy();
  });
});

describe("Checkpoint B fix 7 — audit finding -> nonconformity is an exact, real relationship", () => {
  it("the audit reached REPORT_ISSUED and its confirmed finding is the nonconformity's exact source", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const nc = await prisma.nonconformity.findFirstOrThrow({ where: { organisationId: org.id, reference: { startsWith: "BOARD1-NC-" } }, orderBy: { createdAt: "asc" } });
    expect(nc.sourceType).toBe("AUDIT_FINDING");
    expect(nc.sourceId).toBeTruthy();

    const finding = await prisma.auditFinding.findUniqueOrThrow({ where: { id: nc.sourceId! } });
    expect(finding.status).toBe("CONFIRMED");
    expect(finding.confirmedByUserId).toBeTruthy();
    expect(finding.questionResponseId).not.toBeNull();

    const response = await prisma.auditQuestionResponse.findUniqueOrThrow({ where: { id: finding.questionResponseId! } });
    expect(response.result).toBe("NONCONFORMANCE");

    const audit = await prisma.emsAudit.findUniqueOrThrow({ where: { id: finding.auditId } });
    expect(audit.status).toBe("REPORT_ISSUED");
    const report = await prisma.auditReportRevision.findFirstOrThrow({ where: { organisationId: org.id, auditId: audit.id } });
    expect(report.status).toBe("ISSUED");
    expect(report.checksumSha256).toBeTruthy();
  });

  it("the containment inspection checklist evidence is a real generated file reflecting the actual control check, never the old five-byte placeholder", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const link = await prisma.evidenceLink.findFirstOrThrow({ where: { organisationId: org.id, resourceType: "control_check", purpose: "inspection-checklist" } });
    const evidence = await prisma.evidenceObject.findUniqueOrThrow({ where: { id: link.evidenceId } });
    expect(evidence.byteSize).toBeGreaterThan(5);
    expect(evidence.filename).toBe("BOARD-1-inspection-checklist.txt");
  });
});

describe("Checkpoint B fix 7 — invoice/meter evidence points at real fixture activity", () => {
  it("the electricity invoice and meter reading are each linked to a real, matching activity entry", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const invoice = await prisma.sourceDocument.findFirstOrThrow({ where: { organisationId: org.id, filename: "BOARD-1-invoice.txt" } });
    const invoiceEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId: org.id, sourceDocumentId: invoice.id } });
    expect(Buffer.from(invoice.content).toString("utf8")).toContain(invoiceEntry.canonicalValue.toString());
    expect(Buffer.from(invoice.content).toString("utf8")).toContain(invoiceEntry.canonicalUnit);

    const meter = await prisma.sourceDocument.findFirstOrThrow({ where: { organisationId: org.id, filename: "BOARD-1-meter-reading.txt" } });
    const meterEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId: org.id, sourceDocumentId: meter.id } });
    expect(Buffer.from(meter.content).toString("utf8")).toContain(meterEntry.canonicalValue.toString());
    expect(meterEntry.id).not.toBe(invoiceEntry.id);
  });
});

describe("Checkpoint B fix 7 — connected-record links select the exact record, never an unfiltered register", () => {
  it("aspect/control/obligation chain relations carry ?record=<id>, not a bare register href", async () => {
    const owner = await boardOwnerContext();
    const aspect = await prisma.environmentalAspect.findFirstOrThrow({ where: { organisationId: owner.organisationId } });
    const aspectRecord = await getAspectChainRecord(owner, aspect.id);
    expect(aspectRecord).not.toBeNull();
    for (const rel of aspectRecord!.relations) {
      expect(rel.href).toBe(`/ems/controls?record=${rel.id}`);
    }

    const control = await prisma.operationalControl.findFirstOrThrow({ where: { organisationId: owner.organisationId } });
    const controlRecord = await getControlChainRecord(owner, control.id);
    expect(controlRecord).not.toBeNull();
    for (const rel of controlRecord!.relations) {
      expect(rel.href).toMatch(/\?record=/);
      expect(rel.href).toContain(rel.id);
    }

    const version = await prisma.complianceObligationVersion.findFirstOrThrow({ where: { organisationId: owner.organisationId } });
    const obligationRecord = await getObligationChainRecord(owner, version.id);
    expect(obligationRecord).not.toBeNull();
    for (const rel of obligationRecord!.relations) {
      if (rel.kind === "operational_control") expect(rel.href).toBe(`/ems/controls?record=${rel.id}`);
      if (rel.kind === "nonconformity") expect(rel.href).toBe(`/ems/nonconformities/${rel.id}`);
    }
  });
});

describe("Checkpoint B corrective handoff §6 — additional-source link and observable live transition", () => {
  it("the internal-requirement evaluation item is linked as a further source naming the exact nonconformity id, not spawning a duplicate", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const nc = await prisma.nonconformity.findFirstOrThrow({ where: { organisationId: org.id, reference: { startsWith: "BOARD1-NC-" } }, orderBy: { createdAt: "asc" } });
    const link = await prisma.nonconformitySourceLink.findFirstOrThrow({
      where: { organisationId: org.id, nonconformityId: nc.id, sourceType: "COMPLIANCE_EVALUATION_ITEM", isPrimary: false },
    });
    expect(link.sourceReferenceNote).toContain(nc.id);
    const item = await prisma.complianceEvaluationItem.findUniqueOrThrow({ where: { id: link.sourceId! } });
    expect(item.organisationId).toBe(org.id);
    // Never a second nonconformity — the whole point of "additional source" is not spawning one.
    const ncCount = await prisma.nonconformity.count({ where: { organisationId: org.id, sourceType: "COMPLIANCE_EVALUATION_ITEM" } });
    expect(ncCount).toBe(0);
  });

  it("a retained OPEN corrective action can be completed and independently reviewed live, after the pack has already been issued, without moving the frozen pack", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const nc = await prisma.nonconformity.findFirstOrThrow({ where: { organisationId: org.id, reference: { startsWith: "BOARD1-NC-" } }, orderBy: { createdAt: "asc" } });
    expect(nc.status).toBe("CLOSED"); // the primary chain's own frozen state, per fix 7 — untouched by what follows
    const action = await prisma.correctiveAction.findFirstOrThrow({
      where: { organisationId: org.id, nonconformityId: nc.id, description: { startsWith: "BOARD1-CA-EXT" } },
    });
    expect(action.status).toBe("OPEN"); // explicitly retained, never completed during the build itself

    const pack = await prisma.managementReviewPack.findFirstOrThrow({ where: { organisationId: org.id } });
    const beforePack = { payload: pack.payload, checksum: pack.checksumSha256 };

    const owner = await boardOwnerContext();
    const reviewer = await resolveOrganisationContext(prisma, {
      userId: (await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 independent-reviewer" } })).id,
      requestedOrganisation: org.id,
    });

    const before = await loadOverviewForContext(owner, {});
    expect(before.attention.state).toBe("ready");

    // The real state machine: a CLOSED nonconformity must be reopened before
    // any of its corrective actions can change — an observable live
    // transition, not a direct stamp.
    const reopened = await reopenNonconformity(owner, nc.id, "Live demonstration: complete and independently review the retained corrective action.", owner.userId);
    expect(reopened.status).toBe("REOPENED");

    const completed = await completeCorrectiveAction(owner, action.id, {
      completionEvidenceNote: "Named owner and inspection schedule extended to East Cards.",
      actorUserId: owner.userId,
    });
    expect(completed.status).toBe("COMPLETED");

    // A distinct reviewer — four-eyes is enforced server-side, non-overridable.
    const verified = await verifyCorrectiveAction(reviewer, action.id, { actorUserId: reviewer.userId });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedByMembershipId).toBe(reviewer.membershipId);

    const after = await loadOverviewForContext(owner, {});
    expect(after.attention.state).toBe("ready");
    if (before.attention.state === "ready" && after.attention.state === "ready") {
      expect(after.attention.data.openActions).toBeLessThan(before.attention.data.openActions);
    }

    // The frozen pack's own content/hash never moved, across both stages.
    const reloadedPack = await prisma.managementReviewPack.findUniqueOrThrow({ where: { id: pack.id } });
    expect(reloadedPack.checksumSha256).toBe(beforePack.checksum);
    expect(reloadedPack.payload).toEqual(beforePack.payload);
  });
});
