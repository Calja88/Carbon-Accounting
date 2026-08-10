import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  evaluateUnscopedPrismaRule,
  isAllowedPath,
  validateAllowedDirs,
  validateAllowlist,
} from "../lib/unscoped-prisma-rule.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const srcRoot = path.join(repoRoot, "src");

function toPosix(p: string) {
  return p.split(path.sep).join("/");
}

function walk(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function realRepoFiles() {
  return walk(srcRoot).map((absPath) => ({
    path: toPosix(path.relative(repoRoot, absPath)),
    contents: readFileSync(absPath, "utf8"),
  }));
}

describe("unscoped Prisma access rule (T03)", () => {
  it("passes the checked-in baseline allowlist against the current repository", () => {
    const files = realRepoFiles();
    const allowlist = JSON.parse(
      readFileSync(
        path.join(repoRoot, "scripts", "unscoped-prisma-allowlist.json"),
        "utf8",
      ),
    );

    const { newViolations } = evaluateUnscopedPrismaRule(files, allowlist);

    expect(newViolations).toEqual([]);
  });

  it("fails when a new file outside approved directories calls prisma directly", () => {
    const files = [
      {
        path: "src/app/(app)/new-route/actions.ts",
        contents: `import { prisma } from "@/lib/prisma";\nexport async function run() { return prisma.entity.findMany(); }`,
      },
    ];

    const { newViolations } = evaluateUnscopedPrismaRule(files, []);

    expect(newViolations).toEqual(["src/app/(app)/new-route/actions.ts"]);
  });

  it("fails when a new file only imports the prisma wrapper without an existing allowlist entry", () => {
    const files = [
      {
        path: "src/lib/some-new-service.ts",
        contents: `import { prisma } from "@/lib/prisma";\n`,
      },
    ];

    const { newViolations } = evaluateUnscopedPrismaRule(files, []);

    expect(newViolations).toEqual(["src/lib/some-new-service.ts"]);
  });

  it("passes when a call is already recorded in the allowlist", () => {
    const files = [
      {
        path: "src/lib/legacy-service.ts",
        contents: `import { prisma } from "@/lib/prisma";\nprisma.entity.findMany();`,
      },
    ];

    const { newViolations } = evaluateUnscopedPrismaRule(files, ["src/lib/legacy-service.ts"]);

    expect(newViolations).toEqual([]);
  });

  it("allows direct Prisma access inside approved repository/infrastructure directories", () => {
    const files = [
      {
        path: "src/lib/repositories/entity-repository.ts",
        contents: `import { prisma } from "@/lib/prisma";\nprisma.entity.findMany();`,
      },
      {
        path: "src/lib/platform-repositories/organisation-repository.ts",
        contents: `import { prisma } from "@/lib/prisma";\nprisma.organisation.findMany();`,
      },
      {
        path: "src/lib/jobs/infrastructure/outbox-worker.ts",
        contents: `import { prisma } from "@/lib/prisma";\nprisma.job.findMany();`,
      },
      {
        path: "src/lib/prisma.ts",
        contents: `export const prisma = new PrismaClient();`,
      },
    ];

    const { matches, newViolations } = evaluateUnscopedPrismaRule(files, []);

    expect(matches).toEqual([]);
    expect(newViolations).toEqual([]);
  });

  it("reports stale allowlist entries that no longer use direct Prisma access", () => {
    const files = [
      {
        path: "src/lib/migrated-service.ts",
        contents: `export async function run() { return []; }`,
      },
    ];

    const { staleAllowlistEntries } = evaluateUnscopedPrismaRule(files, [
      "src/lib/migrated-service.ts",
    ]);

    expect(staleAllowlistEntries).toEqual(["src/lib/migrated-service.ts"]);
  });

  it("rejects a broad glob exception outside the single trailing '/**' pattern", () => {
    expect(() => validateAllowedDirs(["src/lib/**/*.ts"])).toThrow(/broad glob/);
    expect(() => validateAllowedDirs(["src/lib/repositories/**"])).not.toThrow();
    expect(() =>
      evaluateUnscopedPrismaRule([], [], ["src/**/anything/**"]),
    ).toThrow(/broad glob/);
  });

  it("rejects wildcard entries in the allowlist itself", () => {
    expect(() => validateAllowlist(["src/lib/*.ts"])).toThrow(/wildcards are not permitted/);
    expect(() => validateAllowlist(["src/lib/service.ts"])).not.toThrow();
  });

  it("matches exact-file and trailing-glob allowed directories correctly", () => {
    expect(isAllowedPath("src/lib/prisma.ts")).toBe(true);
    expect(isAllowedPath("src/lib/prisma.ts.bak")).toBe(false);
    expect(isAllowedPath("src/lib/repositories/foo.ts")).toBe(true);
    expect(isAllowedPath("src/lib/repositories-legacy/foo.ts")).toBe(false);
    expect(isAllowedPath("src/lib/services/foo.ts")).toBe(false);
  });
});
