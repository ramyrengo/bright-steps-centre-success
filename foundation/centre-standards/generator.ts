import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import { randomUUID } from "node:crypto";
import type { Transaction } from "encore.dev/storage/sqldb";
import { inSerializableTransaction } from "../transactions";
import {
  addLocalCalendarDays,
  compareLocalDates,
  localBusinessDate,
  resolveStrictLocalMinute,
} from "./time";

const MAX_CATCH_UP_DAYS = 31;

interface ScheduleRow {
  organisation_id: string;
  centre_id: string;
  centre_timezone: string;
  deployment_id: string;
  template_version_id: string;
  schedule_revision_id: string;
  schedule_revision: number;
  opens_local_time: string;
  due_local_time: string;
  deployment_effective_from: string;
  deployment_effective_to: string | null;
  schedule_effective_from: string;
  schedule_effective_to: string | null;
  last_business_date: string | null;
}

interface DeploymentScheduleSet {
  organisationId: string;
  centreId: string;
  centreTimezone: string;
  deploymentId: string;
  templateVersionId: string;
  deploymentEffectiveFrom: string;
  deploymentEffectiveTo: string | null;
  lastBusinessDate: string | null;
  schedules: Array<{
    id: string;
    revision: number;
    opensLocalTime: string;
    dueLocalTime: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

export interface OperationalOccurrenceGenerationDependencies {
  now: () => Date;
  occurrenceId: () => string;
}

const runtimeDependencies: OperationalOccurrenceGenerationDependencies = {
  now: () => new Date(),
  occurrenceId: randomUUID,
};

async function activeSchedules(
  transaction: Transaction,
  decisionAt: Date,
): Promise<ScheduleRow[]> {
  return transaction.queryAll<ScheduleRow>`
    SELECT
      deployment.organisation_id,
      deployment.centre_id,
      centre.timezone AS centre_timezone,
      deployment.id AS deployment_id,
      deployment.template_version_id,
      schedule.id AS schedule_revision_id,
      schedule.revision AS schedule_revision,
      to_char(schedule.opens_local_time, 'HH24:MI') AS opens_local_time,
      to_char(schedule.due_local_time, 'HH24:MI') AS due_local_time,
      deployment.effective_from::text AS deployment_effective_from,
      deployment.effective_to::text AS deployment_effective_to,
      schedule.effective_from::text AS schedule_effective_from,
      schedule.effective_to::text AS schedule_effective_to,
      (
        SELECT max(occurrence.business_date)::text
        FROM operational_check_occurrences AS occurrence
        WHERE occurrence.organisation_id = deployment.organisation_id
          AND occurrence.centre_id = deployment.centre_id
          AND occurrence.deployment_id = deployment.id
      ) AS last_business_date
    FROM operational_standard_deployments AS deployment
    JOIN centres AS centre
      ON centre.organisation_id = deployment.organisation_id
     AND centre.id = deployment.centre_id
    JOIN operational_standard_schedule_revisions AS schedule
      ON schedule.organisation_id = deployment.organisation_id
     AND schedule.centre_id = deployment.centre_id
     AND schedule.deployment_id = deployment.id
     AND schedule.centre_timezone = centre.timezone
     AND schedule.effective_from <= (${decisionAt} AT TIME ZONE centre.timezone)::date
    JOIN audit_template_versions AS version
     ON version.organisation_id = deployment.organisation_id
     AND version.id = deployment.template_version_id
     AND version.template_subtype = 'OPERATIONAL_STANDARD'
     AND version.status IN ('active', 'superseded')
    WHERE deployment.status = 'ACTIVE'
      AND centre.status = 'active'
      AND deployment.effective_from <= (${decisionAt} AT TIME ZONE centre.timezone)::date
      AND (deployment.effective_to IS NULL OR deployment.effective_to >= (${decisionAt} AT TIME ZONE centre.timezone)::date)
    ORDER BY deployment.organisation_id, deployment.centre_id, deployment.id,
             schedule.effective_from, schedule.revision
    FOR UPDATE OF deployment
  `;
}

function deploymentScheduleSets(rows: readonly ScheduleRow[]): DeploymentScheduleSet[] {
  const grouped = new Map<string, DeploymentScheduleSet>();
  for (const row of rows) {
    const existing = grouped.get(row.deployment_id) ?? {
      organisationId: row.organisation_id,
      centreId: row.centre_id,
      centreTimezone: row.centre_timezone,
      deploymentId: row.deployment_id,
      templateVersionId: row.template_version_id,
      deploymentEffectiveFrom: row.deployment_effective_from,
      deploymentEffectiveTo: row.deployment_effective_to,
      lastBusinessDate: row.last_business_date,
      schedules: [],
    };
    existing.schedules.push({
      id: row.schedule_revision_id,
      revision: Number(row.schedule_revision),
      opensLocalTime: row.opens_local_time,
      dueLocalTime: row.due_local_time,
      effectiveFrom: row.schedule_effective_from,
      effectiveTo: row.schedule_effective_to,
    });
    grouped.set(row.deployment_id, existing);
  }
  return [...grouped.values()];
}

function firstBusinessDate(row: DeploymentScheduleSet, today: string): string {
  const catchUpFloor = addLocalCalendarDays(today, -(MAX_CATCH_UP_DAYS - 1));
  const earliestSchedule = row.schedules
    .map((schedule) => schedule.effectiveFrom)
    .sort(compareLocalDates)[0];
  const afterLast = row.lastBusinessDate
    ? addLocalCalendarDays(row.lastBusinessDate, 1)
    : row.deploymentEffectiveFrom;
  return [afterLast, row.deploymentEffectiveFrom, earliestSchedule, catchUpFloor]
    .sort(compareLocalDates)
    .at(-1)!;
}

function scheduleForDate(
  row: DeploymentScheduleSet,
  businessDate: string,
): DeploymentScheduleSet["schedules"][number] | undefined {
  return row.schedules
    .filter((schedule) =>
      compareLocalDates(schedule.effectiveFrom, businessDate) <= 0 &&
      (!schedule.effectiveTo || compareLocalDates(businessDate, schedule.effectiveTo) <= 0))
    .sort((left, right) =>
      compareLocalDates(right.effectiveFrom, left.effectiveFrom) || right.revision - left.revision)[0];
}

/**
 * Generates immutable local-business-date occurrences. The unique deployment
 * and business-date key makes cron retries harmless; bounded catch-up prevents
 * one stale deployment from monopolising the scheduler.
 */
export async function generateOperationalCheckOccurrences(
  dependencies: OperationalOccurrenceGenerationDependencies = runtimeDependencies,
): Promise<{ created: number }> {
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    let created = 0;
    const schedules = deploymentScheduleSets(await activeSchedules(transaction, decisionAt));
    for (const row of schedules) {
      const today = localBusinessDate(decisionAt, row.centreTimezone);
      let businessDate = firstBusinessDate(row, today);
      while (compareLocalDates(businessDate, today) <= 0) {
        if (
          row.deploymentEffectiveTo &&
          compareLocalDates(businessDate, row.deploymentEffectiveTo) > 0
        ) break;
        const schedule = scheduleForDate(row, businessDate);
        if (!schedule) {
          businessDate = addLocalCalendarDays(businessDate, 1);
          continue;
        }
        const opensAt = resolveStrictLocalMinute({
          businessDate,
          localTime: schedule.opensLocalTime,
          timezone: row.centreTimezone,
        });
        const dueAt = resolveStrictLocalMinute({
          businessDate,
          localTime: schedule.dueLocalTime,
          timezone: row.centreTimezone,
        });
        const inserted = await transaction.queryRow<{ id: string }>`
          INSERT INTO operational_check_occurrences (
            id, organisation_id, centre_id, deployment_id,
            schedule_revision_id, template_version_id, business_date,
            centre_timezone, opens_at, due_at, status,
            created_at, updated_at
          ) VALUES (
            ${dependencies.occurrenceId()}, ${row.organisationId}, ${row.centreId},
            ${row.deploymentId}, ${schedule.id}, ${row.templateVersionId},
            ${businessDate}::date, ${row.centreTimezone}, ${opensAt}, ${dueAt},
            'OPEN', ${decisionAt}, ${decisionAt}
          )
          ON CONFLICT (organisation_id, deployment_id, centre_id, business_date)
          DO NOTHING
          RETURNING id
        `;
        if (inserted) created += 1;
        businessDate = addLocalCalendarDays(businessDate, 1);
      }
    }
    return { created };
  });
}

export const generateOperationalChecks = api(
  { expose: false, method: "POST", path: "/internal/centre-standards/generate" },
  (): Promise<{ created: number }> => generateOperationalCheckOccurrences(),
);

export const operationalCheckGenerationCron = new CronJob(
  "centre-standards-occurrence-generation",
  { every: "15m", endpoint: generateOperationalChecks },
);
