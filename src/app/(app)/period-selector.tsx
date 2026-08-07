import { Button } from "@/components/ui/button";

/**
 * Plain GET form — the selected period lives in the URL, so a dashboard
 * view is shareable/bookmarkable and needs no client-side JS.
 */
export function PeriodSelector({
  action,
  startMonth,
  endMonth,
}: {
  action: string;
  startMonth: string;
  endMonth: string;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="from" className="block text-xs font-medium text-slate-600">
          From
        </label>
        <input
          id="from"
          name="from"
          type="month"
          defaultValue={startMonth}
          className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
      <div>
        <label htmlFor="to" className="block text-xs font-medium text-slate-600">
          To
        </label>
        <input
          id="to"
          name="to"
          type="month"
          defaultValue={endMonth}
          className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
      <Button type="submit" variant="secondary">
        Update
      </Button>
    </form>
  );
}
