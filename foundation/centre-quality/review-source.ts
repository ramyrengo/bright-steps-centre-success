import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type {
  QualityReviewSummary,
  QualitySectionResult,
  QualityStrength,
  QualityUncoveredFinding,
} from "./contracts";
import { classifySection, quarterLabel, sortSectionResults } from "./focus";
import type { CentreQualityAuthorisationView, CentreQualityQueryExecutor } from "./types";

interface FinalisedReviewRow {
  id: string;
  centre_id: string;
  review_period_start: string;
  finalised_at: Date;
  template_version_id: string;
  overall_score: number | null;
  performance_band_label: string | null;
  risk_status: string | null;
  coverage_percent: number | null;
  critical_finding_count: number;
  high_finding_count: number;
  action_count: number;
  positive_practice_count: number;
  acknowledged: boolean;
}

interface StrengthRow {
  id: string;
  description: string;
  review_period_start: string;
}

interface SectionResultRow {
  section_id: string;
  title: string;
  sort_order: number;
  score: number | null;
  coverage_percent: number;
  previous_score: number | null;
}

interface UncoveredFindingRow {
  id: string;
  wording: string;
  review_period_start: string;
}

/** Normalises a PostgreSQL `DATE` to the `YYYY-MM-DD` form the contract uses. */
function isoDate(value: string | Date): string {
  if (value instanceof Date) {
    return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  return value.slice(0, 10);
}

function toSummary(row: FinalisedReviewRow): QualityReviewSummary {
  const reviewPeriodStart = isoDate(row.review_period_start);
  return {
    auditRunId: row.id,
    reviewPeriodStart,
    quarterLabel: quarterLabel(reviewPeriodStart),
    finalisedAt: row.finalised_at.toISOString(),
    templateVersionId: row.template_version_id,
    ...(row.overall_score === null ? {} : { overallScore: row.overall_score }),
    ...(row.performance_band_label === null
      ? {}
      : { performanceBandLabel: row.performance_band_label }),
    ...(row.risk_status === null ? {} : { riskStatus: row.risk_status }),
    ...(row.coverage_percent === null ? {} : { coveragePercent: row.coverage_percent }),
    criticalFindingCount: row.critical_finding_count,
    highFindingCount: row.high_finding_count,
    actionCount: row.action_count,
    positivePracticeCount: row.positive_practice_count,
    acknowledged: row.acknowledged,
  };
}

export const QualityReviewSource = {
  /**
   * Loads the most recent finalised internal reviews for every authorised
   * centre with one set-wise query. `limit` bounds the per-centre history so
   * the query cost stays constant as the portfolio grows.
   */
  async finalisedReviews(
    executor: CentreQualityQueryExecutor,
    authorisation: CentreQualityAuthorisationView,
    centreIds: readonly string[],
    limit: number,
  ): Promise<Map<string, QualityReviewSummary[]>> {
    const byCentre = new Map<string, QualityReviewSummary[]>();
    if (centreIds.length === 0) return byCentre;
    // A centre can finalise more than one run inside a single quarter, for
    // example on two different template versions. Ranking runs directly would
    // then make position 2 another run from the *same* quarter and present it
    // as the previous quarter. Collapse to the latest finalised run per
    // quarter first, then rank quarters, so position 2 is always a strictly
    // earlier `review_period_start`.
    const rows = await executor.queryAll<FinalisedReviewRow>`
      WITH per_quarter AS (
        SELECT
          run.id,
          run.centre_id,
          run.organisation_id,
          run.review_period_start,
          run.finalised_at,
          run.template_version_id,
          run.overall_score::float8 AS overall_score,
          run.performance_band_label,
          run.risk_status,
          run.coverage_percent::float8 AS coverage_percent,
          run.critical_finding_count,
          run.high_finding_count,
          run.action_count,
          run.positive_practice_count,
          row_number() OVER (
            PARTITION BY run.centre_id, run.review_period_start
            ORDER BY run.finalised_at DESC, run.id DESC
          ) AS run_in_quarter,
          dense_rank() OVER (
            PARTITION BY run.centre_id
            ORDER BY run.review_period_start DESC
          ) AS quarter_rank
        FROM audit_runs AS run
        WHERE run.organisation_id = ${authorisation.organisationId}
          AND run.centre_id = ANY(${centreIds as string[]}::uuid[])
          AND run.status = 'FINALISED'
      )
      SELECT
        per_quarter.id,
        per_quarter.centre_id,
        per_quarter.review_period_start,
        per_quarter.finalised_at,
        per_quarter.template_version_id,
        per_quarter.overall_score,
        per_quarter.performance_band_label,
        per_quarter.risk_status,
        per_quarter.coverage_percent,
        per_quarter.critical_finding_count,
        per_quarter.high_finding_count,
        per_quarter.action_count,
        per_quarter.positive_practice_count,
        EXISTS (
          SELECT 1
          FROM audit_acknowledgements AS acknowledgement
          WHERE acknowledgement.organisation_id = per_quarter.organisation_id
            AND acknowledgement.audit_run_id = per_quarter.id
        ) AS acknowledged
      FROM per_quarter
      WHERE per_quarter.run_in_quarter = 1
        AND per_quarter.quarter_rank <= ${limit}
      ORDER BY per_quarter.centre_id, per_quarter.quarter_rank
    `;
    for (const row of rows) {
      const existing = byCentre.get(row.centre_id) ?? [];
      existing.push(toSummary(row));
      byCentre.set(row.centre_id, existing);
    }
    return byCentre;
  },

  /**
   * Positive practice already captured by the Milestone 2B audit model for one
   * authorised centre. Nothing is generated when the centre has none.
   */
  async strengths(
    executor: CentreQualityQueryExecutor,
    authorisation: CentreQualityAuthorisationView,
    centreId: string,
    limit: number,
  ): Promise<QualityStrength[]> {
    if (!(authorisation.centreIdsByCapability.get(capability.quarterlyAuditRead)?.has(centreId))) {
      return [];
    }
    const rows = await executor.queryAll<StrengthRow>`
      SELECT
        observation.id,
        observation.description,
        run.review_period_start
      FROM positive_observations AS observation
      JOIN audit_runs AS run
        ON run.organisation_id = observation.organisation_id
       AND run.id = observation.audit_run_id
      WHERE observation.organisation_id = ${authorisation.organisationId}
        AND observation.centre_id = ${centreId}
        AND run.status = 'FINALISED'
      ORDER BY run.review_period_start DESC, observation.created_at DESC, observation.id
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      positiveObservationId: row.id,
      description: row.description,
      quarterLabel: quarterLabel(isoDate(row.review_period_start)),
    }));
  },

  /**
   * Per-section results for the latest finalised review, with the same
   * section's previous-quarter score when the two reviews used the same
   * template version. One set-wise query covers both quarters; a section the
   * scoring engine did not score returns null rather than zero.
   */
  async sectionResults(
    executor: CentreQualityQueryExecutor,
    authorisation: CentreQualityAuthorisationView,
    centreId: string,
    latest: QualityReviewSummary | undefined,
    previous: QualityReviewSummary | undefined,
  ): Promise<QualitySectionResult[]> {
    if (
      !latest ||
      !(authorisation.centreIdsByCapability.get(capability.quarterlyAuditRead)?.has(centreId))
    ) {
      return [];
    }
    // Only a matching template version makes the two quarters comparable,
    // which is the same rule the overall-score comparison applies.
    const comparableRunId =
      previous && previous.templateVersionId === latest.templateVersionId
        ? previous.auditRunId
        : null;
    const rows = await executor.queryAll<SectionResultRow>`
      SELECT
        section.id AS section_id,
        section.title,
        section.sort_order,
        current_result.score::float8 AS score,
        COALESCE(current_result.coverage_percent, 0)::float8 AS coverage_percent,
        previous_result.score::float8 AS previous_score
      FROM audit_template_sections AS section
      JOIN audit_runs AS run
        ON run.organisation_id = section.organisation_id
       AND run.template_version_id = section.template_version_id
       AND run.id = ${latest.auditRunId}
      LEFT JOIN audit_section_results AS current_result
        ON current_result.organisation_id = section.organisation_id
       AND current_result.audit_run_id = run.id
       AND current_result.section_id = section.id
      LEFT JOIN audit_section_results AS previous_result
        ON ${comparableRunId}::uuid IS NOT NULL
       AND previous_result.organisation_id = section.organisation_id
       AND previous_result.audit_run_id = ${comparableRunId}
       AND previous_result.section_id = section.id
      WHERE section.organisation_id = ${authorisation.organisationId}
      ORDER BY section.sort_order, section.id
    `;
    return sortSectionResults(
      rows.map((row) => {
        const score = row.score === null ? undefined : row.score;
        const previousScore = row.previous_score === null ? undefined : row.previous_score;
        const standing = classifySection({
          score,
          overallScore: latest.overallScore,
          coveragePercent: row.coverage_percent,
          previousScore,
        });
        return {
          sectionId: row.section_id,
          title: row.title,
          sortOrder: row.sort_order,
          standing: standing.standing,
          ...(score === undefined ? {} : { score }),
          coveragePercent: row.coverage_percent,
          ...(previousScore === undefined ? {} : { previousScore }),
          ...(standing.scoreDelta === undefined ? {} : { scoreDelta: standing.scoreDelta }),
          trend: standing.trend,
        };
      }),
    );
  },

  /**
   * Active critical findings with no active corrective action. These are the
   * clearest signal that a centre needs help and must never be hidden.
   */
  async uncoveredCriticalFindings(
    executor: CentreQualityQueryExecutor,
    authorisation: CentreQualityAuthorisationView,
    centreId: string,
    limit: number,
  ): Promise<QualityUncoveredFinding[]> {
    if (!(authorisation.centreIdsByCapability.get(capability.findingRead)?.has(centreId))) {
      return [];
    }
    const rows = await executor.queryAll<UncoveredFindingRow>`
      SELECT
        finding.id,
        item.wording,
        run.review_period_start
      FROM findings AS finding
      JOIN audit_responses AS response
        ON response.organisation_id = finding.organisation_id
       AND response.id = finding.audit_response_id
      JOIN audit_template_items AS item
        ON item.organisation_id = response.organisation_id
       AND item.id = response.audit_item_id
      JOIN audit_runs AS run
        ON run.organisation_id = finding.organisation_id
       AND run.id = finding.audit_run_id
      WHERE finding.organisation_id = ${authorisation.organisationId}
        AND finding.source_family = 'QUARTERLY_AUDIT'
        AND finding.centre_id = ${centreId}
        AND finding.status = 'OPEN'
        AND finding.severity = 'CRITICAL'
        AND NOT EXISTS (
          SELECT 1
          FROM corrective_actions AS action
          WHERE action.organisation_id = finding.organisation_id
            AND action.finding_id = finding.id
            AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
        )
      ORDER BY finding.created_at DESC, finding.id
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      findingId: row.id,
      headline: row.wording,
      severity: "CRITICAL" as const,
      quarterLabel: quarterLabel(isoDate(row.review_period_start)),
    }));
  },
};
