/**
 * Turns a single "which period is this for?" picker into the periodStart/
 * periodEnd range each activity data point actually needs, based on its
 * frequency from the data map. Monthly/quarterly/annual data points all use
 * a month picker and snap to the period that month falls in; "As occurs"
 * data points (F-gas top-ups) use a specific date instead of a period.
 */

export type PeriodInputKind = "month" | "date";

export function periodInputKindForFrequency(frequency: string): PeriodInputKind {
  return frequency.toLowerCase().includes("as occurs") ? "date" : "month";
}

export function defaultPeriodInputValue(frequency: string): string {
  const now = new Date();
  if (periodInputKindForFrequency(frequency) === "date") {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return now.toISOString().slice(0, 7); // YYYY-MM
}

function lastDayOfMonth(year: number, monthIndex0: number): Date {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

export interface ResolvedPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export function resolvePeriod(frequency: string, inputValue: string): ResolvedPeriod {
  const kind = periodInputKindForFrequency(frequency);

  if (kind === "date") {
    const d = new Date(`${inputValue}T00:00:00.000Z`);
    return { periodStart: d, periodEnd: d };
  }

  const [yearStr, monthStr] = inputValue.split("-");
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;

  if (frequency.toLowerCase().includes("quarter")) {
    const quarterStartMonth = Math.floor(monthIndex0 / 3) * 3;
    return {
      periodStart: new Date(Date.UTC(year, quarterStartMonth, 1)),
      periodEnd: lastDayOfMonth(year, quarterStartMonth + 2),
    };
  }

  if (frequency.toLowerCase().includes("annual")) {
    return {
      periodStart: new Date(Date.UTC(year, 0, 1)),
      periodEnd: new Date(Date.UTC(year, 11, 31)),
    };
  }

  // Monthly (default)
  return {
    periodStart: new Date(Date.UTC(year, monthIndex0, 1)),
    periodEnd: lastDayOfMonth(year, monthIndex0),
  };
}
