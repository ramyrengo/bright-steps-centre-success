import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { DailySuccessItem, DailyWhyShown } from "./contracts";
import { controlledDailyCta } from "./cta";
import { classifyDueAt, occurredOnLocalDate } from "./time";
import type { DailySourceInput, DailySourceResult } from "./types";

interface CorrectiveActionDailyRow {
  record_kind: "active" | "completed" | "finding";
  id: string;
  centre_id: string;
  centre_name: string;
  timezone: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  due_at: Date | null;
  status:
    | "OPEN"
    | "IN_PROGRESS"
    | "VERIFICATION_REQUIRED"
    | "CLOSED"
    | "MORE_INFORMATION_REQUIRED"
    | "REJECTED"
    | "WITHDRAWN";
  owner_principal_id: string | null;
  remediation_submitted_by_principal_id: string | null;
  independent_verification_required: boolean;
  immediate: boolean;
  completed_at: Date | null;
}

function idsFor(
  input: DailySourceInput,
  key: Parameters<DailySourceInput["authorisation"]["centreIdsByCapability"]["get"]>[0],
): ReadonlySet<string> {
  return input.authorisation.centreIdsByCapability.get(key) ?? new Set<string>();
}

function whyFor(row: CorrectiveActionDailyRow, dueBucket: string): DailyWhyShown {
  if (row.immediate) return { code: "IMMEDIATE_RISK", label: "Immediate action is required" };
  if (row.severity === "CRITICAL") return { code: "CRITICAL_RISK", label: "Critical risk needs attention" };
  if (row.status === "MORE_INFORMATION_REQUIRED" || row.status === "REJECTED") {
    return { code: "REMEDIATION_RETURNED", label: "Remediation was returned for more work" };
  }
  if (row.status === "VERIFICATION_REQUIRED") {
    return { code: "VERIFICATION_REQUIRED", label: "Remediation is ready for verification" };
  }
  if (dueBucket === "OVERDUE") return { code: "ACTION_OVERDUE", label: "Corrective action is overdue" };
  if (dueBucket === "TODAY") return { code: "ACTION_DUE_TODAY", label: "Corrective action is due today" };
  if (["TOMORROW", "DUE_SOON"].includes(dueBucket)) {
    return { code: "ACTION_DUE_SOON", label: "Corrective action is due soon" };
  }
  return { code: "REMEDIATION_REQUIRED", label: "Remediation remains open" };
}

