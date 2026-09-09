/** Refuse any URL other than the explicitly named disposable loopback database. */
export function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (process.env.CHECKPOINT_A_DISPOSABLE !== "1" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      || url.pathname !== "/ca_checkpoint" || !["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Checkpoint A requires CHECKPOINT_A_DISPOSABLE=1 and a loopback ca_checkpoint database; refusing this target.");
  }
  for (const key of ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "DIRECT_DATABASE_URL"]) {
    if (process.env[key]) {
      const direct = new URL(process.env[key]!);
      if (direct.hostname !== url.hostname || direct.port !== url.port || direct.pathname !== url.pathname) throw new Error("Migration URL must target the same disposable database.");
    }
  }
  return url;
}
