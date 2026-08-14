import { describe, expect, test } from "vitest";
import {
  CentreBudgetError,
  parseMonthKey,
  requireCurrencyCode,
  requireDecimalAmount,
  requireOptionalNote,
  requireUuid,
} from "./validation";

describe("month keys", () => {
  test("accepts a calendar month and normalises it to a first-of-month key", () => {
    expect(parseMonthKey("2036-03")).toBe("2036-03-01");
    expect(parseMonthKey("2036-12")).toBe("2036-12-01");
    expect(parseMonthKey(" 2036-01 ")).toBe("2036-01-01");
  });

  test("rejects anything that is not an unambiguous calendar month", () => {
    for (const invalid of [
      "2036-13",
      "2036-00",
      "2036-3",
      "36-03",
      "2036/03",
      "2036-03-01",
      "1999-03",
      "2101-03",
      "",
      "not-a-month",
      // A SQL fragment must never reach the date cast.
      "2036-03'; DROP TABLE centre_budget_actuals; --",
    ]) {
      expect(() => parseMonthKey(invalid), invalid).toThrow(CentreBudgetError);
    }
    expect(() => parseMonthKey(undefined)).toThrow(CentreBudgetError);
    expect(() => parseMonthKey(202603)).toThrow(CentreBudgetError);
  });
});

describe("decimal amounts", () => {
  test("accepts exact decimals including a deliberate zero", () => {
    expect(requireDecimalAmount("0")).toBe("0");
    expect(requireDecimalAmount("0.00")).toBe("0.00");
    expect(requireDecimalAmount("1250.00")).toBe("1250.00");
    expect(requireDecimalAmount("-125.50")).toBe("-125.50");
    expect(requireDecimalAmount(" 42.5 ")).toBe("42.5");
    expect(requireDecimalAmount("999999999999.99")).toBe("999999999999.99");
  });

  test("rejects values NUMERIC(14,2) cannot hold exactly", () => {
    for (const invalid of [
      "1.005",
      "1e3",
      "0x10",
      "1,250.00",
      "Infinity",
      "NaN",
      "",
      " ",
      ".",
      "1.",
      // Thirteen integer digits overflows the column.
      "1000000000000.00",
    ]) {
      expect(() => requireDecimalAmount(invalid), invalid).toThrow(CentreBudgetError);
    }
  });

  test("rejects a number, so an amount can never arrive as a float", () => {
    // 0.1 + 0.2 === 0.30000000000000004. Refusing the type at the boundary is
    // what keeps that value out of the database entirely.
    expect(() => requireDecimalAmount(0.1 + 0.2)).toThrow(CentreBudgetError);
    expect(() => requireDecimalAmount(1250)).toThrow(CentreBudgetError);
    expect(() => requireDecimalAmount(null)).toThrow(CentreBudgetError);
    expect(() => requireDecimalAmount(undefined)).toThrow(CentreBudgetError);
  });
});

describe("currency codes", () => {
  test("accepts an ISO-4217-shaped code", () => {
    expect(requireCurrencyCode("AUD")).toBe("AUD");
    expect(requireCurrencyCode(" NZD ")).toBe("NZD");
  });

  test("rejects anything else", () => {
    for (const invalid of ["aud", "AUDD", "AU", "A1D", "", "$"]) {
      expect(() => requireCurrencyCode(invalid), invalid).toThrow(CentreBudgetError);
    }
  });
});

describe("identifiers and notes", () => {
  test("requires a canonical UUID", () => {
    expect(requireUuid("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    for (const invalid of ["", "1", "not-a-uuid", "11111111111141118111111111111111"]) {
      expect(() => requireUuid(invalid), invalid).toThrow(CentreBudgetError);
    }
  });

  test("treats an absent note as absent and a blank note as invalid", () => {
    expect(requireOptionalNote(undefined)).toBeUndefined();
    expect(requireOptionalNote(null)).toBeUndefined();
    expect(requireOptionalNote(" Checked against invoices ")).toBe(
      "Checked against invoices",
    );
    expect(() => requireOptionalNote("   ")).toThrow(CentreBudgetError);
    expect(() => requireOptionalNote("x".repeat(501))).toThrow(CentreBudgetError);
  });
});
