import { describe, expect, test } from "vitest";
import {
  aggregateByCentre,
  responsibilityFor,
  type QualityActionRow,
  type ResponsibilityContext,
} from "./action-source";

const CENTRE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CENTRE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOMEONE_ELSE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DECISION_AT = new Date("2026-08-12T02:00:00.000Z");
const SYDNEY = "Australia/Sydney";

function row(overrides: Partial<QualityActionRow> = {}): QualityActionRow {
  return {
    record_kind: "open",
    id: "11111111-1111-4111-8111-111111111111",
    centre_id: CENTRE,
    title: "Synthetic corrective action",
    severity: "MEDIUM",
    status: "OPEN",
    due_at: new Date("2026-08-14T02:00:00.000Z"),
    owner_principal_id: SOMEONE_ELSE,
    remediation_submitted_by_principal_id: null,
    independent_verification_required: false,
    closed_at: null,
    ...overrides,
  };
}

function context(overrides: Partial<ResponsibilityContext> = {}): ResponsibilityContext {
  return {
    principalId: ME,
    remediateCentreIds: new Set<string>(),
    verifyCentreIds: new Set<string>(),
    ...overrides,
  };
}

function aggregate(rows: QualityActionRow[], responsibility = context()) {
  return aggregateByCentre(rows, {
    decisionAt: DECISION_AT,
    timezoneByCentreId: new Map([
      [CENTRE, SYDNEY],
      [OTHER_CENTRE, "Australia/Brisbane"],
    ]),
    responsibility,
  });
}

describe("responsibility classification", () => {
  test("assigns owned remediable work to the current user", () => {
    expect(
      responsibilityFor(
        row({ owner_principal_id: ME }),
        context({ remediateCentreIds: new Set([CENTRE]) }),
      ),
    ).toBe("YOU_NEED_TO_ACT");
  });

  test("assigns unowned centre work to the centre, not to the viewer", () => {
    expect(
      responsibilityFor(row(), context({ remediateCentreIds: new Set([CENTRE]) })),
    ).toBe("CENTRE_NEEDS_TO_ACT");
  });

  test("gives verification work to an eligible independent verifier", () => {
    expect(
      responsibilityFor(
        row({
          status: "VERIFICATION_REQUIRED",
          independent_verification_required: true,
          remediation_submitted_by_principal_id: SOMEONE_ELSE,
        }),
        context({ verifyCentreIds: new Set([CENTRE]) }),
      ),
    ).toBe("YOU_NEED_TO_ACT");
  });

  test("preserves independence: the submitter cannot verify their own remediation", () => {
    expect(
      responsibilityFor(
        row({
          status: "VERIFICATION_REQUIRED",
          independent_verification_required: true,
          remediation_submitted_by_principal_id: ME,
        }),
        context({ verifyCentreIds: new Set([CENTRE]) }),
      ),
    ).toBe("WAITING_ON_SOMEONE_ELSE");
  });

  test("marks verification work the viewer cannot perform as waiting", () => {
    expect(
      responsibilityFor(row({ status: "VERIFICATION_REQUIRED" }), context()),
    ).toBe("WAITING_ON_SOMEONE_ELSE");
  });

  test("falls back to awareness where the viewer holds no centre responsibility", () => {
    expect(responsibilityFor(row(), context())).toBe("FOR_YOUR_AWARENESS");
  });
});

