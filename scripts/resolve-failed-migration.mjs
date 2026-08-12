/**
 * Applies only explicitly audited migration-history resolutions before the
 * separate release migration command runs `prisma migrate deploy`.
 *
 * A failed PostgreSQL migration may have completed earlier statements. Every
 * migration named below has therefore been reviewed for retry safety. Never
 * discover and auto-resolve arbitrary failures here: unknown failures must
 * remain P3009 blockers until an owner inspects `_prisma_migrations.logs` and
 * the actual database schema.
 */
import { execFileSync } from "node:child_process";

function prisma(args) {
  try {
    return {
      ok: true,
      output: execFileSync("npx", ["prisma", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * - The removed AI migration was superseded by a corrected migration.
 * - The T1B spike affected only an isolated, unused table. Marking its known
 *   failed record applied allows the following idempotent repair migration to
 *   establish the table and optional policy from any partial state, while the
 *   original migration file remains immutable for environments where it ran.
 */
const MIGRATION_RESOLUTIONS = [
  { name: "20260808090000_ai_layer_documents_and_lca", resolution: "--rolled-back" },
  { name: "20260811112221_t1b_rls_spike_slice", resolution: "--applied" },
];

let resolved = 0;
for (const { name, resolution } of MIGRATION_RESOLUTIONS) {
  const attempt = prisma(["migrate", "resolve", resolution, name]);
  if (attempt.ok) {
    console.log(`Recorded audited migration resolution ${resolution} for "${name}".`);
    resolved++;
  }
  // --rolled-back is accepted only for a failed migration. --applied also
  // baselines a pending migration, which intentionally skips the original
  // role-dependent T1B SQL so the following repair migration owns rollout.
}

console.log(
  resolved === 0
    ? "No audited migration-history resolutions were needed."
    : `Recorded ${resolved} audited migration-history resolution${resolved === 1 ? "" : "s"}.`,
);
