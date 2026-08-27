/**
 * Shared HTTP response building for the SP05 unified download boundary
 * (`download-boundary.ts`). Every evidence/controlled-document download
 * route builds its response through these two functions so headers, status
 * codes, and non-disclosing behaviour stay identical across routes and
 * providers — never duplicated per-route header-building logic that could
 * drift (e.g. one route forgetting `X-Content-SHA256` or leaking a
 * SharePoint-specific detail message).
 *
 * Never sets a header carrying a raw SharePoint/Graph URL, token, or
 * provider secret (SP05 requirement) — only the consistent metadata fields
 * (filename, MIME, size, checksum, provider, reference status).
 */

import { NextResponse } from "next/server";
import type { EvidenceDownloadFailureReason, EvidenceDownloadMetadata } from "@/lib/documents/download-boundary";
import { isDisclosableFailure } from "@/lib/documents/download-boundary";

const FAILURE_STATUS: Record<EvidenceDownloadFailureReason, number> = {
  not_found: 404,
  malware_infected: 404,
  tombstoned: 410,
  unpinned: 409,
  revoked_access: 409,
  tenant_mismatch: 409,
  missing_upstream: 409,
  checksum_mismatch: 409,
  unreachable: 409,
};

const FAILURE_MESSAGE: Record<EvidenceDownloadFailureReason, string> = {
  not_found: "That file could not be found.",
  malware_infected: "That file could not be found.",
  tombstoned: "This file has been removed by retention and is no longer available.",
  unpinned: "This document's content has not been issued yet.",
  revoked_access: "This organisation's access to the file's storage location has been revoked.",
  tenant_mismatch: "This organisation's document-storage connection is not configured correctly.",
  missing_upstream: "The file's content could not be located.",
  checksum_mismatch: "The file's content no longer matches its recorded checksum and cannot be verified.",
  unreachable: "The file's content could not be reached right now.",
};

/** Builds the non-disclosing/structured failure response for one download-boundary result. `detail` (a Graph error message or stale reason) is included only for reasons already safe to disclose — never for `not_found`. */
export function failureResponse(reason: EvidenceDownloadFailureReason, detail: string | null): NextResponse {
  const status = FAILURE_STATUS[reason];
  const body: { error: string; reason?: EvidenceDownloadFailureReason; detail?: string } = {
    error: FAILURE_MESSAGE[reason],
  };
  if (isDisclosableFailure(reason)) {
    body.reason = reason;
    if (detail) body.detail = detail;
  }
  return NextResponse.json(body, { status });
}

/** Builds the successful download response with consistent, non-secret metadata headers — never a SharePoint webUrl, access token, or provider secret. */
export function successResponse(metadata: EvidenceDownloadMetadata, bytes: Buffer): NextResponse {
  const filename = (metadata.filename ?? "download").replace(/"/g, "");
  const headers: Record<string, string> = {
    "Content-Type": metadata.mimeType ?? "application/octet-stream",
    "Content-Length": String(bytes.byteLength),
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Evidence-Provider": metadata.provider,
  };
  if (metadata.checksumSha256) headers["X-Content-SHA256"] = metadata.checksumSha256;
  if (metadata.referenceStatus) headers["X-Reference-Status"] = metadata.referenceStatus;

  return new NextResponse(new Uint8Array(bytes), { headers });
}
