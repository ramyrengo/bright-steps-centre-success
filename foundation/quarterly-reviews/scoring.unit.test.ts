import { describe, expect, test } from "vitest";
import {
  calculateAuditScore,
  findPerformanceBand,
  validatePerformanceBands,
} from "./scoring";

const rules = [
  { outcome: "COMPLIANT", scoreFactor: 1, denominatorTreatment: "included", requiresReason: false },
  { outcome: "POSITIVE_PRACTICE", scoreFactor: 1, denominatorTreatment: "included", requiresReason: false },
  { outcome: "PARTIALLY_COMPLIANT", scoreFactor: 0.5, denominatorTreatment: "included", requiresReason: false },
  { outcome: "NON_COMPLIANT", scoreFactor: 0, denominatorTreatment: "included", requiresReason: false },
  { outcome: "IMMEDIATE_ACTION_REQUIRED", scoreFactor: 0, denominatorTreatment: "included", requiresReason: true },
  { outcome: "NOT_APPLICABLE", scoreFactor: null, denominatorTreatment: "excluded", requiresReason: true },
  { outcome: "NOT_OBSERVED", scoreFactor: null, denominatorTreatment: "excluded", requiresReason: true },
] as const;

const bands = [
  { code: "STRONG", label: "Strong", minimumScore: 90, maximumScore: 100, priority: 1 },
  { code: "MINIMUM_STANDARD_MET", label: "Minimum Standard Met / Improvement Required", minimumScore: 80, maximumScore: 90, priority: 2 },
  { code: "AT_RISK", label: "At Risk", minimumScore: 70, maximumScore: 80, priority: 3 },
  { code: "PRIORITY_INTERVENTION", label: "Priority Intervention", minimumScore: 0, maximumScore: 70, priority: 4 },
];

describe("quarterly review scoring", () => {
  test("weights partial outcomes and excludes not-applicable items", () => {
    const result = calculateAuditScore({
      items: [
        { itemId: "1", sectionId: "a", weight: 2, scored: true, critical: false, outcome: "COMPLIANT" },
        { itemId: "2", sectionId: "a", weight: 2, scored: true, critical: false, outcome: "PARTIALLY_COMPLIANT" },
        { itemId: "3", sectionId: "b", weight: 8, scored: true, critical: false, outcome: "NOT_APPLICABLE", comment: "Not used at this centre" },
      ],
      outcomeRules: rules,
      bands,
      roundingScale: 1,
    });

    expect(result.overallScore).toBe(75);
    expect(result.band?.code).toBe("AT_RISK");
    expect(result.coveragePercent).toBe(66.7);
    expect(result.validationIssues).toEqual([]);
  });

  test("keeps critical risk separate from a strong percentage", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      itemId: String(index),
      sectionId: "a",
      weight: 1,
      scored: true,
      critical: index === 0,
      outcome: index === 0 ? ("IMMEDIATE_ACTION_REQUIRED" as const) : ("COMPLIANT" as const),
      comment: index === 0 ? "Immediate synthetic test concern" : undefined,
      findingSeverity: index === 0 ? ("CRITICAL" as const) : undefined,
      findingCreated: index === 0,
      actionCreated: index === 0,
    }));
    const result = calculateAuditScore({ items, outcomeRules: rules, bands, roundingScale: 1 });

    expect(result.overallScore).toBe(95);
    expect(result.band?.code).toBe("STRONG");
    expect(result.riskStatus).toBe("CRITICAL");
  });

  test("requires a reason and a visible finding/action for a critical unobserved item", () => {
    const result = calculateAuditScore({
      items: [{ itemId: "critical", sectionId: "a", weight: 1, scored: true, critical: true, outcome: "NOT_OBSERVED" }],
      outcomeRules: rules,
      bands,
      roundingScale: 1,
    });

    expect(result.validationIssues.map((issue) => issue.code)).toEqual([
      "reason_required",
      "critical_not_observed_unresolved",
    ]);
    expect(result.riskStatus).toBe("PRIORITY_INTERVENTION");
  });

  test.each([
    [0, "PRIORITY_INTERVENTION"],
    [69.99, "PRIORITY_INTERVENTION"],
    [70, "AT_RISK"],
    [79.99, "AT_RISK"],
    [80, "MINIMUM_STANDARD_MET"],
    [89.99, "MINIMUM_STANDARD_MET"],
    [89.995, "MINIMUM_STANDARD_MET"],
    [90, "STRONG"],
    [99.99, "STRONG"],
    [100, "STRONG"],
  ])("maps boundary score %s to exactly one band", (score, expectedCode) => {
    expect(findPerformanceBand(score, bands)?.code).toBe(expectedCode);
  });

  test("assigns a rounding edge only after policy rounding", () => {
    const result = calculateAuditScore({
      items: [{
        itemId: "rounding-edge",
        sectionId: "a",
        weight: 1,
        scored: true,
        critical: false,
        outcome: "COMPLIANT",
      }],
      outcomeRules: [{
        outcome: "COMPLIANT",
        scoreFactor: 0.89995,
        denominatorTreatment: "included",
        requiresReason: false,
      }],
      bands,
      roundingScale: 2,
    });

    expect(result.overallScore).toBe(90);
    expect(result.band?.code).toBe("STRONG");
  });

  test.each([
    [[...bands, { code: "OVERLAP", label: "Overlap", minimumScore: 69, maximumScore: 71, priority: 5 }]],
    [[
      ...bands.filter((band) => band.code !== "AT_RISK"),
      { code: "AT_RISK", label: "At Risk", minimumScore: 71, maximumScore: 80, priority: 3 },
    ]],
  ])("rejects overlapping or gapped band sets", (invalidBands) => {
    expect(() => validatePerformanceBands(invalidBands)).toThrow(/gap|overlap/);
  });

  test.each([
    [[...bands, { code: "OUT_OF_RANGE", label: "Out of range", minimumScore: -1, maximumScore: 0, priority: 5 }]],
    [[...bands, { code: "OUT_OF_RANGE", label: "Out of range", minimumScore: 100, maximumScore: 101, priority: 5 }]],
    [[...bands, { code: "EMPTY", label: "Empty", minimumScore: 80, maximumScore: 80, priority: 5 }]],
    [[...bands.slice(0, 3), { ...bands[3], priority: 3 }]],
  ])("rejects invalid ranges and duplicate priorities", (invalidBands) => {
    expect(() => validatePerformanceBands(invalidBands)).toThrow(/invalid/);
  });
});
