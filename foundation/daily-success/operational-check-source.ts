import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { DailySuccessItem } from "./contracts";
import { controlledDailyCta } from "./cta";
import { classifyDueAt } from "./time";
import type { DailySourceInput, DailySourceResult } from "./types";

interface OperationalCheckDailyRow {
  id: string;
  centre_id: string;
  centre_name: string;
  timezone: string;
  standard_name: string;
  business_date: string;
  due_at: Date;
}

export const OperationalCheckDailySource = {
  async collect(input: DailySourceInput): Promise<DailySourceResult> {
    if (input.perspective.kind === "administration") {
      return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    }
    const readable = new Set([
      ...(input.authorisation.centreIdsByCapability.get(capability.operationalCheckRead) ?? []),
      ...(input.authorisation.centreIdsByCapability.get(capability.operationalCheckComplete) ?? []),
    ]);
    const complete = input.authorisation.centreIdsByCapability.get(capability.operationalCheckComplete) ?? new Set<string>();
    const centreIds = input.perspective.kind === "centre" && input.perspective.centreId
      ? readable.has(input.perspective.centreId) ? [input.perspective.centreId] : []
      : [...readable];
    if (centreIds.length === 0) return { items: [], completedTodayCount: 0, completedTodayTitles: [] };

    const rows = await input.executor.queryAll<OperationalCheckDailyRow>`
      SELECT occurrence.id, occurrence.centre_id, centre.name AS centre_name,
             occurrence.centre_timezone AS timezone, version.title AS standard_name,
             occurrence.business_date::text, occurrence.due_at
      FROM operational_check_occurrences AS occurrence
      JOIN centres AS centre
        ON centre.organisation_id = occurrence.organisation_id
       AND centre.id = occurrence.centre_id
      JOIN audit_template_versions AS version
        ON version.organisation_id = occurrence.organisation_id
       AND version.id = occurrence.template_version_id
       AND version.template_subtype = 'OPERATIONAL_STANDARD'
      WHERE occurrence.organisation_id = ${input.authorisation.organisationId}
        AND occurrence.centre_id = ANY(${centreIds}::uuid[])
        AND occurrence.status = 'OPEN'
        AND occurrence.opens_at <= ${input.authorisation.decisionAt}
        AND (
          occurrence.due_at <= ${input.authorisation.decisionAt}
          OR occurrence.business_date = (${input.authorisation.decisionAt} AT TIME ZONE occurrence.centre_timezone)::date
        )
      ORDER BY occurrence.due_at, occurrence.id
    `;

    return {
      items: rows.map((row): DailySuccessItem => {
        const due = classifyDueAt(row.due_at, input.authorisation.decisionAt, row.timezone);
        const overdue = due.bucket === "OVERDUE";
        const canComplete = complete.has(row.centre_id);
        return {
          id: `operational_check:${row.id}`,
          sourceType: "operational_check",
          sourceId: row.id,
          centreId: row.centre_id,
          centreName: row.centre_name,
          headline: row.standard_name,
          summary: overdue ? "A Centre Standard check is overdue" : "A Centre Standard check is due today",
          attentionBand: overdue ? "URGENT" : "TODAY",
          responsibility: canComplete ? "YOU_NEED_TO_ACT" : "FOR_YOUR_AWARENESS",
          whyShown: overdue
            ? { code: "CHECK_OVERDUE", label: "Centre Standard check is overdue" }
            : { code: "CHECK_DUE_TODAY", label: "Centre Standard check is due today" },
          due,
          riskLevel: "STANDARD",
          cta: controlledDailyCta(canComplete ? "Complete check" : "View check", `/standards/checks/${row.id}`),
        };
      }),
      completedTodayCount: 0,
      completedTodayTitles: [],
    };
  },
};
