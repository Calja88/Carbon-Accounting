import type { EvidenceClassification } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission, requirePermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export function hasClassificationClearance(context: OrganisationContext, classification: EvidenceClassification): boolean {
  if (context.access.mode !== "ORGANISATION_WIDE" || !hasPermission(context, "ems.view")) return false;
  if (classification === "PUBLIC" || classification === "INTERNAL") return true;
  if (classification !== "CONFIDENTIAL" && classification !== "RESTRICTED") return false;
  return hasPermission(context, "ems.controlled_document.manage") || hasPermission(context, "ems.controlled_document.approve");
}

/** Object + direct revision + every polymorphic controlling revision/document must all be readable. */
export async function readableEvidenceIds(context: OrganisationContext, ids: string[]): Promise<Set<string>> {
  requirePermission(context, "ems.view");
  if (context.access.mode !== "ORGANISATION_WIDE" || !ids.length) return new Set();
  const organisationId = context.organisationId;
  const objects = await prisma.evidenceObject.findMany({
    where: { organisationId, id: { in: ids } },
    include: { controlledDocumentRevision: { include: { document: true } }, links: true },
  });
  const revisionIds = objects.flatMap(o => o.links.filter(l => l.resourceType === "controlled_document_revision").map(l => l.resourceId));
  const revisions = await prisma.controlledDocumentRevision.findMany({
    where: { organisationId, id: { in: revisionIds } }, include: { document: true },
  });
  const byId = new Map(revisions.map(r => [r.id, r]));
  const revisionAllowed = (r: typeof revisions[number] | null | undefined) => !!r
    && r.organisationId === organisationId && r.document.organisationId === organisationId
    && hasClassificationClearance(context, r.classification) && hasClassificationClearance(context, r.document.classification);
  return new Set(objects.filter(o => {
    if (!hasClassificationClearance(context, o.classification)) return false;
    if (o.controlledDocumentRevision && !revisionAllowed(o.controlledDocumentRevision)) return false;
    return o.links.every(l => l.organisationId === organisationId &&
      (l.resourceType !== "controlled_document_revision" || revisionAllowed(byId.get(l.resourceId))));
  }).map(o => o.id));
}

/** Deny the whole detail rather than disclose hidden revision metadata, counts or distributions. */
export async function readableDocumentIds(context: OrganisationContext, ids: string[]): Promise<Set<string>> {
  requirePermission(context, "ems.view");
  if (context.access.mode !== "ORGANISATION_WIDE" || !ids.length) return new Set();
  const organisationId = context.organisationId;
  const documents = await prisma.controlledDocument.findMany({
    where: { organisationId, id: { in: ids } }, include: { revisions: true, currentRevision: true },
  });
  const evidenceIds = documents.flatMap(d => [...d.revisions, ...(d.currentRevision ? [d.currentRevision] : [])].flatMap(r => r.evidenceObjectId ? [r.evidenceObjectId] : []));
  const allowedEvidence = await readableEvidenceIds(context, evidenceIds);
  return new Set(documents.filter(d => hasClassificationClearance(context, d.classification)
    && [...d.revisions, ...(d.currentRevision ? [d.currentRevision] : [])].every(r => r.organisationId === organisationId && r.documentId === d.id
      && hasClassificationClearance(context, r.classification) && (!r.evidenceObjectId || allowedEvidence.has(r.evidenceObjectId))))
    .map(d => d.id));
}
export async function assertReadableDocument(context: OrganisationContext, id: string): Promise<void> {
  if (!(await readableDocumentIds(context, [id])).has(id)) throw new TenantOwnershipError();
}
