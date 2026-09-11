import { BoardLink, StatusBadge, Surface } from "./primitives";
import type { LinkRef } from "../../lib/board/contracts";

export interface ScenarioComparison {
  baseline: { title: string; kgPerUnit: number | null; source: LinkRef };
  scenario: { title: string; kgPerUnit: number | null; source: LinkRef };
  unit: string; boundary: string; comparable: boolean; reason: string | null;
  contributions: { stage: string; baselineKg: number; scenarioKg: number }[];
}
export function LcaScenario({ model }: { model: ScenarioComparison }) {
  const a = model.baseline.kgPerUnit, b = model.scenario.kgPerUnit;
  const percent = model.comparable && a !== null && b !== null && a > 0 ? (b - a) / a * 100 : null;
  return <Surface title="Explore a lower-impact product" subtitle={`${model.unit} · ${model.boundary}`}><div className="bd-scenario-values">{[model.baseline, model.scenario].map((item, index) => <div key={item.source.href}><p className="bd-eyebrow">{item.title}</p><strong data-testid={index === 0 ? "lca-baseline-kg-per-unit" : "lca-scenario-kg-per-unit"} data-value={item.kgPerUnit ?? undefined}>{item.kgPerUnit === null ? "Not calculated" : item.kgPerUnit.toFixed(3)}<small>kgCO₂e / unit</small></strong><BoardLink href={item.source.href}>{item.source.label} →</BoardLink></div>)}<StatusBadge tone={percent !== null && percent < 0 ? "success" : "neutral"}>{percent === null ? "Not comparable" : `${percent.toFixed(1)}% per unit`}</StatusBadge></div>
    {model.reason && <p className="bd-notice">{model.reason}</p>}<table className="bd-table"><caption className="bd-sr-only">Scenario contribution comparison, kgCO₂e per unit</caption><thead><tr><th scope="col">Lifecycle stage</th><th scope="col">Baseline</th><th scope="col">Scenario</th></tr></thead><tbody>{model.contributions.map(c => <tr key={c.stage}><th scope="row">{c.stage}</th><td>{c.baselineKg.toFixed(3)}</td><td>{c.scenarioKg.toFixed(3)}</td></tr>)}</tbody></table><p className="bd-muted" data-testid="lca-comparison-boundary">{model.unit} · {model.boundary}. Scenario results remain separate from the corporate carbon inventory. Changes do not alter the baseline assessment.</p></Surface>;
}
