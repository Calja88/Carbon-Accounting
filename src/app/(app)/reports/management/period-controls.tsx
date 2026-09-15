/**
 * The report's own period control.
 *
 * The app shell's scope bar posts to `/`, so reusing it here would navigate
 * the reader off the report every time they changed the period. This is a
 * plain GET form on the report's own route: no client state, no JavaScript
 * needed, and the URL stays the scope — so a period selection can be
 * bookmarked and shared exactly like the dashboard's.
 */
export function PeriodControls({
  sites,
  from,
  to,
  siteId,
}: {
  sites: { id: string; name: string }[];
  from: string;
  to: string;
  siteId?: string;
}) {
  const selectedSite = sites.some((s) => s.id === siteId) ? siteId : "";
  return (
    <form method="get" action="/reports/management" className="no-print flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        From
        <input
          type="month"
          name="from"
          defaultValue={from}
          required
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        To
        <input
          type="month"
          name="to"
          defaultValue={to}
          min={from}
          required
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Site
        <select
          name="siteId"
          defaultValue={selectedSite}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
        >
          <option value="">All sites you can see</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
      >
        Update report
      </button>
    </form>
  );
}
