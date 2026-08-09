"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice, SectionCard } from "@/components/lca/ui";
import { BOUNDARY_LABELS, LIFECYCLE_STAGE_ORDER, STAGE_DESCRIPTIONS, STAGE_LABELS } from "@/lib/lca/labels";
import { emptyAssessmentState } from "@/lib/lca/form-state";
import { saveGoalScopeAction } from "../../actions";

export interface GoalScopeFormProps {
  assessment: {
    id: string;
    title: string;
    goal: string | null;
    intendedApplication: string | null;
    intendedAudience: string | null;
    comparativeAssertionDisclosed: boolean;
    scopeDescription: string | null;
    boundary: string;
    boundaryNotes: string | null;
    includedStages: string[];
    periodStart: string | null;
    periodEnd: string | null;
    ownerUserId: string | null;
    methodologyProfileId: string | null;
    methodologyNotes: string | null;
    functionalUnitDescription: string | null;
    functionalUnitQuantity: string;
    functionalUnitUnit: string | null;
    isDeclaredUnit: boolean;
    declaredUnitDescription: string | null;
    referenceFlowDescription: string | null;
    referenceFlowQuantity: string;
    referenceFlowUnit: string | null;
    modelledOutputQuantity: string;
    modelledOutputUnit: string | null;
    modelledOutputDescription: string | null;
    usePhaseLifetimeYears: string | null;
    usePhaseAssumptions: string | null;
    completenessNotes: string | null;
    limitations: string | null;
    interpretation: string | null;
  };
  users: { id: string; name: string }[];
  methodologies: { id: string; label: string }[];
  readOnly: boolean;
  readOnlyReason: string | null;
}

