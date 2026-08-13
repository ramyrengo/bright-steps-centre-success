import { describe, expect, test } from "vitest";
import { emptyRollup } from "./action-source";
import type {
  QualityActionRollup,
  QualityCentreCoverage,
  QualityReviewSummary,
} from "./contracts";
import {
  actionStatusLabel,
  buildComparison,
  buildFocusGroups,
  classifySection,
  deriveFocus,
  describeIncompleteCoverage,
  quarterLabel,
  sortCentreCards,
  sortSectionResults,
} from "./focus";

/** Every source queried successfully under the viewer's own authorisation. */
const COMPLETE: QualityCentreCoverage = {
  quarterlyReviews: "AVAILABLE",
  correctiveActions: "AVAILABLE",
  uncoveredFindings: "AVAILABLE",
};

function coverage(overrides: Partial<QualityCentreCoverage> = {}): QualityCentreCoverage {
  return { ...COMPLETE, ...overrides };
}

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
      deriveFocus({
        coverage: COMPLETE,
        actions: rollup(),
        uncoveredCriticalFindings: 2,
        latestReview: review(),
      }),
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
      deriveFocus({
        coverage: COMPLETE,
        actions,
        uncoveredCriticalFindings: 0,
        latestReview: review(),
      }).focus,
    ).toBe(expected);
  });

  test("distinguishes a centre with no finalised review from a steady centre", () => {
    const result = deriveFocus({
      coverage: COMPLETE,
      actions: rollup(),
      uncoveredCriticalFindings: 0,
      latestReview: undefined,
    });
    expect(result.focus).toBe("AWAITING_FIRST_REVIEW");
    expect(result.reason).toContain("No finalised internal review");
  });

  test("never claims a centre is steady while open work exists", () => {
    const result = deriveFocus({
      coverage: COMPLETE,
      actions: rollup({ total: 3, waiting: 3 }),
      uncoveredCriticalFindings: 0,
      latestReview: review(),
    });
    expect(result.focus).not.toBe("STEADY");
  });
});

