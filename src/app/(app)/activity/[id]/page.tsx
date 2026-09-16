import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { formatKgCO2e } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Surface } from "@/components/ui/primitives";
import {
  BLOCKER_MESSAGE,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  SCOPE_LABEL,
  describeMutability,
  getActivityRecord,
  type ActivityRecordDetail,
} from "@/lib/carbon/activity-register-service";
import { deleteActivityEntryAction, updateActivityNotesAction, type ActivityActionErrorCode } from "../actions";

/**
 * One activity record, in full: what was entered, the figure it produced, the
 * factor behind that figure, and — stated plainly — whether it can still be
 * changed and why not.
 *
 * The buttons here are drawn from the same `describeMutability` the server
 * actions re-check, so the page never offers an action the server is going to
 * refuse. Button visibility is a courtesy, not the boundary: the Phase 4-ii
 * SQL barrier and the reference checks run inside the write transaction.
 */

const ERROR_MESSAGE: Record<ActivityActionErrorCode, string> = {
  closed: "This reporting period is closed. Reopen the period before changing accounting data.",
  protected:
    "This record is referenced by calculations, reporting or history, so it cannot be deleted. Nothing was changed.",
  denied: "You do not have permission to do that. Ask an administrator for the relevant carbon grant.",
  missing: "That activity record no longer exists, or is not one you can work on. Nothing was changed.",
  invalid: "That request was incomplete, so nothing was changed. Deleting a record needs its confirmation.",
};

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function dateTimeLabel(date: Date): string {
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">
        {value ?? <span className="italic text-slate-400">not recorded</span>}
      </dd>
    </div>
  );
}

const TIER_LABEL: Record<string, string> = {
  TIER_1: "Tier 1 — metered or invoiced",
  TIER_2: "Tier 2 — estimated from related data",
  TIER_3: "Tier 3 — proxy or industry average",
};

const ORIGIN_LABEL: Record<string, string> = {
  USER_ENTERED: "Entered by hand",
  IMPORTED: "Imported from a file",
  AI_EXTRACTED: "Accepted from an AI extraction",
  DERIVED: "Derived by the platform",
};

