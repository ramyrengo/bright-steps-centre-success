import type { Header, Query } from "encore.dev/api";

/**
 * Centre Quality & Performance is a live, read-only projection over the
 * source-owned Milestone 2B quarterly-review and corrective-action facts.
 * It owns no workflow state, no score of its own, and no persisted row.
 *
 * Every numeric value in this contract is either counted from currently
 * authorised source rows or copied from a value the quarterly-review module
 * already calculated and stored. Nothing here is inferred, estimated, or
 * back-filled when source data is absent.
 */

export type CentreQualityViewKind = "centre" | "portfolio" | "organisation";

/**
 * Whether a source domain actually contributed to this projection.
 * `AVAILABLE` means the source was queried successfully under the viewer's
 * current authorisation, so a zero result is a real zero. `NOT_AUTHORIZED`
 * and `UNAVAILABLE` both mean the projection does not know, and neither may
 * ever be presented as an absence of records.
 */
export type QualitySourceCoverage = "AVAILABLE" | "NOT_AUTHORIZED" | "UNAVAILABLE";

/**
 * Coverage is a per-centre fact because authorisation is evaluated per centre
 * per capability. One centre in a portfolio can have complete information
 * while another has none, and the two must not be summarised as if they were
 * the same.
 */
export interface QualityCentreCoverage {
  /** `quarterly_audit.read` plus the quarterly-review source query. */
  quarterlyReviews: QualitySourceCoverage;
  /** `corrective_action.read` plus the corrective-action source query. */
  correctiveActions: QualitySourceCoverage;
  /** `finding.read`, which gates uncovered critical findings separately. */
  uncoveredFindings: QualitySourceCoverage;
}

/**
 * Support grouping, deliberately not a rank or a score. It is derived only
 * from currently authorised source facts and is used to gather centres that
 * need the same kind of leadership response.
 * `INFORMATION_INCOMPLETE` is a statement about source coverage, not about a
 * centre's performance. It exists so that a missing source can never be
 * reported as the reassuring `STEADY` or `AWAITING_FIRST_REVIEW`.
 */
export type CentreQualityFocus =
  | "NEEDS_SUPPORT"
  | "MONITOR"
  | "INFORMATION_INCOMPLETE"
  | "STEADY"
  | "AWAITING_FIRST_REVIEW";

export type CentreQualityTrend =
  | "IMPROVED"
  | "STEADY"
  | "DECLINED"
  | "NOT_COMPARABLE";

export interface CentreQualityCta {
  label: string;
  route: string;
}

export interface CentreQualityView {
  kind: CentreQualityViewKind;
  label: string;
  centreId?: string;
  centreName?: string;
}

export interface CentreQualityWorkspaceRequest {
  view?: Query<CentreQualityViewKind>;
  centreId?: Query<string>;
}

export interface CentreQualityDetailRequest {
  centreId: string;
}

/** A finalised internal review exactly as the quarterly-review module stored it. */
export interface QualityReviewSummary {
  auditRunId: string;
  /** Quarter-truncated review period start owned by `audit_runs`. */
  reviewPeriodStart: string;
  /** Formatted from `reviewPeriodStart`; never an invented schedule or due date. */
  quarterLabel: string;
  finalisedAt: string;
  templateVersionId: string;
  overallScore?: number;
  performanceBandLabel?: string;
  riskStatus?: string;
  coveragePercent?: number;
  criticalFindingCount: number;
  highFindingCount: number;
  actionCount: number;
  positivePracticeCount: number;
  acknowledged: boolean;
}

/**
 * Previous-quarter context. `available` is false when no earlier finalised
 * review exists; the frontend must then show an empty state rather than a
 * zero or a neutral trend.
 */
export interface QualityQuarterComparison {
  available: boolean;
  comparable: boolean;
  trend: CentreQualityTrend;
  previous?: QualityReviewSummary;
  scoreDelta?: number;
  criticalDelta?: number;
  /** Explains a `NOT_COMPARABLE` outcome instead of hiding it. */
  note?: string;
}

/** Counts of currently authorised, currently open corrective actions. */
export interface QualityActionRollup {
  total: number;
  critical: number;
  overdue: number;
  dueSoon: number;
  awaitingVerification: number;
  returned: number;
  yourAction: number;
  centreAction: number;
  waiting: number;
}

/**
 * Every count on this card is optional on purpose. A field is present only
 * when its source was `AVAILABLE`, so an unauthorised or failed source is
 * absent rather than zero. Consumers must render absence as "not checked",
 * never as "none".
 */
export interface QualityCentreCard {
  centreId: string;
  centreName: string;
  timezone: string;
  localDate: string;
  coverage: QualityCentreCoverage;
  focus: CentreQualityFocus;
  focusReason: string;
  /** Present only when `coverage.quarterlyReviews` is `AVAILABLE`. */
  latestReview?: QualityReviewSummary;
  comparison?: QualityQuarterComparison;
  /** Present only when `coverage.correctiveActions` is `AVAILABLE`. */
  actions?: QualityActionRollup;
  /** Present only when `coverage.uncoveredFindings` is `AVAILABLE`. */
  uncoveredCriticalFindings?: number;
  strengthsCount?: number;
  completedLast30Days?: number;
  cta: CentreQualityCta;
}

export interface QualityFocusGroup {
  focus: CentreQualityFocus;
  label: string;
  description: string;
  centreIds: string[];
}

