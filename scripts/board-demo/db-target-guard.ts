/**
 * Which database a BOARD-demo command actually connects to.
 *
 * `scripts/board-demo/guard.ts` answers "is the connected database the
 * approved demo one?" — it runs *after* a connection is open, against the
 * manifest row that connection can read. This module answers the question
 * before that: which connection string is the process about to use at all.
 *
 * The hazard is concrete and was hit in this repository. Every board-demo
 * command loads its configuration with `node --env-file=.env.board-demo`,
 * and `--env-file` does NOT override a variable already present in the
 * environment (verified: an ambient value wins). `dotenv/config`, used by
 * prisma.config.ts, behaves the same way. So a shell carrying an ambient
 * production DATABASE_URL silently redirected every "demo" command at
 * production, with the demo env file loaded and apparently in force.
 *
 * `assertDemoDatabaseTarget` is deliberately pure and opens no connection:
 * it is the last check that can still run before a socket is created, so it
 * has to be able to run with nothing but strings. The database name and the
 * known production identifiers below are pinned in source on purpose — an
 * expectation read from the same environment being validated proves nothing.
 *
 * Nothing here is imported by the application or by any production
 * deployment path; it guards demo-only commands.
 */

/** The only database name a BOARD-demo write command may target. */
export const EXPECTED_DEMO_DATABASE_NAME = "board_demo";

/**
 * The production target this repository was pointed at by accident. Named
 * explicitly so the refusal says what actually happened rather than the
 * generic "wrong database name" — these are identifiers, not credentials.
 */
export const KNOWN_PRODUCTION = {
  projectId: "twilight-breeze-25854149",
  databaseName: "neondb",
} as const;

/**
 * Every variable Prisma's own resolution chain will consider (see
 * `resolveDirectUrl` in prisma.config.ts). All of them are scrubbed and
 * re-supplied by the wrapper, so a stray ambient one cannot re-enter
 * through a fallback the operator has forgotten about.
 */
export const DATABASE_URL_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "DIRECT_DATABASE_URL",
] as const;

/** A connection string reduced to what can be shown in a log line. */
export interface TargetDescription {
  host: string;
  database: string;
  user: string;
}

export class DemoTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoTargetError";
  }
}

/** Never returns the password, and never returns the input string. */
export function describeTarget(variable: string, url: string): TargetDescription {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DemoTargetError(`${variable} is not a parseable connection URL.`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new DemoTargetError(`${variable} is not a postgres:// connection URL.`);
  }
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  if (!database) throw new DemoTargetError(`${variable} names no database.`);
  return { host: parsed.hostname, database, user: parsed.username };
}

/** Neon serves the same database on `<host>` and `<host>-pooler`; those are one environment, not two. */
function poolerAgnosticHost(host: string): string {
  return host.replace("-pooler", "");
}

/**
 * Refuses unless the configuration positively identifies the approved BOARD
 * demo database. Every failure throws — there is no "probably fine" path,
 * because the only alternative to being sure is writing somewhere nobody
 * chose.
 *
 * Messages name variables and non-secret identifiers (host, database, role,
 * Neon project id); they never echo a connection string or a password.
 */