export default async function ActivityRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; confirm?: string }>;
}) {
  let context;
  try {
    context = await requireOrganisationContext();
    requireCarbonView(context);
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const { id } = await params;
  const query = await searchParams;
  const record = await getActivityRecord(context, id);
  if (!record) notFound();

  const mutability = describeMutability(context, record.periodState, record.references);
  const errorCode = query.error && query.error in ERROR_MESSAGE ? (query.error as ActivityActionErrorCode) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/activity" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        Activity Data Register
      </Link>

      <PageHeader
        eyebrow={`${record.code} · ${SCOPE_LABEL[record.scope]}`}
        title={record.dataPointName}
        description={`${record.entityName} — ${record.siteName} · ${dateLabel(record.periodStart)} to ${dateLabel(record.periodEnd)}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <Badge tone={ENTRY_STATUS_TONE[record.status]}>{ENTRY_STATUS_LABEL[record.status]}</Badge>
            {record.periodState === "CLOSED" && <Badge tone="neutral">Closed period · read-only</Badge>}
          </span>
        }
      />

      {errorCode && (
        <div className="bd-empty" role="alert">
          <h3>That change was not saved</h3>
          <p>{ERROR_MESSAGE[errorCode]}</p>
        </div>
      )}
      {query.saved === "notes" && (
        <div className="bd-empty" role="status">
          <h3>Notes saved</h3>
          <p>The figure and its calculation are unchanged — only the note on this record was updated.</p>
        </div>
      )}

      <Surface title="Activity">
        <dl>
          <Row label="Activity date" value={`${dateLabel(record.periodStart)} to ${dateLabel(record.periodEnd)}`} />
          <Row label="Source" value={`${record.code} — ${record.dataPointName}`} />
          <Row label="Category" value={record.category} />
          <Row label="Scope" value={SCOPE_LABEL[record.scope]} />
          {record.scope3Category && <Row label="Scope 3 category" value={record.scope3Category} />}
          {record.optionLabel && <Row label="Type" value={record.optionLabel} />}
          <Row label="Organisation" value={record.organisationName} />
          <Row label="Site" value={`${record.entityName} — ${record.siteName}`} />
          <Row
            label="Quantity entered"
            value={`${record.rawValue.toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${record.rawUnit}`}
          />
          <Row
            label="Canonical quantity"
            value={`${record.canonicalValue.toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${record.canonicalUnit}`}
          />
          {record.supplierName && <Row label="Supplier" value={record.supplierName} />}
          <Row label="Data quality" value={TIER_LABEL[record.dataQualityTier] ?? record.dataQualityTier} />
          <Row label="How it arrived" value={ORIGIN_LABEL[record.dataOrigin] ?? record.dataOrigin} />
          <Row label="Reporting period" value={`${record.periodState === "CLOSED" ? "Closed" : "Open"} for accounting changes`} />
        </dl>
        {record.plausibilityFlagged && (
          <p className="mt-3 rounded-md bg-[#fbe9e9] px-3 py-2 text-sm text-[#9f3030]">
            Flagged when it was saved: {record.plausibilityReason ?? "the figure looked unusual against the previous period."}
          </p>
        )}
      </Surface>

      <Surface
        title="Emissions"
        subtitle={
          record.calculations.length === 0
            ? undefined
            : `${record.calculations.length === 1 ? "One figure" : `${record.calculations.length} figures`} produced from this activity.`
        }
      >
        {record.calculations.length === 0 ? (
          <p className="bd-muted text-sm">
            {record.status === "AWAITING_FACTOR"
              ? "No emissions figure yet — this activity is waiting on an emission factor for its category. The record is complete; it produces a figure as soon as a matching factor is imported."
              : "No emissions figure has been produced from this activity yet."}
          </p>
        ) : (
          <div className="space-y-4">
            {record.calculations.map((calc) => (
              <div key={calc.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{formatKgCO2e(calc.resultKgCo2e, { unit: true })}</span>
                  <Badge tone="info">{calc.basis.replace(/_/g, " ").toLowerCase()}</Badge>
                </div>
                <dl className="mt-2">
                  {/* factorUnit is the unit the factor is expressed *per*, so it is
                      only meaningful as a rate — "1 kWh" reads as a quantity and
                      contradicts the calculation page one click away. */}
                  <Row label="Factor applied" value={`${calc.factorValue} kgCO₂e/${calc.factorUnit}`} />
                  <Row label="Factor source" value={calc.factorSource} />
                  <Row label="Factor vintage" value={calc.factorVintage} />
                  <Row label="Calculated" value={dateTimeLabel(calc.calculatedAt)} />
                </dl>
                <Link
                  href={`/calculations/${calc.id}`}
                  className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline"
                >
                  How was this calculated?
                </Link>
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Evidence and provenance">
        <dl>
          <Row label="Entered by" value={record.enteredByName} />
          <Row label="Entered" value={dateTimeLabel(record.enteredAt)} />
          <Row label="Last updated" value={dateTimeLabel(record.updatedAt)} />
          <Row
            label="Supporting document"
            value={
              record.sourceDocumentId ? (
                <Link href={`/documents/${record.sourceDocumentId}`} className="text-blue-700 hover:underline">
                  {record.sourceDocumentName ?? "View document"}
                </Link>
              ) : null
            }
          />
        </dl>
      </Surface>

      <NotesPanel record={record} canEdit={mutability.canEditNotes} blockers={mutability.editBlockers} />

      <DeletePanel record={record} mutability={mutability} confirming={query.confirm === "1"} />
    </div>
  );
}

/**
 * The only editable field on an activity record. Quantity, unit and factor are
 * deliberately absent: changing a figure reports have already used is a
 * restatement, which this register does not do.
 */
function NotesPanel({
  record,
  canEdit,
  blockers,
}: {
  record: ActivityRecordDetail;
  canEdit: boolean;
  blockers: ReturnType<typeof describeMutability>["editBlockers"];
}) {
  return (
    <Surface title="Notes">
      {canEdit ? (
        <form action={updateActivityNotesAction} className="space-y-3">
          <input type="hidden" name="entryId" value={record.id} />
          <input type="hidden" name="back" value={`/activity/${record.id}`} />
          <Textarea
            name="notes"
            rows={3}
            defaultValue={record.notes ?? ""}
            placeholder="Add context for whoever reviews this record — what the figure covers, or where it came from."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save notes</Button>
            <span className="text-xs text-[var(--bd-muted)]">
              Notes are annotation only. The quantity, unit and factor of a saved activity cannot be edited — correcting
              a figure that has already been reported is a restatement, which this register does not perform.
            </span>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-slate-900">
            {record.notes ?? <span className="italic text-slate-400">No notes recorded.</span>}
          </p>
          <p className="mt-3 text-sm text-[var(--bd-muted)]">{blockers.map((b) => BLOCKER_MESSAGE[b]).join(" ")}</p>
        </>
      )}
    </Surface>
  );
}

/**
 * Deletion is offered only where the record genuinely carries no accounting
 * history. Everywhere else the record is preserved and the specific reason is
 * named — a reader should never have to guess which dependency protected it.
 */
function DeletePanel({
  record,
  mutability,
  confirming,
}: {
  record: ActivityRecordDetail;
  mutability: ReturnType<typeof describeMutability>;
  confirming: boolean;
}) {
  if (!mutability.canDelete) {
    return (
      <Surface title="Deleting this record">
        <p className="text-sm text-slate-900">This activity record is protected and cannot be deleted.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--bd-muted)]">
          {mutability.deleteBlockers.map((blocker) => (
            <li key={blocker}>{BLOCKER_MESSAGE[blocker]}</li>
          ))}
        </ul>
        {record.references.reportSnapshots > 0 && (
          <p className="mt-2 text-sm text-[var(--bd-muted)]">
            Its figures appear in {record.references.reportSnapshots}{" "}
            {record.references.reportSnapshots === 1 ? "issued report" : "issued reports"}.
          </p>
        )}
        {record.references.lcaLinks > 0 && (
          <p className="mt-2 text-sm text-[var(--bd-muted)]">
            {record.references.lcaLinks === 1 ? "A product assessment cites" : `${record.references.lcaLinks} product assessments cite`}{" "}
            this record as a source.
          </p>
        )}
      </Surface>
    );
  }

  // Naming the record is the confirmation. A second, deliberate step rather
  // than a browser dialog, so the reader sees exactly which activity, which
  // quantity and which month they are about to destroy — and so the flow
  // works identically without client-side JavaScript.
  const description = `${record.code} ${record.dataPointName} — ${record.rawValue.toLocaleString("en-GB")} ${record.rawUnit} at ${record.siteName} for ${dateLabel(record.periodStart)}`;

  if (!confirming) {
    return (
      <Surface title="Deleting this record">
        <p className="text-sm text-slate-900">
          This record has produced no emissions figure and nothing else refers to it, so it can be removed safely.
        </p>
        <Link href={`/activity/${record.id}?confirm=1`} className="mt-3 inline-block">
          <Button type="button" variant="secondary">
            Delete this activity record
          </Button>
        </Link>
      </Surface>
    );
  }

  return (
    <Surface title="Delete this activity record?">
      <form action={deleteActivityEntryAction} className="space-y-3">
        <input type="hidden" name="entryId" value={record.id} />
        <input type="hidden" name="back" value="/activity" />
        <input type="hidden" name="confirm" value="DELETE" />
        <p className="text-sm font-medium text-slate-900">{description}</p>
        <p className="text-sm text-[var(--bd-muted)]">
          Deletion is permanent and cannot be undone. The activity row is destroyed; the audit trail keeps the record
          that it happened, and what it held.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="danger">
            Yes, delete this record permanently
          </Button>
          <Link href={`/activity/${record.id}`} className="text-sm font-medium text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </Surface>
  );
}
