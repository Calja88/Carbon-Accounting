import { describe, expect, it } from "vitest";
import {
  MILES_TO_KM,
  aggregateRows,
  autoDetectColumns,
  classifyTravelSubtype,
  parseFlexibleDate,
  parseNumber,
  prepareExpenseInRows,
  type RawSheet,
} from "@/lib/expensein-import";

describe("autoDetectColumns", () => {
  it("detects ExpenseIn's standard basic-export headers", () => {
    const mapping = autoDetectColumns([
      "Expense Number",
      "User's First Name",
      "User's Surname",
      "Department",
      "Category",
      "Expense Description",
      "Expense Date",
      "Distance",
      "Gross Amount",
    ]);
    expect(mapping.category).toBe(4);
    expect(mapping.description).toBe(5);
    expect(mapping.date).toBe(6);
    expect(mapping.quantity).toBe(7);
  });

  it("tolerates bespoke header names via contains-matching", () => {
    const mapping = autoDetectColumns(["Expense Date (UTC)", "Expense Category Name", "Total Business Miles"]);
    expect(mapping.date).toBe(0);
    expect(mapping.category).toBe(1);
    expect(mapping.quantity).toBe(2);
  });

  it("returns null for columns that simply aren't present", () => {
    const mapping = autoDetectColumns(["Foo", "Bar"]);
    expect(mapping.date).toBeNull();
    expect(mapping.category).toBeNull();
    expect(mapping.quantity).toBeNull();
  });
});

describe("classifyTravelSubtype", () => {
  it("maps rail-ish categories to rail", () => {
    expect(classifyTravelSubtype("Train").subtype).toBe("rail");
    expect(classifyTravelSubtype("Rail travel").subtype).toBe("rail");
    expect(classifyTravelSubtype("Eurostar").subtype).toBe("rail");
  });

  it("maps hotels and accommodation to hotel", () => {
    expect(classifyTravelSubtype("Hotel").subtype).toBe("hotel");
    expect(classifyTravelSubtype("Accommodation").subtype).toBe("hotel");
  });

  it("distinguishes flight haul bands", () => {
    expect(classifyTravelSubtype("Flight - Long Haul").subtype).toBe("flight_long_haul");
    expect(classifyTravelSubtype("Short-haul flight").subtype).toBe("flight_short_haul");
    expect(classifyTravelSubtype("Domestic flight").subtype).toBe("flight_domestic");
  });

  it("refuses to guess a haul band for a generic flight", () => {
    const result = classifyTravelSubtype("Flight");
    expect(result.subtype).toBeNull();
    expect(result.skipReason).toMatch(/haul band/i);
  });

  it("routes car-mileage claims to grey fleet rather than Category 6", () => {
    const result = classifyTravelSubtype("Car Mileage");
    expect(result.subtype).toBeNull();
    expect(result.skipReason).toMatch(/grey fleet/i);
  });

  it("does not mistake rail claims for grey fleet mileage", () => {
    // "Rail mileage" contains the grey-fleet keyword but is clearly rail.
    expect(classifyTravelSubtype("Rail mileage").subtype).toBe("rail");
  });

  it("reports unmatched categories rather than defaulting to a travel type", () => {
    const result = classifyTravelSubtype("Client entertainment");
    expect(result.subtype).toBeNull();
    expect(result.skipReason).toMatch(/No business-travel type matched/);
  });
});

describe("parseFlexibleDate", () => {
  it("reads ISO dates", () => {
    expect(parseFlexibleDate("2026-03-14")?.toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });

  it("reads UK day-first dates", () => {
    // ExpenseIn is a UK product: 03/04/2026 is 3 April, not 4 March.
    expect(parseFlexibleDate("03/04/2026")?.toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("expands two-digit years", () => {
    expect(parseFlexibleDate("03/04/26")?.toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("returns null for junk", () => {
    expect(parseFlexibleDate("not a date")).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });
});

describe("parseNumber", () => {
  it("strips thousands separators, currency and trailing units", () => {
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("£120.00")).toBe(120);
    expect(parseNumber("340 km")).toBe(340);
  });

  it("returns null when there's no number", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});

describe("prepareExpenseInRows", () => {
  const sheet: RawSheet = {
    headers: ["Expense Date", "Category", "Expense Description", "Distance"],
    rows: [
      ["01/03/2026", "Train", "London to Reading", "120"],
      ["15/03/2026", "Hotel", "Premier Inn Reading", "2"],
      ["20/03/2026", "Car Mileage", "Site visit", "48"],
      ["22/03/2026", "Flight", "Somewhere", "900"],
      ["bad-date", "Train", "", "50"],
    ],
  };
  const mapping = { date: 0, category: 1, description: 2, quantity: 3 };

  it("converts miles to km for distance-based travel but leaves hotel nights alone", () => {
    const result = prepareExpenseInRows(sheet, { mapping, distanceUnit: "miles" });
    expect(result.fatalError).toBeNull();

    const rail = result.prepared.find((r) => r.subtype === "rail");
    expect(rail?.unit).toBe("km");
    expect(rail?.value).toBeCloseTo(120 * MILES_TO_KM, 6);

    const hotel = result.prepared.find((r) => r.subtype === "hotel");
    expect(hotel?.unit).toBe("nights");
    expect(hotel?.value).toBe(2);
  });

  it("leaves distances untouched when the export is already in km", () => {
    const result = prepareExpenseInRows(sheet, { mapping, distanceUnit: "km" });
    expect(result.prepared.find((r) => r.subtype === "rail")?.value).toBe(120);
  });

  it("skips grey fleet, ambiguous flights and unparseable dates, each with a reason", () => {
    const result = prepareExpenseInRows(sheet, { mapping, distanceUnit: "miles" });
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.map((s) => s.rowNumber).sort()).toEqual([4, 5, 6]);
    expect(result.skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("snaps each row to its calendar month", () => {
    const result = prepareExpenseInRows(sheet, { mapping, distanceUnit: "miles" });
    const rail = result.prepared.find((r) => r.subtype === "rail")!;
    expect(rail.periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(rail.periodEnd.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("refuses to run without a quantity column rather than importing money as distance", () => {
    const result = prepareExpenseInRows(sheet, {
      mapping: { ...mapping, quantity: null },
      distanceUnit: "miles",
    });
    expect(result.fatalError).toMatch(/distance\/nights column/i);
    expect(result.prepared).toHaveLength(0);
  });
});

describe("aggregateRows", () => {
  it("sums to one entry per month per travel type and counts contributing rows", () => {
    const sheet: RawSheet = {
      headers: ["Date", "Category", "Distance"],
      rows: [
        ["01/03/2026", "Train", "100"],
        ["09/03/2026", "Train", "50"],
        ["09/04/2026", "Train", "20"],
        ["10/03/2026", "Hotel", "3"],
      ],
    };
    const { prepared } = prepareExpenseInRows(sheet, {
      mapping: { date: 0, category: 1, quantity: 2, description: null },
      distanceUnit: "km",
    });
    const aggregated = aggregateRows(prepared);

    expect(aggregated).toHaveLength(3);
    const marchRail = aggregated.find(
      (a) => a.subtype === "rail" && a.periodStart.toISOString().startsWith("2026-03"),
    )!;
    expect(marchRail.value).toBe(150);
    expect(marchRail.rowCount).toBe(2);

    const aprilRail = aggregated.find(
      (a) => a.subtype === "rail" && a.periodStart.toISOString().startsWith("2026-04"),
    )!;
    expect(aprilRail.value).toBe(20);
    expect(aprilRail.rowCount).toBe(1);
  });
});
