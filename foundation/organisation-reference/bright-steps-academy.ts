/**
 * The Bright Steps Academy organisation, states, and trading centres as
 * approved by the Product Owner on 2026-08-14.
 *
 * This file is reviewed reference data, not an integration. ADR-0010 remains
 * deferred and forbids building an import, sync, or reconciliation job against
 * an external system of record. Nothing here reads an upstream system: the
 * foundation database stays the authority, and this module is simply the
 * approved values in a form a reviewer can read and a test can assert.
 *
 * It deliberately holds no personal data. People are provisioned only through
 * the Milestone 2C invitation lifecycle, never from a committed dataset.
 */

/**
 * SEEDING CONVENTION — NOT HISTORY.
 *
 * Every effective-dated row this dataset produces starts at 2026-01-01T00:00:00Z.
 * That instant is an approved seeding convention chosen so the whole structure is
 * already effective on the day it is loaded. It is NOT a centre opening date, NOT
 * an appointment date, and NOT evidence of when anything actually began. Do not
 * read it as history, and do not report on it as if it were.
 *
 * UTC is used rather than a local midnight because a single organisation spanning
 * four offsets has no single local midnight, and ADR-0004 resolves effective
 * windows on instants.
 */
export const BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM = new Date(
  "2026-01-01T00:00:00.000Z",
);

/** The date the Product Owner approved the values in this file. */
export const BRIGHT_STEPS_DATASET_APPROVED_ON = "2026-08-14";

/**
 * Incremented whenever an approved value in this file changes, so an audit row
 * records which revision of the reviewed dataset produced it.
 */
export const BRIGHT_STEPS_DATASET_VERSION = 1;

export const BRIGHT_STEPS_ORGANISATION_ID =
  "b5c30000-0000-4000-8000-000000000001";

export const BRIGHT_STEPS_ORGANISATION_NAME = "Bright Steps Academy";

export type AustralianStateCode = "NSW" | "ACT" | "VIC" | "SA" | "WA";

/**
 * The four distinct offset behaviours across the trading estate:
 * Sydney and Melbourne are UTC+10 with daylight saving, Adelaide is UTC+9:30
 * with daylight saving (a half-hour base offset), and Perth is UTC+8 with no
 * daylight saving at all. They are IANA identifiers, never fixed offsets.
 */
export type CentreTimezone =
  | "Australia/Sydney"
  | "Australia/Melbourne"
  | "Australia/Adelaide"
  | "Australia/Perth";

export interface ReferenceOrganisationalUnit {
  id: string;
  code: AustralianStateCode;
  /**
   * Held identical to the code on purpose. The approved data names each state
   * by its code, and expanding it to a long form here would be an engineering
   * invention in a field a Product Owner has not reviewed.
   */
  name: string;
  kind: "state";
}

export interface ReferenceCentre {
  id: string;
  /**
   * A deterministic upper-case slug of the approved name. Centre codes were not
   * supplied and `centres.code` is NOT NULL and unique per organisation, so the
   * code is derived mechanically rather than chosen. `centreCodeFromName`
   * defines the derivation and a unit test asserts every code matches it.
   */
  code: string;
  name: string;
  stateCode: AustralianStateCode;
  timezone: CentreTimezone;
  /** Foreign key into `ReferenceOrganisationalUnit`, materialised as a placement. */
  placementId: string;
}

/**
 * Derives a centre code from an approved centre name: upper case, every run of
 * non-alphanumeric characters collapsed to a single hyphen, ends trimmed.
 *
 * The pipe in "Elizabeth North | Woodford Rd" is load-bearing — a second
 * Elizabeth North site on Laverstock Rd exists and is not trading — so the
 * derivation must keep the two distinguishable rather than collapsing both to
 * ELIZABETH-NORTH.
 */
export function centreCodeFromName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const BRIGHT_STEPS_STATES: readonly ReferenceOrganisationalUnit[] =
  Object.freeze([
    { id: "b5c30000-0000-4000-8000-000000000011", code: "NSW", name: "NSW", kind: "state" },
    { id: "b5c30000-0000-4000-8000-000000000012", code: "ACT", name: "ACT", kind: "state" },
    { id: "b5c30000-0000-4000-8000-000000000013", code: "VIC", name: "VIC", kind: "state" },
    { id: "b5c30000-0000-4000-8000-000000000014", code: "SA", name: "SA", kind: "state" },
    { id: "b5c30000-0000-4000-8000-000000000015", code: "WA", name: "WA", kind: "state" },
  ] as const satisfies readonly ReferenceOrganisationalUnit[]);

/**
 * The twelve trading centres. This list is exhaustive: a centre that is not
 * here is not loaded, and `BRIGHT_STEPS_NON_TRADING_CENTRES` records the sites
 * that were considered and deliberately excluded.
 */
