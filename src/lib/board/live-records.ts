import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { listEnvironmentalAspects } from "@/lib/ems/aspects/aspect-service";
import { listOperationalControls } from "@/lib/ems/controls/control-service";
import { getComplianceObligationVersion } from "@/lib/ems/legal/obligation-service";
import { listEvidenceForResource } from "@/lib/documents/evidence-service";
import type { EvidenceItem, RecordModel, RecordRef } from "./contracts";

/**
 * BD06 live wiring for INTEGRATION/LIVE_BINDINGS.md §4. Maps real,
 * already-authorized domain reads into Astra's RecordModel/RecordRef/
 * EvidenceItem contracts for the aspects/controls/obligations list pages'
 * new `?record=<id>` detail view (RecordWorkspace). Never a second domain
 * state store — every relation below is an existing explicit Prisma
 * relation (OperationalControlAspect, ComplianceObligationVersionControl,
 * ComplianceEvaluationItem, NonconformitySourceLink), never an inferred or
 * unchecked polymorphic link.
 *
 * No `import "server-only"` — same documented reason as live-nav.ts/
 * live-overview.ts (not a dependency of this repository; only ever
 * imported from a server component).
 */

function toEvidenceItems(rows: Awaited<ReturnType<typeof listEvidenceForResource>>, sourceHref: `/${string}`, sourceLabel: string): EvidenceItem[] {
  return rows.map((e) => ({
    id: e.id,
    name: e.filename,
    revision: e.id,
    kind: "file",
    status: !e.storageKey ? "missing" : e.malwareScanStatus === "PENDING" ? "pending" : e.malwareScanStatus === "CLEAN" ? "available" : "missing",
    mime: e.mimeType,
    sizeBytes: e.byteSize,
    checksum: e.checksumSha256,
    recordedAt: e.createdAt.toISOString(),
    source: { kind: "evidence-source", id: e.id, revision: e.id, label: sourceLabel, href: sourceHref },
    download: e.storageKey ? `/api/ems/evidence/${e.id}` : null,
  }));
}

function ref(kind: string, id: string, revision: string, label: string, href: `/${string}`): RecordRef {
  return { kind, id, revision, label, href };
}

/** Environmental Aspect → its linked Operational Controls (OperationalControlAspect join table). */
export async function getAspectChainRecord(context: OrganisationContext, aspectId: string): Promise<RecordModel | null> {
  const aspects = await listEnvironmentalAspects(context); // does its own requireUnscopedEmsAccess + tenant scoping
  const aspect = aspects.find((a) => a.id === aspectId);
  if (!aspect) return null;

  const ctx = toTenantRepositoryContext(context);
  const controlLinks = await prisma.operationalControlAspect.findMany({
    where: tenantWhere<Prisma.OperationalControlAspectWhereInput>(ctx, { aspectId }),
    include: { control: { select: { id: true, title: true, updatedAt: true, status: true } } },
  });
  const evidence = await listEvidenceForResource(context, "environmental_aspect", aspectId);

  return {
    reference: aspect.id, title: aspect.name, kind: "Environmental aspect",
    owner: aspect.process.name, site: "—", revision: aspect.updatedAt.toISOString(),
    status: { label: aspect.operatingCondition, tone: "neutral" },
    summary: `Process: ${aspect.process.name}. ${aspect.impactLinks.length} linked environmental impact${aspect.impactLinks.length === 1 ? "" : "s"}.${aspect.description ? ` ${aspect.description}` : ""}`,
    relations: controlLinks.map((l) => ref("operational_control", l.control.id, l.control.updatedAt.toISOString(), `Control: ${l.control.title}`, "/ems/controls" as const)),
    evidence: toEvidenceItems(evidence, "/ems/aspects" as const, "Open aspect register"),
    timeline: [{ id: aspect.id, title: "Aspect recorded", detail: aspect.existingControls ? `Existing controls: ${aspect.existingControls}` : "No existing controls recorded.", occurredAt: aspect.createdAt.toISOString(), actor: "—" }],
    nextStep: controlLinks.length === 0
      ? { title: "No linked control yet", detail: "Link an operational control to this aspect from the controls register." }
      : { title: "Follow the linked control", detail: "Open the control below to see its compliance obligation and evaluation state." },
  };
}

