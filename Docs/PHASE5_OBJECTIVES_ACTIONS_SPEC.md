# Phase 5 Build Specification — Objectives, Metrics and Action Programmes

**Implements:** T50–T52  
**Prerequisite:** EMS foundation, aspects and legal obligations.  
**Outcome:** versioned environmental objectives, governed metrics, targets, programmes, actions, progress and read-only carbon/LCA metric adapters.

## 1. Fixed decisions

- Objectives link to policy, significant aspects, obligations and risks/opportunities; links do not determine priority automatically.
- A metric definition is versioned and separate from measurement values.
- Carbon/LCA adapters read existing issued/provenance-rich results. EMS does not copy or recalculate them.
- Corporate absolute emissions and product intensity are never combined.
- Completing actions does not automatically mark an objective achieved.
- Target/baseline changes create revisions with rationale and approval.
- No actual targets, baselines or environmental measurements are seeded.

## 2. State machines

```text
ObjectiveVersion: DRAFT → IN_REVIEW → APPROVED → ACTIVE → ACHIEVED / NOT_ACHIEVED / CANCELLED / SUPERSEDED
MetricDefinitionVersion: DRAFT → APPROVED → ACTIVE → SUPERSEDED
ActionProgramme: DRAFT → ACTIVE → ON_HOLD → COMPLETED / CANCELLED
ActionItem: OPEN → IN_PROGRESS → BLOCKED → COMPLETED → VERIFIED / REOPENED / CANCELLED
```

Objective review, not action completion, decides achieved/not achieved.

## 3. Data model

- `EnvironmentalObjective`: organisation, stable reference, current version.
- `EnvironmentalObjectiveVersion`: title, intent, owner, baseline description/date, target value/qualitative target, unit, target date, evaluation method, status, prepared/approved identities/times, revision rationale.
- `ObjectiveSourceLink`: policy revision, aspect assessment, obligation version, risk/opportunity, management-review decision.
- `ObjectiveMetricDefinition`: stable reference/current version.
- `ObjectiveMetricVersion`: name, source type (`MANUAL`, `CORPORATE_CARBON`, `PRODUCT_LCA`, `MONITORING`, `DERIVED_APPROVED_FORMULA`), aggregation/formula config, unit, frequency, boundary/scope, data-quality/review rules, status.
- `ObjectiveMeasurement`: exact metric version, period/time, Decimal value or qualitative result, explicit unit, source snapshot reference/provenance, recorder/reviewer, evidence, status.
- `ObjectiveReview`: exact objective version, review date, progress/forecast, status decision, rationale, approved target change proposal, evidence.
- `ActionProgramme`: objective/NC/review/source links, owner, dates, resources description, status.
- `ActionItem`: programme/source, title, owner membership, priority, dates, status, completion criteria, completion/verification evidence.
- `ActionDependency`, `ActionProgressUpdate`, `ActionStatusHistory`.

Approved objective and metric versions are immutable. Measurement correction creates a superseding record, retaining original and reason.

## 4. Metric adapter contract

```ts
interface MetricSourceAdapter {
  readonly type: MetricSourceType;
  validateDefinition(ctx, config): Promise<ValidationResult>;
  resolve(ctx, version, period): Promise<MetricObservation[]>;
}
```

Corporate adapter requires exact report period, scope/basis/category/site boundary and returns calculation/report provenance. LCA adapter requires issued assessment version, functional/declared unit and intensity semantics. Monitoring adapter reads reviewed results only according to definition. Adapters never accept a foreign Organisation ID or raw browser-provided query.

## 5. Permissions

- `ems.objective.manage`: draft/review objectives and metric definitions.
- add `ems.objective.approve` (recommended, Sustainability Lead default) for approval/target revisions.
- `ems.action.manage`: create/assign/update actions in permitted scope.
- Action owners may update progress/completion evidence but verification follows configured permission/separation.

## 6. Modules/routes

```text
src/lib/ems/objectives/objective-service.ts
src/lib/ems/objectives/metric-service.ts
src/lib/ems/objectives/metric-adapters/types.ts
src/lib/ems/objectives/metric-adapters/manual.ts
src/lib/ems/objectives/metric-adapters/corporate-carbon.ts
src/lib/ems/objectives/metric-adapters/product-lca.ts
src/lib/ems/objectives/metric-adapters/monitoring.ts
src/lib/ems/actions/action-service.ts
src/lib/ems/actions/reminder-handler.ts
src/app/(app)/ems/objectives/**
src/app/(app)/ems/actions/**
src/app/api/ems/objectives/export/route.ts
src/app/api/ems/actions/export/route.ts
```

## 7. Tests

- Foreign objective/metric/measurement/programme/action/source IDs fail.
- Mixed A objective + B aspect/obligation/report/LCA version/monitoring plan fails.
- Approved versions are immutable; revision retains links and rationale.
- Corporate adapter result matches existing analytics/report service golden fixture exactly.
- Scope 2 basis is explicit and never double-counted.
- LCA adapter refuses draft/live mutable assessment when issued version is required.
- Corporate absolute and LCA intensity metrics cannot share an aggregation definition.
- Measurement unit mismatch fails; Decimal precision retained.
- Manual correction supersedes rather than overwrites.
- Completed action does not change objective status.
- Objective achieved requires review/permission/evidence according to policy.
- Site-scoped users see only appropriate actions/metrics; aggregate does not leak other sites.
- Overdue reminders deduplicate and stop after closure/reassignment.
- Cancel/target change requires rationale and audit.
- Tests contain fictional targets and measurements only.

## 8. PR sequence

```text
P5-01 Objective/version/source-link schema and workflow (T50 objective)
P5-02 Metric/version/manual measurements (T50 metric)
P5-03 Corporate carbon adapter and regression tests (T51 carbon)
P5-04 Product LCA + monitoring adapters and semantic guards (T51 remaining)
P5-05 Action programmes/items/dependencies/history (T52 core)
P5-06 Reminders, dashboards, reviews and exports (T52 UI)
P5-07 End-to-end objective review and tenant-adversarial suite
```

## 9. Definition of done

A synthetic organisation can approve an objective and metric, resolve traceable fictional observations from manual or existing-domain adapters, manage actions, and issue an objective review without duplicating calculation logic or crossing tenant/scope boundaries.

## 10. Minimal Claude context

| Task | Provide |
|---|---|
| T50 | §§1–3, aspect/obligation link interfaces, controlled approval pattern |
| T51 | adapter contract/tests plus current carbon report and LCA issued-version service signatures |
| T52 | action model/state/tests plus notifications/outbox interface |

