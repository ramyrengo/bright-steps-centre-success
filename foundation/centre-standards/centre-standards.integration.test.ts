import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { FoundationCapability } from "../authorization/capabilities";
import { buildAuthorisedNavigation } from "../navigation/service";
import { centreSuccessDB } from "../db";
import { CorrectiveActionDailySource } from "../daily-success/corrective-action-source";
import { OperationalCheckDailySource } from "../daily-success/operational-check-source";
import { PeopleAccessDailySource } from "../daily-success/people-access-source";
import { QuarterlyReviewDailySource } from "../daily-success/quarterly-review-source";
import { buildDailySuccess } from "../daily-success/service";
import { generateOperationalCheckOccurrences } from "./generator";
import { buildStandardsWorkspace, completeStandardsCheck, loadStandardsCheckDetail } from "./service";
import { loadCorrectiveActionDetail } from "../quarterly-reviews/queries";
import { loadComplianceOversight } from "../quarterly-reviews/service";
import { seedSyntheticStandardsPilot, SYNTHETIC_STANDARDS_PILOT_IDS, SYNTHETIC_STANDARDS_REMEDIATION } from "./synthetic-pilot";

const localEnvironment = { cloud: "local" as const, name: "local", type: "development" as const };
const ORGANISATION = "b5c40000-0000-4000-8000-000000000010";
const CENTRES = [
  "b5c40000-0000-4000-8000-000000000011",
  "b5c40000-0000-4000-8000-000000000012",
] as const;
const STATE_UNIT = "b5c40000-0000-4000-8000-000000000013";
const REGION_UNIT = "b5c40000-0000-4000-8000-000000000014";
const SYSTEM_ADMINISTRATOR = "b5c40000-0000-4000-8000-000000000015";
const QUARTERLY_SCORING_POLICY = "b5c40000-0000-4000-8000-000000000016";
const QUARTERLY_TEMPLATE = "b5c40000-0000-4000-8000-000000000017";
const QUARTERLY_VERSION = "b5c40000-0000-4000-8000-000000000018";
const SECOND_SCHEDULE = "b5c40000-0000-4000-8000-000000000019";
const EDUCATOR = "b5c40000-0000-4000-8000-000000000101";
const OTHER_EDUCATOR = "b5c40000-0000-4000-8000-000000000102";
const WRONG_CENTRE_EDUCATOR = "b5c40000-0000-4000-8000-000000000103";
const EXPIRED_EDUCATOR = "b5c40000-0000-4000-8000-000000000104";
const INACTIVE_EDUCATOR = "b5c40000-0000-4000-8000-000000000105";
const INVALID_HIERARCHY_EDUCATOR = "b5c40000-0000-4000-8000-000000000106";
const INVALID_CENTRE = "b5c40000-0000-4000-8000-000000000107";
const DAILY_DIRECTOR = "b5c40000-0000-4000-8000-000000000108";
const OCCURRENCES = [
  "b5c40000-0000-4000-8000-000000000201",
  "b5c40000-0000-4000-8000-000000000202",
  "b5c40000-0000-4000-8000-000000000203",
];
const AT = new Date("2026-08-13T02:00:00.000Z");
let firstOperationalActionId: string;
const dailyDependencies = {
  now: () => AT,
  correctiveActionSource: CorrectiveActionDailySource,
  quarterlyReviewSource: QuarterlyReviewDailySource,
  peopleAccessSource: PeopleAccessDailySource,
  operationalCheckSource: OperationalCheckDailySource,
};

async function seedEducator(principalId: string, centreId: string, effectiveTo?: Date): Promise<void> {
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  const scopeId = randomUUID();
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${ORGANISATION} AND role_key = 'educator'
      AND version = 2 AND status = 'active'
  `;
  if (!role) throw new Error("Educator v2 is unavailable");
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${`Synthetic Educator ${principalId.slice(-3)}`}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (id, organisation_id, principal_id, status, effective_from)
    VALUES (${membershipId}, ${ORGANISATION}, ${principalId}, 'active', '2026-08-01')
  `;
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, effective_to, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${ORGANISATION}, ${membershipId}, ${role.id}, 'active',
      '2026-08-01', ${effectiveTo ?? null}, 'system', 'Synthetic Centre Standards integration test.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id,
      effective_from, effective_to
    ) VALUES (
      ${scopeId}, ${ORGANISATION}, ${assignmentId}, 'centre', ${centreId},
      '2026-08-01', ${effectiveTo ?? null}
    )
  `;
}

async function addCentreDirectorAssignment(principalId: string, centreId: string): Promise<void> {
  const row = await centreSuccessDB.queryRow<{ membership_id: string; role_id: string }>`
    SELECT membership.id AS membership_id, role.id AS role_id
    FROM organisation_memberships AS membership
    JOIN role_definitions AS role
      ON role.organisation_id = membership.organisation_id
     AND role.role_key = 'centre_director'
     AND role.status = 'active'
    WHERE membership.organisation_id = ${ORGANISATION}
      AND membership.principal_id = ${principalId}
  `;
  if (!row) throw new Error("Centre Director assignment fixture is unavailable");
  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${ORGANISATION}, ${row.membership_id}, ${row.role_id},
      'active', '2026-08-01', 'system',
      'Synthetic Daily Success operational-source integration test.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
    ) VALUES (
      ${randomUUID()}, ${ORGANISATION}, ${assignmentId}, 'centre', ${centreId}, '2026-08-01'
    )
  `;
}

