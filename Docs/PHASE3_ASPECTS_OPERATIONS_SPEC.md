# Phase 3 Build Specification — Aspects, Operational Control and Performance

**Implements:** T30–T35  
**Prerequisite:** Phase 2 controlled evidence, jobs, notifications and EMS scope.  
**Outcome:** versioned process profiles, aspect/impact assessment, deterministic significance, operational controls, monitoring/calibration, external-provider controls, communications and emergency preparedness.

## 1. Fixed decisions

- Process starter profiles contain structure only; users must confirm before application.
- Aspect significance is organisation-configured, deterministic and versioned. No default score represents an ISO requirement.
- Historic assessments snapshot criteria, inputs, formula version, result and override rationale.
- Significant-status override requires permission, rationale and audit event; it never rewrites the calculated score.
- Carbon and LCA records are linked by reference/provenance only. EMS never reimplements their calculations.
- Monitoring results use Decimal and explicit units; no implicit conversion.
- Emergency exercises do not automatically establish legal noncompliance.

## 2. Data model

### Process/activity structure

- `ProcessProfileTemplate`: platform template key/version, description, synthetic/structural marker.
- `ProcessTemplateItem`: parent hierarchy, name, activity/product/service type, suggested lifecycle stage and operating conditions; no environmental values/aspects.
- `ActivityProcess`: organisation, EMS programme, optional Entity/Site, parent, name, description, lifecycle stage, active dates, template provenance.
- `OperatingCondition`: `NORMAL`, `ABNORMAL`, `STARTUP_SHUTDOWN`, `MAINTENANCE`, `EMERGENCY`.

Starter template names only: Hull manufacturing/e-ID/mass-transit/smart bureau/software; Rayleigh metal-card/smart bureau; Milton Keynes office/SaaS. Applying a template produces draft ActivityProcesses only.

### Aspects, impacts and assessment

- `EnvironmentalAspect`: process, name, description, source/input/output, control relationship (`DIRECT_CONTROL`, `INFLUENCE`), lifecycle stage, operating condition, beneficial/adverse potential, active dates.
- `EnvironmentalImpact`: organisation catalogue item, category, receptor, local/global, beneficial/adverse, description.
- `AspectImpactLink`: aspect, impact, causal description.
- `SignificanceMethod`: organisation/programme, name, version, status, formula type/config JSON, threshold, approval metadata.
- `SignificanceCriterion`: method, stable key, label, scale config, weight, required flag, order.
- `AspectAssessment`: aspect, method/version snapshot, assessment version, criterion inputs JSON, calculated score, calculated significant Boolean, override result/rationale, final result, assessor/approver, dates/status.
- `AspectAssessmentLink`: obligation, interested-party requirement, risk/opportunity, incident/complaint references.

Method and criterion config is validated by discriminated Zod schemas. Store exact validated config snapshots on an approved assessment.

### Operational controls

- `OperationalControl`: aspect(s), title, type (`ENGINEERING`, `PROCEDURAL`, `MONITORING`, `COMPETENCE`, `PROCUREMENT`, `EMERGENCY`, `OTHER`), owner, status, frequency, acceptance/effectiveness criteria, controlled-document revision, review dates.
- `ControlApplicability`: Entity/Site/process/external-provider scope.
- `ControlCheck`: scheduled/performed time, result, evidence, reviewer, exception/action links.
- `ExternalProviderControl`: provider name/reference, provided process/product/service, communicated requirements, evaluation frequency, last/next review, status.
- `ExternalProviderEvaluation`: criteria snapshot, result, evidence, reviewer, actions.

### Monitoring and calibration

- `MonitoringPlan`: aspect/control/obligation/objective links, parameter, method, location, frequency, explicit unit, acceptance criteria, responsible role/member, instrument requirement, status/review dates.
- `MonitoringResult`: plan, time/period, Decimal value, unit copied from plan, qualitative result optional, data-quality flag, evidence, recorder/reviewer and review status.
- `MonitoringExceptionReview`: affected results, reason, validity decision, consequence/actions; never silently deletes/recalculates.
- `MonitoringEquipment`: reference, description, location, owner, calibration/verification frequency, status.
- `EquipmentCalibration`: equipment, due/performed dates, provider/method, result, certificate evidence, next due, out-of-tolerance flag and response review.

### Communications and emergency preparedness

- `CommunicationPlan`: subject, internal/external audience, trigger/frequency, method, owner, approval requirement, source requirements.
- `CommunicationRecord`: plan optional, occurred time, parties/audience, approved content reference/summary, sender, response/follow-up, evidence.
- `EmergencyScenario`: aspect/process/site links, trigger, receptors, credible consequence, priority, controls and review date.
- `EmergencyPlan`: scenario, controlled-document revision, roles (not fabricated contact details), resources, communication plan, effective/review dates.
- `EmergencyExercise`: scenario/plan version, type/date, participants, objectives, outcome, observations, lessons, evidence.
- `EmergencyExerciseAction`: link to shared/domain action; incident/NC creation remains explicit.