/** Operational Control → back to its Aspects, and forward to the Obligation versions it satisfies (ComplianceObligationVersionControl). */
export async function getControlChainRecord(context: OrganisationContext, controlId: string): Promise<RecordModel | null> {
  const controls = await listOperationalControls(context); // does its own permission check + tenant scoping
  const control = controls.find((c) => c.id === controlId);
  if (!control) return null;

  const ctx = toTenantRepositoryContext(context);
  const obligationLinks = await prisma.complianceObligationVersionControl.findMany({
    where: tenantWhere<Prisma.ComplianceObligationVersionControlWhereInput>(ctx, { controlId }),
    include: { obligationVersion: { select: { id: true, title: true, updatedAt: true } } },
  });
  const checkEvidence = await Promise.all(control.checks.map((c) => listEvidenceForResource(context, "control_check", c.id)));

  return {
    reference: control.id, title: control.title, kind: "Operational control",
    owner: "—", site: "—", revision: control.updatedAt.toISOString(),
    status: { label: control.status, tone: control.status === "ACTIVE" ? "success" : "neutral" },
    summary: `Linked to ${control.aspectLinks.length} environmental aspect${control.aspectLinks.length === 1 ? "" : "s"}. ${control.checks.length} recorded check${control.checks.length === 1 ? "" : "s"}.`,
    relations: [
      ...control.aspectLinks.map((l) => ref("environmental_aspect", l.aspect.id, control.updatedAt.toISOString(), `Aspect: ${l.aspect.name}`, "/ems/aspects" as const)),
      ...obligationLinks.map((l) => ref("compliance_obligation_version", l.obligationVersion.id, l.obligationVersion.updatedAt.toISOString(), `Obligation: ${l.obligationVersion.title}`, "/ems/legal/obligations" as const)),
    ],
    evidence: checkEvidence.flat().map((e) => toEvidenceItems([e], "/ems/controls" as const, "Open control register")[0]),
    timeline: control.checks.slice(0, 5).map((c) => ({ id: c.id, title: `Control check ${c.result.toLowerCase()}`, detail: c.notes ?? "Recorded", occurredAt: (c.performedAt ?? c.scheduledAt).toISOString(), actor: "—" })),
    nextStep: obligationLinks.length === 0
      ? { title: "No linked obligation yet", detail: "Link this control to the compliance obligation it satisfies from the obligations register." }
      : { title: "Follow the linked obligation", detail: "Open the obligation below to see its current evaluation state." },
  };
}

/**
 * A Compliance Obligation Version → the controls that satisfy it, the
 * evaluation items assessing it, and any Nonconformity genuinely sourced
 * from one of those evaluation items (via the append-only
 * NonconformitySourceLink table — never inferred from a matching id).
 * When the version's source is an `OtherRequirementSource` of type
 * VOLUNTARY_COMMITMENT, this is the demonstrated fictional internal-policy
 * requirement (BD06 §"INTERNAL REQUIREMENT") — a real, already-existing
 * source-type category, not a fabricated statute and not a schema change.
 */
export async function getObligationChainRecord(context: OrganisationContext, versionId: string): Promise<RecordModel | null> {
  const version = await getComplianceObligationVersion(context, versionId); // throws TenantOwnershipError if foreign/missing
  if (!version) return null;
  const ctx = toTenantRepositoryContext(context);

  const [controlLinks, evaluationItems] = await Promise.all([
    prisma.complianceObligationVersionControl.findMany({
      where: tenantWhere<Prisma.ComplianceObligationVersionControlWhereInput>(ctx, { obligationVersionId: versionId }),
      include: { control: { select: { id: true, title: true, updatedAt: true } } },
    }),
    prisma.complianceEvaluationItem.findMany({
      where: tenantWhere<Prisma.ComplianceEvaluationItemWhereInput>(ctx, { obligationVersionId: versionId }),
      select: { id: true, status: true, evaluatedAt: true, updatedAt: true },
    }),
  ]);

  const itemIds = evaluationItems.map((i) => i.id);
  const sourcedNonconformities = itemIds.length
    ? await prisma.nonconformitySourceLink.findMany({
        where: tenantWhere<Prisma.NonconformitySourceLinkWhereInput>(ctx, { sourceType: "COMPLIANCE_EVALUATION_ITEM", sourceId: { in: itemIds } }),
        include: { nonconformity: { select: { id: true, reference: true, updatedAt: true } } },
      })
    : [];

  const isInternalPolicy = version.otherRequirementSource?.type === "VOLUNTARY_COMMITMENT";
  const sourceLabel = version.instrument ? "External statutory instrument" : isInternalPolicy ? "Internal policy (voluntary commitment)" : version.otherRequirementSource ? "Other requirement source" : "Unspecified source";

  return {
    reference: version.id, title: version.title, kind: "Compliance obligation",
    owner: "—", site: "—", revision: version.updatedAt.toISOString(),
    status: { label: version.status, tone: version.status === "APPROVED" ? "success" : "neutral" },
    summary: `${sourceLabel}. ${version.requirementSummary} ${evaluationItems.length} evaluation ${evaluationItems.length === 1 ? "item" : "items"} recorded.`,
    relations: [
      ...controlLinks.map((l) => ref("operational_control", l.control.id, l.control.updatedAt.toISOString(), `Control: ${l.control.title}`, "/ems/controls" as const)),
      ...sourcedNonconformities.map((s) => ref("nonconformity", s.nonconformity.id, s.nonconformity.updatedAt.toISOString(), `Nonconformity: ${s.nonconformity.reference}`, `/ems/nonconformities/${s.nonconformity.id}` as const)),
    ],
    evidence: [],
    timeline: evaluationItems.map((i) => ({ id: i.id, title: `Evaluation ${i.status.toLowerCase()}`, detail: i.evaluatedAt ? "Decision recorded." : "Awaiting a recorded decision.", occurredAt: (i.evaluatedAt ?? i.updatedAt).toISOString(), actor: "—" })),
    nextStep: sourcedNonconformities.length > 0
      ? { title: "Follow the resulting nonconformity", detail: "Open the nonconformity below to see its corrective action and effectiveness review." }
      : evaluationItems.length === 0
        ? { title: "Not yet evaluated", detail: "This obligation version has no recorded evaluation item yet." }
        : { title: "Evaluation in progress", detail: "No nonconformity has been raised from this obligation's evaluation yet." },
  };
}
