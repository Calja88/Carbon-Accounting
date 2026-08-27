# Claude Handoff Index

This is the shortest route from planning to implementation. Do not give Claude every document for every task.

## 1. Canonical documents

| Need | Give Claude |
|---|---|
| Understand the existing system once | `CURRENT_STATE_ARCHITECTURE.md` |
| Understand the target EMS once | `EMS_EXPANSION_PLAN.md` |
| Select a narrow implementation job | One task only from `CLAUDE_IMPLEMENTATION_TASKS.md` |
| Implement Phase 1 schema/RBAC | `PHASE1_TENANCY_RBAC_SPEC.md` plus the selected task |
| Know which existing files to touch | Relevant batch only from `PHASE1_FILE_REFACTOR_MAP.md` |
| Write tenant-security tests | Relevant section only from `PHASE1_ADVERSARIAL_TEST_MATRIX.md` |
| Establish regression/Neon guardrails | Selected T00–T03 task + `PHASE0_GUARDRAILS_NEON_SPEC.md` excerpt |
| Build EMS foundation | Selected T20–T24 task + `PHASE2_EMS_FOUNDATION_SPEC.md` excerpt |
| Build aspects/operations | Selected T30–T35 task + `PHASE3_ASPECTS_OPERATIONS_SPEC.md` excerpt |
| Build legal/compliance | Selected T40–T46 task + `PHASE4_LEGAL_COMPLIANCE_SPEC.md` excerpt |
| Build objectives/actions | Selected T50–T52 task + `PHASE5_OBJECTIVES_ACTIONS_SPEC.md` excerpt |
| Build audits/incidents/CAPA | Selected T60–T64 task + `PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md` excerpt |
| Build competence/review | Selected T70–T73 task + `PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md` excerpt |
| Harden and assess readiness | Selected T80–T84 task + `PHASE8_HARDENING_READINESS_SPEC.md` excerpt |
| Check current EMS UI coverage/deployment status | `EMS_UI_COVERAGE.md` |
| Understand SharePoint integration boundaries | `SP00_SHAREPOINT_INTEGRATION_SPEC.md` |

The planning documents are authoritative in this order when wording conflicts:

1. explicit new owner decision;
2. selected task packet;
3. Phase 1 tenancy/RBAC specification;
4. EMS expansion plan;
5. current-state architecture.

## 2. Recommended first five implementation sessions

### Session 1 — T00 regression safety

Provide:

- global context from `CLAUDE_IMPLEMENTATION_TASKS.md`;
- task T00 only;
- current tests under `src/lib/__tests__` and `src/lib/lca/__tests__`;
- current pure engines/report snapshot code only when named by the test gap.

Do not provide the EMS plan. This task changes no EMS or tenancy behaviour.

### Session 2 — T01 ADRs

Provide:

- task T01;
- sections 1, 3, 7 and 9 of `PHASE1_TENANCY_RBAC_SPEC.md`;
- section 2 of `EMS_EXPANSION_PLAN.md`.

Documentation only; no code exploration is necessary beyond confirming repository conventions.

### Session 3 — T02 Neon configuration

Provide:

- task T02;
- `package.json`, `.env.example`, `prisma.config.ts`, `prisma/schema.prisma`, `src/lib/prisma.ts`, deployment section of README;
- section 6 of `EMS_EXPANSION_PLAN.md`.

Do not provide EMS domain details or file refactor map.

### Session 4 — T10 Organisation/membership schema

Provide:

- task T10;
- sections 1–4 and 9 of `PHASE1_TENANCY_RBAC_SPEC.md`;
- `prisma/schema.prisma` and four existing migrations;
- existing seed user/entity/site function only.

Explicit instruction: expand-only migration; no backfill implementation and no application authorisation changes.

### Session 5 — T11 permission schema/templates

Provide:

- task T11;
- sections 1, 2, 5 and 6 of `PHASE1_TENANCY_RBAC_SPEC.md`;
- schema after T10 and permission seed location;
- permission-specific section of `PHASE1_ADVERSARIAL_TEST_MATRIX.md`.

Explicit instruction: the Sustainability Lead template alone gets `ems.compliance_obligation.approve` by default.

## 3. Copy-ready implementation prompt shell

```text
Implement task <TASK_ID> only.

Repository constraints:
<paste Global context from CLAUDE_IMPLEMENTATION_TASKS.md>

Task:
<paste only the selected task>

Normative specification excerpts:
<paste only the sections named in CLAUDE_HANDOFF_INDEX.md>

Relevant current files:
<attach/list only files named for this session>

Before editing, return a maximum-12-line plan listing exact files to add/change and tests to run. Do not redesign decisions already specified. If Prisma/Next.js syntax requires a deviation, state the smallest deviation and why. Then implement, run focused tests followed by appropriate full checks, and report only files changed, migration impact, test results, and residual risks.
```

## 3A. Phase-by-phase minimal handoff map

Use the “Minimal Claude context” table at the end of each phase specification. The table below tells you which single specification to open; do not attach adjacent phase specifications unless the task consumes a named interface from them.

