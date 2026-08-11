import type {
  AuditOutcome,
  AuditRiskStatus,
  FindingSeverity,
} from "./types";

export interface ScoringOutcomeRule {
  outcome: AuditOutcome;
  scoreFactor: number | null;
  denominatorTreatment: "included" | "excluded";
  requiresReason: boolean;
}

export interface ScoreableAuditItem {
  itemId: string;
  sectionId: string;
  weight: number;
  scored: boolean;
  critical: boolean;
  outcome?: AuditOutcome;
  comment?: string;
  findingSeverity?: FindingSeverity;
  findingCreated?: boolean;
  actionCreated?: boolean;
}

export interface PerformanceBand {
  code: string;
  label: string;
  minimumScore: number;
  maximumScore: number;
  priority: number;
}

export interface SectionScore {
  sectionId: string;
  eligibleWeight: number;
  achievedWeight: number;
  score: number | null;
  coveragePercent: number;
}

export interface AuditScoreResult {
  overallScore: number | null;
  coveragePercent: number;
  band: PerformanceBand | null;
  riskStatus: AuditRiskStatus;
  criticalFindingCount: number;
  highFindingCount: number;
  positivePracticeCount: number;
  sections: SectionScore[];
  validationIssues: Array<{
    itemId: string;
    code:
      | "response_missing"
      | "reason_required"
      | "critical_not_observed_unresolved"
      | "outcome_not_configured";
  }>;
}

function rounded(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function equalBoundary(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
}

/**
 * Performance bands use [minimum, maximum), except that the final upper bound
 * of 100 is inclusive. A released policy must cover every score exactly once.
 */
export function validatePerformanceBands(
  bands: readonly PerformanceBand[],
): PerformanceBand[] {
  if (bands.length === 0) {
    throw new Error("audit performance bands are missing");
  }

  const ordered = [...bands].sort((left, right) =>
    left.minimumScore - right.minimumScore || left.priority - right.priority,
  );
  const priorities = new Set<number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const band = ordered[index];
    if (
      !Number.isFinite(band.minimumScore) ||
      !Number.isFinite(band.maximumScore) ||
      band.minimumScore < 0 ||
      band.maximumScore > 100 ||
      band.minimumScore >= band.maximumScore ||
      priorities.has(band.priority)
    ) {
      throw new Error("audit performance band configuration is invalid");
    }
    priorities.add(band.priority);

    if (index === 0 && !equalBoundary(band.minimumScore, 0)) {
      throw new Error("audit performance bands must start at zero");
    }
    if (
      index > 0 &&
      !equalBoundary(ordered[index - 1].maximumScore, band.minimumScore)
    ) {
      throw new Error("audit performance bands contain a gap or overlap");
    }
  }

  if (!equalBoundary(ordered[ordered.length - 1].maximumScore, 100)) {
    throw new Error("audit performance bands must finish at one hundred");
  }
  return ordered;
}

export function findPerformanceBand(
  score: number,
  bands: readonly PerformanceBand[],
): PerformanceBand | null {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return (
    validatePerformanceBands(bands).find(
      (band) =>
        score >= band.minimumScore &&
        (equalBoundary(band.maximumScore, 100)
          ? score <= band.maximumScore
          : score < band.maximumScore),
    ) ?? null
  );
}

function riskFor(
  score: number | null,
  band: PerformanceBand | null,
  criticalCount: number,
  highCount: number,
): AuditRiskStatus {
  if (criticalCount > 0) return "CRITICAL";
  if (highCount > 0) return "HIGH";
  if (score === null || band === null) return "PRIORITY_INTERVENTION";

  switch (band.code) {
    case "STRONG":
      return "STRONG";
    case "MINIMUM_STANDARD_MET":
      return "IMPROVEMENT_REQUIRED";
    case "AT_RISK":
      return "AT_RISK";
    default:
      return "PRIORITY_INTERVENTION";
  }
}

export function calculateAuditScore(input: {
  items: readonly ScoreableAuditItem[];
  outcomeRules: readonly ScoringOutcomeRule[];
  bands: readonly PerformanceBand[];
  roundingScale: number;
}): AuditScoreResult {
  const rules = new Map(input.outcomeRules.map((rule) => [rule.outcome, rule]));
  const sections = new Map<
    string,
    { eligible: number; achieved: number; assessed: number; total: number }
  >();
  const validationIssues: AuditScoreResult["validationIssues"] = [];
  let eligible = 0;
  let achieved = 0;
  let assessed = 0;
  let total = 0;
  let criticalFindingCount = 0;
  let highFindingCount = 0;
  let positivePracticeCount = 0;

  for (const item of input.items) {
    const section = sections.get(item.sectionId) ?? {
      eligible: 0,
      achieved: 0,
      assessed: 0,
      total: 0,
    };
    section.total += 1;
    total += 1;

    if (!item.outcome) {
      validationIssues.push({ itemId: item.itemId, code: "response_missing" });
      sections.set(item.sectionId, section);
      continue;
    }

    const rule = rules.get(item.outcome);
    if (!rule) {
      validationIssues.push({ itemId: item.itemId, code: "outcome_not_configured" });
      sections.set(item.sectionId, section);
      continue;
    }

    if (rule.requiresReason && !item.comment?.trim()) {
      validationIssues.push({ itemId: item.itemId, code: "reason_required" });
    }

    if (
      item.critical &&
      item.outcome === "NOT_OBSERVED" &&
      (!item.findingCreated || !item.actionCreated)
    ) {
      validationIssues.push({
        itemId: item.itemId,
        code: "critical_not_observed_unresolved",
      });
    }

    if (item.outcome === "POSITIVE_PRACTICE") positivePracticeCount += 1;
    if (item.findingSeverity === "CRITICAL") criticalFindingCount += 1;
    if (item.findingSeverity === "HIGH") highFindingCount += 1;

    if (
      item.scored &&
      rule.denominatorTreatment === "included" &&
      rule.scoreFactor !== null
    ) {
      eligible += item.weight;
      achieved += item.weight * rule.scoreFactor;
      section.eligible += item.weight;
      section.achieved += item.weight * rule.scoreFactor;
      assessed += 1;
      section.assessed += 1;
    }

    sections.set(item.sectionId, section);
  }

  const overallScore =
    eligible === 0 ? null : rounded((achieved / eligible) * 100, input.roundingScale);
  const coveragePercent =
    total === 0 ? 0 : rounded((assessed / total) * 100, input.roundingScale);
  const band =
    overallScore === null
      ? null
      : findPerformanceBand(overallScore, input.bands);

  return {
    overallScore,
    coveragePercent,
    band,
    riskStatus: riskFor(
      overallScore,
      band,
      criticalFindingCount,
      highFindingCount,
    ),
    criticalFindingCount,
    highFindingCount,
    positivePracticeCount,
    sections: [...sections.entries()].map(([sectionId, section]) => ({
      sectionId,
      eligibleWeight: section.eligible,
      achievedWeight: section.achieved,
      score:
        section.eligible === 0
          ? null
          : rounded(
              (section.achieved / section.eligible) * 100,
              input.roundingScale,
            ),
      coveragePercent:
        section.total === 0
          ? 0
          : rounded(
              (section.assessed / section.total) * 100,
              input.roundingScale,
            ),
    })),
    validationIssues,
  };
}