export function GoalScopeForm({ assessment, users, methodologies, readOnly, readOnlyReason }: GoalScopeFormProps) {
  const [state, formAction, pending] = useActionState(saveGoalScopeAction, emptyAssessmentState);
  const [isDeclaredUnit, setIsDeclaredUnit] = useState(assessment.isDeclaredUnit);
  const [stages, setStages] = useState<string[]>(assessment.includedStages);

  const toggleStage = (stage: string) => {
    setStages((current) => (current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage]));
  };

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="assessmentId" value={assessment.id} />
      {stages.map((stage) => (
        <input key={stage} type="hidden" name="includedStages" value={stage} />
      ))}

      {readOnly && <Notice tone="info" title="Read-only">{readOnlyReason}</Notice>}
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <SectionCard
        title="Goal"
        description="Why the assessment exists and what it will be used for. A reviewer reads this before anything else, because it decides whether the data and boundary are fit for purpose."
      >
        <div className="grid gap-4">
          <div>
            <Label htmlFor="title">Assessment title</Label>
            <Input id="title" name="title" required defaultValue={assessment.title} disabled={readOnly} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="goal">Goal of the assessment</Label>
            <Textarea
              id="goal"
              name="goal"
              rows={3}
              defaultValue={assessment.goal ?? ""}
              disabled={readOnly}
              className="mt-1"
              placeholder="e.g. Establish the cradle-to-gate footprint of this product to answer customer questionnaires and identify the largest reduction opportunities."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="intendedApplication">Intended application</Label>
              <Textarea
                id="intendedApplication"
                name="intendedApplication"
                rows={2}
                defaultValue={assessment.intendedApplication ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
              <Hint>What decisions or claims this result will support.</Hint>
            </div>
            <div>
              <Label htmlFor="intendedAudience">Intended audience</Label>
              <Textarea
                id="intendedAudience"
                name="intendedAudience"
                rows={2}
                defaultValue={assessment.intendedAudience ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
              <Hint>Who will read it — internal teams, customers, or the public.</Hint>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="comparativeAssertionDisclosed"
              defaultChecked={assessment.comparativeAssertionDisclosed}
              disabled={readOnly}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              This assessment supports a comparative claim disclosed outside the organisation.
              <Hint>
                A public comparison against another product is a much higher bar. Ticking this makes the review centre ask
                for independent review before the assessment is treated as ready.
              </Hint>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ownerUserId">Assessment owner</Label>
              <Select id="ownerUserId" name="ownerUserId" defaultValue={assessment.ownerUserId ?? ""} disabled={readOnly} className="mt-1">
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="methodologyProfileId">Methodology profile</Label>
              <Select
                id="methodologyProfileId"
                name="methodologyProfileId"
                defaultValue={assessment.methodologyProfileId ?? ""}
                disabled={readOnly}
                className="mt-1"
              >
                <option value="">None selected</option>
                {methodologies.map((methodology) => (
                  <option key={methodology.id} value={methodology.id}>
                    {methodology.label}
                  </option>
                ))}
              </Select>
              <Hint>The engine reads this profile directly — it sets allocation, recycling, electricity, biogenic and offset treatment.</Hint>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Scope and boundary"
        description="What is inside the system being modelled, and what is deliberately outside it."
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="boundary">Lifecycle boundary</Label>
              <Select id="boundary" name="boundary" defaultValue={assessment.boundary} disabled={readOnly} className="mt-1">
                {Object.entries(BOUNDARY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="boundaryNotes">Boundary notes</Label>
              <Input
                id="boundaryNotes"
                name="boundaryNotes"
                defaultValue={assessment.boundaryNotes ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
              <Hint>Required if the boundary is custom: say exactly what is in and what is out.</Hint>
            </div>
          </div>

          <div>
            <Label>Lifecycle stages in scope</Label>
            <Hint>
              A stage ticked here but not modelled shows up as a gap in the review centre. A stage that genuinely does not
              apply belongs in the exclusions register with a reason, not simply unticked and forgotten.
            </Hint>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {LIFECYCLE_STAGE_ORDER.map((stage) => (
                <label
                  key={stage}
                  className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50"
                >
                  <input
                    type="checkbox"
                    checked={stages.includes(stage)}
                    onChange={() => toggleStage(stage)}
                    disabled={readOnly}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="font-medium text-slate-800">{STAGE_LABELS[stage]}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{STAGE_DESCRIPTIONS[stage]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="scopeDescription">Scope description</Label>
            <Textarea
              id="scopeDescription"
              name="scopeDescription"
              rows={3}
              defaultValue={assessment.scopeDescription ?? ""}
              disabled={readOnly}
              className="mt-1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="periodStart">Assessment period — start</Label>
              <Input
                id="periodStart"
                name="periodStart"
                type="date"
                defaultValue={assessment.periodStart ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="periodEnd">Assessment period — end</Label>
              <Input
                id="periodEnd"
                name="periodEnd"
                type="date"
                defaultValue={assessment.periodEnd ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
              <Hint>Which production period the activity data represents. Factor vintages are checked against it.</Hint>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Functional unit and reference flow"
        description="Every result is expressed per functional unit. Get this wrong and the arithmetic is still right but the answer means nothing."
      >
        <div className="grid gap-4">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="isDeclaredUnit"
              checked={isDeclaredUnit}
              onChange={(e) => setIsDeclaredUnit(e.target.checked)}
              disabled={readOnly}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Report against a declared unit rather than a functional unit.
              <Hint>
                A cradle-to-gate assessment stops before the product does its job, so there is no function to measure
                against yet. A declared unit says &quot;this much product, to this point&quot; and makes no claim about
                service delivered.
              </Hint>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label htmlFor="functionalUnitDescription">
                {isDeclaredUnit ? "Declared unit description" : "Functional unit description"}
              </Label>
              <Input
                id="functionalUnitDescription"
                name="functionalUnitDescription"
                defaultValue={assessment.functionalUnitDescription ?? ""}
                disabled={readOnly}
                className="mt-1"
                placeholder={isDeclaredUnit ? "1 kg of finished product at the factory gate" : "1 tag, providing identification over a 5-year service life"}
              />
            </div>
            <div>
              <Label htmlFor="functionalUnitQuantity">Quantity</Label>
              <Input
                id="functionalUnitQuantity"
                name="functionalUnitQuantity"
                defaultValue={assessment.functionalUnitQuantity}
                disabled={readOnly}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="functionalUnitUnit">Unit</Label>
              <Input
                id="functionalUnitUnit"
                name="functionalUnitUnit"
                defaultValue={assessment.functionalUnitUnit ?? ""}
                disabled={readOnly}
                className="mt-1"
                placeholder="item"
              />
            </div>
            {isDeclaredUnit && (
              <div>
                <Label htmlFor="declaredUnitDescription">Declared unit note</Label>
                <Input
                  id="declaredUnitDescription"
                  name="declaredUnitDescription"
                  defaultValue={assessment.declaredUnitDescription ?? ""}
                  disabled={readOnly}
                  className="mt-1"
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label htmlFor="referenceFlowDescription">Reference flow</Label>
              <Input
                id="referenceFlowDescription"
                name="referenceFlowDescription"
                defaultValue={assessment.referenceFlowDescription ?? ""}
                disabled={readOnly}
                className="mt-1"
                placeholder="1 tag, including a 5% allowance for units that fail final test"
              />
              <Hint>How much product is needed to deliver one functional unit. Usually one, but not always.</Hint>
            </div>
            <div>
              <Label htmlFor="referenceFlowQuantity">Quantity per functional unit</Label>
              <Input
                id="referenceFlowQuantity"
                name="referenceFlowQuantity"
                defaultValue={assessment.referenceFlowQuantity}
                disabled={readOnly}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="referenceFlowUnit">Unit</Label>
              <Input
                id="referenceFlowUnit"
                name="referenceFlowUnit"
                defaultValue={assessment.referenceFlowUnit ?? ""}
                disabled={readOnly}
                className="mt-1"
                placeholder="item"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Label htmlFor="modelledOutputQuantity">What the entered inventory represents</Label>
            <Hint>
              The quantities on the inventory are for this much output. A model built on one batch of 500 units contains
              500 functional units, so a 1,000 kgCO2e model total becomes 2 kgCO2e per unit. This is the divisor the
              engine uses.
            </Hint>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="modelledOutputQuantity" className="text-xs">
                  Quantity
                </Label>
                <Input
                  id="modelledOutputQuantity"
                  name="modelledOutputQuantity"
                  defaultValue={assessment.modelledOutputQuantity}
                  disabled={readOnly}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="modelledOutputUnit" className="text-xs">
                  Unit
                </Label>
                <Input
                  id="modelledOutputUnit"
                  name="modelledOutputUnit"
                  defaultValue={assessment.modelledOutputUnit ?? ""}
                  disabled={readOnly}
                  className="mt-1"
                  placeholder="item"
                />
              </div>
              <div>
                <Label htmlFor="modelledOutputDescription" className="text-xs">
                  Description
                </Label>
                <Input
                  id="modelledOutputDescription"
                  name="modelledOutputDescription"
                  defaultValue={assessment.modelledOutputDescription ?? ""}
                  disabled={readOnly}
                  className="mt-1"
                  placeholder="One production batch"
                />
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Use phase and interpretation" description="Context the report needs and a reviewer will ask for.">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="usePhaseLifetimeYears">Assumed product lifetime (years)</Label>
              <Input
                id="usePhaseLifetimeYears"
                name="usePhaseLifetimeYears"
                defaultValue={assessment.usePhaseLifetimeYears ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="usePhaseAssumptions">Use-phase assumptions</Label>
              <Input
                id="usePhaseAssumptions"
                name="usePhaseAssumptions"
                defaultValue={assessment.usePhaseAssumptions ?? ""}
                disabled={readOnly}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="methodologyNotes">Methodology notes for this assessment</Label>
            <Textarea
              id="methodologyNotes"
              name="methodologyNotes"
              rows={2}
              defaultValue={assessment.methodologyNotes ?? ""}
              disabled={readOnly}
              className="mt-1"
            />
            <Hint>Anything specific to this assessment that departs from, or adds to, the methodology profile.</Hint>
          </div>
          <div>
            <Label htmlFor="completenessNotes">Completeness notes</Label>
            <Textarea
              id="completenessNotes"
              name="completenessNotes"
              rows={2}
              defaultValue={assessment.completenessNotes ?? ""}
              disabled={readOnly}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="limitations">Limitations</Label>
            <Textarea
              id="limitations"
              name="limitations"
              rows={3}
              defaultValue={assessment.limitations ?? ""}
              disabled={readOnly}
              className="mt-1"
            />
            <Hint>The report generates limitations from the data as well; anything you add here appears alongside them.</Hint>
          </div>
          <div>
            <Label htmlFor="interpretation">Interpretation and conclusions</Label>
            <Textarea
              id="interpretation"
              name="interpretation"
              rows={4}
              defaultValue={assessment.interpretation ?? ""}
              disabled={readOnly}
              className="mt-1"
            />
          </div>
        </div>
      </SectionCard>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save goal and scope"}
          </Button>
          <span className="text-sm text-slate-500">Changing any of this makes the stored results out of date until you recalculate.</span>
        </div>
      )}
    </form>
  );
}
