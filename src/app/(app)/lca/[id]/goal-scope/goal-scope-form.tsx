"use client";

import { useActionState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { saveGoalScopeAction, type GoalScopeState } from "../../actions";
import { ALLOCATION_METHOD_LABELS, BOUNDARY_TYPE_LABELS, REVIEW_STATUS_LABELS } from "@/lib/lca/stages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: GoalScopeState = { error: null, saved: false };

export interface GoalScopeValues {
  purpose: string;
  intendedApplication: string;
  intendedAudience: string;
  comparativeAssertion: boolean;
  functionalUnitDescription: string;
  functionalUnitQuantity: string;
  functionalUnitUnit: string;
  referenceFlowDescription: string;
  referenceFlowQuantity: string;
  referenceFlowUnit: string;
  systemBoundaryType: string;
  systemBoundaryNotes: string;
  geography: string;
  timePeriodStart: string;
  timePeriodEnd: string;
  technologyDescription: string;
  cutOffCriteria: string;
  exclusions: string;
  allocationMethod: string;
  allocationRationale: string;
  impactCategories: string;
  dataQualityRequirements: string;
  limitations: string;
  criticalReviewStatus: string;
  criticalReviewNotes: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** A labelled question with the "why this matters" note the wizard exists to give. */
function Question({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <p className="mt-0.5 text-xs text-slate-500">{help}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TextArea({ id, name, rows = 3, defaultValue, placeholder }: { id: string; name: string; rows?: number; defaultValue?: string; placeholder?: string }) {
  return (
    <textarea
      id={id}
      name={name}
      rows={rows}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
    />
  );
}

export function GoalScopeForm({ projectId, values }: { projectId: string; values: GoalScopeValues }) {
  const [state, formAction, pending] = useActionState(saveGoalScopeAction, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="projectId" value={projectId} />

      <Card>
        <CardHeader>
          <CardTitle>1. Goal of the study</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Question
            id="purpose"
            label="What is the purpose of this study?"
            help="Why it is being carried out — internal improvement, customer reporting, a product carbon footprint, comparison, EPD preparation, procurement. The goal shapes every later choice, so it is recorded first."
          >
            <TextArea id="purpose" name="purpose" defaultValue={values.purpose} />
          </Question>

          <Question
            id="intendedApplication"
            label="How will the results be applied?"
            help="What decisions this study will feed into. Results used to make a public claim carry heavier requirements than results used to guide an internal design choice."
          >
            <TextArea id="intendedApplication" name="intendedApplication" rows={2} defaultValue={values.intendedApplication} />
          </Question>

          <Question
            id="intendedAudience"
            label="Who is the intended audience?"
            help="Internal engineering, a specific customer, a certification body, the public. This governs how the results have to be presented and reviewed."
          >
            <Input id="intendedAudience" name="intendedAudience" defaultValue={values.intendedAudience} />
          </Question>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              name="comparativeAssertion"
              defaultChecked={values.comparativeAssertion}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                Results are intended to support a comparative assertion disclosed to the public
              </span>
              <span className="mt-0.5 block text-sm text-slate-500">
                Under ISO 14044 this brings additional requirements, including critical review by an interested-party
                panel. This platform records that intent and the review status; it does not carry out the review.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Functional unit and reference flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Question
            id="functionalUnitDescription"
            label="What is the functional unit?"
            help="The quantified performance the study is measured against — what the product does, how much of it, for how long. It has to be measurable, or nothing can be compared with it. For example: 'protecting and identifying one retail garment for a two-year service life'."
          >
            <TextArea id="functionalUnitDescription" name="functionalUnitDescription" rows={2} defaultValue={values.functionalUnitDescription} />
          </Question>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="functionalUnitQuantity">Functional unit quantity</Label>
              <Input id="functionalUnitQuantity" name="functionalUnitQuantity" type="number" step="any" defaultValue={values.functionalUnitQuantity} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="functionalUnitUnit">Functional unit</Label>
              <Input id="functionalUnitUnit" name="functionalUnitUnit" placeholder="e.g. inlay, garment-year" defaultValue={values.functionalUnitUnit} className="mt-1" />
            </div>
          </div>

          <Question
            id="referenceFlowDescription"
            label="What is the reference flow?"
            help="How much physical product is needed to deliver one functional unit. This is what the inventory quantities are anchored to."
          >
            <TextArea id="referenceFlowDescription" name="referenceFlowDescription" rows={2} defaultValue={values.referenceFlowDescription} />
          </Question>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="referenceFlowQuantity">Reference flow quantity</Label>
              <Input id="referenceFlowQuantity" name="referenceFlowQuantity" type="number" step="any" defaultValue={values.referenceFlowQuantity} className="mt-1" />
              <p className="mt-1 text-xs text-slate-400">
                Inventory flows recorded per production batch rather than per functional unit are divided by this
                figure. Without it, those flows can&apos;t be calculated at all — they are reported as gaps, never as zero.
              </p>
            </div>
            <div>
              <Label htmlFor="referenceFlowUnit">Reference flow unit</Label>
              <Input id="referenceFlowUnit" name="referenceFlowUnit" placeholder="e.g. inlays" defaultValue={values.referenceFlowUnit} className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Scope of the system</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Question
            id="systemBoundaryType"
            label="What stages does the system boundary cover?"
            help="Cradle-to-gate stops when the product leaves your gate. Cradle-to-grave carries through use and end-of-life. Changing this re-syncs which stages are marked in or out of the boundary; stages already carrying data are never deleted."
          >
            <Select id="systemBoundaryType" name="systemBoundaryType" defaultValue={values.systemBoundaryType || "CRADLE_TO_GATE"}>
              {Object.entries(BOUNDARY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Question>

          <Question id="systemBoundaryNotes" label="Notes on the boundary" help="Anything about the boundary a reader would otherwise have to infer.">
            <TextArea id="systemBoundaryNotes" name="systemBoundaryNotes" rows={2} defaultValue={values.systemBoundaryNotes} />
          </Question>

          <Question
            id="geography"
            label="What geographic boundary applies?"
            help="Where the production and supply chain modelled here actually sit. Emission factors are region-specific — a UK grid factor applied to production in another country is a real error, not a rounding one."
          >
            <Input id="geography" name="geography" placeholder="e.g. United Kingdom, with components from EU suppliers" defaultValue={values.geography} />
          </Question>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="timePeriodStart">Time period from</Label>
              <Input id="timePeriodStart" name="timePeriodStart" type="date" defaultValue={values.timePeriodStart} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="timePeriodEnd">Time period to</Label>
              <Input id="timePeriodEnd" name="timePeriodEnd" type="date" defaultValue={values.timePeriodEnd} className="mt-1" />
            </div>
          </div>

          <Question
            id="technologyDescription"
            label="What technology does the system represent?"
            help="The production route actually modelled — a specific line, an industry average, a best-available technique. Two studies of the same product with different technology assumptions are not comparable."
          >
            <TextArea id="technologyDescription" name="technologyDescription" rows={2} defaultValue={values.technologyDescription} />
          </Question>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Cut-off, exclusions and allocation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Question
            id="cutOffCriteria"
            label="What cut-off criteria apply?"
            help="The rule for leaving something out — by mass, energy or environmental significance. State the rule, not just the outcome, so a reviewer can apply it themselves."
          >
            <TextArea id="cutOffCriteria" name="cutOffCriteria" rows={2} defaultValue={values.cutOffCriteria} />
          </Question>

          <Question id="exclusions" label="What has been excluded, and why?" help="Anything deliberately left out. An exclusion recorded here is a methodological choice; one that isn't is a gap.">
            <TextArea id="exclusions" name="exclusions" rows={2} defaultValue={values.exclusions} />
          </Question>

          <Question
            id="allocationMethod"
            label="What allocation approach is used?"
            help="Where a process makes more than one product, how its burden is split. ISO 14044 prefers avoiding allocation by subdivision or system expansion before falling back to a physical or economic split."
          >
            <Select id="allocationMethod" name="allocationMethod" defaultValue={values.allocationMethod || "NOT_APPLICABLE"}>
              {Object.entries(ALLOCATION_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Question>

          <Question id="allocationRationale" label="Why that allocation approach?" help="Required whenever allocation is used at all.">
            <TextArea id="allocationRationale" name="allocationRationale" rows={2} defaultValue={values.allocationRationale} />
          </Question>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5. Impact assessment, data quality and review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Question
            id="impactCategories"
            label="Which impact categories are required?"
            help="One per line. This platform calculates climate change (GWP100, kgCO2e) only — it holds carbon emission factors, not full characterisation factors for other categories. Listing another category records the requirement; it does not make the platform compute it."
          >
            <TextArea id="impactCategories" name="impactCategories" rows={3} defaultValue={values.impactCategories} />
          </Question>

          <Question
            id="dataQualityRequirements"
            label="What data quality is required?"
            help="How recent, how geographically and technologically representative, and how much must be primary. Recording the requirement is what makes the later assessment mean something."
          >
            <TextArea id="dataQualityRequirements" name="dataQualityRequirements" rows={2} defaultValue={values.dataQualityRequirements} />
          </Question>

          <Question id="limitations" label="What are the study's limitations?" help="What the results can't be used for. Stated up front, not discovered by a reader later.">
            <TextArea id="limitations" name="limitations" rows={2} defaultValue={values.limitations} />
          </Question>

          <Question
            id="criticalReviewStatus"
            label="Critical review status"
            help="This platform records the status; it does not perform, commission or evidence a review. Leave it as 'no critical review' unless a review has genuinely taken place."
          >
            <Select id="criticalReviewStatus" name="criticalReviewStatus" defaultValue={values.criticalReviewStatus || "NOT_REVIEWED"}>
              {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Question>

          <Question id="criticalReviewNotes" label="Review notes" help="Who reviewed it, when, and what they concluded.">
            <TextArea id="criticalReviewNotes" name="criticalReviewNotes" rows={2} defaultValue={values.criticalReviewNotes} />
          </Question>
        </CardContent>
      </Card>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.saved && <p className="text-sm text-emerald-700">Saved.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <Button type="submit" name="confirm" value="1" disabled={pending}>
          <CheckCircle2 className="h-4 w-4" />
          Save and confirm these methodological choices
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        Confirming records you as the person who made these choices, and when. The platform never picks a
        methodological answer on your behalf, and the AI copilot can explain any of these concepts or help you word an
        answer, but it can&apos;t fill one in.
        {values.confirmedAt && (
          <>
            {" "}
            Last confirmed by {values.confirmedBy ?? "someone"} on{" "}
            {new Date(values.confirmedAt).toLocaleString("en-GB")}.
          </>
        )}
      </p>
    </form>
  );
}
