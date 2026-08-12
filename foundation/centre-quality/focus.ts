import type {
  CentreQualityFocus,
  CentreQualityTrend,
  QualityActionRollup,
  QualityFocusGroup,
  QualityQuarterComparison,
  QualityReviewSummary,
  QualitySectionStanding,
} from "./contracts";

/**
 * Pure derivation helpers. Every function here reads only facts the source
 * workflows already own. None of them invents a due date, a schedule, a
 * regulatory rating, or a composite health score.
 */

const QUARTER_MONTHS = new Set([1, 4, 7, 10]);

/**
 * Formats the quarter-truncated `audit_runs.review_period_start` that the
 * quarterly-review module already stores. This is presentation of an existing
 * fact, not a derived reporting period.
 */
export function quarterLabel(reviewPeriodStart: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reviewPeriodStart);
  if (!match) return reviewPeriodStart;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!QUARTER_MONTHS.has(month)) return reviewPeriodStart;
  return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
}

/** Renders a stored `corrective_actions.status` without leaking raw enum text. */
export function actionStatusLabel(status: string): string {
  return {
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    EVIDENCE_SUBMITTED: "Evidence submitted",
    VERIFICATION_REQUIRED: "Waiting for verification",
    VERIFIED: "Verified",
    CLOSED: "Closed",
    MORE_INFORMATION_REQUIRED: "More information needed",
    REJECTED: "Returned for more work",
  }[status] ?? "Active";
}

/**
 * Builds previous-quarter context. Returns an explicitly unavailable result
 * rather than a zero when no earlier finalised review exists, and refuses to
 * compare across template versions because the scoring basis differs.
 */
export function buildComparison(
  latest: QualityReviewSummary | undefined,
  previous: QualityReviewSummary | undefined,
): QualityQuarterComparison {
  if (!latest || !previous) {
    return {
      available: false,
      comparable: false,
      trend: "NOT_COMPARABLE",
      ...(latest
        ? { note: "No earlier finalised review is available for this centre." }
        : {}),
    };
  }
  if (latest.templateVersionId !== previous.templateVersionId) {
    return {
      available: true,
      comparable: false,
      trend: "NOT_COMPARABLE",
      previous,
      criticalDelta: latest.criticalFindingCount - previous.criticalFindingCount,
      note: "The review template changed between these quarters, so scores are not directly comparable.",
    };
  }
  const criticalDelta = latest.criticalFindingCount - previous.criticalFindingCount;
  if (latest.overallScore === undefined || previous.overallScore === undefined) {
    return {
      available: true,
      comparable: false,
      trend: "NOT_COMPARABLE",
      previous,
      criticalDelta,
      note: "One of these reviews recorded no overall internal result.",
    };
  }
  const scoreDelta = Number((latest.overallScore - previous.overallScore).toFixed(2));
  const trend: CentreQualityTrend =
    scoreDelta > 0.5 ? "IMPROVED" : scoreDelta < -0.5 ? "DECLINED" : "STEADY";
  return {
    available: true,
    comparable: true,
    trend,
    previous,
    scoreDelta,
    criticalDelta,
  };
}

export interface SectionStandingInput {
  /** `audit_section_results.score` for the latest finalised review. */
  score: number | undefined;
  /** The same review's `audit_runs.overall_score`. */
  overallScore: number | undefined;
  coveragePercent: number;
  /** Same section, previous finalised review, only when comparable. */
  previousScore: number | undefined;
}

export interface SectionStanding {
  standing: QualitySectionStanding;
  trend: CentreQualityTrend;
  scoreDelta?: number;
}

/**
 * Places a section against the centre's own overall result for the same
 * review. Both numbers are already owned by the quarterly-review module, so
 * this states a relationship rather than deriving a new measure. A section
 * that scored nothing is reported as not scored, never as zero.
 */
export function classifySection(input: SectionStandingInput): SectionStanding {
  const comparable =
    input.score !== undefined && input.previousScore !== undefined;
  const scoreDelta = comparable
    ? Number((input.score! - input.previousScore!).toFixed(2))
    : undefined;
  const trend: CentreQualityTrend = !comparable
    ? "NOT_COMPARABLE"
    : scoreDelta! > 0.5
      ? "IMPROVED"
      : scoreDelta! < -0.5
        ? "DECLINED"
        : "STEADY";
  if (input.score === undefined || input.overallScore === undefined) {
    return { standing: "NOT_SCORED", trend, ...(comparable ? { scoreDelta } : {}) };
  }
  return {
    standing: input.score < input.overallScore ? "FOCUS" : "STRONG",
    trend,
    ...(comparable ? { scoreDelta } : {}),
  };
}

/** Focus areas first, then template order, so the list is deterministic. */
export function sortSectionResults<
  T extends { standing: QualitySectionStanding; sortOrder: number; sectionId: string },
>(sections: readonly T[]): T[] {
  const rank: Record<QualitySectionStanding, number> = {
    FOCUS: 0,
    NOT_SCORED: 1,
    STRONG: 2,
  };
  return sections.slice().sort(
    (left, right) =>
      rank[left.standing] - rank[right.standing] ||
      left.sortOrder - right.sortOrder ||
      left.sectionId.localeCompare(right.sectionId),
  );
}

