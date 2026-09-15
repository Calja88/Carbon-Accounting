import { z } from "zod";

const receiptSchema = z.strictObject({
  projectId: z.literal("cool-cake-20837205"), branchId: z.string().regex(/^br-[a-z0-9-]+$/),
  parentBranchId: z.string().regex(/^br-[a-z0-9-]+$/), branchName: z.string().regex(/^phase3vi-contracts-[a-z0-9-]+$/),
  endpointId: z.string().regex(/^ep-[a-z0-9]+-[a-z0-9]+-ar[a-z0-9]+$/),
  directUrl: z.string(), pooledUrl: z.string(), createdAt: z.string(), expiresAt: z.string(),
});
export type DisposableFactorTarget = z.infer<typeof receiptSchema>;

/** Explicit, short-lived creation receipt; never derives a target from ambient
 * URLs. The operator must obtain this receipt from a newly created Neon child.
 * Diagnostics deliberately contain no URL or credential values. */
export function assertDisposableFactorTarget(input: unknown, now = Date.now()): DisposableFactorTarget {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid disposable factor-test receipt");
  const r = parsed.data;
  const created = Date.parse(r.createdAt), expires = Date.parse(r.expiresAt);
  if (r.branchId === r.parentBranchId || r.branchId === "br-cold-grass-aroam3e1" ||
      !Number.isFinite(created) || !Number.isFinite(expires) || created > now || now - created > 48 * 3_600_000 ||
      expires <= now || expires <= created || expires - created > 48 * 3_600_000) throw new Error("Disposable factor-test branch is stale or not a new child");
  try {
    const direct = new URL(r.directUrl), pooled = new URL(r.pooledUrl);
    const suffix = ".c-4.us-west-2.aws.neon.tech";
    if (direct.hostname !== r.endpointId + suffix || pooled.hostname !== r.endpointId + "-pooler" + suffix ||
        !["postgresql:", "postgres:"].includes(direct.protocol) || direct.protocol !== pooled.protocol ||
        direct.pathname !== pooled.pathname || direct.pathname.length < 2 || direct.username !== pooled.username ||
        direct.password !== pooled.password || !direct.username || !direct.password || direct.port || pooled.port ||
        direct.searchParams.get("sslmode") !== "require" || pooled.searchParams.get("sslmode") !== "require") throw new Error("mismatch");
  } catch { throw new Error("Disposable factor-test endpoint mismatch"); }
  return r;
}

export function disposableFactorEnvironment(receipt: DisposableFactorTarget, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const r = assertDisposableFactorTarget(receipt);
  return { ...inherited, DATABASE_URL: r.pooledUrl, DIRECT_URL: r.directUrl, DATABASE_URL_UNPOOLED: "", DIRECT_DATABASE_URL: "" };
}
