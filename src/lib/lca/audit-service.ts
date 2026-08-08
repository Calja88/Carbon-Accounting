/**
 * Append-only audit trail for product assessments.
 *
 * Mirrors the guarantee the corporate side already makes through snapshotted
 * Calculation rows and versioned ReportSnapshots: nothing that bears on a
 * reported figure changes without a record of who changed it, when, and from
 * what to what. Events are never updated or deleted — a correction is another
 * event, not a rewrite.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LcaAuditEntityType =
  | "assessment"
  | "product"
  | "product_version"
  | "process"
  | "process_output"
  | "inventory_item"
  | "transport_leg"
  | "end_of_life_route"
  | "bom_import"
  | "factor_assignment"
  | "methodology"
  | "allocation"
  | "assumption"
  | "exclusion"
  | "evidence"
  | "calculation_run"
  | "status"
  | "approval"
  | "version"
  | "scenario"
  | "report_export"
  | "verification"
  | "supplier"
  | "supplier_pcf"
  | "corporate_link";

export interface RecordAuditInput {
  assessmentId?: string | null;
  entityType: LcaAuditEntityType;
  entityId?: string | null;
  action: string;
  summary: string;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAuditEvent(input: RecordAuditInput) {
  return prisma.lcaAuditEvent.create({
    data: {
      assessmentId: input.assessmentId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      summary: input.summary,
      actorUserId: input.actorUserId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      metadata: toJson(input.metadata),
    },
  });
}

/** Several events in one go — used by imports, which touch many rows at once. */
export async function recordAuditEvents(inputs: RecordAuditInput[]) {
  if (inputs.length === 0) return { count: 0 };
  return prisma.lcaAuditEvent.createMany({
    data: inputs.map((input) => ({
      assessmentId: input.assessmentId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      summary: input.summary,
      actorUserId: input.actorUserId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      metadata: toJson(input.metadata),
    })),
  });
}

export async function listAuditEvents(assessmentId: string, take = 500) {
  return prisma.lcaAuditEvent.findMany({
    where: { assessmentId },
    include: { actor: true },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

export async function countAuditEvents(assessmentId: string) {
  return prisma.lcaAuditEvent.count({ where: { assessmentId } });
}

/**
 * Field-level diff for an update event, so the trail says what actually
 * changed rather than dumping two whole records side by side.
 */
export function diffRecords<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): { before: Partial<T>; after: Partial<T>; changedFields: string[] } {
  const beforeDiff: Partial<T> = {};
  const afterDiff: Partial<T> = {};
  const changedFields: string[] = [];

  for (const field of fields) {
    if (!(field in after)) continue;
    const oldValue = before[field];
    const newValue = after[field];
    const oldNorm = oldValue instanceof Date ? oldValue.toISOString() : oldValue?.toString?.() ?? oldValue;
    const newNorm = newValue instanceof Date ? newValue.toISOString() : newValue?.toString?.() ?? newValue;
    if (oldNorm !== newNorm) {
      beforeDiff[field] = oldValue as T[keyof T];
      afterDiff[field] = newValue as T[keyof T];
      changedFields.push(String(field));
    }
  }

  return { before: beforeDiff, after: afterDiff, changedFields };
}
