"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/components/ui/primitives";
import type { ReportingPeriodTransitionView, ReportingPeriodView } from "@/lib/carbon/reporting-period-view";

/**
 * Phase 4-iii close/reopen surface. It renders what the Phase 4-ii service
 * reports and posts back to that same service — it holds no rule of its own,
 * and never assumes the state it was rendered with is still true. A period
 * closed by somebody else between this render and the submit is refused by
 * the server, and the page comes back showing the state that actually holds.
 */
export interface PeriodScope {
  from: string;
  to: string;
  siteId?: string;
  scope?: string;
  status?: string;
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
};

function formatMoment(at: Date): string {
  return `${new Date(at).toLocaleString("en-GB", DATE_TIME)} UTC`;
}

export function ReportingPeriodPanel({
  view,
  siteLabel,
  scope,
  action,
  done,
}: {
  view: ReportingPeriodView;
  siteLabel: string;
  scope: PeriodScope;
  action: (formData: FormData) => void | Promise<void>;
  done: "OPEN" | "CLOSED" | null;
}) {
  const closed = view.state === "CLOSED";
  return (
    <Surface
      title="Reporting period"
      subtitle={`${siteLabel} — ${view.monthLabel}`}
      actions={<Badge tone={closed ? "danger" : "success"}>{closed ? "Closed" : "Open"}</Badge>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-slate-700">
              {closed
                ? "Activity data and accounting calculations for this month cannot be changed while the period is closed. Reports, stored figures, evidence and methodology stay readable."
                : "Activity data and accounting calculations for this month can still be changed. Close the period once the month is final."}
            </p>
            {closed && <CurrentState transition={view.current} />}
          </div>
          {view.canTransition ? (
            <TransitionControl view={view} siteLabel={siteLabel} scope={scope} action={action} />
          ) : (
            <p className="max-w-xs text-xs text-[var(--bd-muted)]">
              You can see whether this month is open or closed, but not change it — that needs the carbon approval
              permission.
            </p>
          )}
        </div>

        {done && (
          <p className="rounded-md bg-[#e4f2ec] px-3 py-2 text-sm text-[#225b44]" role="status">
            {done === "CLOSED"
              ? `${view.monthLabel} is now closed for ${siteLabel}. Accounting changes are blocked until it is reopened.`
              : `${view.monthLabel} is open again for ${siteLabel}. Accounting changes are allowed and still audited.`}
          </p>
        )}

        <form method="get" className="flex flex-wrap items-end gap-3 border-t border-[var(--bd-line)] pt-4">
          <input type="hidden" name="siteId" value={view.siteId} />
          <input type="hidden" name="from" value={scope.from} />
          <input type="hidden" name="to" value={scope.to} />
          {scope.scope && <input type="hidden" name="scope" value={scope.scope} />}
          {scope.status && <input type="hidden" name="status" value={scope.status} />}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--bd-muted)]">
              Month to review
            </span>
            <Input type="month" name="periodMonth" defaultValue={view.monthInput} className="max-w-[12rem]" />
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>

        {view.history.length > 0 && <History history={view.history} />}
      </div>
    </Surface>
  );
}

function CurrentState({ transition }: { transition: ReportingPeriodTransitionView | null }) {
  if (!transition) return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--bd-muted)]">
      <div>
        <dt className="inline font-semibold">Closed by </dt>
        <dd className="inline">{transition.actorName ?? "a member who is no longer listed"}</dd>
      </div>
      <div>
        <dt className="inline font-semibold">Closed at </dt>
        <dd className="inline">{formatMoment(transition.at)}</dd>
      </div>
      {transition.reason && (
        <div>
          <dt className="inline font-semibold">Reason </dt>
          <dd className="inline">{transition.reason}</dd>
        </div>
      )}
    </dl>
  );
}

function History({ history }: { history: ReportingPeriodTransitionView[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none text-slate-600">
        Close and reopen history ({history.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {history.map((entry, index) => (
          <li key={`${new Date(entry.at).toISOString()}-${index}`} className="border-l-2 border-slate-200 pl-3">
            <div className="text-xs font-semibold text-slate-700">
              {entry.state === "CLOSED" ? "Closed" : "Reopened"} — {formatMoment(entry.at)}
            </div>
            <div className="text-xs text-[var(--bd-muted)]">
              by {entry.actorName ?? "a member who is no longer listed"}
              {entry.reason ? ` · ${entry.reason}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TransitionControl({
  view,
  siteLabel,
  scope,
  action,
}: {
  view: ReportingPeriodView;
  siteLabel: string;
  scope: PeriodScope;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const closing = view.state === "OPEN";
  const next = closing ? "CLOSED" : "OPEN";

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant={closing ? "primary" : "secondary"}
        onClick={() => dialog.current?.showModal()}
      >
        {closing ? "Close period" : "Reopen period"}
      </Button>

      {/* `m-auto` is load-bearing: Tailwind preflight resets margin on every
          element, which overrides the UA stylesheet's `dialog:modal { margin: auto }`
          and leaves a showModal() dialog pinned to the top-left corner. */}
      <dialog
        ref={dialog}
        aria-labelledby="reporting-period-dialog-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-200 p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => {
          setReason("");
          trigger.current?.focus();
        }}
      >
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="siteId" value={view.siteId} />
          <input type="hidden" name="periodMonth" value={view.monthInput} />
          <input type="hidden" name="state" value={next} />
          <input type="hidden" name="from" value={scope.from} />
          <input type="hidden" name="to" value={scope.to} />
          {scope.scope && <input type="hidden" name="scope" value={scope.scope} />}
          {scope.status && <input type="hidden" name="status" value={scope.status} />}

          <h2 id="reporting-period-dialog-title" className="text-lg font-semibold">
            {closing ? "Close" : "Reopen"} {view.monthLabel} for {siteLabel}?
          </h2>
          <p className="text-sm text-slate-600">
            {closing
              ? "Closing this reporting period prevents activity data and accounting calculations for this month and site from being changed until the period is reopened. Reports, stored figures and evidence stay readable."
              : "Reopening this reporting period allows activity data and accounting calculations for this month and site to be changed again. The close and this reopening both stay in the audit record."}
          </p>

          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Reason <span className="text-slate-500">(recorded in the audit record)</span>
            </span>
            {closing ? (
              <Input
                name="reason"
                required
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Month-end close"
              />
            ) : (
              <Textarea
                name="reason"
                required
                rows={2}
                maxLength={400}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Corrected supplier invoice for August"
              />
            )}
          </label>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <ConfirmButton closing={closing} disabled={!reason.trim()} />
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmButton({ closing, disabled }: { closing: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? (closing ? "Closing…" : "Reopening…") : closing ? "Close period" : "Reopen period"}
    </Button>
  );
}
