import { assertDemoTarget, type DemoDatabaseIdentity, type DemoEnvironment } from "../../../scripts/board-demo/guard";

/**
 * BD02 live wiring for scripts/board-demo/guard.ts. Reads only the
 * environment manifest — never infers "demo" from a URL substring, Vercel
 * preview status, or branch name, per BD02's explicit rule.
 */
function readDemoEnvironmentManifest(): DemoEnvironment {
  return {
    dataMode: process.env.BOARD_DEMO_DATA_MODE,
    deploymentClass: process.env.BOARD_DEMO_DEPLOYMENT_CLASS,
    configuredDatabaseId: process.env.BOARD_DEMO_DATABASE_ID,
    allowedDatabaseId: process.env.BOARD_DEMO_ALLOWED_DATABASE_ID,
    configuredEnvironmentId: process.env.BOARD_DEMO_ENVIRONMENT_ID,
  };
}

/**
 * Whether the current request is genuinely running inside the guarded
 * synthetic demo environment — true only when the environment manifest
 * (env vars, set independently of any application code) and the database's
 * own recorded identity (`databaseIdentity`, read fresh by the caller —
 * never cached, never assumed) both positively agree per
 * `scripts/board-demo/guard.ts`'s `assertDemoTarget`. Any missing value,
 * mismatch, or non-zero ordinary-organisation count fails closed — the
 * banner stays off rather than guessing.
 *
 * `databaseIdentity` is `null` wherever no disposable demo database has
 * been provisioned yet (true for every environment this branch has run in
 * so far — BD02 could not provision one in this session; see
 * Docs/board-sprint/CONTINUITY.md). The synthetic banner is correctly off
 * in that case, not merely unwired.
 */
export function isVerifiedDemoEnvironment(databaseIdentity: DemoDatabaseIdentity | null): boolean {
  if (!databaseIdentity) return false;
  try {
    assertDemoTarget(readDemoEnvironmentManifest(), databaseIdentity);
    return true;
  } catch {
    return false;
  }
}