## 3. Significance engine contract

```ts
type SignificanceSnapshot = {
  methodKey: string;
  version: number;
  formula: "WEIGHTED_SUM" | "MAX_CRITERION" | "RULE_SET";
  threshold: string;
  criteria: Array<{ key: string; value: string; weight?: string }>;
};

type SignificanceResult = {
  score: string;
  calculatedSignificant: boolean;
  trace: Array<{ criterionKey: string; contribution: string }>;
};
```

Pure function: no DB, clock or actor. Decimal arithmetic only. Invalid/missing required inputs raise typed validation errors. Override occurs outside engine and stores calculated and final outcomes separately.

## 4. Permissions and transitions

- `ems.aspect.edit`: draft processes/aspects/links/assessments.
- `ems.aspect.approve`: approve methods and assessments; Sustainability Lead default.
- `ems.control.manage`: controls/checks/provider controls.
- `ems.monitoring.record`: results/calibration capture.
- `ems.monitoring.review`: result/exception review.
- `ems.communication.manage`; `ems.emergency_plan.manage`; `ems.emergency_exercise.record`.

Approved significance method/assessment cannot be mutated. Reassessment creates a successor. Significant aspect without required control appears as an explicit gap, not an automatic fabricated control.

## 5. Modules and routes

```text
src/lib/ems/aspects/types.ts
src/lib/ems/aspects/schemas.ts
src/lib/ems/aspects/process-service.ts
src/lib/ems/aspects/aspect-service.ts
src/lib/ems/aspects/significance-engine.ts
src/lib/ems/aspects/significance-service.ts
src/lib/ems/controls/control-service.ts
src/lib/ems/monitoring/monitoring-service.ts
src/lib/ems/monitoring/calibration-service.ts
src/lib/ems/providers/provider-control-service.ts
src/lib/ems/communications/communication-service.ts
src/lib/ems/emergency/emergency-service.ts
src/app/(app)/ems/processes/**
src/app/(app)/ems/aspects/**
src/app/(app)/ems/controls/**
src/app/(app)/ems/monitoring/**
src/app/(app)/ems/providers/**
src/app/(app)/ems/communications/**
src/app/(app)/ems/emergency/**
```

Do not put significance arithmetic in React/server actions. Do not query carbon/LCA internals directly from aspect UI; use read-only link/search adapters.

## 6. Adversarial and domain tests

- Template application is opt-in, idempotent and creates no aspects/scores/measurements.
- Foreign Site/process/aspect/impact/method/control/plan/result/equipment/scenario IDs fail.
- Mixed A aspect + B impact/method/control/document/evidence fails at DB boundary.
- Same significance snapshot produces exact same score/trace.
- Method revision does not change old assessments.
- Missing/invalid criterion, negative weight, bad threshold and Decimal edge cases fail safely.
- Override retains calculated outcome and requires rationale/permission.
- Approved assessment/method remains immutable.
- Significant aspect with no control appears in gap report.
- Site-scoped user sees only allowed processes/aspects/monitoring aggregates.
- Result unit must equal plan unit unless an explicit reviewed conversion service exists.
- Out-of-tolerance calibration retains result and creates review requirement.
- Provider evaluation and communications reveal no other tenant/sensitive contacts.
- Emergency plan revision is a controlled document; exercise pins exact plan revision.
- Exercise failure does not automatically assert incident, NC or legal breach.
- Carbon/LCA links cannot cross organisation and do not copy totals.
- All values and incidents in tests are synthetic.

## 7. PR sequence

```text
P3-01 Process templates and ActivityProcess hierarchy (T30)
P3-02 Aspect/impact register and lifecycle/condition links (T31)
P3-03 Pure significance engine and method versioning (T32 engine)
P3-04 Assessment/approval/reassessment UI and reports (T32 workflow)
P3-05 Operational controls/checks/review gaps (T33)
P3-06 Monitoring plans/results and equipment calibration (T34)
P3-07 External-provider controls/evaluations (part T35)
P3-08 Communications and emergency scenarios/plans/exercises (rest T35)
P3-09 Cross-module dashboard and adversarial suite
```

## 8. Definition of done

A synthetic site can confirm a structural process profile, assess and approve aspects using a reproducible method, manage controls and providers, record/review monitoring and calibration, issue communications, and exercise a versioned emergency plan. Historic outcomes remain reproducible and tenant-isolated.

## 9. Minimal Claude context

| Task | Provide |
|---|---|
| T30 | §§1–2 process only, EMS scope/Entity/Site models, seed template names |
| T31 | aspect models + existing LCA lifecycle enums only as reference, not reuse mandate |
| T32 | significance model/engine contract/tests; existing pure LCA engine pattern |
| T33 | operational-control models, controlled-document interface, notifications |
| T34 | monitoring/calibration models, Decimal helper patterns, evidence/reminders |
| T35 | provider/communication/emergency sections and action-link interface |