describe("source coverage never becomes a reassuring classification", () => {
  test("an authorised source that returned nothing is a real zero", () => {
    const result = deriveFocus({
      coverage: COMPLETE,
      actions: rollup(),
      uncoveredCriticalFindings: 0,
      latestReview: review(),
    });
    expect(result.focus).toBe("STEADY");
    expect(result.reason).toContain("No open corrective actions");
  });

  test.each([
    ["NOT_AUTHORIZED" as const],
    ["UNAVAILABLE" as const],
  ])("refuses to report steady when corrective actions are %s", (state) => {
    const result = deriveFocus({
      coverage: coverage({ correctiveActions: state }),
      actions: undefined,
      uncoveredCriticalFindings: 0,
      latestReview: review(),
    });
    expect(result.focus).toBe("INFORMATION_INCOMPLETE");
    expect(result.reason).not.toMatch(/no open corrective actions/iu);
  });

  test.each([
    ["NOT_AUTHORIZED" as const],
    ["UNAVAILABLE" as const],
  ])("refuses to claim a first review is awaited when reviews are %s", (state) => {
    const result = deriveFocus({
      coverage: coverage({ quarterlyReviews: state }),
      actions: rollup(),
      uncoveredCriticalFindings: 0,
      latestReview: undefined,
    });
    expect(result.focus).toBe("INFORMATION_INCOMPLETE");
    expect(result.reason).not.toMatch(/no finalised internal review/iu);
  });

  test("refuses to report steady when review findings are outside the viewer's access", () => {
    expect(
      deriveFocus({
        coverage: coverage({ uncoveredFindings: "NOT_AUTHORIZED" }),
        actions: rollup(),
        uncoveredCriticalFindings: undefined,
        latestReview: review(),
      }).focus,
    ).toBe("INFORMATION_INCOMPLETE");
  });

  test("still reports a known critical action when another source is missing", () => {
    const result = deriveFocus({
      coverage: coverage({ quarterlyReviews: "UNAVAILABLE" }),
      actions: rollup({ total: 1, critical: 1 }),
      uncoveredCriticalFindings: 0,
      latestReview: undefined,
    });
    expect(result.focus).toBe("NEEDS_SUPPORT");
  });

  test("still reports known active work when another source is missing", () => {
    expect(
      deriveFocus({
        coverage: coverage({ quarterlyReviews: "NOT_AUTHORIZED" }),
        actions: rollup({ total: 1, dueSoon: 1 }),
        uncoveredCriticalFindings: 0,
        latestReview: undefined,
      }).focus,
    ).toBe("MONITOR");
  });

  test("names what was missing instead of implying a judgement about the centre", () => {
    expect(
      describeIncompleteCoverage(coverage({ correctiveActions: "UNAVAILABLE" })),
    ).toBe(
      "Corrective action information could not be checked, so no overall position is stated for this centre",
    );
    expect(
      describeIncompleteCoverage(
        coverage({ quarterlyReviews: "NOT_AUTHORIZED", uncoveredFindings: "NOT_AUTHORIZED" }),
      ),
    ).toContain("Internal review and review finding information is outside your access");
  });

  test("groups incomplete centres separately rather than mixing them into steady", () => {
    const groups = buildFocusGroups([
      { centreId: "c1", centreName: "Ashgrove", focus: "STEADY" },
      { centreId: "c2", centreName: "Belmore", focus: "INFORMATION_INCOMPLETE" },
      { centreId: "c3", centreName: "Alderley", focus: "NEEDS_SUPPORT" },
    ]);
    expect(groups.map((group) => group.focus)).toEqual([
      "NEEDS_SUPPORT",
      "INFORMATION_INCOMPLETE",
      "STEADY",
    ]);
    const incomplete = groups.find((group) => group.focus === "INFORMATION_INCOMPLETE")!;
    expect(incomplete.centreIds).toEqual(["c2"]);
    expect(incomplete.label).toBe("Information incomplete");
    const steady = groups.find((group) => group.focus === "STEADY")!;
    expect(steady.centreIds).not.toContain("c2");
  });

  test("orders incomplete centres after known active work but before steady", () => {
    const order = sortCentreCards([
      { centreId: "c1", centreName: "Ashgrove", focus: "STEADY" },
      { centreId: "c2", centreName: "Belmore", focus: "INFORMATION_INCOMPLETE" },
      { centreId: "c3", centreName: "Camden", focus: "MONITOR" },
    ]).map((card) => card.centreId);
    expect(order).toEqual(["c3", "c2", "c1"]);
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

describe("section standing against the centre's own review result", () => {
  function section(overrides: Partial<Parameters<typeof classifySection>[0]> = {}) {
    return classifySection({
      score: 80,
      overallScore: 90,
      coveragePercent: 100,
      previousScore: undefined,
      ...overrides,
    });
  }

  test("states a section below the review's own overall result as below it", () => {
    expect(section({ score: 80, overallScore: 90 }).standing).toBe("BELOW_CENTRE_RESULT");
  });

  test("states a relationship rather than an endorsement at or above the result", () => {
    expect(section({ score: 90, overallScore: 90 }).standing).toBe(
      "AT_OR_ABOVE_CENTRE_RESULT",
    );
    expect(section({ score: 95, overallScore: 90 }).standing).toBe(
      "AT_OR_ABOVE_CENTRE_RESULT",
    );
  });

  test("a barely observed section still only claims the factual relationship", () => {
    // Coverage is reported separately as a fact; it must not be turned into a
    // quality judgement in either direction, and must not silently upgrade a
    // thin observation into an endorsement.
    const result = section({ score: 95, overallScore: 90, coveragePercent: 10 });
    expect(result.standing).toBe("AT_OR_ABOVE_CENTRE_RESULT");
    expect(Object.values(result)).not.toContain("STRONG");
  });

  test("reports an unscored section as not scored rather than zero", () => {
    const result = section({ score: undefined });
    expect(result.standing).toBe("NOT_SCORED");
    expect(result.scoreDelta).toBeUndefined();
  });

  test("reports not scored when the review recorded no overall result to compare against", () => {
    expect(section({ overallScore: undefined }).standing).toBe("NOT_SCORED");
  });

  test.each([
    [88, 80, "IMPROVED", 8],
    [80, 88, "DECLINED", -8],
    [80, 80, "STEADY", 0],
    [80.3, 80, "STEADY", 0.3],
  ])("compares section %s against %s as %s", (score, previousScore, trend, delta) => {
    expect(section({ score, previousScore })).toMatchObject({ trend, scoreDelta: delta });
  });

  test("states not comparable when the section has no previous quarter", () => {
    const result = section({ previousScore: undefined });
    expect(result.trend).toBe("NOT_COMPARABLE");
    expect(result.scoreDelta).toBeUndefined();
  });

  test("orders sections below the centre result first, then template order", () => {
    const sections = [
      { sectionId: "s3", sortOrder: 3, standing: "AT_OR_ABOVE_CENTRE_RESULT" as const },
      { sectionId: "s1", sortOrder: 1, standing: "AT_OR_ABOVE_CENTRE_RESULT" as const },
      { sectionId: "s4", sortOrder: 4, standing: "BELOW_CENTRE_RESULT" as const },
      { sectionId: "s2", sortOrder: 2, standing: "NOT_SCORED" as const },
      { sectionId: "s5", sortOrder: 5, standing: "BELOW_CENTRE_RESULT" as const },
    ];
    expect(sortSectionResults(sections).map((item) => item.sectionId)).toEqual([
      "s4", "s5", "s2", "s1", "s3",
    ]);
    expect(sortSectionResults(sections)).toEqual(sortSectionResults(sections.slice().reverse()));
  });
});
