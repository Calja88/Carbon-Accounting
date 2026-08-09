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
 *
 * If the server action throws (e.g. a blocking-dependents check further
 * down the stack), the dialog catches it, shows the message inline, and
 * stays open — a failed delete must never bubble up to the nearest error
 * boundary and replace the whole page with "Something went wrong."
 */

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface DestructiveActionDialogProps {
  /** Accessible name for the trigger — visible text unless triggerIcon is set, in which case it becomes the aria-label. */
  triggerLabel: string;
  /** Renders the trigger as an icon-only button (dense inline lists) with triggerLabel as its aria-label instead of visible text. */
  triggerIcon?: React.ReactNode;
  triggerVariant?: "danger" | "ghost" | "secondary";
  title: string;
  description: React.ReactNode;
  /** Dependent records the action will affect — shown so nothing is deleted blind. */
  dependents?: { label: string; count: number }[];
  /**
   * Whether a nonzero dependent count means the server action will refuse
   * the delete, vs. dependents that are safely cascaded/unlinked as part of
   * it. Defaults to true (the safer assumption); set false only once you've
   * checked the specific service function actually proceeds regardless.
   */
  dependentsAreBlocking?: boolean;
  confirmLabel?: string;
  /** The existing server action this dialog gates — signature and behaviour unchanged. */
  formAction: (formData: FormData) => void | Promise<void>;
  /** Hidden inputs (record ids etc.) the server action needs, exactly as the un-dialogued form passed them. */
  children?: React.ReactNode;
  className?: string;
}

export function DestructiveActionDialog({
  triggerLabel,
  triggerIcon,
  triggerVariant = "ghost",
  title,
  description,
  dependents,
  dependentsAreBlocking = true,
  confirmLabel = "Delete",
  formAction,
  children,
  className,
}: DestructiveActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

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

  const hasBlockingDependents = dependentsAreBlocking && (dependents ?? []).some((d) => d.count > 0);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size="sm"
        className={cn(triggerIcon && "px-2", className)}
        aria-label={triggerIcon ? triggerLabel : undefined}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerIcon ?? triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
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

          {hasBlockingDependents && !error && (
            <p className="mt-3 text-sm text-amber-800">
              This has dependent records. Removing it may not be possible until they are dealt with first — the next
              step will tell you if that&apos;s the case.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <form
            action={async (formData) => {
              setPending(true);
              setError(null);
              try {
                await formAction(formData);
                dialogRef.current?.close();
              } catch (err) {
                // redirect()/notFound() work by throwing a special error
                // with a "NEXT_REDIRECT"/"NEXT_NOT_FOUND" digest — that must
                // propagate to Next's runtime to actually navigate, never be
                // swallowed here as a displayable error message.
                const digest = (err as { digest?: string })?.digest;
                if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) {
                  throw err;
                }
                setError(err instanceof Error ? err.message : "That didn't work. Try again.");
              } finally {
                setPending(false);
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
