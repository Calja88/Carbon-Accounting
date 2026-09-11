# Board demo hosting and usage controls

Vercel's Ignored Build Step is `node scripts/vercel/ignore-build.mjs`.
Exit 0 skips a routine commit; `[vercel deploy]` in the commit message or the
explicit `BOARD_DEMO_FORCE_DEPLOY=1` environment setting permits a build.
Keep the force setting unset normally. GitHub Actions still runs on the PR.
The first delivery push (`abb5292`) was **Canceled by Ignored Build Step**.
No paid upgrade or deliberate Vercel deployment was requested or performed.
The existing deployment predates the final changes and is not final-demo proof.

Reference: [Vercel ignored-build semantics](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel).

## Free local production runtime

Use Node and **pnpm 10.28.0**, not this machine's fallback pnpm 11 shim.
The application uses the existing Next.js server, Prisma and authentication.
The reviewed migrations are explicit; `pnpm build` never applies migrations.

Private `.env.board-demo` contains only the disposable runtime's connection,
provisioning identity, session configuration and persona-file path. The
operator's `.env.board-personas.json` is private and gitignored. Neither file
belongs in an H00 bundle. `.neon` still points at production: do not run any
implicit-project Neon command from this directory.

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env.board-demo --import tsx scripts/board-demo/run.ts
powershell -File scripts/board-demo/start.ps1
# Optional HTTPS sharing, after the local rehearsal passes:
powershell -File scripts/board-demo/start.ps1 -Tunnel
```

The launcher verifies the manifest, READY state, replay, source relations and
evidence bytes before opening a port. Next starts in production mode on
127.0.0.1 only. Cloudflared, when requested, forwards HTTPS to that loopback
server; its generated origin is passed to authentication before Next starts.
The launcher owns its child processes and stops them on exit. Logs are in
`artifacts/board-runtime/`. Keep the host awake during the meeting.

`cloudflared.exe` was downloaded from the official Cloudflare GitHub release
into `artifacts/board-tools/`; it requires no administrator installation.
The launcher also accepts an existing `cloudflared` on PATH.
[Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
provide a temporary random hostname, with no uptime guarantee. For a stable
board-day URL use an existing named tunnel; no framework migration is needed.

## Recovery

Never clear a BUILDING lease, rewrite an issued pack, reseed over changed
history, or use the production project. The failed seed remains on the
disposable project's original `main` branch for diagnosis.

Use a new branch of a preserved, verified READY rehearsal baseline for each
fresh live-transition rehearsal. Confirm the project is `cool-cake-20837205`,
select the branch explicitly in Neon CLI, retrieve its connection privately,
update `.env.board-demo`, and run the verification command above. A successful
replay regenerates the manifest with actual IDs and the current commit.
Keep the original baseline untouched. To recover an interrupted *initial*
build, branch from the empty, migrated state and provision a fresh independent
manifest proof before running `scripts/board-demo/run.ts --seed`.

Do not run the shared destructive integration tests against the rehearsal
database. They belong to the guarded loopback `ca_checkpoint` CI database.
