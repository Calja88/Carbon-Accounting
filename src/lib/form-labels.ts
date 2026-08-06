/** Plain-language label for the type/sub-type selector on data points that need one. */
export const FACTOR_OPTION_LABELS: Record<string, string> = {
  "S1-03": "Fuel type",
  "S1-04": "Vehicle type",
  "S1-05": "Refrigerant type",
  "S3-01": "Spend category",
  "S3-06": "Travel type",
};

/**
 * Data points where an optional "Supplier name" field is shown so a
 * supplier-specific emission factor override can be matched (methodology
 * Section 7). Currently just Cat 1 (S3-01) — see README assumptions for
 * why this isn't extended to Cat 2 in this build.
 */
export const SUPPLIER_OVERRIDE_CODES = new Set(["S3-01"]);