/**
 * Coverage is `partial` when any centre's sources did not fully report, or
 * when a centre could not be authorised safely and was therefore left out of
 * the card set entirely. An omitted centre is invisible here by design, so
 * nothing below may be read as an organisation-complete statement unless
 * coverage is `complete`.
 * Known negative evidence stays visible under partial coverage: a centre that
 * is genuinely showing critical or overdue work is still counted. Every
 * reassuring count and every summed total is withheld instead, because those
 * are the values that would falsely imply an all-clear.
 */
export interface QualityPortfolioSummary {
  coverage: "complete" | "partial";
  /** Centres actually included below. Under `partial` coverage this is what
   *  the viewer can see, never an organisation total. */
  visibleCentreCount: number;
  /** Known negative evidence: safe to state under either coverage. */
  needsSupportCount: number;
  monitorCount: number;
  informationIncompleteCount: number;
  /** Reassuring counts. Present only under `complete` coverage. */
  steadyCount?: number;
  awaitingFirstReviewCount?: number;
  /** Summed totals. Present only when every contributing centre reported. */
  openCriticalCount?: number;
  overdueCount?: number;
  awaitingVerificationCount?: number;
}

export interface QualitySourceHealth {
  source: "quarterly_reviews" | "corrective_actions";
  /** Response-level roll-up of the per-centre coverage for this source. */
  status: QualitySourceCoverage;
}

export interface QualityAuthorisationHealth {
  status: "available" | "partial";
  warning?: string;
}

/**
 * `status` discriminates the response, in the same way Daily Success does.
 * `ready` and `partial` are active projections and carry the business block:
 * `centres`, `focusGroups`, `summary`, `sourceHealth` and
 * `authorisationHealth`.
 * `selection_required` and `unsupported` query no business source at all, so
 * they carry none of that block. Returning `sourceHealth: AVAILABLE` or a
 * zero-filled summary in those states would assert that sources were checked
 * and found empty, when in fact nothing was checked. Only the authorisation
 * facts the request did establish — the authorised view choices and the
 * organisation timezone — are returned.
 */
export interface CentreQualityWorkspaceResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  status: "ready" | "partial" | "selection_required" | "unsupported";
  activeView?: CentreQualityView;
  availableViews: CentreQualityView[];
  organisationTimezone: string;
  /** Present only for an active projection (`ready` or `partial`). */
  centres?: QualityCentreCard[];
  focusGroups?: QualityFocusGroup[];
  summary?: QualityPortfolioSummary;
  sourceHealth?: QualitySourceHealth[];
  authorisationHealth?: QualityAuthorisationHealth;
  warning?: string;
}

export interface QualityActionListItem {
  correctiveActionId: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  statusLabel: string;
  responsibility:
    | "YOU_NEED_TO_ACT"
    | "CENTRE_NEEDS_TO_ACT"
    | "WAITING_ON_SOMEONE_ELSE"
    | "FOR_YOUR_AWARENESS";
  dueAt: string;
  dueLocalDate: string;
  dueBucket: "OVERDUE" | "TODAY" | "TOMORROW" | "DUE_SOON" | "LATER";
  daysFromToday: number;
  independentVerificationRequired: boolean;
  cta: CentreQualityCta;
}

export interface QualityCompletedActionItem {
  correctiveActionId: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  closedAt: string;
  closedLocalDate: string;
  cta: CentreQualityCta;
}

export interface QualityStrength {
  positiveObservationId: string;
  description: string;
  quarterLabel: string;
}

export interface QualityUncoveredFinding {
  findingId: string;
  headline: string;
  severity: "CRITICAL";
  quarterLabel: string;
}

/**
 * How a section stands relative to the centre's own overall result for the
 * same review. This is a stated comparison between two numbers the
 * quarterly-review module already calculated, not a new score.
 * The values are deliberately relational. An earlier draft used `STRONG`,
 * which reads as an objective quality judgement and would have been applied
 * to a barely observed section purely because its number sat at or above the
 * centre's own overall result. Coverage is reported alongside so a partly
 * observed section is never mistaken for a settled one.
 */
export type QualitySectionStanding =
  | "BELOW_CENTRE_RESULT"
  | "AT_OR_ABOVE_CENTRE_RESULT"
  | "NOT_SCORED";

export interface QualitySectionResult {
  sectionId: string;
  title: string;
  /** Presentation order owned by the audit template. */
  sortOrder: number;
  standing: QualitySectionStanding;
  /** `audit_section_results.score`; absent when the section scored nothing. */
  score?: number;
  /** `audit_section_results.coverage_percent`, stated so a partly observed
   *  section is never presented as a settled result. */
  coveragePercent: number;
  /** Movement against the same section last quarter, only when comparable. */
  previousScore?: number;
  scoreDelta?: number;
  trend: CentreQualityTrend;
}

/**
 * Each list is absent when its source did not report, and empty only when the
 * source was `AVAILABLE` and genuinely held no rows. `centre.coverage` states
 * which case applies, so the frontend never has to guess whether an empty
 * list means "none" or "not checked".
 */
export interface CentreQualityDetailResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  status: "ready" | "partial";
  centre: QualityCentreCard;
  openActions?: QualityActionListItem[];
  completedActions?: QualityCompletedActionItem[];
  strengths?: QualityStrength[];
  uncoveredFindings?: QualityUncoveredFinding[];
  /** Per-section standing for the latest finalised review. Empty when the
   *  centre has no finalised review, rather than a fabricated zero row. */
  sectionResults?: QualitySectionResult[];
  reviewHistory?: QualityReviewSummary[];
  canAcknowledgeReview: boolean;
  sourceHealth: QualitySourceHealth[];
  warning?: string;
}