| Task range | Primary specification | Only cross-phase context normally needed |
|---|---|---|
| T00–T03 | `PHASE0_GUARDRAILS_NEON_SPEC.md` | Existing tests/config and named current files only |
| T10–T1B | `PHASE1_TENANCY_RBAC_SPEC.md` | Relevant batch in `PHASE1_FILE_REFACTOR_MAP.md`; matching adversarial-test section |
| T20–T24 | `PHASE2_EMS_FOUNDATION_SPEC.md` | OrganisationContext/permissions and existing evidence/LCA audit patterns |
| T30–T35 | `PHASE3_ASPECTS_OPERATIONS_SPEC.md` | EMS scope, controlled documents, evidence, notifications; read-only carbon/LCA link interface |
| T40–T46 | `PHASE4_LEGAL_COMPLIANCE_SPEC.md` | Jobs/outbox, evidence, aspects/controls and NC creation interface |
| T50–T52 | `PHASE5_OBJECTIVES_ACTIONS_SPEC.md` | Aspect/obligation IDs, carbon/LCA read adapters, notifications |
| T60–T64 | `PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md` | Evidence, obligations, shared actions, competence stub |
| T70–T73 | `PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md` | Evidence/reminders and read-only input adapter interfaces from completed modules |
| T80–T84 | `PHASE8_HARDENING_READINESS_SPEC.md` | Phase-specific test sections and deployed route/resource registry only |

### Standard session payload

For any task after Phase 1, attach only:

1. the global context block;
2. one task packet;
3. the exact sections named in that phase's minimal-context table;
4. interfaces of completed dependencies, not their implementations unless debugging;
5. files in the named PR/module boundary; and
6. relevant adversarial acceptance bullets.

If Claude asks for the complete project plan to implement a narrow task, provide the missing interface or decision excerpt instead.

## 4. Context-budget rules

- One task per session/PR.
- Do not paste all 42 schema models when a task touches only identity/tenancy; provide the schema file as a repository file and point to relevant models.
- Do not paste the full README. Provide named invariants or sections only.
- Do not paste ISO standard content. Requirement mapping is an owner/licensing task.
- Do not give raw environmental source data, even as “examples.”
- Use the fixed permission catalogue rather than asking Claude to invent permission names.
- Use the fixed ownership matrix rather than asking Claude which models are tenant-owned.
- Use the fixed file batches rather than asking Claude to search the whole app each session.
- Use the adversarial matrix as acceptance criteria, not as a request to devise a security strategy.
- Ask for a concise pre-edit file plan; stop a session that proposes unrelated refactors.
- Start the next task only after the current branch is green and reviewed.

## 5. Decisions Claude must escalate, not make

- Changing Organisation/Entity/Site hierarchy.
- Granting compliance approval to any default role other than Sustainability Lead.
- Treating Organisation Administrator as an all-powerful platform administrator.
- Changing carbon/LCA arithmetic or combining their totals.
- Deciding environmental aspect significance criteria.
- Deciding whether legislation applies or an organisation complies.
- Claiming ISO conformity/certification.
- Selecting a paid legal-content provider or entering a contract.
- Moving real environmental data into development, tests or prompts.
- Weakening composite tenant constraints or foreign-ID negative tests.
- Enabling RLS in production before the T1B pooling/context spike passes.

## 6. Review checklist for every Claude PR

- Is the diff limited to the selected packet?
- Did it modify any pure calculation/LCA engine file without the task requiring it?
- Does every customer-data service accept Organisation context first?
- Are tenant predicates inside database queries rather than post-filtered?
- Are nested IDs checked for same-Organisation ownership?
- Are permissions checked from current membership state?
- Are approved/issued records still immutable?
- Are new fixtures fully synthetic?
- Did foreign-ID and denial-path tests ship with the endpoint/mutation?
- Did the direct-Prisma allowlist shrink or stay justified?
- Do existing golden tests pass?
- Are residual decisions clearly escalated rather than silently assumed?

## 7. Complete PR order

The canonical order is dependency order, not necessarily calendar order:

```text
Phase 0: T00 → T01/T02 → T03
Phase 1: T10 → T11 → T12/T13 → T14/T15 → T16/T17 → T18/T19 → T1A → T1B
Phase 2: T20/T21 → T22 → T23 → T24
Phase 3: T30 → T31 → T32 → T33 → T34/T35
Phase 4: T40 → T41 → T42 → T43 → T44 → T45/T46
Phase 5: T50 → T51 → T52
Phase 6: T60 → T61/T62 → T63 → T64
Phase 7: T70 → T71 → T72 → T73
Phase 8: T80/T81/T82/T83 → remediation → T84 → pilot gate
```

Parallel branches are safe only where tasks share no schema/migration or service contracts. Merge schema/interface work before UI consumers.

## 8. Per-phase review focus

| Phase | Reject the PR if… |
|---|---|
| 1 | Any customer query is unscoped, JWT role grants authority, or admin implicitly gets all permissions |
| 2 | Approved documents mutate, outbox is non-atomic, or evidence links skip target ownership validation |
| 3 | Significance is hidden/non-reproducible, old scores change, or monitoring lacks explicit units |
| 4 | Source detection decides applicability/compliance, approval is hard-coded, or active obligation mutates |
| 5 | EMS recalculates carbon/LCA, absolute and intensity results combine, or action completion marks achievement |
| 6 | Incident implies legal conclusion, audit independence is ignored, or closure bypasses effectiveness controls |
| 7 | Attendance automatically means competence, personal data is broadly visible, or AI writes review decisions |
| 8 | Synthetic tests are replaced with production data, unresolved P0/P1 isolation remains, or readiness is called certification |