async function occurrenceId(date: string): Promise<string> {
  const row = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM operational_check_occurrences
    WHERE organisation_id = ${ORGANISATION}
      AND deployment_id = ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}
      AND business_date = ${date}::date
  `;
  if (!row) throw new Error(`occurrence unavailable: ${date}`);
  return row.id;
}

function answers(issue: boolean): Array<{ questionId: string; value: string }> {
  return SYNTHETIC_STANDARDS_PILOT_IDS.questionIds.map((questionId, index) => ({
    questionId,
    value: issue && index === 1 ? "NON_COMPLIANT" : "COMPLIANT",
  }));
}

describe.sequential("Milestone 4A Centre Standards vertical slice", () => {
  beforeAll(async () => {
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${ORGANISATION}, 'Synthetic Centre Standards Test Organisation', 'active', 'Australia/Sydney')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisational_units (
        id, organisation_id, parent_id, kind, code, name, status, effective_from
      ) VALUES
        (${STATE_UNIT}, ${ORGANISATION}, NULL, 'state', 'STD-STATE',
         'Synthetic Standards State', 'active', '2026-08-01'),
        (${REGION_UNIT}, ${ORGANISATION}, ${STATE_UNIT}, 'region', 'STD-REGION',
         'Synthetic Standards Region', 'active', '2026-08-01')
    `;
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES
        (${CENTRES[0]}, ${ORGANISATION}, 'STD-NORTH', 'Synthetic Standards North Centre',
         'SYNTHETIC', 'Australia/Sydney', 'active'),
        (${CENTRES[1]}, ${ORGANISATION}, 'STD-SOUTH', 'Synthetic Standards South Centre',
         'SYNTHETIC', 'Australia/Sydney', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO centre_organisational_unit_memberships (
        id, organisation_id, centre_id, organisational_unit_id, effective_from
      ) VALUES
        (${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]}, ${REGION_UNIT}, '2026-08-01'),
        (${randomUUID()}, ${ORGANISATION}, ${CENTRES[1]}, ${REGION_UNIT}, '2026-08-01')
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_scoring_policies (
        id, organisation_id, policy_key, version, name, status, rounding_scale, source_classification
      ) VALUES (
        ${QUARTERLY_SCORING_POLICY}, ${ORGANISATION}, 'standards_wrong_kind_test', 1,
        'Synthetic wrong-kind test policy', 'draft', 1, 'BSA_DEVELOPMENT_TEST'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_templates (
        id, organisation_id, template_key, title, audit_type, template_subtype, status
      ) VALUES (
        ${QUARTERLY_TEMPLATE}, ${ORGANISATION}, 'standards_wrong_kind_test',
        'Synthetic wrong-kind quarterly template', 'quarterly_review', 'QUARTERLY_REVIEW', 'active'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_template_versions (
        id, organisation_id, audit_template_id, scoring_policy_id, template_subtype,
        version, title, instructions, status, effective_from, source_classification, synthetic
      ) VALUES (
        ${QUARTERLY_VERSION}, ${ORGANISATION}, ${QUARTERLY_TEMPLATE}, ${QUARTERLY_SCORING_POLICY},
        'QUARTERLY_REVIEW', 1, 'Synthetic wrong-kind quarterly template',
        'Synthetic test content only.', 'draft', '2026-08-01', 'BSA_DEVELOPMENT_TEST', TRUE
      )
    `;
    await seedSyntheticStandardsPilot({
      environment: localEnvironment,
      organisationId: ORGANISATION,
      centreId: CENTRES[0],
      effectiveFrom: "2026-08-11",
      activate: true,
    });
    await seedEducator(EDUCATOR, CENTRES[0]);
    await seedEducator(OTHER_EDUCATOR, CENTRES[0]);
    await seedEducator(WRONG_CENTRE_EDUCATOR, CENTRES[1]);
    await seedEducator(EXPIRED_EDUCATOR, CENTRES[0], new Date("2026-08-13T00:00:00Z"));
    await seedEducator(INACTIVE_EDUCATOR, CENTRES[0]);
    await seedEducator(DAILY_DIRECTOR, CENTRES[0]);
    await addCentreDirectorAssignment(DAILY_DIRECTOR, CENTRES[0]);
    const administratorRole = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${ORGANISATION}
        AND role_key = 'system_administrator'
        AND status = 'active'
    `;
    const administratorMembership = randomUUID();
    const administratorAssignment = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${SYSTEM_ADMINISTRATOR}, 'Synthetic Standards System Administrator', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisation_memberships (id, organisation_id, principal_id, status, effective_from)
      VALUES (${administratorMembership}, ${ORGANISATION}, ${SYSTEM_ADMINISTRATOR}, 'active', '2026-08-01')
    `;
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, grant_source_type, reason
      ) VALUES (
        ${administratorAssignment}, ${ORGANISATION}, ${administratorMembership},
        ${administratorRole!.id}, 'active', '2026-08-01', 'system',
        'Synthetic Centre Standards isolation test.'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, effective_from
      ) VALUES (${randomUUID()}, ${ORGANISATION}, ${administratorAssignment}, 'organisation', '2026-08-01')
    `;
    await centreSuccessDB.exec`
      UPDATE role_assignments SET status = 'inactive'
      WHERE organisation_membership_id = (
        SELECT id FROM organisation_memberships WHERE principal_id = ${INACTIVE_EDUCATOR}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES (${INVALID_CENTRE}, ${ORGANISATION}, 'SYN-INVALID', 'Synthetic Invalid Hierarchy Centre', 'SYNTHETIC', 'Australia/Sydney', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO centre_organisational_unit_memberships (
        id, organisation_id, centre_id, organisational_unit_id, effective_from
      ) VALUES
        (${randomUUID()}, ${ORGANISATION}, ${INVALID_CENTRE}, ${STATE_UNIT}, '2026-08-01'),
        (${randomUUID()}, ${ORGANISATION}, ${INVALID_CENTRE}, ${REGION_UNIT}, '2026-08-01')
    `;
    await seedEducator(INVALID_HIERARCHY_EDUCATOR, INVALID_CENTRE);
    const eligible = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM operational_standard_deployments AS deployment
      JOIN operational_standard_schedule_revisions AS schedule
        ON schedule.organisation_id = deployment.organisation_id
       AND schedule.centre_id = deployment.centre_id
       AND schedule.deployment_id = deployment.id
      JOIN centres AS centre
        ON centre.organisation_id = deployment.organisation_id AND centre.id = deployment.centre_id
      JOIN audit_template_versions AS version
        ON version.organisation_id = deployment.organisation_id AND version.id = deployment.template_version_id
       AND version.template_subtype = 'OPERATIONAL_STANDARD' AND version.status = 'active'
      WHERE deployment.status = 'ACTIVE' AND centre.status = 'active'
        AND deployment.organisation_id = ${ORGANISATION}
        AND deployment.effective_from <= (${AT} AT TIME ZONE centre.timezone)::date
        AND (deployment.effective_to IS NULL OR deployment.effective_to >= (${AT} AT TIME ZONE centre.timezone)::date)
        AND schedule.effective_from <= (${AT} AT TIME ZONE centre.timezone)::date
        AND (schedule.effective_to IS NULL OR schedule.effective_to >= (${AT} AT TIME ZONE centre.timezone)::date)
    `;
    if (eligible?.count !== 1) throw new Error(`expected one eligible schedule, received ${eligible?.count}`);
    let index = 0;
    const generated = await generateOperationalCheckOccurrences({ now: () => AT, occurrenceId: () => OCCURRENCES[index++] });
    if (generated.created !== 3) {
      const state = await centreSuccessDB.queryRow<Record<string, unknown>>`
        SELECT deployment.status, deployment.effective_from::text,
               schedule.effective_from::text AS schedule_from,
               version.status AS version_status, version.template_subtype,
               centre.status AS centre_status, centre.timezone,
               (deployment.effective_from <= (${AT} AT TIME ZONE centre.timezone)::date) AS deployment_started,
               (schedule.effective_from <= (${AT} AT TIME ZONE centre.timezone)::date) AS schedule_started,
               (SELECT count(*)::integer FROM operational_check_occurrences WHERE deployment_id = deployment.id) AS occurrence_count,
               (deployment.effective_to IS NULL) AS deployment_open,
               (schedule.effective_to IS NULL) AS schedule_open
        FROM operational_standard_deployments AS deployment
        JOIN operational_standard_schedule_revisions AS schedule ON schedule.deployment_id = deployment.id
        JOIN audit_template_versions AS version ON version.id = deployment.template_version_id
        JOIN centres AS centre ON centre.id = deployment.centre_id
        WHERE deployment.id = ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}
      `;
      throw new Error(`expected three generated occurrences, received ${generated.created}: ${JSON.stringify(state)}`);
    }
    await expect(generateOperationalCheckOccurrences({
      now: () => AT,
      occurrenceId: randomUUID,
    })).resolves.toEqual({ created: 0 });
  });

  test("enforces subtype and source-family tenant/centre integrity in PostgreSQL", async () => {
    const quarterlyVersion = QUARTERLY_VERSION;
    await expect(centreSuccessDB.exec`
      INSERT INTO audit_runs (
        id, organisation_id, centre_id, template_version_id, template_subtype,
        auditor_principal_id, review_period_start, status, started_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.versionId}, 'QUARTERLY_REVIEW',
        ${EDUCATOR}, '2026-07-01', 'DRAFT', ${AT}
      )
    `).rejects.toThrow();
    await expect(centreSuccessDB.exec`
      INSERT INTO operational_check_occurrences (
        id, organisation_id, centre_id, deployment_id, schedule_revision_id,
        template_version_id, business_date, centre_timezone, opens_at, due_at, status
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}, ${SYNTHETIC_STANDARDS_PILOT_IDS.scheduleRevisionId},
        ${quarterlyVersion}, '2026-08-14', 'Australia/Sydney',
        '2026-08-13T23:00:00Z', '2026-08-14T07:00:00Z', 'OPEN'
      )
    `).rejects.toThrow();

    const response = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM operational_check_responses
      WHERE organisation_id = ${ORGANISATION}
      LIMIT 1
    `;
    expect(response).toBeNull();
    const sourceCounts = await centreSuccessDB.queryRow<{ operational: number; quarterly: number }>`
      SELECT
        count(*) FILTER (WHERE source_family = 'OPERATIONAL_CHECK')::integer AS operational,
        count(*) FILTER (WHERE source_family = 'QUARTERLY_AUDIT')::integer AS quarterly
      FROM findings
      WHERE organisation_id = ${ORGANISATION}
    `;
    expect(sourceCounts).toEqual({ operational: 0, quarterly: 0 });

    const openOccurrence = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id
      FROM operational_check_occurrences
      WHERE organisation_id = ${ORGANISATION}
        AND status = 'OPEN'
      ORDER BY business_date
      LIMIT 1
    `;
    await expect(centreSuccessDB.exec`
      INSERT INTO system_audit_events (
        id, organisation_id, actor_principal_id, action, resource_type,
        resource_id, scope_type, scope_id, context, occurred_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${EDUCATOR},
        'operational_check.test_invalid_scope', 'operational_check_occurrence',
        ${openOccurrence!.id}, 'centre', ${CENTRES[1]}, '{}'::jsonb, ${AT}
      )
    `).rejects.toThrow(/scope does not match its centre/);
    await expect(centreSuccessDB.exec`
      UPDATE operational_check_occurrences
      SET status = 'COMPLETED', completed_by_principal_id = ${EDUCATOR},
          completed_at = ${AT}, updated_at = ${AT}, lock_version = lock_version + 1
      WHERE organisation_id = ${ORGANISATION}
        AND id = ${openOccurrence!.id}
    `).rejects.toThrow(/response for every pinned item/);

    await expect(centreSuccessDB.exec`
      UPDATE operational_standard_deployments
      SET effective_from = '2026-08-10', updated_at = now(), lock_version = lock_version + 1
      WHERE organisation_id = ${ORGANISATION}
        AND id = ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}
    `).rejects.toThrow(/source facts are immutable/);

    await expect(centreSuccessDB.exec`
      INSERT INTO operational_standard_schedule_revisions (
        id, organisation_id, centre_id, deployment_id, revision, frequency,
        opens_local_time, due_local_time, effective_from
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}, 3, 'DAILY',
        '10:00', '18:00', '2026-08-14'
      )
    `).rejects.toThrow(/contiguous/);
  });

  test("discovers only authorised open work and keeps System Administrator isolated", async () => {
    const workspace = await buildStandardsWorkspace({ principalId: EDUCATOR }, { now: () => AT });
    expect(workspace.response.status).toBe("ready");
    expect(workspace.response.openChecks).toHaveLength(3);
    expect(workspace.response.openChecks?.every((check) => check.canComplete)).toBe(true);
    const wrong = await buildStandardsWorkspace({ principalId: WRONG_CENTRE_EDUCATOR }, { now: () => AT });
    expect(wrong.response).toMatchObject({ status: "ready", openChecks: [] });
    const admin = await buildStandardsWorkspace(
      { principalId: SYSTEM_ADMINISTRATOR },
      { now: () => AT },
    );
    expect(admin.response.status).toBe("unsupported");
    expect(admin.response.openChecks).toBeUndefined();
    const partial = await buildStandardsWorkspace(
      { principalId: INVALID_HIERARCHY_EDUCATOR },
      { now: () => AT },
    );
    expect(partial.response.status).toBe("partial");
    expect(partial.response.openChecks).toBeUndefined();
    const navigation = await buildAuthorisedNavigation({ principalId: EDUCATOR }, { now: () => AT });
    expect(navigation.response.links).toContainEqual({ label: "Centre Standards", route: "/standards" });
    const adminNavigation = await buildAuthorisedNavigation(
      { principalId: SYSTEM_ADMINISTRATOR },
      { now: () => AT },
    );
    expect(adminNavigation.response.links).not.toContainEqual({ label: "Centre Standards", route: "/standards" });
  });

  test("atomically completes an action-generating response and enforces source identity", async () => {
    const id = await occurrenceId("2026-08-11");
    const detail = await loadStandardsCheckDetail({ principalId: EDUCATOR, occurrenceId: id }, { now: () => AT });
    expect(detail.questions).toHaveLength(3);
    expect(detail).toMatchObject({
      standardName: "Centre Standards Pilot — Staging",
      synthetic: true,
      syntheticNotice: expect.stringContaining("SYNTHETIC STAGING TEST"),
      state: "OPEN",
      timeliness: "OVERDUE",
    });
    expect(JSON.stringify(detail)).not.toMatch(/severity|dueDays|remediation|verification/i);
    const completed = await completeStandardsCheck(
      { principalId: EDUCATOR, request: { occurrenceId: id, answers: answers(true) } },
      { now: () => AT },
    );
    expect(completed).toMatchObject({ outcome: "COMPLETED", issueRaised: true });
    const facts = await centreSuccessDB.queryRow<{
      responses: number; findings: number; actions: number; remediation: string;
      source_family: string; owner_principal_id: string; timeliness: string;
    }>`
      SELECT
        (SELECT count(*)::integer FROM operational_check_responses WHERE occurrence_id = occurrence.id) AS responses,
        (SELECT count(*)::integer FROM findings WHERE check_response_id IN (
          SELECT id FROM operational_check_responses WHERE occurrence_id = occurrence.id
        )) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.check_response_id IN (SELECT id FROM operational_check_responses WHERE occurrence_id = occurrence.id)) AS actions,
        (SELECT action.required_remediation FROM corrective_actions AS action JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.check_response_id IN (SELECT id FROM operational_check_responses WHERE occurrence_id = occurrence.id) LIMIT 1) AS remediation,
        (SELECT action.owner_principal_id FROM corrective_actions AS action JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.check_response_id IN (SELECT id FROM operational_check_responses WHERE occurrence_id = occurrence.id) LIMIT 1) AS owner_principal_id,
        (SELECT finding.source_family FROM findings AS finding WHERE finding.check_response_id IN (
          SELECT id FROM operational_check_responses WHERE occurrence_id = occurrence.id
        ) LIMIT 1) AS source_family,
        CASE WHEN occurrence.completed_at <= occurrence.due_at THEN 'on_time' ELSE 'late' END AS timeliness
      FROM operational_check_occurrences AS occurrence WHERE occurrence.id = ${id}
    `;
    expect(facts).toEqual({
      responses: 3,
      findings: 1,
      actions: 1,
      remediation: SYNTHETIC_STANDARDS_REMEDIATION,
      source_family: "OPERATIONAL_CHECK",
      owner_principal_id: DAILY_DIRECTOR,
      timeliness: "late",
    });
    const forbiddenAuditConcepts = await centreSuccessDB.queryRow<{
      runs: number;
      acknowledgements: number;
      positive_practice: number;
    }>`
      SELECT
        (SELECT count(*)::integer FROM audit_runs WHERE organisation_id = ${ORGANISATION}) AS runs,
        (SELECT count(*)::integer FROM audit_acknowledgements WHERE organisation_id = ${ORGANISATION}) AS acknowledgements,
        (SELECT count(*)::integer FROM positive_observations WHERE organisation_id = ${ORGANISATION}) AS positive_practice
    `;
    expect(forbiddenAuditConcepts).toEqual({ runs: 0, acknowledgements: 0, positive_practice: 0 });
    const operationalResponse = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM operational_check_responses WHERE occurrence_id = ${id} AND outcome = 'NON_COMPLIANT'
    `;
    const operationalAction = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT action.id
      FROM corrective_actions AS action
      JOIN findings AS finding
        ON finding.organisation_id = action.organisation_id
       AND finding.id = action.finding_id
      WHERE finding.organisation_id = ${ORGANISATION}
        AND finding.check_response_id = ${operationalResponse!.id}
    `;
    firstOperationalActionId = operationalAction!.id;
    const actionDetail = await loadCorrectiveActionDetail(
      ORGANISATION,
      firstOperationalActionId,
      DAILY_DIRECTOR,
    );
    expect(actionDetail.finding).toMatchObject({
      repeatCount: 1,
      origin: {
        source: "OPERATIONAL_CHECK",
        label: "Centre Standard",
        occurrenceId: id,
        standardName: "Centre Standards Pilot — Staging",
        businessDate: "2026-08-11",
        synthetic: true,
      },
    });
    expect(JSON.stringify(actionDetail.finding.origin)).not.toMatch(/audit|acknowledged/i);
    const quarterlyOversight = await loadComplianceOversight(ORGANISATION, AT);
    expect(quarterlyOversight.counts).toMatchObject({
      criticalFindings: 0,
      highFindings: 0,
      openCorrectiveActions: 0,
      overdueCorrectiveActions: 0,
      awaitingVerification: 0,
    });
    await expect(centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, source_family, item_lineage_key,
        severity, description, source_classification, status,
        created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]}, 'OPERATIONAL_CHECK',
        'sourceless-operational', 'MEDIUM', 'Synthetic invalid sourceless finding',
        'BSA_DEVELOPMENT_TEST', 'OPEN', ${EDUCATOR}, ${AT}, ${AT}
      )
    `).rejects.toThrow();
    await expect(centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, source_family, audit_run_id,
        audit_response_id, check_response_id, item_lineage_key, severity,
        description, source_classification, status, created_by_principal_id,
        created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]}, 'OPERATIONAL_CHECK',
        ${randomUUID()}, ${randomUUID()}, ${operationalResponse!.id}, 'mixed-source',
        'MEDIUM', 'Synthetic invalid mixed-source finding', 'BSA_DEVELOPMENT_TEST',
        'OPEN', ${EDUCATOR}, ${AT}, ${AT}
      )
    `).rejects.toThrow();
    await expect(centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, source_family, check_response_id,
        item_lineage_key, severity, description, source_classification,
        status, created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]}, 'OPERATIONAL_CHECK',
        ${operationalResponse!.id}, 'duplicate-operational-source', 'MEDIUM',
        'Synthetic duplicate finding', 'BSA_DEVELOPMENT_TEST', 'OPEN',
        ${EDUCATOR}, ${AT}, ${AT}
      )
    `).rejects.toThrow();
    await expect(centreSuccessDB.exec`
      UPDATE findings
      SET source_family = 'QUARTERLY_AUDIT', updated_at = now(), lock_version = lock_version + 1
      WHERE organisation_id = ${ORGANISATION}
        AND check_response_id = ${operationalResponse!.id}
    `).rejects.toThrow(/source identity is immutable/);
    await expect(centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, source_family, check_response_id,
        item_lineage_key, severity, description, source_classification, status,
        created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[1]}, 'OPERATIONAL_CHECK',
        ${operationalResponse!.id}, 'wrong-centre', 'MEDIUM', 'Synthetic invalid cross-centre finding',
        'BSA_DEVELOPMENT_TEST', 'OPEN', ${EDUCATOR}, ${AT}, ${AT}
      )
    `).rejects.toThrow();
    const otherOrganisation = randomUUID();
    const otherCentre = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${otherOrganisation}, 'Synthetic Cross Tenant Organisation', 'active', 'Australia/Sydney')
    `;
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES (${otherCentre}, ${otherOrganisation}, 'CROSS', 'Synthetic Cross Tenant Centre', 'SYNTHETIC', 'Australia/Sydney', 'active')
    `;
    await expect(centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, source_family, check_response_id,
        item_lineage_key, severity, description, source_classification, status,
        created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${otherOrganisation}, ${otherCentre}, 'OPERATIONAL_CHECK',
        ${operationalResponse!.id}, 'wrong-tenant', 'MEDIUM', 'Synthetic invalid cross-tenant finding',
        'BSA_DEVELOPMENT_TEST', 'OPEN', ${EDUCATOR}, ${AT}, ${AT}
      )
    `).rejects.toThrow();
  });

  test("denies wrong-centre and expired assignments", async () => {
    const id = await occurrenceId("2026-08-12");
    await expect(completeStandardsCheck(
      { principalId: WRONG_CENTRE_EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
      { now: () => AT },
    )).rejects.toMatchObject({ code: "access_denied" });
    await expect(completeStandardsCheck(
      { principalId: INACTIVE_EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
      { now: () => AT },
    )).rejects.toMatchObject({ code: "access_denied" });
    await expect(completeStandardsCheck(
      { principalId: EXPIRED_EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
      { now: () => AT },
    )).rejects.toMatchObject({ code: "access_denied" });
  });

  test("no-action completion is idempotent for requester and another authorised principal", async () => {
    const id = await occurrenceId("2026-08-12");
    const concurrent = await Promise.all([
      completeStandardsCheck(
        { principalId: EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
        { now: () => AT },
      ),
      completeStandardsCheck(
        { principalId: EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
        { now: () => new Date(AT.getTime() + 1) },
      ),
    ]);
    expect(concurrent.map((result) => result.outcome).sort()).toEqual([
      "ALREADY_COMPLETED",
      "COMPLETED",
    ]);
    expect(concurrent.find((result) => result.outcome === "COMPLETED"))
      .toMatchObject({ issueRaised: false });
    const same = await completeStandardsCheck(
      { principalId: EDUCATOR, request: { occurrenceId: id, answers: [] } },
      { now: () => new Date(AT.getTime() + 1000) },
    );
    expect(same).toMatchObject({ outcome: "ALREADY_COMPLETED", completedByRequester: true });
    const other = await completeStandardsCheck(
      { principalId: OTHER_EDUCATOR, request: { occurrenceId: id, answers: [] } },
      { now: () => new Date(AT.getTime() + 2000) },
    );
    expect(other).toMatchObject({ outcome: "ALREADY_COMPLETED", completedByRequester: false });
    const counts = await centreSuccessDB.queryRow<{ responses: number; findings: number }>`
      SELECT
        (SELECT count(*)::integer FROM operational_check_responses WHERE occurrence_id = ${id}) AS responses,
        (SELECT count(*)::integer FROM findings WHERE check_response_id IN (
          SELECT id FROM operational_check_responses WHERE occurrence_id = ${id}
        )) AS findings
    `;
    expect(counts).toEqual({ responses: 3, findings: 0 });
  });

  test("Daily Success projects OPEN due/overdue work set-wise and keeps generated actions in the existing source", async () => {
    const openId = await occurrenceId("2026-08-13");
    const centreSet = new Set([CENTRES[0]]);
    const baseInput = {
      authorisation: {
        principalId: EDUCATOR,
        organisationId: ORGANISATION,
        decisionAt: AT,
        centres: [],
        centreIdsByCapability: new Map([[capability.operationalCheckComplete, centreSet]]),
        invalidCentreIdsByCapability: new Map(),
        organisationCapabilities: new Set<FoundationCapability>(),
      },
      perspective: { kind: "centre" as const, label: "Synthetic North Centre", centreId: CENTRES[0], centreName: "Synthetic North Centre" },
      executor: centreSuccessDB,
    };
    const due = await OperationalCheckDailySource.collect(baseInput);
    expect(due.items).toEqual([expect.objectContaining({ sourceId: openId, whyShown: expect.objectContaining({ code: "CHECK_DUE_TODAY" }) })]);
    const overdue = await OperationalCheckDailySource.collect({
      ...baseInput,
      authorisation: { ...baseInput.authorisation, decisionAt: new Date("2026-08-13T08:00:00Z") },
    });
    expect(overdue.items[0].whyShown.code).toBe("CHECK_OVERDUE");

    const educatorDaily = await buildDailySuccess(
      { principalId: EDUCATOR, request: {} },
      dailyDependencies,
    );
    expect(educatorDaily.response.status).toBe("unsupported");
    expect(educatorDaily.response.availablePerspectives).toEqual([]);

    const integratedDaily = await buildDailySuccess(
      { principalId: DAILY_DIRECTOR, request: { centreId: CENTRES[0] } },
      dailyDependencies,
    );
    expect(integratedDaily.response.sections.flatMap((section) => section.items))
      .toContainEqual(expect.objectContaining({ sourceId: openId, sourceType: "operational_check" }));
    expect(integratedDaily.diagnostics.queryCount).toBe(17);

    const actionResult = await CorrectiveActionDailySource.collect({
      ...baseInput,
      authorisation: {
        ...baseInput.authorisation,
        principalId: DAILY_DIRECTOR,
        centreIdsByCapability: new Map([
          [capability.correctiveActionRead, centreSet],
          [capability.correctiveActionRemediate, centreSet],
        ]),
      },
    });
    expect(actionResult.items.some((item) => item.sourceType === "corrective_action")).toBe(true);

    for (const size of [1, 5, 20]) {
      let queries = 0;
      const many = new Set([CENTRES[0], ...Array.from({ length: size - 1 }, () => randomUUID())]);
      await OperationalCheckDailySource.collect({
        ...baseInput,
        authorisation: {
          ...baseInput.authorisation,
          centreIdsByCapability: new Map([[capability.operationalCheckRead, many]]),
        },
        perspective: { kind: "portfolio", label: "Area Manager portfolio" },
        executor: {
          queryAll: ((strings: TemplateStringsArray, ...values: unknown[]) => {
            queries += 1;
            return centreSuccessDB.queryAll(strings, ...values as never[]);
          }) as typeof centreSuccessDB.queryAll,
          queryRow: centreSuccessDB.queryRow.bind(centreSuccessDB),
          exec: async () => undefined,
        },
      });
      expect(queries).toBe(1);
    }
  });

  test("completed checks disappear and a genuine checked-empty projection is explicit", async () => {
    const id = await occurrenceId("2026-08-13");
    await completeStandardsCheck(
      { principalId: EDUCATOR, request: { occurrenceId: id, answers: answers(false) } },
      { now: () => new Date("2026-08-13T08:00:01Z") },
    );
    const workspace = await buildStandardsWorkspace(
      { principalId: EDUCATOR },
      { now: () => new Date("2026-08-13T08:00:02Z") },
    );
    expect(workspace.response).toMatchObject({ status: "ready", openChecks: [] });
    const daily = await OperationalCheckDailySource.collect({
      executor: centreSuccessDB,
      authorisation: {
        principalId: EDUCATOR, organisationId: ORGANISATION,
        decisionAt: new Date("2026-08-13T08:00:02Z"), centres: [],
        centreIdsByCapability: new Map([[capability.operationalCheckComplete, new Set([CENTRES[0]])]]),
        invalidCentreIdsByCapability: new Map(), organisationCapabilities: new Set<FoundationCapability>(),
      },
      perspective: { kind: "centre", label: "Synthetic North Centre", centreId: CENTRES[0] },
    });
    expect(daily.items).toEqual([]);
  });

  test("serializes concurrent completion and never duplicates responses or actions", async () => {
    const nextAt = new Date("2026-08-14T02:00:00Z");
    await centreSuccessDB.exec`
      INSERT INTO operational_standard_schedule_revisions (
        id, organisation_id, centre_id, deployment_id, revision, frequency,
        opens_local_time, due_local_time, effective_from
      ) VALUES (
        ${SECOND_SCHEDULE}, ${ORGANISATION}, ${CENTRES[0]},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId}, 2, 'DAILY',
        '10:00', '18:00', '2026-08-14'
      )
    `;
    await expect(centreSuccessDB.exec`
      INSERT INTO operational_check_occurrences (
        id, organisation_id, centre_id, deployment_id, schedule_revision_id,
        template_version_id, business_date, centre_timezone, opens_at, due_at,
        status, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${ORGANISATION}, ${CENTRES[0]},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.deploymentId},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.scheduleRevisionId},
        ${SYNTHETIC_STANDARDS_PILOT_IDS.versionId}, '2026-08-14',
        'Australia/Sydney', '2026-08-13T23:00:00Z', '2026-08-14T07:00:00Z',
        'OPEN', ${nextAt}, ${nextAt}
      )
    `).rejects.toThrow(/latest applicable schedule revision/);
    await generateOperationalCheckOccurrences({
      now: () => nextAt,
      occurrenceId: () => "b5c40000-0000-4000-8000-000000000204",
    });
    const id = await occurrenceId("2026-08-14");
    const pinnedSchedule = await centreSuccessDB.queryRow<{
      schedule_revision_id: string;
      opens_local: string;
      due_local: string;
    }>`
      SELECT
        schedule_revision_id,
        to_char(opens_at AT TIME ZONE centre_timezone, 'HH24:MI') AS opens_local,
        to_char(due_at AT TIME ZONE centre_timezone, 'HH24:MI') AS due_local
      FROM operational_check_occurrences
      WHERE organisation_id = ${ORGANISATION} AND id = ${id}
    `;
    expect(pinnedSchedule).toEqual({
      schedule_revision_id: SECOND_SCHEDULE,
      opens_local: "10:00",
      due_local: "18:00",
    });
    const results = await Promise.all([
      completeStandardsCheck(
        { principalId: EDUCATOR, request: { occurrenceId: id, answers: answers(true) } },
        { now: () => nextAt },
      ),
      completeStandardsCheck(
        { principalId: OTHER_EDUCATOR, request: { occurrenceId: id, answers: answers(true) } },
        { now: () => nextAt },
      ),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["ALREADY_COMPLETED", "COMPLETED"]);
    const counts = await centreSuccessDB.queryRow<{ responses: number; findings: number; actions: number }>`
      SELECT
        (SELECT count(*)::integer FROM operational_check_responses WHERE occurrence_id = ${id}) AS responses,
        (SELECT count(*)::integer FROM findings WHERE check_response_id IN (
          SELECT id FROM operational_check_responses WHERE occurrence_id = ${id}
        )) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.check_response_id IN (SELECT id FROM operational_check_responses WHERE occurrence_id = ${id})) AS actions
    `;
    expect(counts).toEqual({ responses: 3, findings: 1, actions: 1 });
    const firstActionAfterRepeatedLineage = await loadCorrectiveActionDetail(
      ORGANISATION,
      firstOperationalActionId,
      DAILY_DIRECTOR,
    );
    expect(firstActionAfterRepeatedLineage.finding.repeatCount).toBe(1);
  });

  test("keeps the workspace query budget constant for 1 and 20 scoped centres", async () => {
    const baseline = await buildStandardsWorkspace(
      { principalId: EDUCATOR },
      { now: () => new Date("2026-08-14T08:00:03Z") },
    );
    const assignment = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT assignment.id
      FROM role_assignments AS assignment
      JOIN organisation_memberships AS membership
        ON membership.organisation_id = assignment.organisation_id
       AND membership.id = assignment.organisation_membership_id
      JOIN role_definitions AS role
        ON role.organisation_id = assignment.organisation_id
       AND role.id = assignment.role_definition_id
      WHERE assignment.organisation_id = ${ORGANISATION}
        AND membership.principal_id = ${EDUCATOR}
        AND role.role_key = 'educator'
        AND role.version = 2
    `;

    for (const existingCentreId of CENTRES.slice(1)) {
      await centreSuccessDB.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
        ) VALUES (
          ${randomUUID()}, ${ORGANISATION}, ${assignment!.id}, 'centre',
          ${existingCentreId}, '2026-08-01'
        )
      `;
    }
    for (let index = 0; index < 17; index += 1) {
      const centreId = randomUUID();
      await centreSuccessDB.exec`
        INSERT INTO centres (
          id, organisation_id, code, name, jurisdiction_code, timezone, status
        ) VALUES (
          ${centreId}, ${ORGANISATION}, ${`STANDARDS-BUDGET-${index}`},
          ${`Synthetic Standards Budget Centre ${index + 1}`}, 'SYNTHETIC',
          'Australia/Sydney', 'active'
        )
      `;
      await centreSuccessDB.exec`
        INSERT INTO centre_organisational_unit_memberships (
          id, organisation_id, centre_id, organisational_unit_id, effective_from
        ) VALUES (
          ${randomUUID()}, ${ORGANISATION}, ${centreId}, ${REGION_UNIT},
          '2026-08-01'
        )
      `;
      await centreSuccessDB.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
        ) VALUES (
          ${randomUUID()}, ${ORGANISATION}, ${assignment!.id}, 'centre',
          ${centreId}, '2026-08-01'
        )
      `;
    }

    const portfolio = await buildStandardsWorkspace(
      { principalId: EDUCATOR },
      { now: () => new Date("2026-08-14T08:00:04Z") },
    );
    expect(portfolio.diagnostics.queryCount).toBe(baseline.diagnostics.queryCount);
    expect(portfolio.response.status).toBe("ready");
  });
});
