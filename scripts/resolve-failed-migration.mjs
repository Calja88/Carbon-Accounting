/**
 * Clears a Prisma migration that is recorded as *failed* in the target
 * database, so `migrate deploy` can apply the corrected version.
 *
 * Prisma applies each migration inside a transaction, so a migration that
 * errored applied nothing — the row in `_prisma_migrations` is the only thing
 * left behind, and P3009 blocks every later migration until it is cleared.
 * `migrate resolve --rolled-back` is Prisma's own production-safe recovery for
 * exactly that state: it touches no application table and drops no data.
 *
 * Runs before `migrate deploy`, and is a no-op once there is nothing failed to
 * clear, so it is safe on every deploy and can be dropped from the build once
 * every environment has moved past it.
 */
import { execFileSync } from "node:child_process";

function prisma(args) {
  try {
    return {
      ok: true,
      output: execFileSync("npx", ["prisma", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (error) {
    // `migrate status` exits non-zero whenever anything is pending or failed —
    // which is precisely the state we are here to inspect, so the output
    // matters more than the exit code.
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * Migrations known to have been recorded as failed in a deployed database by
 * a superseded version of this repository. Named explicitly because the
 * migration directory itself no longer exists locally — it was replaced by a
 * corrected one — so nothing else can discover it.
 */
const KNOWN_FAILED = ["20260808090000_ai_layer_documents_and_lca"];

const { output } = prisma(["migrate", "status"]);

const discovered = [
  ...output.matchAll(/The `([^`]+)` migration started at [^\n]*failed/g),
  ...output.matchAll(/^\s*[-•]?\s*(\d{14}_[A-Za-z0-9_]+)\s*$/gm),
].map((match) => match[1]);

const candidates = [...new Set([...discovered, ...KNOWN_FAILED])];
let resolved = 0;

for (const name of candidates) {
  const attempt = prisma(["migrate", "resolve", "--rolled-back", name]);
  if (attempt.ok) {
    console.log(`Marked failed migration "${name}" as rolled back so the corrected version can apply.`);
    resolved++;
  }
  // A failure here is the normal case for a migration that is fine — Prisma
  // refuses to roll back one that never failed. Nothing to do, and nothing
  // that should stop the build.
}

console.log(
  resolved === 0
    ? "No failed migrations needed resolving."
    : `Resolved ${resolved} failed migration${resolved === 1 ? "" : "s"}.`,
);
