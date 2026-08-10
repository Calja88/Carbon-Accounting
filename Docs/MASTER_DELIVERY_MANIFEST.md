# Carbon + ISO 14001 Platform — Delivery Manifest

**Status:** architecture and implementation specifications complete; application implementation has not begun.  
**Data boundary:** no real environmental data inspected, seeded, migrated or ingested.

## 1. Document map

| Phase | Task packets | Build-ready specification | Additional acceptance/refactor material | Exit outcome |
|---|---|---|---|---|
| Current state | — | `CURRENT_STATE_ARCHITECTURE.md` | — | Evidence-based baseline and risk findings |
| Target programme | — | `EMS_EXPANSION_PLAN.md` | — | Target architecture, EMS model and delivery gates |
| 0 Guardrails/Neon | T00–T03 | `PHASE0_GUARDRAILS_NEON_SPEC.md` | Existing invariant/test inventory | Green regressions, ADRs, Neon-safe config, CI ratchet |
| 1 Tenancy/RBAC | T10–T1B | `PHASE1_TENANCY_RBAC_SPEC.md` | `PHASE1_FILE_REFACTOR_MAP.md`; `PHASE1_ADVERSARIAL_TEST_MATRIX.md` | Proven multi-organisation isolation and configurable permissions |
| 2 EMS foundation | T20–T24 | `PHASE2_EMS_FOUNDATION_SPEC.md` | Phase test section | EMS scope/context, controlled evidence, audit, jobs, notifications |
| 3 Aspects/operations | T30–T35 | `PHASE3_ASPECTS_OPERATIONS_SPEC.md` | Phase test section | Reproducible aspects/significance, controls, monitoring/emergency |
| 4 Legal/compliance | T40–T46 | `PHASE4_LEGAL_COMPLIANCE_SPEC.md` | Phase test section | Official-source detection + human applicability/approval/evaluation |
| 5 Objectives/actions | T50–T52 | `PHASE5_OBJECTIVES_ACTIONS_SPEC.md` | Phase test section | Versioned objectives/metrics/actions and read-only carbon/LCA adapters |
| 6 Audit/incident/CAPA | T60–T64 | `PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md` | Phase test section | Audits, incidents, NC, root cause, action, effectiveness and closure |
| 7 Competence/review | T70–T73 | `PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md` | Phase test section | Competence/awareness and deterministic management review |
| 8 Hardening/readiness | T80–T84 | `PHASE8_HARDENING_READINESS_SPEC.md` | Cross-phase release gates | Evidence-backed synthetic pilot readiness |
| Claude execution | all | `CLAUDE_IMPLEMENTATION_TASKS.md` | `CLAUDE_HANDOFF_INDEX.md` | Minimal-context task/PR execution |

## 2. Completeness check

Every implementation task family has:

- fixed decisions and non-authority boundaries;
- prerequisite/dependency statement;
- record/schema contract;
- workflow state transitions where applicable;
- named permission requirements;
- immutability/versioning rules;
- tenant and mixed-parent failure tests;
- proposed service/module/route boundaries;
- reviewable PR ordering;
- definition of done; and
- a minimal Claude context table.

Phase 1 additionally has an exact ownership/permission schema, current-file refactor inventory and adversarial test matrix because tenancy touches the existing application. Later phases mostly add new modules, so their file boundaries are specified prospectively inside each phase document.

## 3. Canonical implementation order

```text
P0 guardrails
  ↓
P1 organisation isolation and permissions
  ↓
P2 shared EMS/evidence/audit/jobs
  ↓
P3 aspects and operational implementation
  ↓
P4 legal register and compliance evaluation
  ↓
P5 objectives/actions/performance
  ↓
P6 audits/incidents/NC/CAPA
  ↓
P7 competence and management review
  ↓
P8 security/resilience/licensed review/pilot gates
```

Do not add tenant-owned EMS modules before Phase 1 isolation is proven. Do not use real records to accelerate any phase. Do not treat Phase 8 readiness as certification.

## 4. Cross-phase invariants

1. Organisation boundary applies to pages, services, mutations, downloads, exports, aggregates, jobs, notifications and AI context.
2. Default compliance-obligation approval belongs only to Sustainability Lead through configurable permission.
3. Carbon and LCA engines, semantics and immutable outputs remain preserved.
4. Approved/issued records change through successor versions/addenda, not mutation.
5. Human decisions remain human: significance override, legal applicability, obligation approval, compliance evaluation, incident notification, NC closure, competence assessment and management-review decisions.
6. Evidence has checksum, provenance, authorisation, classification and retention.
7. Material transitions create audit events and reliable outbox work atomically.
8. Numeric environmental values use Decimal and explicit units.
9. AI output is optional, labelled, schema-validated and non-authoritative.
10. Synthetic fixtures only until a separately approved real-data onboarding plan.

## 5. How to start

Start with T00 using `PHASE0_GUARDRAILS_NEON_SPEC.md` and the exact minimal context listed there. Review and merge one task/PR at a time. Use `CLAUDE_HANDOFF_INDEX.md` to assemble each prompt; do not give Claude this full manifest as implementation context unless it needs programme orientation.