describe("per-centre aggregation", () => {
  test("counts overdue, due-soon, verification and returned states from source rows", () => {
    const result = aggregate([
      row({ id: "a1", due_at: new Date("2026-08-01T02:00:00.000Z"), severity: "CRITICAL" }),
      row({ id: "a2", due_at: new Date("2026-08-13T02:00:00.000Z") }),
      row({ id: "a3", status: "VERIFICATION_REQUIRED" }),
      row({ id: "a4", status: "REJECTED", due_at: new Date("2026-09-30T02:00:00.000Z") }),
    ]);
    expect(result.get(CENTRE)?.rollup).toMatchObject({
      total: 4,
      critical: 1,
      overdue: 1,
      returned: 1,
      awaitingVerification: 1,
    });
  });

  test("uses centre-local calendar days for the due-soon window", () => {
    const result = aggregate([
      row({ id: "a1", due_at: new Date("2026-08-18T13:59:00.000Z") }),
      row({ id: "a2", due_at: new Date("2026-08-19T14:01:00.000Z") }),
    ]);
    expect(result.get(CENTRE)?.rollup.dueSoon).toBe(1);
    expect(result.get(CENTRE)?.openItems.map((item) => item.dueBucket)).toEqual([
      "DUE_SOON",
      "LATER",
    ]);
  });

  test("keeps centres separate and never mixes another centre's counts in", () => {
    const result = aggregate([
      row({ id: "a1", centre_id: CENTRE, severity: "CRITICAL" }),
      row({ id: "a2", centre_id: OTHER_CENTRE, severity: "CRITICAL" }),
    ]);
    expect(result.get(CENTRE)?.rollup.critical).toBe(1);
    expect(result.get(OTHER_CENTRE)?.rollup.critical).toBe(1);
  });

  test("drops rows for a centre with no resolved timezone rather than guessing one", () => {
    const result = aggregateByCentre([row({ centre_id: "unknown-centre" })], {
      decisionAt: DECISION_AT,
      timezoneByCentreId: new Map(),
      responsibility: context(),
    });
    expect(result.size).toBe(0);
  });

  test("counts uncovered critical findings separately from corrective actions", () => {
    const result = aggregate([
      row({ record_kind: "uncovered_finding", id: "f1", severity: "CRITICAL", due_at: null }),
    ]);
    expect(result.get(CENTRE)).toMatchObject({
      uncoveredCriticalFindings: 1,
      rollup: { total: 0, critical: 0 },
    });
  });

  test("records recent completions without counting them as open work", () => {
    const result = aggregate([
      row({
        record_kind: "closed",
        id: "c1",
        status: "CLOSED",
        closed_at: new Date("2026-08-10T02:00:00.000Z"),
      }),
    ]);
    expect(result.get(CENTRE)).toMatchObject({
      completedLast30Days: 1,
      rollup: { total: 0 },
    });
    expect(result.get(CENTRE)?.completedItems[0]).toMatchObject({
      closedLocalDate: "2026-08-10",
      cta: { route: "/centre/actions/c1" },
    });
  });

  test("ignores an open action with no due date instead of inventing one", () => {
    const result = aggregate([row({ due_at: null })]);
    expect(result.get(CENTRE)?.rollup.total).toBe(0);
  });

  test("orders open work critical-first then by due proximity, deterministically", () => {
    const result = aggregate([
      row({ id: "b", severity: "LOW", due_at: new Date("2026-08-13T02:00:00.000Z") }),
      row({ id: "a", severity: "CRITICAL", due_at: new Date("2026-08-30T02:00:00.000Z") }),
      row({ id: "c", severity: "LOW", due_at: new Date("2026-08-13T02:00:00.000Z") }),
    ]);
    expect(result.get(CENTRE)?.openItems.map((item) => item.correctiveActionId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("routes an eligible verification item to the verification workflow", () => {
    const result = aggregate(
      [row({ id: "v1", status: "VERIFICATION_REQUIRED" })],
      context({ verifyCentreIds: new Set([CENTRE]) }),
    );
    expect(result.get(CENTRE)?.openItems[0]).toMatchObject({
      responsibility: "YOU_NEED_TO_ACT",
      statusLabel: "Waiting for verification",
      cta: { label: "Verify action", route: "/area-manager/verification/v1" },
    });
  });

  test("produces an empty aggregate map when the source returns nothing", () => {
    expect(aggregate([]).size).toBe(0);
  });
});
