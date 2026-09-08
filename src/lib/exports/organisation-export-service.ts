/**
 * Organisation export service (task T81,
 * Docs/PHASE8_HARDENING_READINESS_SPEC.md §4 "Organisation export
 * requirements"). Schema-driven rather than a hand-maintained model list:
 * every Prisma model carrying a scalar `organisationId` field
 * (`Prisma.dmmf.datamodel.models`) is exported automatically, so
 * "complete" is a structural guarantee — a later task that adds a new
 * organisation-scoped table is included the moment it lands, with no edit
 * to this file, rather than depending on someone remembering to add it to
 * a list.
 *
 * Deliberately excluded by construction, not by omission from a list:
 *  - any model with no `organisationId` field (e.g. `User`,
 *    `AiModelCatalog`, `EvidenceObjectBlob`) — cross-tenant/platform tables
 *    never leak into a tenant export;
 *  - raw bytes (`Bytes`-typed fields, e.g. `SourceDocument.content`,
 *    `EvidenceObjectBlob.data`) are replaced with a `{ redacted, byteLength }`
 *    marker rather than embedded — "structured JSON/CSV plus referenced
 *    evidence where authorised", not an inline blob dump; the existing
 *    authenticated download routes remain the way to fetch evidence bytes;
 *  - `EXPORT_FIELD_REDACTIONS` drops specific sensitive fields per model
 *    (currently only `OrganisationMembership.inviteTokenHash` — an
 *    invitation-token hash, matching the "no ... auth tokens" export rule).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { canonicalStringify } from "@/lib/audit/integrity";

export const ORGANISATION_EXPORT_SCHEMA_VERSION = "1.0.0";

const EXPORT_FIELD_REDACTIONS: Record<string, string[]> = {
  OrganisationMembership: ["inviteTokenHash"],
};

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

interface ExportableModel {
  /** PascalCase Prisma model name, e.g. "EvidenceObject". */
  modelName: string;
  /** Prisma client delegate property, e.g. "evidenceObject". */
  delegateName: string;
  redactedFields: string[];
}

/** Every Prisma model with a scalar `organisationId` field — the export's tenant-scope boundary. */
export function listExportableModels(): ExportableModel[] {
  const models = Prisma.dmmf.datamodel.models;
  const exportable: ExportableModel[] = [];
  for (const model of models) {
    const hasOrganisationId = model.fields.some((f) => f.kind === "scalar" && f.name === "organisationId");
    if (!hasOrganisationId) continue;
    exportable.push({
      modelName: model.name,
      delegateName: lowerFirst(model.name),
      redactedFields: EXPORT_FIELD_REDACTIONS[model.name] ?? [],
    });
  }
  return exportable;
}

/** JSON-safe conversion for values Prisma returns that `JSON.stringify` cannot handle directly (BigInt, Decimal, Buffer). */
function toExportSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { redacted: "bytes", byteLength: value.byteLength };
  if (value && typeof value === "object" && "toFixed" in value && typeof (value as { toFixed: unknown }).toFixed === "function") {
    // Prisma.Decimal — duck-typed rather than imported, since the class isn't re-exported for isinstance checks.
    return (value as { toString(): string }).toString();
  }
  if (Array.isArray(value)) return value.map(toExportSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toExportSafe(v);
    return out;
  }
  return value;
}

function redactRow(row: Record<string, unknown>, model: ExportableModel): Record<string, unknown> {
  const safe = toExportSafe(row) as Record<string, unknown>;
  for (const field of model.redactedFields) {
    if (field in safe) safe[field] = { redacted: "field" };
  }
  return safe;
}

export interface OrganisationExportSection {
  modelName: string;
  recordCount: number;
  checksumSha256: string;
  records: Record<string, unknown>[];
}

export interface OrganisationExportManifest {
  schemaVersion: string;
  organisationId: string;
  generatedByUserId: string;
  generatedAt: string;
  sectionCount: number;
  totalRecordCount: number;
  sections: { modelName: string; recordCount: number; checksumSha256: string }[];
  exportChecksumSha256: string;
}

export interface OrganisationExport {
  manifest: OrganisationExportManifest;
  sections: OrganisationExportSection[];
}

/**
 * Generates a complete, tenant-scoped export of every organisation-scoped
 * record. Requires `organisation.export.generate`, and the generation
 * itself is recorded as an audit event (access logging) naming the record
 * counts, never the record content.
 */
export async function generateOrganisationExport(context: OrganisationContext): Promise<OrganisationExport> {
  requirePermission(context, "organisation.export.generate");

  const ctx = toTenantRepositoryContext(context);
  const models = listExportableModels();
  const sections: OrganisationExportSection[] = [];

  for (const model of models) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[model.delegateName];
    const rows: Record<string, unknown>[] = await delegate.findMany({ where: { organisationId: ctx.organisationId } });
    const records = rows.map((row) => redactRow(row, model));
    const checksumSha256 = createHash("sha256").update(canonicalStringify(records)).digest("hex");
    sections.push({ modelName: model.modelName, recordCount: records.length, checksumSha256, records });
  }

  const generatedAt = new Date().toISOString();
  const sectionManifests = sections.map((s) => ({
    modelName: s.modelName,
    recordCount: s.recordCount,
    checksumSha256: s.checksumSha256,
  }));
  const totalRecordCount = sections.reduce((sum, s) => sum + s.recordCount, 0);
  const exportChecksumSha256 = createHash("sha256")
    .update(canonicalStringify(sectionManifests))
    .digest("hex");

  const manifest: OrganisationExportManifest = {
    schemaVersion: ORGANISATION_EXPORT_SCHEMA_VERSION,
    organisationId: ctx.organisationId,
    generatedByUserId: context.userId,
    generatedAt,
    sectionCount: sections.length,
    totalRecordCount,
    sections: sectionManifests,
    exportChecksumSha256,
  };

  await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await recordAuditEvent(tx, txCtx, {
      eventType: "organisation_export.generated",
      resourceType: "organisation_export",
      resourceId: null,
      summary: `Organisation export generated: ${sections.length} sections, ${totalRecordCount} records.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { sectionCount: sections.length, totalRecordCount, exportChecksumSha256 },
    });
  });

  return { manifest, sections };
}
