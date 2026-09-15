# BD09 preparation — pre-merge

PR #64 remains draft. Preparation and synthetic rehearsal do not constitute
Astra merge approval or the formal start of BD09. The original external build
pack is not present locally; the acceptance matrix below implements the
handover's explicit board-day requirements and the repository's checkpoint gates.

## Repeatable checks

```powershell
# Current private demo configuration and READY fixture required.
node --env-file=.env.board-demo --import tsx scripts/board-demo/run.ts
node --env-file=.env.board-demo node_modules/@playwright/test/cli.js test --config=playwright.board.config.ts
# Only after preserving an untouched READY baseline branch:
$env:BOARD_REHEARSAL_TRANSITION = '1'
node --env-file=.env.board-demo node_modules/@playwright/test/cli.js test --config=playwright.board.config.ts --grep 'live completion'
```

The browser suite uses the existing Microsoft Edge installation on Windows.
It stores screenshots/PDFs/results under `artifacts/board-browser*`; authentication
traces are deliberately disabled because login recordings contain credentials.
The manifest contains IDs and synthetic login emails, never passwords.

## Acceptance matrix

| Area | Required proof |
|---|---|
| Overview | Jan–Aug 2026: 1,248 tCO2e; comparable 2025: 1,560; -20%; genuine 192/192; unknown screening |
| Carbon | Site selection, real source-period rows, calculation trace, source-document download |
| Connected EMS | Exact aspect → control → internal requirement/evaluation → audit/finding → NC → action links |
| Evidence | HTTP bytes, filename/MIME/size/SHA-256 and exact linked revision; external references never downloadable blobs |
| LCA | Engine-derived 0.120 → 0.102 kg/card; 15%; stale/incompatible/foreign pairs suppressed |
| Pack | Issued-only view; exact frozen Carbon/LCA/Attention; three real input definitions/snapshots; decisions labelled draft; source revisions; checksum |
| Print/export | Browser PDF hides navigation/actions, retains disclosure/checksum; JSON checksum matches persisted payload |
| Responsive | 1366×768, 1440×900 and 375px; no page overflow; headline/trend/attention visible at laptop size |
| Live transition | Owner completes action; different reviewer records effectiveness; close; Attention changes; historical payload/checksum unchanged |
| Permissions | Read-only views/exports; contributor cannot read EMS pack; restricted cannot see organisation pack; invalid/foreign/anonymous resources denied |
| Recovery | Preserve READY baseline; create fresh rehearsal child; verify replay before launch; never overwrite issued history |

## Personas

| Persona | Demonstration |
|---|---|
| Sustainability lead | Carbon, EMS and LCA; prepare review; complete action |
| Independent reviewer | Separate actor for effectiveness review and approval controls |
| Read-only | Carbon/EMS/LCA viewing and issued-pack export; no mutation grants |
| Contributor | Carbon entry creation; no management-pack access |
| Restricted | No site/entity grants; organisation pack denied |
| Suspended | No active organisation context |

The live transition is an explicit one-time mutation. Rerun it on a fresh
branch of the preserved READY baseline, not on a manually reset state machine.
Do not label a checklist item passed merely because a test definition exists.
Final executed results belong in CHECKPOINT_B_REVIEW.md and the H00 bundle.

## After Astra approval

Verify the approved SHA matches the actual PR head. Merge PR #64 only with the
authoritative **APPROVE MERGE; Merge PR #64, then begin BD09** decision. Rebuild
the approved/merged revision, regenerate the persistent manifest, run the final
rehearsal on a fresh baseline child, verify HTTPS auth/downloads, and record the
board-day URL and recovery owner. No paid hosting upgrade is needed for the
prepared local production-mode route.
