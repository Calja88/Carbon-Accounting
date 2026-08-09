import { EmptyState } from "@/components/lca/ui";

/**
 * Wraps a list/table with consistent loading/empty/error states, so every
 * list page (documents, historical data, factor sets, reports) handles
 * "nothing here yet" and "something went wrong" the same way instead of
 * each hand-rolling its own paragraph.
 */
export function RecordList({
  state,
  emptyTitle,
  emptyDescription,
  emptyAction,
  errorMessage,
  children,
}: {
  state: "loading" | "empty" | "error" | "ready";
  emptyTitle: string;
  emptyDescription: React.ReactNode;
  emptyAction?: React.ReactNode;
  errorMessage?: string;
  children: React.ReactNode;
}) {
  if (state === "loading") {
    return (
      <div aria-busy="true" role="status" className="rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div role="status" className="rounded-lg border border-red-200 bg-red-50 px-6 py-6 text-center text-sm text-red-800">
        {errorMessage ?? "Something went wrong loading this list."}
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div role="status">
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return <>{children}</>;
}
