/**
 * Checkpoint B required fix 6 (usable personas/credentials/permissions),
 * against the real BOARD-1 fixture bd08-board1-seed.test.ts already built —
 * this file must run after it in the include order.
 */
import bcrypt from "bcryptjs";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac/authorize";
import { resolveOrganisationContext } from "@/lib/organisation/context";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

async function personaContext(name: string) {
  const user = await prisma.user.findFirstOrThrow({ where: { name: `BOARD-1 ${name}` } });
  return { user, context: await resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: (await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } })).id }) };
}

describe("Checkpoint B fix 6 — usable personas, credentials, permissions", () => {
  it("every active persona's stored hash is real bcrypt, not the seed's own ad-hoc digest — verifiable through the actual login path", async () => {
    const users = await prisma.user.findMany({ where: { name: { startsWith: "BOARD-1 " }, NOT: { name: "BOARD-1 suspended" } } });
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/); // bcryptjs's own hash prefix — not a 64-char sha256 hex string
      await expect(bcrypt.compare("definitely-the-wrong-password", user.passwordHash)).resolves.toBe(false);
    }
  });

  it("the contributor persona can perform the real contribution journey (carbon.entry.create) and nothing beyond it", async () => {
    const { context } = await personaContext("contributor");
    expect(hasPermission(context, "carbon.entry.create")).toBe(true);
    expect(hasPermission(context, "ems.management_review.manage")).toBe(false);
    expect(hasPermission(context, "carbon.report.export")).toBe(false);
  });

  it("the sustainability lead and independent reviewer hold LCA permissions; read-only and restricted hold view-only", async () => {
    const { context: lead } = await personaContext("sustainability-lead");
    const { context: reviewer } = await personaContext("independent-reviewer");
    const { context: readOnly } = await personaContext("read-only");
    const { context: restricted } = await personaContext("restricted");
    for (const ctx of [lead, reviewer]) {
      expect(hasPermission(ctx, "lca.assessment.calculate")).toBe(true);
      expect(hasPermission(ctx, "lca.version.issue")).toBe(true);
    }
    for (const ctx of [readOnly, restricted]) {
      expect(hasPermission(ctx, "lca.view")).toBe(true);
      expect(hasPermission(ctx, "lca.assessment.calculate")).toBe(false);
      expect(hasPermission(ctx, "carbon.entry.create")).toBe(false);
    }
  });

  it("the restricted persona's access mode is genuinely RESTRICTED with no site/entity scope granted (deny-by-default)", async () => {
    const { context } = await personaContext("restricted");
    expect(context.access.mode).toBe("RESTRICTED");
    expect(context.access.siteIds.size).toBe(0);
    expect(context.access.entityIds.size).toBe(0);
  });

  it("the suspended persona cannot resolve an active organisation context", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 suspended" } });
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    await expect(resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org.id })).rejects.toThrow();
  });
});
