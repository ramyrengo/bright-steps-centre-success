import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { DailySuccessItem } from "./contracts";
import { controlledDailyCta } from "./cta";
import type { DailySourceInput, DailySourceResult } from "./types";

interface QuarterlyReviewDailyRow {
  id: string;
  centre_id: string;
  centre_name: string;
  status: "DRAFT" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "FINALISED";
  auditor_principal_id: string;
  critical_finding_count: number;
  high_finding_count: number;
  acknowledged: boolean;
}

function idsFor(input: DailySourceInput, key: typeof capability.quarterlyAuditRead): ReadonlySet<string>;
function idsFor(input: DailySourceInput, key: typeof capability.quarterlyAuditConduct): ReadonlySet<string>;
function idsFor(input: DailySourceInput, key: typeof capability.quarterlyAuditAcknowledge): ReadonlySet<string>;
function idsFor(input: DailySourceInput, key: string): ReadonlySet<string> {
  return input.authorisation.centreIdsByCapability.get(key as typeof capability.quarterlyAuditRead) ?? new Set<string>();
}

export const QuarterlyReviewDailySource = {
  async collect(input: DailySourceInput): Promise<DailySourceResult> {
    if (input.perspective.kind === "administration" || input.perspective.kind === "compliance") {
      return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    }
    const readable = idsFor(input, capability.quarterlyAuditRead);
    const centreIds = input.perspective.kind === "centre" && input.perspective.centreId
      ? readable.has(input.perspective.centreId) ? [input.perspective.centreId] : []
      : [...readable];
    if (centreIds.length === 0) return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    const rows = await input.executor.queryAll<QuarterlyReviewDailyRow>`
      SELECT
        run.id,
        run.centre_id,
        centre.name AS centre_name,
        run.status,
        run.auditor_principal_id,
        run.critical_finding_count,
        run.high_finding_count,
        EXISTS (
          SELECT 1
          FROM audit_acknowledgements AS acknowledgement
          WHERE acknowledgement.organisation_id = run.organisation_id
            AND acknowledgement.audit_run_id = run.id
            AND acknowledgement.principal_id = ${input.authorisation.principalId}
        ) AS acknowledged
      FROM audit_runs AS run
      JOIN centres AS centre
        ON centre.organisation_id = run.organisation_id
       AND centre.id = run.centre_id
      WHERE run.organisation_id = ${input.authorisation.organisationId}
        AND run.centre_id = ANY(${centreIds}::uuid[])
        AND run.status IN ('DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'FINALISED')
      ORDER BY run.started_at, run.id
    `;
    const conduct = idsFor(input, capability.quarterlyAuditConduct);
    const acknowledge = idsFor(input, capability.quarterlyAuditAcknowledge);
    const items: DailySuccessItem[] = [];
    for (const row of rows) {
      const activeAssigned =
        input.perspective.kind === "portfolio" &&
        row.status !== "FINALISED" &&
        row.auditor_principal_id === input.authorisation.principalId &&
        conduct.has(row.centre_id);
      const unacknowledged =
        input.perspective.kind === "centre" &&
        row.status === "FINALISED" &&
        !row.acknowledged &&
        acknowledge.has(row.centre_id);
      if (!activeAssigned && !unacknowledged) continue;
      const critical = row.critical_finding_count > 0;
      const high = row.high_finding_count > 0;
      items.push({
        id: `quarterly_review:${row.id}`,
        sourceType: "quarterly_review",
        sourceId: row.id,
        centreId: row.centre_id,
        centreName: row.centre_name,
        headline: unacknowledged ? "Quarterly review is ready to acknowledge" : "Continue quarterly review",
        summary: unacknowledged
          ? "The finalised internal review requires acknowledgement"
          : "An assigned internal review remains in progress",
        attentionBand: critical ? "URGENT" : unacknowledged ? "TODAY" : "UPCOMING",
        responsibility: "YOU_NEED_TO_ACT",
        whyShown: unacknowledged
          ? { code: "REVIEW_REQUIRES_ACKNOWLEDGEMENT", label: "Finalised review requires acknowledgement" }
          : { code: "AUDIT_REQUIRES_ACTION", label: "Assigned internal review requires action" },
        riskLevel: critical ? "CRITICAL" : high ? "HIGH" : "STANDARD",
        cta: unacknowledged
          ? controlledDailyCta("Review and acknowledge", `/centre/reviews/${row.id}`)
          : controlledDailyCta(
              "Continue review",
              `/area-manager/centres/${row.centre_id}/audit/${row.id}`,
            ),
      });
    }
    return { items, completedTodayCount: 0, completedTodayTitles: [] };
  },
};
