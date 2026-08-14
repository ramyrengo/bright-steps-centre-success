import { describe, expect, test } from "vitest";

import {
  compareExactDecimals,
  currentMonthKey,
  formatAmount,
  formatMonthLabel,
  formatMoney,
  formatPercent,
  isEnterableAmount,
  isMonthKey,
  isNegativeAmount,
  parseExactDecimal,
  shiftMonth,
} from "./budget-values";

describe("exact decimal handling", () => {
  test("keeps every digit the API sent, including trailing zeros", () => {
    // A single round-trip through a JavaScript number renders "0.00" as "0"
    // and "1250.00" as "1250", which erases the difference between a recorded
    // figure and a bare one. These assertions fail the moment that happens.
    expect(formatAmount("0.00")).toBe("0.00");
    expect(formatAmount("1250.00")).toBe("1,250.00");
    expect(formatAmount("0.10")).toBe("0.10");
  });

  test("groups long figures without losing precision", () => {
    expect(formatAmount("999999999999.99")).toBe("999,999,999,999.99");
    expect(formatAmount("12345678901234.56")).toBe("12,345,678,901,234.56");
    expect(formatAmount("-2500.00")).toBe("-2,500.00");
  });

  test("pads a short fraction rather than dropping it", () => {
    expect(parseExactDecimal("12.5")?.fraction).toBe("50");
    expect(formatAmount("12.5")).toBe("12.50");
  });

  test("returns an unparseable value untouched instead of inventing a zero", () => {
    expect(formatAmount("not a number")).toBe("not a number");
    expect(parseExactDecimal("1,250.00")).toBeUndefined();
  });

  test("a signed zero is not a negative figure", () => {
    expect(isNegativeAmount("-0.00")).toBe(false);
    expect(formatAmount("-0.00")).toBe("0.00");
    expect(isNegativeAmount("-0.01")).toBe(true);
    expect(isNegativeAmount("0.00")).toBe(false);
  });

  test("renders only the currency the API supplied", () => {
    expect(formatMoney("1250.00", "AUD")).toBe("AUD 1,250.00");
    // No currency has been approved for this product, so an amount without one
    // is rendered plainly rather than dressed in an assumed symbol.
    expect(formatMoney("1250.00")).toBe("1,250.00");
    expect(formatMoney("1250.00", "NZD")).toBe("NZD 1,250.00");
  });

  test("percentages carry their decimals", () => {
    expect(formatPercent("84.30")).toBe("84.30%");
    expect(formatPercent("0.00")).toBe("0.00%");
    expect(formatPercent("108.33")).toBe("108.33%");
  });
});

describe("comparing decimals without floats", () => {
  test("orders by magnitude across digit counts", () => {
    expect(compareExactDecimals("108.33", "90.00")).toBe(1);
    expect(compareExactDecimals("90.00", "108.33")).toBe(-1);
    expect(compareExactDecimals("1000.00", "999.99")).toBe(1);
  });

  test("treats equal values as equal whatever their padding", () => {
    expect(compareExactDecimals("100.00", "100.0")).toBe(0);
    expect(compareExactDecimals("0100.00", "100.00")).toBe(0);
  });

  test("orders negatives below positives and by depth", () => {
    expect(compareExactDecimals("-1250.00", "500.00")).toBe(-1);
    expect(compareExactDecimals("-1250.00", "-2500.00")).toBe(1);
  });
});

describe("entered amounts", () => {
  test("accepts what the API accepts, including a deliberate zero", () => {
    expect(isEnterableAmount("0.00")).toBe(true);
    expect(isEnterableAmount("1234.05")).toBe(true);
    expect(isEnterableAmount("-25.50")).toBe(true);
    expect(isEnterableAmount(" 42 ")).toBe(true);
  });

  test("rejects an empty entry rather than reading it as zero", () => {
    expect(isEnterableAmount("")).toBe(false);
    expect(isEnterableAmount("   ")).toBe(false);
  });

  test("rejects what the API would reject", () => {
    expect(isEnterableAmount("1.234")).toBe(false);
    expect(isEnterableAmount("1234567890123")).toBe(false);
    expect(isEnterableAmount("1,250.00")).toBe(false);
    expect(isEnterableAmount("twelve")).toBe(false);
  });
});

describe("calendar months", () => {
  test("recognises only real month keys", () => {
    expect(isMonthKey("2026-08")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-8")).toBe(false);
  });

  test("steps across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-08", -14)).toBe("2025-06");
  });

  test("names a month in words so the reader can see which one they were given", () => {
    expect(formatMonthLabel("2026-08")).toBe("August 2026");
    expect(formatMonthLabel("2026-01")).toBe("January 2026");
  });

  test("the opening month comes from the reader's own clock", () => {
    expect(isMonthKey(currentMonthKey(new Date(2026, 7, 14)))).toBe(true);
    expect(currentMonthKey(new Date(2026, 7, 14))).toBe("2026-08");
    expect(currentMonthKey(new Date(2026, 0, 1))).toBe("2026-01");
  });
});