export const CorrectiveActionDailySource = {
  async collect(input: DailySourceInput): Promise<DailySourceResult> {
    if (input.perspective.kind === "administration") {
      return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    }
    const readable = idsFor(input, capability.correctiveActionRead);
    const centreIds = input.perspective.kind === "centre" && input.perspective.centreId
      ? readable.has(input.perspective.centreId)
        ? [input.perspective.centreId]
        : []
      : [...readable];
    if (centreIds.length === 0) return { items: [], completedTodayCount: 0, completedTodayTitles: [] };

    const since = new Date(input.authorisation.decisionAt.getTime() - 48 * 60 * 60 * 1000);
    const rows = await input.executor.queryAll<CorrectiveActionDailyRow>`
      WITH active_actions AS (
        SELECT
          'active'::text AS record_kind,
          action.id,
          action.centre_id,
          centre.name AS centre_name,
          centre.timezone,
          action.title,
          action.severity,
          action.due_at,
          action.status,
          action.owner_principal_id,
          action.remediation_submitted_by_principal_id,
          action.independent_verification_required,
          COALESCE(configuration.immediate, FALSE) AS immediate,
          NULL::timestamptz AS completed_at
        FROM corrective_actions AS action
        JOIN centres AS centre
          ON centre.organisation_id = action.organisation_id
         AND centre.id = action.centre_id
        JOIN findings AS finding
          ON finding.organisation_id = action.organisation_id
         AND finding.id = action.finding_id
        LEFT JOIN audit_responses AS response
          ON response.organisation_id = finding.organisation_id
         AND response.id = finding.audit_response_id
        LEFT JOIN audit_item_outcome_configurations AS configuration
          ON configuration.organisation_id = response.organisation_id
         AND configuration.audit_item_id = response.audit_item_id
         AND configuration.outcome = response.outcome
        WHERE action.organisation_id = ${input.authorisation.organisationId}
          AND action.centre_id = ANY(${centreIds}::uuid[])
          AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
      ),
      completed_actions AS (
        SELECT DISTINCT ON (action.id)
          'completed'::text AS record_kind,
          action.id,
          action.centre_id,
          centre.name AS centre_name,
          centre.timezone,
          action.title,
          action.severity,
          action.due_at,
          action.status,
          action.owner_principal_id,
          action.remediation_submitted_by_principal_id,
          action.independent_verification_required,
          FALSE AS immediate,
          event.occurred_at AS completed_at
        FROM corrective_actions AS action
        JOIN centres AS centre
          ON centre.organisation_id = action.organisation_id
         AND centre.id = action.centre_id
        JOIN corrective_action_events AS event
          ON event.organisation_id = action.organisation_id
         AND event.corrective_action_id = action.id
         AND event.to_status = 'CLOSED'
         AND event.occurred_at >= ${since}
        WHERE action.organisation_id = ${input.authorisation.organisationId}
          AND action.centre_id = ANY(${centreIds}::uuid[])
          AND action.status = 'CLOSED'
        ORDER BY action.id, event.occurred_at DESC
      ),
      uncovered_critical_findings AS (
        SELECT
          'finding'::text AS record_kind,
          finding.id,
          finding.centre_id,
          centre.name AS centre_name,
          centre.timezone,
          item.wording AS title,
          finding.severity,
          NULL::timestamptz AS due_at,
          'OPEN'::text AS status,
          NULL::uuid AS owner_principal_id,
          NULL::uuid AS remediation_submitted_by_principal_id,
          FALSE AS independent_verification_required,
          FALSE AS immediate,
          NULL::timestamptz AS completed_at
        FROM findings AS finding
        JOIN centres AS centre
          ON centre.organisation_id = finding.organisation_id
         AND centre.id = finding.centre_id
        JOIN audit_responses AS response
          ON response.organisation_id = finding.organisation_id
         AND response.id = finding.audit_response_id
        JOIN audit_template_items AS item
          ON item.organisation_id = response.organisation_id
         AND item.id = response.audit_item_id
        WHERE finding.organisation_id = ${input.authorisation.organisationId}
          AND finding.source_family = 'QUARTERLY_AUDIT'
          AND finding.centre_id = ANY(${centreIds}::uuid[])
          AND finding.status = 'OPEN'
          AND finding.severity = 'CRITICAL'
          AND ${input.perspective.kind === "portfolio" || input.perspective.kind === "compliance"}
          AND NOT EXISTS (
            SELECT 1
            FROM corrective_actions AS action
            WHERE action.organisation_id = finding.organisation_id
              AND action.finding_id = finding.id
              AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
          )
      )
      SELECT * FROM active_actions
      UNION ALL
      SELECT * FROM completed_actions
      UNION ALL
      SELECT * FROM uncovered_critical_findings
      ORDER BY record_kind, due_at, id
    `;

    const remediate = idsFor(input, capability.correctiveActionRemediate);
    const verify = idsFor(input, capability.correctiveActionVerify);
    const items: DailySuccessItem[] = [];
    const completedTodayTitles: string[] = [];
    let completedTodayCount = 0;

    for (const row of rows) {
      if (row.record_kind === "completed") {
        if (
          row.completed_at &&
          occurredOnLocalDate(row.completed_at, input.authorisation.decisionAt, row.timezone)
        ) {
          completedTodayCount += 1;
          completedTodayTitles.push(row.title);
        }
        continue;
      }

      if (row.record_kind === "finding") {
        items.push({
          id: `finding:${row.id}`,
          sourceType: "finding",
          sourceId: row.id,
          centreId: row.centre_id,
          centreName: row.centre_name,
          headline: row.title,
          summary: "An active critical internal review finding requires oversight",
          attentionBand: "URGENT",
          responsibility: input.perspective.kind === "portfolio"
            ? "YOUR_CENTRE_NEEDS_TO_ACT"
            : "FOR_YOUR_AWARENESS",
          whyShown: { code: "CRITICAL_RISK", label: "Critical risk needs attention" },
          riskLevel: "CRITICAL",
          cta: input.perspective.kind === "portfolio"
            ? controlledDailyCta("Open Area Manager workspace", "/area-manager")
            : controlledDailyCta("Open compliance oversight", "/compliance"),
        });
        continue;
      }

      if (!row.due_at) continue;
      const due = classifyDueAt(row.due_at, input.authorisation.decisionAt, row.timezone);
      const directlyOwned = row.owner_principal_id === input.authorisation.principalId;
      const canRemediate = directlyOwned && remediate.has(row.centre_id);
      const canIndependentlyVerify =
        verify.has(row.centre_id) &&
        !(
          row.independent_verification_required &&
          row.remediation_submitted_by_principal_id === input.authorisation.principalId
        );
      const verification = row.status === "VERIFICATION_REQUIRED";
      const responsibility = verification
        ? canIndependentlyVerify
          ? "YOU_NEED_TO_ACT" as const
          : "WAITING_ON_SOMEONE_ELSE" as const
        : canRemediate
          ? "YOU_NEED_TO_ACT" as const
          : input.perspective.kind === "centre" || input.perspective.kind === "portfolio"
            ? "YOUR_CENTRE_NEEDS_TO_ACT" as const
            : "FOR_YOUR_AWARENESS" as const;
      const critical = row.immediate || row.severity === "CRITICAL";
      const attentionBand = critical || due.bucket === "OVERDUE" ||
          row.status === "MORE_INFORMATION_REQUIRED" || row.status === "REJECTED"
        ? "URGENT" as const
        : verification
          ? canIndependentlyVerify ? "TODAY" as const : "WAITING" as const
          : due.bucket === "TODAY"
            ? "TODAY" as const
            : due.bucket === "TOMORROW" || due.bucket === "DUE_SOON"
              ? "UPCOMING" as const
              : "AWARENESS" as const;

      const include = input.perspective.kind === "centre"
        ? critical || canRemediate || verification || due.daysFromToday <= 7
        : input.perspective.kind === "portfolio"
          ? critical || row.severity === "HIGH" || verification || due.bucket === "OVERDUE" || due.bucket === "TODAY"
          : critical || (row.severity === "HIGH" && due.bucket === "OVERDUE") || verification;
      if (!include) continue;

      items.push({
        id: `corrective_action:${row.id}`,
        sourceType: "corrective_action",
        sourceId: row.id,
        centreId: row.centre_id,
        centreName: row.centre_name,
        headline: row.title,
        summary: verification ? "Waiting for verification" : "Corrective action remains active",
        attentionBand,
        responsibility,
        whyShown: whyFor(row, due.bucket),
        due,
        riskLevel: critical ? "CRITICAL" : row.severity === "HIGH" ? "HIGH" : "STANDARD",
        ...(verification
          ? { verification: { required: true as const, eligible: canIndependentlyVerify } }
          : {}),
        cta: verification && canIndependentlyVerify
          ? controlledDailyCta("Verify action", `/area-manager/verification/${row.id}`)
          : controlledDailyCta(
              canRemediate ? "Continue action" : "Review action",
              `/centre/actions/${row.id}`,
            ),
      });
    }

    return { items, completedTodayCount, completedTodayTitles: completedTodayTitles.slice(0, 3) };
  },
};
