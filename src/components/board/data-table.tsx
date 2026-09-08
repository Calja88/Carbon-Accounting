"use client";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Column<T> {
  id: string; label: string; render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null; numeric?: boolean; rowHeader?: boolean;
}
/** Bounded, already-authorized result sets only. Server pagination belongs in its domain adapter. */
export function DataTable<T>({ caption, rows, columns, rowKey, searchText, emptyMessage = "No records match this view." }: {
  caption: string; rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string;
  searchText?: (row: T) => string; emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const displayed = useMemo(() => {
    const filtered = rows.filter(row => !searchText || searchText(row).toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB")));
    const column = columns.find(c => c.id === sort?.id);
    if (!column?.sortValue || !sort) return filtered;
    const value = column.sortValue, direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = value(a), bv = value(b);
      if (av === null && bv === null) return 0; if (av === null) return 1; if (bv === null) return -1;
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "en-GB", { numeric: true })) * direction;
    });
  }, [rows, columns, searchText, query, sort]);
  return <div className="bd-table-wrap">
    {searchText && <label className="bd-table-search">Filter {caption.toLocaleLowerCase("en-GB")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search these records…" /></label>}
    <div className="bd-table-scroll" role="region" aria-label={caption} tabIndex={0}><table className="bd-table"><caption className="bd-sr-only">{caption}</caption><thead><tr>{columns.map(c => <th key={c.id} scope="col" className={c.numeric ? "bd-numeric" : ""} aria-sort={c.sortValue ? sort?.id === c.id ? sort.direction === "asc" ? "ascending" : "descending" : "none" : undefined}>
      {c.sortValue ? <button type="button" onClick={() => setSort({ id: c.id, direction: sort?.id === c.id && sort.direction === "asc" ? "desc" : "asc" })}>{c.label}<span aria-hidden="true"> {sort?.id === c.id ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button> : c.label}
    </th>)}</tr></thead><tbody>{displayed.map(row => <tr key={rowKey(row)}>{columns.map(c => c.rowHeader ? <th key={c.id} scope="row">{c.render(row)}</th> : <td key={c.id} className={c.numeric ? "bd-numeric" : ""}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>
    {!displayed.length && <p className="bd-empty" role="status">{emptyMessage}</p>}
    {searchText && <p className="bd-table-count" aria-live="polite">{displayed.length} of {rows.length} records</p>}
  </div>;
}
