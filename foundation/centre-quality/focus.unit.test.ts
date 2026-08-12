import { describe, expect, test } from "vitest";
import { emptyRollup } from "./action-source";
import type { QualityActionRollup, QualityReviewSummary } from "./contracts";
import {
  actionStatusLabel,
  buildComparison,
  buildFocusGroups,
  deriveFocus,
  quarterLabel,
  sortCentreCards,
} from "./focus";

function review(overrides: Partial<QualityReviewSummary> = {}): QualityReviewSummary {
  return {
    auditRunId: "11111111-1111-4111-8111-111111111111",
    reviewPeriodStart: "2026-07-01",
    quarterLabel: "Q3 2026",
    finalisedAt: "2026-07-20T02:00:00.000Z",
    templateVersionId: "22222222-2222-4222-8222-222222222222",
    overallScore: 92,
    performanceBandLabel: "Strong",
    criticalFindingCount: 0,
    highFindingCount: 0,
    actionCount: 0,
    positivePracticeCount: 2,
    acknowledged: true,
    ...overrides,
  };
}

function rollup(overrides: Partial<QualityActionRollup> = {}): QualityActionRollup {
  return { ...emptyRollup(), ...overrides };
}

describe("quarter labelling", () => {
  test.each([
    ["2026-01-01", "Q1 2026"],
    ["2026-04-01", "Q2 2026"],
    ["2026-07-01", "Q3 2026"],
    ["2026-10-01", "Q4 2026"],
  ])("formats the stored quarter start %s as %s", (start, expected) => {
    expect(quarterLabel(start)).toBe(expected);
  });

  test("returns the raw value rather than inventing a quarter for unexpected input", () => {
    expect(quarterLabel("2026-05-14")).toBe("2026-05-14");
    expect(quarterLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("previous-quarter comparison", () => {
  test("reports unavailable rather than zero when no earlier review exists", () => {
    const comparison = buildComparison(review(), undefined);
    expect(comparison).toMatchObject({
      available: false,
      comparable: false,
      trend: "NOT_COMPARABLE",
    });
    expect(comparison.scoreDelta).toBeUndefined();
    expect(comparison.criticalDelta).toBeUndefined();
    expect(comparison.previous).toBeUndefined();
    expect(comparison.note).toContain("No earlier finalised review");
  });

  test("reports unavailable when the centre has no finalised review at all", () => {
    expect(buildComparison(undefined, undefined)).toEqual({
      available: false,
      comparable: false,
      trend: "NOT_COMPARABLE",
    });
  });

  test("refuses to compare scores across different template versions", () => {
    const comparison = buildComparison(
      review({ overallScore: 95 }),
      review({
        overallScore: 60,
        templateVersionId: "33333333-3333-4333-8333-333333333333",
        criticalFindingCount: 3,
      }),
    );
    expect(comparison).toMatchObject({ available: true, comparable: false, trend: "NOT_COMPARABLE" });
    expect(comparison.scoreDelta).toBeUndefined();
    expect(comparison.criticalDelta).toBe(-3);
    expect(comparison.note).toContain("template changed");
  });

  test("refuses to compare when either review recorded no overall result", () => {
    const comparison = buildComparison(
      review({ overallScore: undefined }),
      review({ overallScore: 70 }),
    );
    expect(comparison).toMatchObject({ comparable: false, trend: "NOT_COMPARABLE" });
    expect(comparison.scoreDelta).toBeUndefined();
  });

  test.each([
    [95, 90, "IMPROVED", 5],
    [90, 95, "DECLINED", -5],
    [90, 90, "STEADY", 0],
    [90.2, 90, "STEADY", 0.2],
  ])("compares %s against %s as %s", (latest, previous, trend, delta) => {
    const comparison = buildComparison(
      review({ overallScore: latest }),
      review({ overallScore: previous }),
    );
    expect(comparison).toMatchObject({ available: true, comparable: true, trend, scoreDelta: delta });
  });
});

describe("support focus derivation", () => {
  test("treats an uncovered critical finding as the highest support signal", () => {
    expect(
      deriveFocus({ actions: rollup(), uncoveredCriticalFindings: 2, latestReview: review() }),
    ).toEqual({
      focus: "NEEDS_SUPPORT",
      reason: "2 critical review findings have no active corrective action",
    });
  });

  test.each([
    [rollup({ total: 1, critical: 1 }), "NEEDS_SUPPORT"],
    [rollup({ total: 1, overdue: 1 }), "NEEDS_SUPPORT"],
    [rollup({ total: 1, returned: 1 }), "MONITOR"],
    [rollup({ total: 1, awaitingVerification: 1 }), "MONITOR"],
    [rollup({ total: 1, dueSoon: 1 }), "MONITOR"],
    [rollup({ total: 1 }), "MONITOR"],
    [rollup(), "STEADY"],
  ])("classifies an action rollup as %#", (actions, expected) => {
    expect(
      deriveFocus({ actions, uncoveredCriticalFindings: 0, latestReview: review() }).focus,
    ).toBe(expected);
  });

  test("distinguishes a centre with no finalised review from a steady centre", () => {
    const result = deriveFocus({
      actions: rollup(),
      uncoveredCriticalFindings: 0,
      latestReview: undefined,
    });
    expect(result.focus).toBe("AWAITING_FIRST_REVIEW");
    expect(result.reason).toContain("No finalised internal review");
  });

  test("never claims a centre is steady while open work exists", () => {
    const result = deriveFocus({
      actions: rollup({ total: 3, waiting: 3 }),
      uncoveredCriticalFindings: 0,
      latestReview: review(),
    });
    expect(result.focus).not.toBe("STEADY");
  });
});

describe("non-punitive grouping and deterministic ordering", () => {
  const centres = [
    { centreId: "c3", centreName: "Zephyr Centre", focus: "NEEDS_SUPPORT" as const },
    { centreId: "c1", centreName: "Ashgrove Centre", focus: "STEADY" as const },
    { centreId: "c2", centreName: "Belmore Centre", focus: "NEEDS_SUPPORT" as const },
    { centreId: "c4", centreName: "Alderley Centre", focus: "MONITOR" as const },
  ];

  test("orders by support group then centre name, never by a score", () => {
    expect(sortCentreCards(centres).map((centre) => centre.centreId)).toEqual([
      "c2",
      "c3",
      "c4",
      "c1",
    ]);
  });

  test("groups centres for coaching and sorts alphabetically inside a group", () => {
    const groups = buildFocusGroups(centres);
    expect(groups.map((group) => group.focus)).toEqual(["NEEDS_SUPPORT", "MONITOR", "STEADY"]);
    expect(groups[0].centreIds).toEqual(["c2", "c3"]);
    expect(groups[0].label).toBe("Needs support now");
  });

  test("omits empty groups instead of rendering an empty rank", () => {
    expect(
      buildFocusGroups([{ centreId: "c1", centreName: "Only", focus: "STEADY" }]).map(
        (group) => group.focus,
      ),
    ).toEqual(["STEADY"]);
  });

  test("uses supportive, non-ranking group language", () => {
    const labels = buildFocusGroups(centres).map((group) => `${group.label} ${group.description}`);
    expect(labels.join(" ")).not.toMatch(/\brank|\bworst|\bbest|\bbottom|\btop\b|league|score/iu);
  });
});

describe("status labelling", () => {
  test("renders stored statuses as product language", () => {
    expect(actionStatusLabel("VERIFICATION_REQUIRED")).toBe("Waiting for verification");
    expect(actionStatusLabel("MORE_INFORMATION_REQUIRED")).toBe("More information needed");
    expect(actionStatusLabel("REJECTED")).toBe("Returned for more work");
  });

  test("falls back safely for an unrecognised status without leaking raw enum text", () => {
    expect(actionStatusLabel("SOME_FUTURE_STATE")).toBe("Active");
  });
});
