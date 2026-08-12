import { describe, expect, test } from "vitest";
import type { DailySuccessItem } from "./contracts";
import { buildCentreAttention, buildSections, sortDailyItems } from "./priority";

function item(
  sourceId: string,
  overrides: Partial<DailySuccessItem> = {},
): DailySuccessItem {
  return {
    id: `corrective_action:${sourceId}`,
    sourceType: "corrective_action",
    sourceId,
    centreId: "00000000-0000-4000-8000-000000000001",
    centreName: "Synthetic Centre",
    headline: sourceId,
    summary: "Safe summary",
    attentionBand: "TODAY",
    responsibility: "YOU_NEED_TO_ACT",
    whyShown: { code: "ACTION_DUE_TODAY", label: "Due today" },
    riskLevel: "STANDARD",
    cta: { label: "Review action", route: `/centre/actions/${sourceId}` },
    ...overrides,
  };
}

describe("Daily Success deterministic priority", () => {
  const candidateCentres = [{
    id: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic Centre",
    timezone: "Australia/Sydney",
    resource: {
      kind: "centre" as const,
      organisationId: "00000000-0000-4000-8000-000000000099",
      centreId: "00000000-0000-4000-8000-000000000001",
      organisationalUnitIds: [],
    },
  }];
  test("preserves critical awareness above lower-severity current-user work", () => {
    const ordered = sortDailyItems([
      item("ordinary-direct"),
      item("critical-awareness", {
        riskLevel: "CRITICAL",
        attentionBand: "URGENT",
        responsibility: "FOR_YOUR_AWARENESS",
        whyShown: { code: "CRITICAL_RISK", label: "Critical risk" },
      }),
    ]);
    expect(ordered.map((candidate) => candidate.sourceId)).toEqual([
      "critical-awareness",
      "ordinary-direct",
    ]);
  });

  test("uses responsibility within equivalent risk and attention classes", () => {
    const ordered = sortDailyItems([
      item("waiting", { responsibility: "WAITING_ON_SOMEONE_ELSE" }),
      item("mine", { responsibility: "YOU_NEED_TO_ACT" }),
      item("centre", { responsibility: "YOUR_CENTRE_NEEDS_TO_ACT" }),
    ]);
    expect(ordered.map((candidate) => candidate.sourceId)).toEqual(["mine", "centre", "waiting"]);
  });

  test("applies stable source identifiers as the final tie-break", () => {
    expect(sortDailyItems([item("b"), item("a")]).map((candidate) => candidate.sourceId)).toEqual(["a", "b"]);
  });

  test("never truncates critical/immediate risk out of DO FIRST", () => {
    const sections = buildSections([
      item("critical-a", { riskLevel: "CRITICAL", attentionBand: "URGENT" }),
      item("critical-b", { riskLevel: "CRITICAL", attentionBand: "URGENT" }),
      item("critical-c", { riskLevel: "CRITICAL", attentionBand: "URGENT" }),
      item("critical-d", { riskLevel: "CRITICAL", attentionBand: "URGENT" }),
      item("ordinary", { attentionBand: "URGENT" }),
    ]);
    expect(sections[0].items.map((candidate) => candidate.sourceId)).toEqual([
      "critical-a",
      "critical-b",
      "critical-c",
      "critical-d",
    ]);
  });

  test("sets an Area Manager centre band from its worst authorised active risk", () => {
    const summaries = buildCentreAttention([
      item("ordinary"),
      item("critical-owned-by-centre", {
        riskLevel: "CRITICAL",
        attentionBand: "URGENT",
        responsibility: "YOUR_CENTRE_NEEDS_TO_ACT",
      }),
    ], { candidateCentres, coverage: "complete" });
    expect(summaries[0]).toMatchObject({
      attentionBand: "URGENT",
      headline: "critical-owned-by-centre",
      criticalCount: 1,
      coverage: "complete",
    });
  });

  test("marks partial centre counts incomplete instead of publishing false zeros", () => {
    const summaries = buildCentreAttention([], { candidateCentres, coverage: "partial" });
    expect(summaries).toEqual([expect.objectContaining({
      centreName: "Synthetic Centre",
      coverage: "partial",
      headline: "Some priorities could not be checked",
    })]);
    expect(summaries[0].criticalCount).toBeUndefined();
    expect(summaries[0].overdueCount).toBeUndefined();
    expect(summaries[0].dueTodayCount).toBeUndefined();
  });
});
