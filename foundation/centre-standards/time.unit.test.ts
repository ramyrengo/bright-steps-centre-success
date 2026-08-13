import { describe, expect, test } from "vitest";
import {
  addLocalCalendarDays,
  localBusinessDate,
  resolveStrictLocalMinute,
} from "./time";
import { deriveOperationalTimeliness } from "./types";

describe("Centre Standards civil-time scheduling", () => {
  test("resolves Sydney through DST start and end without adding 24 UTC hours", () => {
    expect(resolveStrictLocalMinute({ businessDate: "2026-10-04", localTime: "09:00", timezone: "Australia/Sydney" }).toISOString())
      .toBe("2026-10-03T22:00:00.000Z");
    expect(resolveStrictLocalMinute({ businessDate: "2027-04-04", localTime: "09:00", timezone: "Australia/Sydney" }).toISOString())
      .toBe("2027-04-03T23:00:00.000Z");
    expect(addLocalCalendarDays("2026-10-03", 1)).toBe("2026-10-04");
  });

  test("Brisbane has no DST offset transition", () => {
    expect(resolveStrictLocalMinute({ businessDate: "2026-10-04", localTime: "09:00", timezone: "Australia/Brisbane" }).toISOString())
      .toBe("2026-10-03T23:00:00.000Z");
    expect(resolveStrictLocalMinute({ businessDate: "2027-04-04", localTime: "09:00", timezone: "Australia/Brisbane" }).toISOString())
      .toBe("2027-04-03T23:00:00.000Z");
  });

  test("rejects DST gaps and folds rather than guessing", () => {
    expect(() => resolveStrictLocalMinute({ businessDate: "2026-10-04", localTime: "02:30", timezone: "Australia/Sydney" })).toThrow(/ambiguous or nonexistent/);
    expect(() => resolveStrictLocalMinute({ businessDate: "2027-04-04", localTime: "02:30", timezone: "Australia/Sydney" })).toThrow(/ambiguous or nonexistent/);
  });

  test("rejects timezone abbreviations and invalid centre timezone identifiers", () => {
    expect(() => resolveStrictLocalMinute({
      businessDate: "2026-08-13",
      localTime: "09:00",
      timezone: "AEST",
    })).toThrow();
    expect(() => localBusinessDate(
      new Date("2026-08-13T00:00:00Z"),
      "Australia/Not_A_Zone",
    )).toThrow();
  });

  test("uses centre-local business dates and exact deadline boundaries", () => {
    expect(localBusinessDate(new Date("2026-08-13T14:30:00Z"), "Australia/Sydney")).toBe("2026-08-14");
    expect(deriveOperationalTimeliness({ status: "OPEN", dueAt: new Date("2026-08-13T07:00:00Z"), completedAt: null, decisionAt: new Date("2026-08-13T07:00:00Z") })).toBe("OVERDUE");
    expect(deriveOperationalTimeliness({ status: "COMPLETED", dueAt: new Date("2026-08-13T07:00:00Z"), completedAt: new Date("2026-08-13T07:00:01Z"), decisionAt: new Date("2026-08-13T08:00:00Z") })).toBe("COMPLETED_LATE");
  });
});
