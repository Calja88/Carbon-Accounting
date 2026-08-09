"use client";

/**
 * One consistent destructive-action confirmation pattern, replacing the
 * mix of bare-button instant-submit deletes and ad hoc confirm() calls
 * scattered across the LCA module's actions.ts files. Uses the native
 * <dialog> element (showModal/close) rather than a hand-rolled modal, so
 * focus trapping, Escape-to-close and backdrop semantics come from the
 * browser rather than being reimplemented.
 *
 * The dialog only gates the *client-side submit* — the form it renders
 * still posts to the same server action the bare button used to call
 * directly, unchanged. `dependents` should reflect what the server action
 * will actually do (block on dependents vs. cascade) — see call sites for
 * the specific service's behaviour before writing copy that promises a
 * specific outcome.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface DestructiveActionDialogProps {
  /** The button that opens the dialog. */
  triggerLabel: string;
  triggerVariant?: "danger" | "ghost" | "secondary";
  title: string;
  description: React.ReactNode;
  /** Dependent records the action will affect or be blocked by — shown so nothing is deleted blind. */
  dependents?: { label: string; count: number }[];
  confirmLabel?: string;
  /** The existing server action this dialog gates — signature and behaviour unchanged. */
  formAction: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs (record ids etc.) the server action needs, exactly as the un-dialogued form passed them. */
  children?: React.ReactNode;
  className?: string;
}

export function DestructiveActionDialog({
  triggerLabel,
  triggerVariant = "ghost",
  title,
  description,
  dependents,
  confirmLabel = "Delete",
  formAction,
  children,
  className,
}: DestructiveActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // A click that lands on the <dialog> element itself (not its content,
    // which stops propagation via the inner div) is a backdrop click.
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  const hasBlockingDependents = (dependents ?? []).some((d) => d.count > 0);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size="sm"
        className={className}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="destructive-dialog-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="destructive-dialog-title" className="text-base font-semibold text-slate-900">
                {title}
              </h2>
              <div className="mt-1 text-sm text-slate-600">{description}</div>
            </div>
          </div>

          {dependents && dependents.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {dependents.map((d) => (
                <li key={d.label} className="flex items-center justify-between">
                  <span>{d.label}</span>
                  <span className={d.count > 0 ? "font-medium text-amber-800" : "text-slate-400"}>{d.count}</span>
                </li>
              ))}
            </ul>
          )}

          {hasBlockingDependents && (
            <p className="mt-3 text-sm text-amber-800">
              This has dependent records. Removing it may not be possible until they are dealt with first — the next
              step will tell you if that&apos;s the case.
            </p>
          )}

          <form
            action={async (formData) => {
              setPending(true);
              try {
                await formAction(formData);
              } finally {
                setPending(false);
                dialogRef.current?.close();
              }
            }}
            className="mt-5 flex justify-end gap-2"
          >
            {children}
            <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? "Deleting…" : confirmLabel}
            </Button>
          </form>
        </div>
      </dialog>
    </>
  );
}
