/**
 * The product system, drawn.
 *
 * Server-rendered inline SVG, matching how the emissions dashboard already
 * draws its charts — no charting or flow-diagram dependency, no client-side
 * JavaScript, and it prints correctly in a report. A full node-graph editor
 * would be a large dependency for what is, at this scale, a linear chain of
 * stages with processes hanging off them.
 *
 * Excluded stages are drawn, greyed and dashed, rather than omitted: a reader
 * needs to see what the boundary leaves out as much as what it takes in.
 * Contribution shares are shown when the study has been calculated, so the
 * diagram doubles as a hotspot view.
 */

export interface DiagramStage {
  id: string;
  name: string;
  included: boolean;
  exclusionReason: string | null;
  processCount: number;
  kgCo2e: number | null;
  percentOfTotal: number | null;
}

const BOX_WIDTH = 148;
const BOX_HEIGHT = 84;
const GAP = 34;
const PADDING = 8;

export function SystemBoundaryDiagram({ stages }: { stages: DiagramStage[] }) {
  if (stages.length === 0) {
    return <p className="text-sm text-slate-500">No life cycle stages defined yet.</p>;
  }

  const width = PADDING * 2 + stages.length * BOX_WIDTH + (stages.length - 1) * GAP;
  const height = PADDING * 2 + BOX_HEIGHT + 26;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Product system boundary: ${stages.map((s) => `${s.name} ${s.included ? "included" : "excluded"}`).join(", ")}`}
        className="max-w-full"
      >
        <defs>
          <marker id="lca-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {stages.map((stage, index) => {
          const x = PADDING + index * (BOX_WIDTH + GAP);
          const y = PADDING;
          const share = stage.percentOfTotal ?? 0;
          // Fill depth encodes contribution, but the percentage is always
          // written out too — colour is never the only carrier of a figure.
          const fill = !stage.included ? "#f8fafc" : share >= 40 ? "#dbeafe" : share >= 15 ? "#eff6ff" : "#ffffff";

          return (
            <g key={stage.id}>
              <rect
                x={x}
                y={y}
                width={BOX_WIDTH}
                height={BOX_HEIGHT}
                rx={10}
                fill={fill}
                stroke={stage.included ? "#94a3b8" : "#cbd5e1"}
                strokeWidth={1}
                strokeDasharray={stage.included ? undefined : "4 3"}
              />
              <text x={x + 12} y={y + 22} fontSize={11} fontWeight={600} fill={stage.included ? "#0f172a" : "#94a3b8"}>
                {stage.name.length > 20 ? `${stage.name.slice(0, 19)}…` : stage.name}
              </text>
              <text x={x + 12} y={y + 40} fontSize={10} fill="#64748b">
                {stage.processCount} process{stage.processCount === 1 ? "" : "es"}
              </text>
              {stage.included ? (
                stage.kgCo2e !== null ? (
                  <>
                    <text x={x + 12} y={y + 58} fontSize={11} fontWeight={600} fill="#0f172a">
                      {stage.kgCo2e.toFixed(3)} kg
                    </text>
                    <text x={x + 12} y={y + 73} fontSize={10} fill="#64748b">
                      {share.toFixed(1)}% of total
                    </text>
                  </>
                ) : (
                  <text x={x + 12} y={y + 58} fontSize={10} fill="#94a3b8">
                    not calculated
                  </text>
                )
              ) : (
                <text x={x + 12} y={y + 58} fontSize={10} fill="#94a3b8">
                  excluded
                </text>
              )}

              {index < stages.length - 1 && (
                <line
                  x1={x + BOX_WIDTH + 4}
                  y1={y + BOX_HEIGHT / 2}
                  x2={x + BOX_WIDTH + GAP - 4}
                  y2={y + BOX_HEIGHT / 2}
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  markerEnd="url(#lca-arrow)"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* The equivalent table: no figure on this page exists only as a shape. */}
      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Life cycle stages, their inclusion in the system boundary and their contribution</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-4">Stage</th>
            <th className="py-2 pr-4">In boundary</th>
            <th className="py-2 pr-4 text-right">kgCO2e</th>
            <th className="py-2 pr-4 text-right">Share</th>
            <th className="py-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr key={stage.id} className="border-b border-slate-100">
              <td className="py-2 pr-4 font-medium text-slate-800">{stage.name}</td>
              <td className="py-2 pr-4 text-slate-600">{stage.included ? "Included" : "Excluded"}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                {stage.included && stage.kgCo2e !== null ? stage.kgCo2e.toFixed(4) : "—"}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                {stage.included && stage.percentOfTotal !== null ? `${stage.percentOfTotal.toFixed(1)}%` : "—"}
              </td>
              <td className="py-2 text-slate-500">{stage.included ? "" : (stage.exclusionReason ?? "No reason recorded.")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
