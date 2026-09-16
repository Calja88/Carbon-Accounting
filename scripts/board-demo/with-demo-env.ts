/**
 * Runs a command against the BOARD demo database, and only against it.
 *
 * `node --env-file=.env.board-demo <command>` — the pattern every board-demo
 * command used until now — does not override a variable that is already in
 * the environment. A shell carrying an ambient production DATABASE_URL
 * therefore kept it, while the demo env file appeared to be in force. This
 * wrapper closes that: it scrubs every database variable Prisma would
 * consider out of the child's environment first, then supplies the demo
 * file's values, so the file always wins; and it refuses to spawn anything
 * at all unless `assertDemoDatabaseTarget` positively recognises the result.
 *
 * Usage: tsx scripts/board-demo/with-demo-env.ts <command> [args...]
 *
 * Demo-only. No production deployment path imports or depends on this.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { DemoTargetError, assertDemoDatabaseTarget, buildDemoEnv, describeTarget } from "./db-target-guard";

const ENV_FILE = ".env.board-demo";

/** cmd.exe quoting: double quotes group, and only `"` itself needs escaping inside them. */
function quoteForShell(arg: string): string {
  return /[\s"^&|<>]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function main(): void {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    console.error("Usage: tsx scripts/board-demo/with-demo-env.ts <command> [args...]");
    process.exit(2);
  }

  const repoRoot = resolve(import.meta.dirname, "../..");
  const envPath = resolve(repoRoot, ENV_FILE);
  let fileEnv: Record<string, string>;
  try {
    fileEnv = parseEnv(readFileSync(envPath, "utf8")) as Record<string, string>;
  } catch {
    console.error(`Refusing: ${ENV_FILE} could not be read. A BOARD-demo command has no target without it.`);
    process.exit(1);
  }

  const { env, overridden } = buildDemoEnv(process.env, fileEnv);

  try {
    assertDemoDatabaseTarget(env);
  } catch (error) {
    console.error(
      `Refusing to run against an unverified database: ${error instanceof DemoTargetError ? error.message : "target could not be established"}`,
    );
    process.exit(1);
  }

  const target = describeTarget("DATABASE_URL", env.DATABASE_URL);
  if (overridden.length > 0) {
    console.warn(`Ambient ${overridden.join(", ")} ignored; ${ENV_FILE} decides the target.`);
  }
  console.log(
    `BOARD demo target verified: ${target.database} as ${target.user} on ${target.host} (project ${env.BOARD_DEMO_DATABASE_ID}).`,
  );

  // Windows needs a shell to run the `.cmd` shims in node_modules/.bin, and
  // spawnSync joins argv on spaces when it uses one — so an argument
  // containing whitespace has to carry its own quotes or it silently
  // becomes two arguments.
  const useShell = process.platform === "win32";
  const [bin, ...args] = useShell ? command.map(quoteForShell) : command;
  // Next's ambient typing makes NODE_ENV required on ProcessEnv; the child's
  // environment is built from scratch, so assert the shape spawnSync wants.
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error) {
    console.error(`Command failed to start: ${result.error.name}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