export function assertDemoDatabaseTarget(env: Record<string, string | undefined>): void {
  const value = (name: string) => (env[name] ?? "").trim();

  if (value("APP_DATA_MODE") !== "synthetic") {
    throw new DemoTargetError("APP_DATA_MODE must be 'synthetic' for a BOARD-demo command.");
  }
  if (value("BOARD_DEMO_DATA_MODE") !== "synthetic") {
    throw new DemoTargetError("BOARD_DEMO_DATA_MODE must be 'synthetic' for a BOARD-demo command.");
  }
  if (value("BOARD_DEMO_DEPLOYMENT_CLASS") !== "private-demo") {
    throw new DemoTargetError("BOARD_DEMO_DEPLOYMENT_CLASS must be 'private-demo' for a BOARD-demo command.");
  }

  const configuredProject = value("BOARD_DEMO_DATABASE_ID");
  const allowedProject = value("BOARD_DEMO_ALLOWED_DATABASE_ID");
  if (!configuredProject || !allowedProject) {
    throw new DemoTargetError("BOARD_DEMO_DATABASE_ID and BOARD_DEMO_ALLOWED_DATABASE_ID must both be set.");
  }
  if (configuredProject !== allowedProject) {
    throw new DemoTargetError("BOARD_DEMO_DATABASE_ID does not match BOARD_DEMO_ALLOWED_DATABASE_ID.");
  }
  if (configuredProject === KNOWN_PRODUCTION.projectId) {
    throw new DemoTargetError(`Refusing the known production project ${KNOWN_PRODUCTION.projectId}.`);
  }
  if (!value("BOARD_DEMO_ENVIRONMENT_ID")) {
    throw new DemoTargetError("BOARD_DEMO_ENVIRONMENT_ID must be set; the manifest check cannot run without it.");
  }

  // A partial configuration is the exact shape of the two incidents this
  // repository has already had: the variable the operator set is not the
  // one the engine used. Both, explicitly, or nothing runs.
  const pooled = value("DATABASE_URL");
  const direct = value("DIRECT_URL");
  if (!pooled || !direct) {
    throw new DemoTargetError(
      "A BOARD-demo command requires both DATABASE_URL and DIRECT_URL to be set explicitly by .env.board-demo.",
    );
  }
  for (const extra of ["DATABASE_URL_UNPOOLED", "DIRECT_DATABASE_URL"]) {
    if (value(extra)) {
      throw new DemoTargetError(`${extra} is set as well as DIRECT_URL; the migration target would be ambiguous.`);
    }
  }

  const pooledTarget = describeTarget("DATABASE_URL", pooled);
  const directTarget = describeTarget("DIRECT_URL", direct);

  for (const [variable, target] of [["DATABASE_URL", pooledTarget], ["DIRECT_URL", directTarget]] as const) {
    if (target.database === KNOWN_PRODUCTION.databaseName) {
      throw new DemoTargetError(
        `${variable} targets '${KNOWN_PRODUCTION.databaseName}', the known production database. Refusing.`,
      );
    }
    if (target.database !== EXPECTED_DEMO_DATABASE_NAME) {
      throw new DemoTargetError(
        `${variable} targets database '${target.database}', not '${EXPECTED_DEMO_DATABASE_NAME}'.`,
      );
    }
    if (!target.user) throw new DemoTargetError(`${variable} names no database role.`);
  }

  if (poolerAgnosticHost(pooledTarget.host) !== poolerAgnosticHost(directTarget.host)) {
    throw new DemoTargetError("DATABASE_URL and DIRECT_URL point at different hosts; the target is ambiguous.");
  }
  if (pooledTarget.user !== directTarget.user) {
    throw new DemoTargetError("DATABASE_URL and DIRECT_URL connect as different roles; the target is ambiguous.");
  }
}

/**
 * The environment a BOARD-demo child process must run with: the demo env
 * file's values, layered over an inherited environment whose database
 * variables have been *removed* rather than overwritten.
 *
 * Removal is the whole fix. `node --env-file` and `dotenv/config` both leave
 * an already-set variable alone, so an ambient DATABASE_URL survived every
 * attempt to point a demo command somewhere else. Stripping them first means
 * the file's value always wins, and a variable the file does not define ends
 * up unset — so `assertDemoDatabaseTarget` refuses a half-configured target
 * instead of it being quietly completed from the ambient shell.
 *
 * `overridden` reports which ambient variables were discarded, so the
 * operator is told rather than silently corrected.
 */
export function buildDemoEnv(
  ambient: Record<string, string | undefined>,
  fileEnv: Record<string, string>,
): { env: Record<string, string>; overridden: string[] } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(ambient)) {
    if (value === undefined) continue;
    if ((DATABASE_URL_VARIABLES as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  const overridden = (DATABASE_URL_VARIABLES as readonly string[]).filter((name) => (ambient[name] ?? "").trim());
  return { env: Object.assign(env, fileEnv), overridden };
}
