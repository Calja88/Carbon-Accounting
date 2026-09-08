import { describe, expect, it, vi } from "vitest";
import { createTenantRepositoryContext, TenantContextError } from "@/lib/repositories/context";
import {
  assertAllOwned,
  assertChildOwnership,
  assertEntityOwnership,
  assertOwned,
  assertSiteOwnership,
  assertTenantRoot,
  tenantWhere,
  TenantOwnershipError,
} from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction, type TenantTransactionRunner } from "@/lib/repositories/transaction";
import {
  activityEntryA,
  activityEntryB,
  contextA,
  entityA,
  entityB,
  ORG_A,
  ORG_B,
  siteA,
  siteASubstitutedEntity,
  siteB,
} from "./tenant-fixtures";

describe("createTenantRepositoryContext", () => {
  it("builds a context when every field is present", () => {
    const ctx = createTenantRepositoryContext({
      organisationId: ORG_A,
      userId: "user-1",
      correlationId: "corr-1",
    });
    expect(ctx).toEqual({ organisationId: ORG_A, userId: "user-1", correlationId: "corr-1" });
  });

  it.each([
    { organisationId: "", userId: "user-1", correlationId: "corr-1" },
    { organisationId: ORG_A, userId: "", correlationId: "corr-1" },
    { organisationId: ORG_A, userId: "user-1", correlationId: "" },
  ])("rejects a missing field (%#)", (input) => {
    expect(() => createTenantRepositoryContext(input)).toThrow(TenantContextError);
  });
});

describe("tenantWhere", () => {
  it("merges the context organisation into the where clause", () => {
    expect(tenantWhere(contextA, { id: "entry-1" })).toEqual({ id: "entry-1", organisationId: ORG_A });
  });
});

describe("assertOwned", () => {
  it("returns an in-tenant record", () => {
    expect(assertOwned(contextA, entityA)).toBe(entityA);
  });

  it("denies a foreign-tenant record", () => {
    expect(() => assertOwned(contextA, entityB)).toThrow(TenantOwnershipError);
  });

  it("denies a missing record with the identical error as a foreign one", () => {
    let missingMessage = "";
    let foreignMessage = "";
    try {
      assertOwned(contextA, null);
    } catch (err) {
      missingMessage = (err as Error).message;
    }
    try {
      assertOwned(contextA, entityB);
    } catch (err) {
      foreignMessage = (err as Error).message;
    }
    expect(missingMessage).toBe(foreignMessage);
    expect(missingMessage).not.toBe("");
  });

  it("assertAllOwned denies the whole batch if any record is foreign", () => {
    expect(() => assertAllOwned(contextA, [entityA, entityB])).toThrow(TenantOwnershipError);
  });
});

describe("assertTenantRoot", () => {
  it("allows the context's own organisation id", () => {
    expect(() => assertTenantRoot(contextA, ORG_A)).not.toThrow();
  });

  it("denies a foreign organisation id, e.g. a swapped slug/id in a request", () => {
    expect(() => assertTenantRoot(contextA, ORG_B)).toThrow(TenantOwnershipError);
  });
});

describe("assertEntityOwnership", () => {
  it("allows Organisation A reading its own Entity", () => {
    expect(assertEntityOwnership(contextA, entityA)).toBe(entityA);
  });

  it("denies Organisation A reading Organisation B's Entity", () => {
    expect(() => assertEntityOwnership(contextA, entityB)).toThrow(TenantOwnershipError);
  });
});

describe("assertSiteOwnership", () => {
  it("allows a same-tenant Site", () => {
    expect(assertSiteOwnership(contextA, siteA, entityA.id)).toBe(siteA);
  });

  it("denies a foreign-tenant Site", () => {
    expect(() => assertSiteOwnership(contextA, siteB)).toThrow(TenantOwnershipError);
  });

  it("denies a same-tenant Site whose entityId was substituted for a foreign Entity", () => {
    expect(() => assertSiteOwnership(contextA, siteASubstitutedEntity, entityA.id)).toThrow(TenantOwnershipError);
  });
});

describe("assertChildOwnership", () => {
  it("allows a same-tenant child resource under its expected parent", () => {
    expect(assertChildOwnership(contextA, activityEntryA, siteA.id, "siteId")).toBe(activityEntryA);
  });

  it("denies a foreign-tenant child resource (B ActivityEntry read via A context)", () => {
    expect(() => assertChildOwnership(contextA, activityEntryB, siteA.id, "siteId")).toThrow(TenantOwnershipError);
  });

  it("denies a same-tenant child resource attached to the wrong parent", () => {
    expect(() => assertChildOwnership(contextA, activityEntryA, siteB.id, "siteId")).toThrow(TenantOwnershipError);
  });
});

describe("runInTenantTransaction", () => {
  it("requires a context and threads it into the callback", async () => {
    const tx = { marker: "fake-tx" };
    const $transaction = vi.fn((callback: (givenTx: typeof tx) => Promise<unknown>) => callback(tx));
    const client = { $transaction } as unknown as TenantTransactionRunner<typeof tx>;
    const fn = vi.fn(async (givenTx: typeof tx, givenCtx) => {
      expect(givenTx).toBe(tx);
      expect(givenCtx).toBe(contextA);
      return "result";
    });

    const result = await runInTenantTransaction(contextA, client, fn);

    expect(result).toBe("result");
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a callback error", async () => {
    const $transaction = vi.fn((callback: (tx: object) => Promise<unknown>) => callback({}));
    const client = { $transaction } as unknown as TenantTransactionRunner<object>;
    await expect(
      runInTenantTransaction(contextA, client, async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
  });
});
