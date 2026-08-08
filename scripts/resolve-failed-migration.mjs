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
 * Runs before `migrate deploy` and is a no-op once there is nothing failed to
 * clear, so it is safe on every deploy and can be removed once the affected
 * environments have moved on.
 */
import { execFileSync } from "node:child_process";

const run = (args) =>
  execFileSync("npx", ["prisma", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let status = "";
try {
  status = run(["migrate", "status"]);
} catch (error) {
  // `migrate status` exits non-zero whenever anything is pending or failed —
  // which is precisely the case we are here to inspect.
  status = `${error.stdout ?? ""}${error.stderr ?? ""}`;
}

const failed = [...status.matchAll(/The `([^`]+)` migration started at [^\n]* failed/g)].map((m) => m[1]);

if (failed.length === 0) {
  console.log("No failed migrations recorded — nothing to resolve.");
  process.exit(0);
}

for (const name of failed) {
  console.log(`Marking failed migration "${name}" as rolled back so the corrected version can apply.`);
  run(["migrate", "resolve", "--rolled-back", name]);
}
