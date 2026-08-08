/**
 * High-precision arithmetic for the LCA engine.
 *
 * Product footprints multiply small factors by large quantities and then
 * divide by production volumes, often several times over. Doing that in
 * float64 accumulates representation error that shows up as figures which
 * don't reconcile between the register export, the results dashboard and the
 * report — the exact class of defect that makes an assessment unverifiable.
 *
 * Prisma ships decimal.js as `Prisma.Decimal`, which is also the runtime type
 * of every Decimal column in the schema, so using it here means values pass
 * from database to engine to database without a lossy float hop in between.
 * Addition, subtraction and multiplication are exact; division carries 20
 * significant digits (decimal.js's default), which is deterministic and well
 * beyond the precision of any published emission factor.
 *
 * The global decimal.js configuration is deliberately left untouched — this
 * module never calls `Decimal.set`, so nothing here can change how Prisma
 * itself handles Decimal columns elsewhere in the application.
 */

import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Anything that can stand in for a decimal at a module boundary. */
export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

export class InvalidNumberError extends Error {}

/**
 * Coerces a value to Decimal. `null`/`undefined`/empty string become the
 * supplied fallback (0 by default) rather than NaN, so a missing optional
 * column can't silently poison a total.
 */
export function D(value: DecimalInput, fallback: DecimalInput = 0): Decimal {
  if (value === null || value === undefined || value === "") {
    return value === fallback ? ZERO : D(fallback, 0);
  }
  const d = new Decimal(value);
  if (!d.isFinite()) {
    throw new InvalidNumberError(`"${String(value)}" is not a finite number.`);
  }
  return d;
}

/** Same as D, but returns null instead of a fallback when there's no value. */
export function DOrNull(value: DecimalInput): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Decimal(value);
  if (!d.isFinite()) {
    throw new InvalidNumberError(`"${String(value)}" is not a finite number.`);
  }
  return d;
}

export function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
}

/** Percentage (0..100) as a multiplier (0..1). */
export function percentToFactor(percent: DecimalInput): Decimal {
  return D(percent).div(HUNDRED);
}

/** Share of a total, as a percentage. Returns 0 when the total is zero. */
export function percentOf(part: Decimal, total: Decimal): Decimal {
  if (total.isZero()) return ZERO;
  return part.div(total).times(HUNDRED);
}

/**
 * For JSON payloads, chart props and anything crossing the server/client
 * boundary. Precision beyond float64 is not meaningful for display, and a
 * Decimal instance is not serialisable through a React Server Component
 * boundary.
 */
export function toNumber(value: DecimalInput): number {
  if (value === null || value === undefined || value === "") return 0;
  return new Decimal(value).toNumber();
}

/** Full-precision string, for audit records and CSV exports. */
export function toExactString(value: DecimalInput): string {
  if (value === null || value === undefined || value === "") return "";
  return new Decimal(value).toFixed();
}

/** Trims trailing zeros for human-readable formulas: 2.500000 -> "2.5". */
export function toDisplayString(value: DecimalInput, maxDecimals = 6): string {
  if (value === null || value === undefined || value === "") return "";
  const d = new Decimal(value);
  if (d.isZero()) return "0";
  const abs = d.abs();
  // Very small figures are real (a gram of material, a fraction of a gram of
  // CO2e) — show them in exponential form rather than rounding them to "0".
  if (abs.lt(new Decimal(10).pow(-maxDecimals))) return d.toExponential(3);
  return d.toDecimalPlaces(maxDecimals).toString();
}
