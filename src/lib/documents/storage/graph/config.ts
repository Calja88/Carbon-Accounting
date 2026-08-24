/**
 * Per-organisation Microsoft Graph target resolution (task SP02). Bridges
 * SP01's tenant-scoped `OrganisationStorageConnection`/`StorageSiteBinding`
 * rows to the `GraphSiteTarget` the client boundary (`client.ts`) accepts —
 * this is the only place a `GraphSiteTarget` is constructed, so a caller can
 * never hand the client an organisation/site pair it invented itself.
 *
 * Gated on `ems.storage_connection.manage`, the same permission SP01's
 * `connection-service.ts` already requires for reading connection
 * configuration, so granting document-content access never implies Graph
 * configuration visibility and vice versa (SP00 §11 / SP01's separation).
 *
 * Rejects an unconfigured organisation/site combination (missing
 * connection, disconnected/suspended/offboarded status, or a site binding
 * that isn't `CONNECTED`) before any HTTP call is made — SP02 "reject
 * unconfigured organisation/site combinations before HTTP calls".
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { findTenantStorageConnection, toTenantRepositoryContext } from "@/lib/repositories/storage-connection-repository";
import { GraphClientError, GraphSiteTarget } from "./types";

const MANAGE_PERMISSION = "ems.storage_connection.manage" as const;

/**
 * Resolves the `GraphSiteTarget` for one organisation's storage connection.
 * When `siteBindingId` is omitted, the organisation must have exactly one
 * `CONNECTED` site binding — an organisation with more than one active
 * binding must disambiguate explicitly, so this never silently guesses
 * which site a caller meant.
 */
export async function resolveGraphSiteTarget(context: OrganisationContext, siteBindingId?: string): Promise<GraphSiteTarget> {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const correlationId = context.correlationId;

  const connection = await findTenantStorageConnection(ctx);
  if (!connection) {
    throw new GraphClientError(
      "This organisation has no document-storage connection configured.",
      "CONFIGURATION",
      null,
      false,
      correlationId,
    );
  }
  if (connection.status !== "CONNECTED") {
    throw new GraphClientError(
      `This organisation's document-storage connection is ${connection.status.toLowerCase()}, not connected.`,
      "CONFIGURATION",
      null,
      false,
      correlationId,
    );
  }
  if (!connection.entraTenantId) {
    throw new GraphClientError(
      "This organisation's document-storage connection has no Entra tenant configured.",
      "CONFIGURATION",
      null,
      false,
      correlationId,
    );
  }

  const bindings = await prisma.storageSiteBinding.findMany({
    where: { organisationId: ctx.organisationId, connectionId: connection.id, status: "CONNECTED" },
  });

  const binding = siteBindingId ? bindings.find((b) => b.id === siteBindingId) : bindings.length === 1 ? bindings[0] : undefined;

  if (!binding) {
    throw new GraphClientError(
      siteBindingId
        ? "The requested SharePoint site binding is not connected for this organisation."
        : "This organisation has no single connected SharePoint site binding to default to; specify one explicitly.",
      "CONFIGURATION",
      null,
      false,
      correlationId,
    );
  }

  return {
    organisationId: ctx.organisationId,
    entraTenantId: connection.entraTenantId,
    siteId: binding.siteId,
    driveId: binding.driveId,
  };
}