export interface FocusInput {
  actions: QualityActionRollup;
  uncoveredCriticalFindings: number;
  latestReview: QualityReviewSummary | undefined;
}

/**
 * Groups a centre by the kind of leadership response it needs. This is a
 * support classification, never a rank: two centres in the same group are
 * not ordered against each other, and no centre is scored.
 */
export function deriveFocus(input: FocusInput): {
  focus: CentreQualityFocus;
  reason: string;
} {
  const { actions, uncoveredCriticalFindings, latestReview } = input;
  if (uncoveredCriticalFindings > 0) {
    return {
      focus: "NEEDS_SUPPORT",
      reason:
        uncoveredCriticalFindings === 1
          ? "A critical review finding has no active corrective action"
          : `${uncoveredCriticalFindings} critical review findings have no active corrective action`,
    };
  }
  if (actions.critical > 0) {
    return {
      focus: "NEEDS_SUPPORT",
      reason:
        actions.critical === 1
          ? "A critical corrective action is still open"
          : `${actions.critical} critical corrective actions are still open`,
    };
  }
  if (actions.overdue > 0) {
    return {
      focus: "NEEDS_SUPPORT",
      reason:
        actions.overdue === 1
          ? "A corrective action has passed its due date"
          : `${actions.overdue} corrective actions have passed their due date`,
    };
  }
  if (actions.returned > 0) {
    return {
      focus: "MONITOR",
      reason:
        actions.returned === 1
          ? "Remediation was returned for more work"
          : `${actions.returned} remediations were returned for more work`,
    };
  }
  if (actions.awaitingVerification > 0) {
    return {
      focus: "MONITOR",
      reason:
        actions.awaitingVerification === 1
          ? "Remediation is waiting for independent verification"
          : `${actions.awaitingVerification} remediations are waiting for independent verification`,
    };
  }
  if (actions.dueSoon > 0) {
    return {
      focus: "MONITOR",
      reason:
        actions.dueSoon === 1
          ? "A corrective action falls due within seven days"
          : `${actions.dueSoon} corrective actions fall due within seven days`,
    };
  }
  if (!latestReview) {
    return {
      focus: "AWAITING_FIRST_REVIEW",
      reason: "No finalised internal review has been recorded for this centre yet",
    };
  }
  if (actions.total > 0) {
    return {
      focus: "MONITOR",
      reason:
        actions.total === 1
          ? "One corrective action remains open with no immediate deadline"
          : `${actions.total} corrective actions remain open with no immediate deadline`,
    };
  }
  return {
    focus: "STEADY",
    reason: `No open corrective actions after the ${latestReview.quarterLabel} internal review`,
  };
}

const FOCUS_ORDER: readonly CentreQualityFocus[] = [
  "NEEDS_SUPPORT",
  "MONITOR",
  "AWAITING_FIRST_REVIEW",
  "STEADY",
];

const FOCUS_PRESENTATION: Record<
  CentreQualityFocus,
  { label: string; description: string }
> = {
  NEEDS_SUPPORT: {
    label: "Needs support now",
    description: "Critical or overdue work where a centre is likely to need help.",
  },
  MONITOR: {
    label: "Keep an eye on",
    description: "Active work that is moving but has not landed yet.",
  },
  AWAITING_FIRST_REVIEW: {
    label: "Awaiting first review",
    description: "No finalised internal review has been recorded yet.",
  },
  STEADY: {
    label: "Steady",
    description: "No open corrective actions after the most recent internal review.",
  },
};

/**
 * Groups centres for coaching. Within a group, centres are ordered by name so
 * the surface never reads as a best-to-worst league table.
 */
export function buildFocusGroups(
  centres: readonly { centreId: string; centreName: string; focus: CentreQualityFocus }[],
): QualityFocusGroup[] {
  return FOCUS_ORDER.flatMap((focus) => {
    const members = centres
      .filter((centre) => centre.focus === focus)
      .slice()
      .sort((left, right) =>
        left.centreName.localeCompare(right.centreName, "en-AU") ||
        left.centreId.localeCompare(right.centreId),
      );
    if (members.length === 0) return [];
    return [
      {
        focus,
        label: FOCUS_PRESENTATION[focus].label,
        description: FOCUS_PRESENTATION[focus].description,
        centreIds: members.map((member) => member.centreId),
      },
    ];
  });
}

/** Deterministic card order: focus group first, then centre name, then id. */
export function sortCentreCards<
  T extends { centreId: string; centreName: string; focus: CentreQualityFocus },
>(cards: readonly T[]): T[] {
  return cards.slice().sort((left, right) => {
    const focusDifference =
      FOCUS_ORDER.indexOf(left.focus) - FOCUS_ORDER.indexOf(right.focus);
    if (focusDifference !== 0) return focusDifference;
    return (
      left.centreName.localeCompare(right.centreName, "en-AU") ||
      left.centreId.localeCompare(right.centreId)
    );
  });
}
