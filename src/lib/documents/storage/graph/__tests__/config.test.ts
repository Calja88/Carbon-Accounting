/**
 * Graph site-target resolution tests (task SP02). Prisma is a fake in-memory
 * store, matching the SP01 `connection-service.test.ts` pattern. Covers
 * permission gating (separate from document-content permissions), rejecting
 * an unconfigured/disconnected organisation, and ambiguous/missing site
 * binding selection — all "before HTTP calls" per SP02 scope.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

interface ConnectionRow {
  id: string;
  organisationId: string;
  status: string;
  entraTenantId: string | null;
}

interface SiteBindingRow {
  id: string;
  connectionId: string;
  organisationId: string;
  siteId: string;
  driveId: string;
  status: string;
  rootFolderPath?: string | null;
}

const { connections, siteBindings, resetTables } = vi.hoisted(() => {
  const connections: ConnectionRow[] = [];
  const siteBindings: SiteBindingRow[] = [];
  function resetTables() {
    connections.length = 0;
    siteBindings.length = 0;
  }
  return { connections, siteBindings, resetTables };
});

vi.mock("@/lib/prisma", () => {
  const organisationStorageConnection = {
    findUnique: vi.fn(async ({ where }: { where: { organisationId?: string; id?: string } }) => {
      if (where.organisationId) return connections.find((c) => c.organisationId === where.organisationId) ?? null;
      return connections.find((c) => c.id === where.id) ?? null;
    }),
  };
  const storageSiteBinding = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return siteBindings.filter((b) =>
        Object.entries(where).every(([key, value]) => (b as unknown as Record<string, unknown>)[key] === value),
      );
    }),
  };
  return { prisma: { organisationStorageConnection, storageSiteBinding } };
});

const { resolveGraphSiteTarget, resolveGraphSiteTargetForEvidenceProvider } = await import("../config");

const manageContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, {
    permissions: new Set(["ems.storage_connection.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
  });

const unauthorisedContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, { permissions: new Set() as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });

describe("resolveGraphSiteTarget", () => {
  beforeEach(() => resetTables());

  it("denies a caller without ems.storage_connection.manage", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    await expect(resolveGraphSiteTarget(unauthorisedContext(ORG_A))).rejects.toThrow();
  });

  it("rejects an organisation with no storage connection configured", async () => {
    await expect(resolveGraphSiteTarget(manageContext(ORG_A))).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });

  it("rejects a connection that is not CONNECTED", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "SUSPENDED", entraTenantId: "tenant-a" });
    await expect(resolveGraphSiteTarget(manageContext(ORG_A))).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });

  it("rejects a connection with no Entra tenant recorded", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: null });
    await expect(resolveGraphSiteTarget(manageContext(ORG_A))).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });

  it("resolves the single connected site binding when none is specified", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    siteBindings.push({ id: "binding-1", connectionId: "conn-1", organisationId: ORG_A, siteId: "site-1", driveId: "drive-1", status: "CONNECTED" });

    const target = await resolveGraphSiteTarget(manageContext(ORG_A));

    expect(target).toEqual({ organisationId: ORG_A, entraTenantId: "tenant-a", siteId: "site-1", driveId: "drive-1" });
  });

  it("rejects when more than one connected site binding exists and none was specified", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    siteBindings.push(
      { id: "binding-1", connectionId: "conn-1", organisationId: ORG_A, siteId: "site-1", driveId: "drive-1", status: "CONNECTED" },
      { id: "binding-2", connectionId: "conn-1", organisationId: ORG_A, siteId: "site-2", driveId: "drive-2", status: "CONNECTED" },
    );

    await expect(resolveGraphSiteTarget(manageContext(ORG_A))).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });

  it("resolves an explicitly requested site binding among several", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    siteBindings.push(
      { id: "binding-1", connectionId: "conn-1", organisationId: ORG_A, siteId: "site-1", driveId: "drive-1", status: "CONNECTED" },
      { id: "binding-2", connectionId: "conn-1", organisationId: ORG_A, siteId: "site-2", driveId: "drive-2", status: "CONNECTED" },
    );

    const target = await resolveGraphSiteTarget(manageContext(ORG_A), "binding-2");

    expect(target.siteId).toBe("site-2");
  });

  it("never resolves a site binding belonging to another organisation", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    connections.push({ id: "conn-2", organisationId: ORG_B, status: "CONNECTED", entraTenantId: "tenant-b" });
    siteBindings.push({ id: "binding-b", connectionId: "conn-2", organisationId: ORG_B, siteId: "site-b", driveId: "drive-b", status: "CONNECTED" });

    await expect(resolveGraphSiteTarget(manageContext(ORG_A), "binding-b")).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });
});

describe("resolveGraphSiteTargetForEvidenceProvider", () => {
  beforeEach(() => resetTables());

  it("resolves without any OrganisationContext/permission, unlike resolveGraphSiteTarget", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    siteBindings.push({
      id: "binding-1",
      connectionId: "conn-1",
      organisationId: ORG_A,
      siteId: "site-1",
      driveId: "drive-1",
      status: "CONNECTED",
      rootFolderPath: "EMS/Evidence",
    });

    const resolved = await resolveGraphSiteTargetForEvidenceProvider(ORG_A);

    expect(resolved.target).toEqual({ organisationId: ORG_A, entraTenantId: "tenant-a", siteId: "site-1", driveId: "drive-1" });
    expect(resolved.siteBindingId).toBe("binding-1");
    expect(resolved.rootFolderPath).toBe("EMS/Evidence");
  });

  it("still rejects an unconfigured organisation", async () => {
    await expect(resolveGraphSiteTargetForEvidenceProvider(ORG_A)).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });

  it("never resolves a site binding belonging to another organisation", async () => {
    connections.push({ id: "conn-1", organisationId: ORG_A, status: "CONNECTED", entraTenantId: "tenant-a" });
    connections.push({ id: "conn-2", organisationId: ORG_B, status: "CONNECTED", entraTenantId: "tenant-b" });
    siteBindings.push({ id: "binding-b", connectionId: "conn-2", organisationId: ORG_B, siteId: "site-b", driveId: "drive-b", status: "CONNECTED" });

    await expect(resolveGraphSiteTargetForEvidenceProvider(ORG_A, "binding-b")).rejects.toMatchObject({ kind: "CONFIGURATION" });
  });
});
