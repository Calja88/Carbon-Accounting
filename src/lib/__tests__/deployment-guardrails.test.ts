import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Static guardrails for the repaired T02/T1B deployment boundary. */
describe("deployment guardrails", () => {
  it("keeps the generic application build database-free", () => {
    const packageJson = JSON.parse(read("package.json")) as { packageManager: string; scripts: Record<string, string> };
    expect(packageJson.packageManager).toBe("pnpm@10.28.0");
    expect(packageJson.scripts.build).toBe("next build");
    expect(packageJson.scripts.build).not.toMatch(/migrate|resolve-failed-migration|db:push/i);
    expect(packageJson.scripts["db:migrate:deploy"]).toMatch(/resolve-failed-migration.*migrate deploy/);
  });

  it("explicitly allows the pinned native/codegen dependency build scripts", () => {
    const workspace = read("pnpm-workspace.yaml");
    for (const dependency of ["@prisma/client", "@prisma/engines", "esbuild", "prisma", "unrs-resolver"]) {
      expect(workspace).toMatch(new RegExp(`['"]?${dependency.replace("/", "\\/")}['"]?: true`));
    }
    expect(workspace).not.toContain("set this to true or false");
  });

  it("resolves only explicitly audited migration names", () => {
    const recovery = read("scripts/resolve-failed-migration.mjs");
    expect(recovery).toContain("20260808090000_ai_layer_documents_and_lca");
    expect(recovery).toContain("20260811112221_t1b_rls_spike_slice");
    expect(recovery).not.toContain("matchAll(");
    expect(recovery).not.toContain("migrate status");
  });

  it("repairs the failed T1B spike without rewriting its historical migration", () => {
    const recovery = read("scripts/resolve-failed-migration.mjs");
    const migration = read("prisma/migrations/20260811112300_repair_t1b_rls_spike_rollout/migration.sql");
    expect(recovery).toContain('{ name: "20260811112221_t1b_rls_spike_slice", resolution: "--applied" }');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "RlsSpikeRecord"');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "RlsSpikeRecord_organisationId_idx"');
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_spike_app')");
    expect(migration).toContain('ALTER TABLE "RlsSpikeRecord" DISABLE ROW LEVEL SECURITY');
    expect(migration).not.toContain("RAISE EXCEPTION");
  });
});
