import { describe, expect, test } from "vitest";
import {
  classifyDueAt,
  localDateKey,
  occurredOnLocalDate,
  requireIanaTimezone,
} from "./time";

describe("Daily Success centre-local time", () => {
  test("uses authoritative IANA timezones across NSW daylight saving and Queensland", () => {
    const instant = new Date("2026-01-01T13:30:00.000Z");
    expect(localDateKey(instant, "Australia/Sydney")).toBe("2026-01-02");
    expect(localDateKey(instant, "Australia/Brisbane")).toBe("2026-01-01");
  });

  test("uses the actual NSW daylight-saving transition instant", () => {
    const beforeTransition = new Date("2026-10-03T15:59:59.000Z");
    const afterTransition = new Date("2026-10-03T16:00:00.000Z");
    const format = (instant: Date) => new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(instant);
    expect(format(beforeTransition)).toBe("01:59:59");
    expect(format(afterTransition)).toBe("03:00:00");
    expect(localDateKey(beforeTransition, "Australia/Sydney")).toBe("2026-10-04");
    expect(localDateKey(afterTransition, "Australia/Sydney")).toBe("2026-10-04");
  });

  test("classifies earlier and later on the same local date without using UTC midnight", () => {
    const now = new Date("2026-01-01T23:30:00.000Z");
    expect(classifyDueAt(new Date("2026-01-01T22:00:00.000Z"), now, "Australia/Sydney")).toMatchObject({
      bucket: "OVERDUE",
      localDate: "2026-01-02",
      daysFromToday: 0,
    });
    expect(classifyDueAt(new Date("2026-01-02T02:00:00.000Z"), now, "Australia/Sydney")).toMatchObject({
      bucket: "TODAY",
      localDate: "2026-01-02",
      daysFromToday: 0,
    });
  });

  test("uses tomorrow, seven-day inclusive, and eight-day later boundaries", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    expect(classifyDueAt(new Date("2026-03-02T00:00:00.000Z"), now, "Australia/Brisbane").bucket).toBe("TOMORROW");
    expect(classifyDueAt(new Date("2026-03-08T00:00:00.000Z"), now, "Australia/Brisbane").bucket).toBe("DUE_SOON");
    expect(classifyDueAt(new Date("2026-03-09T00:00:00.000Z"), now, "Australia/Brisbane").bucket).toBe("LATER");
  });

  test("crosses leap days, month ends, and year ends by local calendar day", () => {
    expect(classifyDueAt(
      new Date("2028-02-29T12:00:00.000Z"),
      new Date("2028-02-28T12:00:00.000Z"),
      "Australia/Perth",
    ).daysFromToday).toBe(1);
    expect(classifyDueAt(
      new Date("2026-04-01T12:00:00.000Z"),
      new Date("2026-03-31T12:00:00.000Z"),
      "Australia/Adelaide",
    ).daysFromToday).toBe(1);
    expect(classifyDueAt(
      new Date("2027-01-01T12:00:00.000Z"),
      new Date("2026-12-31T12:00:00.000Z"),
      "Australia/Melbourne",
    ).daysFromToday).toBe(1);
  });

  test("derives completed today from the source timestamp in centre time", () => {
    const now = new Date("2026-08-11T15:30:00.000Z");
    expect(occurredOnLocalDate(new Date("2026-08-11T14:30:00.000Z"), now, "Australia/Sydney")).toBe(true);
    expect(occurredOnLocalDate(new Date("2026-08-10T13:30:00.000Z"), now, "Australia/Sydney")).toBe(false);
  });

  test("accepts UTC when it is the authoritative IANA zone", () => {
    expect(requireIanaTimezone("UTC")).toBe("UTC");
  });

  test.each(["", "AEST", "Australia/Not_A_Zone", "../../Sydney"])(
    "rejects an invalid or non-IANA timezone: %s",
    (timezone) => expect(() => requireIanaTimezone(timezone)).toThrow("Daily Success timezone is unavailable"),
  );
});
