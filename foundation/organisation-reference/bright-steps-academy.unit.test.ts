import { describe, expect, test } from "vitest";
import {
  businessDateContext,
  classifyDueAt,
  localDateKey,
  requireIanaTimezone,
} from "../daily-success/time";
import {
  BRIGHT_STEPS_NON_TRADING_CENTRES,
  BRIGHT_STEPS_ORGANISATION_ID,
  BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM,
  BRIGHT_STEPS_STATES,
  BRIGHT_STEPS_TRADING_CENTRES,
  centreCodeFromName,
  portfolioCentresForStates,
  type AustralianStateCode,
  type CentreTimezone,
} from "./bright-steps-academy";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The approved state-to-timezone rule, restated independently of the dataset. */
const APPROVED_STATE_TIMEZONE: Record<AustralianStateCode, CentreTimezone> = {
  NSW: "Australia/Sydney",
  ACT: "Australia/Sydney",
  VIC: "Australia/Melbourne",
  SA: "Australia/Adelaide",
  WA: "Australia/Perth",
};

const centreByCode = new Map(
  BRIGHT_STEPS_TRADING_CENTRES.map((centre) => [centre.code, centre]),
);

describe("approved Bright Steps Academy reference data", () => {
  test("holds exactly the twelve trading centres", () => {
    expect(BRIGHT_STEPS_TRADING_CENTRES).toHaveLength(12);
    expect(BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.name).sort()).toEqual([
      "Bentleigh",
      "Beresfield",
      "Blair Athol",
      "Calala",
      "Chelsea",
      "Clifton Hill",
      "Elizabeth East",
      "Elizabeth North | Woodford Rd",
      "Horsham",
      "Kwinana",
      "Macgregor",
      "Mandurah",
    ]);
  });

  test("never loads a site that is not trading", () => {
    // A non-trading centre loaded active becomes a phantom in every portfolio,
    // carrying checks nobody can complete and reading "not recorded" forever.
    const loadedNames = new Set(BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.name));
    expect(BRIGHT_STEPS_NON_TRADING_CENTRES).toHaveLength(8);
    for (const excluded of BRIGHT_STEPS_NON_TRADING_CENTRES) {
      expect(loadedNames.has(excluded)).toBe(false);
    }
  });

  test("keeps the two Elizabeth North sites distinguishable", () => {
    // Woodford Rd trades and Laverstock Rd does not, so a code that collapsed
    // both to ELIZABETH-NORTH would silently load the wrong site.
    expect(BRIGHT_STEPS_NON_TRADING_CENTRES).toContain("Elizabeth North | Laverstock Rd");
    expect(centreByCode.get("ELIZABETH-NORTH-WOODFORD-RD")?.name).toBe(
      "Elizabeth North | Woodford Rd",
    );
    expect(centreCodeFromName("Elizabeth North | Laverstock Rd")).not.toBe(
      centreCodeFromName("Elizabeth North | Woodford Rd"),
    );
  });

  test("derives every centre code mechanically from its approved name", () => {
    for (const centre of BRIGHT_STEPS_TRADING_CENTRES) {
      expect(centre.code).toBe(centreCodeFromName(centre.name));
      expect(centre.code.length).toBeLessThanOrEqual(50);
    }
  });

  test("uses unique canonical identifiers throughout", () => {
    const ids = [
      BRIGHT_STEPS_ORGANISATION_ID,
      ...BRIGHT_STEPS_STATES.map((state) => state.id),
      ...BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.id),
      ...BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.placementId),
    ];
    for (const id of ids) expect(id).toMatch(CANONICAL_UUID);
    expect(new Set(ids).size).toBe(ids.length);

    const codes = BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("places every centre in an approved state that exists", () => {
    const stateCodes = new Set(BRIGHT_STEPS_STATES.map((state) => state.code));
    expect([...stateCodes].sort()).toEqual(["ACT", "NSW", "SA", "VIC", "WA"]);
    for (const centre of BRIGHT_STEPS_TRADING_CENTRES) {
      expect(stateCodes.has(centre.stateCode)).toBe(true);
    }
  });

  test("applies the approved state-to-timezone rule to every centre", () => {
    for (const centre of BRIGHT_STEPS_TRADING_CENTRES) {
      expect(centre.timezone).toBe(APPROVED_STATE_TIMEZONE[centre.stateCode]);
    }
  });

  test("covers all four offset behaviours with resolvable IANA zones", () => {
    const zones = new Set(BRIGHT_STEPS_TRADING_CENTRES.map((centre) => centre.timezone));
    expect([...zones].sort()).toEqual([
      "Australia/Adelaide",
      "Australia/Melbourne",
      "Australia/Perth",
      "Australia/Sydney",
    ]);
    for (const zone of zones) expect(requireIanaTimezone(zone)).toBe(zone);
  });

  test("records the seeding convention as an exact instant", () => {
    // A seeding convention, not an opening date. Asserted so a later edit that
    // reinterprets it as history has to change a test that says otherwise.
    expect(BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("derives an Area Manager portfolio as explicit centres", () => {
    // package-policy.ts rejects an organisational-unit scope for area_manager,
    // so a multi-state portfolio has to resolve to a centre list.
    expect(portfolioCentresForStates(["NSW", "ACT"]).map((centre) => centre.name)).toEqual([
      "Beresfield",
      "Calala",
      "Macgregor",
    ]);
    expect(portfolioCentresForStates(["VIC"]).map((centre) => centre.name)).toEqual([
      "Bentleigh",
      "Chelsea",
      "Clifton Hill",
      "Horsham",
    ]);
    expect(portfolioCentresForStates(["SA"])).toHaveLength(3);
    expect(portfolioCentresForStates(["WA"]).map((centre) => centre.name)).toEqual([
      "Kwinana",
      "Mandurah",
    ]);
    expect(portfolioCentresForStates([])).toHaveLength(0);
  });
});

/**
 * The estate spans four distinct offset behaviours, so "today" is not one date
 * across Bright Steps. These exercise the real centre timezones through the
 * product's own conversion, not through arithmetic restated in the test.
 */
describe("trading estate timezone behaviour", () => {
  const sydney = centreByCode.get("BERESFIELD")!;
  const melbourne = centreByCode.get("BENTLEIGH")!;
  const adelaide = centreByCode.get("BLAIR-ATHOL")!;
  const perth = centreByCode.get("KWINANA")!;

  test("ACST: the Adelaide half-hour offset changes the business date", () => {
    // 14:15Z in winter is 23:45 in Adelaide (UTC+9:30) but already 00:15 the
    // next day in Sydney (UTC+10). A whole-hour approximation of Adelaide would
    // move Blair Athol's business date a day early.
    const at = new Date("2026-06-15T14:15:00.000Z");
    expect(localDateKey(at, adelaide.timezone)).toBe("2026-06-15");
    expect(localDateKey(at, sydney.timezone)).toBe("2026-06-16");
    expect(localDateKey(at, melbourne.timezone)).toBe("2026-06-16");
    expect(localDateKey(at, perth.timezone)).toBe("2026-06-15");
  });

  test("ACDT: the half-hour offset still discriminates under daylight saving", () => {
    // 13:15Z in summer is 23:45 in Adelaide (UTC+10:30) and 00:15 in Sydney
    // (UTC+11). The half hour survives the daylight-saving shift.
    const at = new Date("2026-01-15T13:15:00.000Z");
    expect(localDateKey(at, adelaide.timezone)).toBe("2026-01-15");
    expect(localDateKey(at, sydney.timezone)).toBe("2026-01-16");
  });

  test("ACST: Adelaide's daylight-saving end keeps one local date", () => {
    // 2026-04-05 is the SA transition: the local clock steps back from
    // 02:59:59 ACDT to 02:00:00 ACST, so local time repeats within one date.
    const before = new Date("2026-04-04T16:29:59.000Z");
    const after = new Date("2026-04-04T16:30:00.000Z");
    expect(localDateKey(before, adelaide.timezone)).toBe("2026-04-05");
    expect(localDateKey(after, adelaide.timezone)).toBe("2026-04-05");
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  test("AWST: Perth's business date rolls at the same instant all year", () => {
    // Perth observes no daylight saving. Its local midnight is 16:00Z in
    // January and 16:00Z in July; Sydney's moves between 13:00Z and 14:00Z.
    expect(localDateKey(new Date("2026-01-15T15:59:00.000Z"), perth.timezone)).toBe("2026-01-15");
    expect(localDateKey(new Date("2026-01-15T16:00:00.000Z"), perth.timezone)).toBe("2026-01-16");
    expect(localDateKey(new Date("2026-07-15T15:59:00.000Z"), perth.timezone)).toBe("2026-07-15");
    expect(localDateKey(new Date("2026-07-15T16:00:00.000Z"), perth.timezone)).toBe("2026-07-16");

    expect(localDateKey(new Date("2026-01-15T13:00:00.000Z"), sydney.timezone)).toBe("2026-01-16");
    expect(localDateKey(new Date("2026-07-15T13:00:00.000Z"), sydney.timezone)).toBe("2026-07-15");
  });

  test("DST divergence: one second moves Kwinana and Beresfield onto the same date", () => {
    // 2026-10-03T16:00:00Z is the NSW/VIC transition — 02:00 AEST becomes
    // 03:00 AEDT. Perth does not move, Adelaide has not moved yet (SA switches
    // half an hour later), so all three behave differently across one second.
    const beforeTransition = new Date("2026-10-03T15:59:59.000Z");
    const afterTransition = new Date("2026-10-03T16:00:00.000Z");

    // Before: Kwinana is still on the 3rd while Beresfield is already on the 4th.
    expect(localDateKey(beforeTransition, perth.timezone)).toBe("2026-10-03");
    expect(localDateKey(beforeTransition, sydney.timezone)).toBe("2026-10-04");
    expect(localDateKey(beforeTransition, melbourne.timezone)).toBe("2026-10-04");
    expect(localDateKey(beforeTransition, adelaide.timezone)).toBe("2026-10-04");

    // After: Sydney jumps an hour, Perth simply rolls over, and the two centres
    // agree on the date again.
    expect(localDateKey(afterTransition, perth.timezone)).toBe("2026-10-04");
    expect(localDateKey(afterTransition, sydney.timezone)).toBe("2026-10-04");

    expect(businessDateContext("centre", perth.id, perth.timezone, beforeTransition)).toEqual({
      scope: "centre",
      id: perth.id,
      timezone: "Australia/Perth",
      date: "2026-10-03",
    });
    expect(businessDateContext("centre", sydney.id, sydney.timezone, beforeTransition)).toEqual({
      scope: "centre",
      id: sydney.id,
      timezone: "Australia/Sydney",
      date: "2026-10-04",
    });
  });

  test("DST divergence: the same due instant buckets differently per centre", () => {
    // A corrective action due at 2026-10-04T02:00:00Z, judged at the NSW
    // transition instant. Beresfield has already reached the 4th, so the action
    // is due today; Kwinana is still on the 3rd, so it is due tomorrow.
    const decisionAt = new Date("2026-10-03T15:59:59.000Z");
    const dueAt = new Date("2026-10-04T02:00:00.000Z");

    const atBeresfield = classifyDueAt(dueAt, decisionAt, sydney.timezone);
    expect(atBeresfield.localDate).toBe("2026-10-04");
    expect(atBeresfield.bucket).toBe("TODAY");
    expect(atBeresfield.daysFromToday).toBe(0);

    const atKwinana = classifyDueAt(dueAt, decisionAt, perth.timezone);
    expect(atKwinana.localDate).toBe("2026-10-04");
    expect(atKwinana.bucket).toBe("TOMORROW");
    expect(atKwinana.daysFromToday).toBe(1);
  });
});
