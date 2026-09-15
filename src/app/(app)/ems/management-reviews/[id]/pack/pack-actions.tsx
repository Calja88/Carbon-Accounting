"use client";

export function PackActions({ reviewId }: { reviewId: string }) {
  return <nav className="bd-pack-actions" aria-label="Management pack actions">
    <a className="bd-button bd-button--quiet" href={`/ems/management-reviews/${reviewId}`}>Review workspace</a>
    <a className="bd-button bd-button--quiet" href={`/ems/management-reviews/${reviewId}/pack/download`}>Download frozen pack</a>
    <button className="bd-button bd-button--primary" onClick={() => window.print()}>Print / save PDF</button>
  </nav>;
}
