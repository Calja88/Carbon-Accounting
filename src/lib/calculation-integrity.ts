export class CalculationIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "CalculationIntegrityError"; }
}
/** Empty means a first calculation. A non-empty set must be complete, never repaired by deleting history. */
export function assertCompletePrimaryCalculations(
  rows: readonly { scope: string; basis: string; derivedFromCalculationId?: string | null }[],
  scope: string,
  category: string,
): void {
  if (!rows.length) return;
  if (rows.some(row => row.scope !== scope || row.derivedFromCalculationId != null)) {
    throw new CalculationIntegrityError("Primary calculation set contains a derived or wrong-scope row.");
  }
  const bases = rows.map(row => row.basis);
  if (new Set(bases).size !== bases.length) throw new CalculationIntegrityError("Duplicate primary calculation rows: retain history and investigate.");
  const valid = scope === "SCOPE_2" && category === "grid_electricity"
    ? rows.length === 2 && bases.includes("LOCATION_BASED") && (bases.includes("MARKET_BASED") || bases.includes("RESIDUAL_MIX"))
    : rows.length === 1 && bases[0] === "STANDARD";
  if (!valid) throw new CalculationIntegrityError("Incomplete or unexpected primary calculation set; Scope 2 requires one location and one market/residual row.");
}