export const BRIGHT_STEPS_TRADING_CENTRES: readonly ReferenceCentre[] =
  Object.freeze([
    {
      id: "b5c30000-0000-4000-8000-000000000021",
      code: "BERESFIELD",
      name: "Beresfield",
      stateCode: "NSW",
      timezone: "Australia/Sydney",
      placementId: "b5c30000-0000-4000-8000-000000000041",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000022",
      code: "CALALA",
      name: "Calala",
      stateCode: "NSW",
      timezone: "Australia/Sydney",
      placementId: "b5c30000-0000-4000-8000-000000000042",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000023",
      code: "MACGREGOR",
      name: "Macgregor",
      stateCode: "ACT",
      timezone: "Australia/Sydney",
      placementId: "b5c30000-0000-4000-8000-000000000043",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000024",
      code: "BENTLEIGH",
      name: "Bentleigh",
      stateCode: "VIC",
      timezone: "Australia/Melbourne",
      placementId: "b5c30000-0000-4000-8000-000000000044",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000025",
      code: "CHELSEA",
      name: "Chelsea",
      stateCode: "VIC",
      timezone: "Australia/Melbourne",
      placementId: "b5c30000-0000-4000-8000-000000000045",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000026",
      code: "CLIFTON-HILL",
      name: "Clifton Hill",
      stateCode: "VIC",
      timezone: "Australia/Melbourne",
      placementId: "b5c30000-0000-4000-8000-000000000046",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000027",
      code: "HORSHAM",
      name: "Horsham",
      stateCode: "VIC",
      timezone: "Australia/Melbourne",
      placementId: "b5c30000-0000-4000-8000-000000000047",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000028",
      code: "BLAIR-ATHOL",
      name: "Blair Athol",
      stateCode: "SA",
      timezone: "Australia/Adelaide",
      placementId: "b5c30000-0000-4000-8000-000000000048",
    },
    {
      id: "b5c30000-0000-4000-8000-000000000029",
      code: "ELIZABETH-EAST",
      name: "Elizabeth East",
      stateCode: "SA",
      timezone: "Australia/Adelaide",
      placementId: "b5c30000-0000-4000-8000-000000000049",
    },
    {
      id: "b5c30000-0000-4000-8000-00000000002a",
      code: "ELIZABETH-NORTH-WOODFORD-RD",
      name: "Elizabeth North | Woodford Rd",
      stateCode: "SA",
      timezone: "Australia/Adelaide",
      placementId: "b5c30000-0000-4000-8000-00000000004a",
    },
    {
      id: "b5c30000-0000-4000-8000-00000000002b",
      code: "KWINANA",
      name: "Kwinana",
      stateCode: "WA",
      timezone: "Australia/Perth",
      placementId: "b5c30000-0000-4000-8000-00000000004b",
    },
    {
      id: "b5c30000-0000-4000-8000-00000000002c",
      code: "MANDURAH",
      name: "Mandurah",
      stateCode: "WA",
      timezone: "Australia/Perth",
      placementId: "b5c30000-0000-4000-8000-00000000004c",
    },
  ] as const satisfies readonly ReferenceCentre[]);

/**
 * Sites that exist in the business but are NOT trading, recorded here so the
 * exclusion is a reviewed decision rather than an omission somebody later
 * "fixes".
 *
 * Loading one of these as an active centre would put a phantom centre in every
 * portfolio, give it scheduled checks nobody can complete, and leave it showing
 * "not recorded" forever — which the product reads as unknown, not as fine.
 * A test asserts none of these names reaches the load set.
 */
export const BRIGHT_STEPS_NON_TRADING_CENTRES: readonly string[] = Object.freeze(
  [
    "Bellbird",
    "Bundoora",
    "Dubbo",
    "Elizabeth North | Laverstock Rd",
    "Elizabeth Vale",
    "Frankston",
    "Inverell",
    "Lalor",
  ],
);

/**
 * The centres an Area Manager portfolio covers for a set of states.
 *
 * Area Manager packages are validated by `people-access/package-policy.ts`,
 * which requires an explicit centre portfolio and rejects an organisational-unit
 * scope. So a portfolio has to be expressed as centres even though the states
 * exist in the hierarchy, and this derives that list from the approved data
 * rather than leaving an administrator to retype it.
 */
export function portfolioCentresForStates(
  stateCodes: readonly AustralianStateCode[],
): readonly ReferenceCentre[] {
  const wanted = new Set(stateCodes);
  return BRIGHT_STEPS_TRADING_CENTRES.filter((centre) =>
    wanted.has(centre.stateCode),
  );
}
