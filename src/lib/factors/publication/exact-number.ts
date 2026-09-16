export interface ExactNumber { coefficient: string; exponent: number }
export type SourceNumber =
  | { kind: "FINITE"; rawToken: string; exact: ExactNumber }
  | { kind: "MISSING"; rawToken: string | null }
  | { kind: "INVALID"; rawToken: string; reason: string };

const MAX_DIGITS = 1_000;
const MAX_EXPONENT = 1_000;

/** Input must be the original XML/text token, never a Number's formatted value.
 * This pure parser does not change the existing workbook preview adapter. */
export function parseSourceNumber(rawToken: string | null): SourceNumber {
  if (rawToken === null || rawToken.trim() === "") return { kind: "MISSING", rawToken };
  const invalid = (reason: string): SourceNumber => ({ kind: "INVALID", rawToken, reason });
  if (rawToken.length > 4_096) return invalid("TOKEN_TOO_LONG");
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(rawToken.trim());
  if (!match) return invalid("INVALID_DECIMAL");
  const fraction = match[3] ?? match[4] ?? "";
  const exponentToken = match[5] ?? "0";
  if (exponentToken.replace(/^[+-]?0*/, "").length > 4) return invalid("EXPONENT_OUT_OF_RANGE");
  const sourceExponent = Number(exponentToken); // bounded integer exponent, never the factor value
  if (Math.abs(sourceExponent) > MAX_EXPONENT) return invalid("EXPONENT_OUT_OF_RANGE");
  let digits = ((match[2] ?? "") + fraction).replace(/^0+/, "");
  if (digits.length > MAX_DIGITS) return invalid("COEFFICIENT_TOO_LONG");
  if (!digits) return { kind: "FINITE", rawToken, exact: { coefficient: "0", exponent: 0 } };
  const trailing = /0*$/.exec(digits)![0].length;
  digits = digits.slice(0, digits.length - trailing);
  const exponent = sourceExponent - fraction.length + trailing;
  if (Math.abs(exponent) > MAX_EXPONENT) return invalid("EXPONENT_OUT_OF_RANGE");
  return { kind: "FINITE", rawToken, exact: { coefficient: (match[1] === "-" ? "-" : "") + digits, exponent } };
}

export function assertExactNumber(value: ExactNumber): void {
  if (!Number.isSafeInteger(value.exponent) || Math.abs(value.exponent) > MAX_EXPONENT ||
      !/^(?:0|-?[1-9]\d*)$/.test(value.coefficient) || value.coefficient.replace("-", "").length > MAX_DIGITS ||
      (value.coefficient === "0" ? value.exponent !== 0 : value.coefficient.endsWith("0"))) {
    throw new Error("Non-canonical exact number");
  }
}

/** Returns an exact decimal string or throws; there is no rounding operation. */
export function toLosslessDecimal18_8(value: ExactNumber): string {
  assertExactNumber(value);
  if (value.coefficient.startsWith("-")) throw new Error("NEGATIVE_FACTOR");
  if (value.exponent < -8) throw new Error("EXCESSIVE_PRECISION");
  const point = value.coefficient.length + value.exponent;
  if (point > 10) throw new Error("FACTOR_OVERFLOW");
  if (value.exponent >= 0) return value.coefficient + "0".repeat(value.exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${value.coefficient}`;
  return `${value.coefficient.slice(0, point)}.${value.coefficient.slice(point)}`;
}

export function isLosslessDecimal18_8(value: ExactNumber): boolean {
  try { toLosslessDecimal18_8(value); return true; } catch { return false; }
}
