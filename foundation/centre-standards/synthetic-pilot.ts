import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { inSerializableTransaction } from "../transactions";
import {
  assertSyntheticStandardsEnvironment,
  SyntheticStandardsSeedError,
} from "./synthetic-environment";
import { requireStandardsUuid } from "./types";

export {
  assertSyntheticStandardsEnvironment,
  SyntheticStandardsSeedError,
} from "./synthetic-environment";

export const SYNTHETIC_STANDARDS_PILOT_IDS = Object.freeze({
  templateId: "b5c40000-0000-4000-8000-000000000001",
  versionId: "b5c40000-0000-4000-8000-000000000002",
  sectionId: "b5c40000-0000-4000-8000-000000000003",
  questionIds: [
    "b5c40000-0000-4000-8000-000000000004",
    "b5c40000-0000-4000-8000-000000000005",
    "b5c40000-0000-4000-8000-000000000006",
  ],
  deploymentId: "b5c40000-0000-4000-8000-000000000007",
  scheduleRevisionId: "b5c40000-0000-4000-8000-000000000008",
});

export const SYNTHETIC_STANDARDS_NOTICE =
  "SYNTHETIC STAGING TEST — this is not Bright Steps policy, a regulatory requirement or an operational instruction.";
export const SYNTHETIC_STANDARDS_REMEDIATION =
  "SYNTHETIC STAGING TEST — no real Bright Steps operational remediation is required. Complete this action only to test the Centre Success workflow.";

async function assertSourceContext(
  transaction: Transaction,
  organisationId: string,
  centreId: string,
): Promise<void> {
  const context = await transaction.queryRow<{ organisation_id: string; centre_id: string; timezone: string }>`
    SELECT organisation.id AS organisation_id, centre.id AS centre_id, centre.timezone
    FROM organisations AS organisation
    JOIN centres AS centre ON centre.organisation_id = organisation.id
    WHERE organisation.id = ${organisationId}
      AND organisation.status = 'active'
      AND centre.id = ${centreId}
      AND centre.status = 'active'
    FOR UPDATE OF centre
  `;
  if (!context) throw new SyntheticStandardsSeedError("approved staging organisation or centre is unavailable");
  if (context.timezone !== "Australia/Sydney") {
    throw new SyntheticStandardsSeedError("synthetic staging centre must use Australia/Sydney");
  }
}

async function insertPilotContent(
  transaction: Transaction,
  organisationId: string,
  centreId: string,
  effectiveFrom: string,
  activate: boolean,
  actorPrincipalId?: string,
): Promise<void> {
  const ids = SYNTHETIC_STANDARDS_PILOT_IDS;
  const existing = await transaction.queryRow<{
    organisation_id: string; centre_id: string; title: string; synthetic: boolean;
    deployment_status: string; effective_from: string; question_count: number;
    outcome_count: number;
  }>`
    SELECT deployment.organisation_id, deployment.centre_id, version.title,
           version.synthetic, deployment.status AS deployment_status,
           deployment.effective_from::text,
           (SELECT count(*)::integer FROM audit_template_items AS item
            WHERE item.organisation_id = deployment.organisation_id
              AND item.template_version_id = deployment.template_version_id) AS question_count,
           (SELECT count(*)::integer FROM audit_item_outcome_configurations AS configuration
            JOIN audit_template_items AS item
              ON item.organisation_id = deployment.organisation_id
             AND item.template_version_id = deployment.template_version_id
             AND item.id = configuration.audit_item_id
            WHERE configuration.organisation_id = deployment.organisation_id) AS outcome_count
    FROM operational_standard_deployments AS deployment
    JOIN audit_template_versions AS version
      ON version.organisation_id = deployment.organisation_id
     AND version.id = deployment.template_version_id
    WHERE deployment.id = ${ids.deploymentId}
    FOR UPDATE OF deployment
  `;
  if (existing) {
    if (
      existing.organisation_id !== organisationId || existing.centre_id !== centreId ||
      existing.title !== "Centre Standards Pilot — Staging" || !existing.synthetic ||
      existing.effective_from !== effectiveFrom || existing.question_count !== 3 ||
      existing.outcome_count !== 4 ||
      !["DRAFT", "ACTIVE"].includes(existing.deployment_status)
    ) {
      throw new SyntheticStandardsSeedError("existing synthetic pilot conflicts with the approved definition");
    }
    if (activate && existing.deployment_status === "DRAFT") {
      await transaction.exec`
        UPDATE operational_standard_deployments
        SET status = 'ACTIVE', updated_at = now(), lock_version = lock_version + 1
        WHERE organisation_id = ${organisationId} AND id = ${ids.deploymentId}
      `;
    }
    return;
  }
  const partial = await transaction.queryRow<{ present: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM audit_templates WHERE id = ${ids.templateId}
      UNION ALL SELECT 1 FROM audit_template_versions WHERE id = ${ids.versionId}
      UNION ALL SELECT 1 FROM operational_standard_schedule_revisions WHERE id = ${ids.scheduleRevisionId}
    ) AS present
  `;
  if (partial?.present) throw new SyntheticStandardsSeedError("partial synthetic pilot state is not reusable");
  await transaction.exec`
    INSERT INTO audit_templates (
      id, organisation_id, template_key, title, audit_type, template_subtype, status
    ) VALUES (
      ${ids.templateId}, ${organisationId}, 'centre_standards_pilot_staging',
      'Centre Standards Pilot — Staging', 'operational_standard',
      'OPERATIONAL_STANDARD', 'active'
    ) ON CONFLICT (id) DO NOTHING
  `;
  await transaction.exec`
    INSERT INTO audit_template_versions (
      id, organisation_id, audit_template_id, scoring_policy_id,
      template_subtype, version, title, instructions, status,
      effective_from, source_classification, synthetic
    ) VALUES (
      ${ids.versionId}, ${organisationId}, ${ids.templateId}, NULL,
      'OPERATIONAL_STANDARD', 1, 'Centre Standards Pilot — Staging',
      ${SYNTHETIC_STANDARDS_NOTICE}, 'draft', ${effectiveFrom}::date,
      'SYNTHETIC_STAGING_TEST', TRUE
    ) ON CONFLICT (id) DO NOTHING
  `;
  await transaction.exec`
    INSERT INTO audit_template_sections (
      id, organisation_id, template_version_id, stable_key, title, instructions, sort_order
    ) VALUES (
      ${ids.sectionId}, ${organisationId}, ${ids.versionId},
      'synthetic_staging_workflow', 'Synthetic workflow test',
      ${SYNTHETIC_STANDARDS_NOTICE}, 1
    ) ON CONFLICT (id) DO NOTHING
  `;
  const questions = [
    "Test question 1 — choose the normal test outcome.",
    "Test question 2 — choose whether to create the synthetic follow-up.",
    "Test question 3 — confirm the atomic completion test.",
  ];
  for (let index = 0; index < questions.length; index += 1) {
    await transaction.exec`
      INSERT INTO audit_template_items (
        id, organisation_id, template_version_id, section_id, lineage_key,
        wording, instructions, sort_order, scoring_weight, scored, critical,
        evidence_requirement, applicability, source_classification, source_reference
      ) VALUES (
        ${ids.questionIds[index]}, ${organisationId}, ${ids.versionId}, ${ids.sectionId},
        ${`synthetic_staging_question_${index + 1}`}, ${questions[index]},
        ${SYNTHETIC_STANDARDS_NOTICE}, ${index + 1}, 0, FALSE, FALSE,
        'none', 'required', 'SYNTHETIC_STAGING_TEST', 'Centre Standards 4A pilot'
      ) ON CONFLICT (id) DO NOTHING
    `;
    await transaction.exec`
      INSERT INTO audit_item_outcome_configurations (
        organisation_id, audit_item_id, outcome, permitted, creates_finding,
        creates_action, immediate, severity, due_days,
        independent_verification_required, required_remediation
      ) VALUES (
        ${organisationId}, ${ids.questionIds[index]}, 'COMPLIANT', TRUE,
        FALSE, FALSE, FALSE, NULL, NULL, FALSE, NULL
      ) ON CONFLICT (audit_item_id, outcome) DO NOTHING
    `;
    if (index === 1) {
      await transaction.exec`
        INSERT INTO audit_item_outcome_configurations (
          organisation_id, audit_item_id, outcome, permitted, creates_finding,
          creates_action, immediate, severity, due_days,
          independent_verification_required, required_remediation
        ) VALUES (
          ${organisationId}, ${ids.questionIds[index]}, 'NON_COMPLIANT', TRUE,
          TRUE, TRUE, FALSE, 'MEDIUM', 1, FALSE, ${SYNTHETIC_STANDARDS_REMEDIATION}
        ) ON CONFLICT (audit_item_id, outcome) DO NOTHING
      `;
    }
  }
  await transaction.exec`
    UPDATE audit_template_versions
    SET status = 'active'
    WHERE organisation_id = ${organisationId}
      AND id = ${ids.versionId}
      AND status = 'draft'
  `;
  await transaction.exec`
    INSERT INTO operational_standard_deployments (
      id, organisation_id, centre_id, template_version_id, status,
      effective_from, synthetic_notice, created_by_principal_id
    ) VALUES (
      ${ids.deploymentId}, ${organisationId}, ${centreId}, ${ids.versionId},
      ${activate ? "ACTIVE" : "DRAFT"}, ${effectiveFrom}::date,
      ${SYNTHETIC_STANDARDS_NOTICE}, ${actorPrincipalId ?? null}
    ) ON CONFLICT (id) DO NOTHING
  `;
  await transaction.exec`
    INSERT INTO operational_standard_schedule_revisions (
      id, organisation_id, centre_id, deployment_id, revision, frequency,
      opens_local_time, due_local_time, effective_from, created_by_principal_id
    ) VALUES (
      ${ids.scheduleRevisionId}, ${organisationId}, ${centreId}, ${ids.deploymentId},
      1, 'DAILY', '09:00', '17:00', ${effectiveFrom}::date, ${actorPrincipalId ?? null}
    ) ON CONFLICT (id) DO NOTHING
  `;
}

export async function seedSyntheticStandardsPilot(input: {
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
  organisationId: string;
  centreId: string;
  effectiveFrom: string;
  activate: boolean;
  actorPrincipalId?: string;
}): Promise<typeof SYNTHETIC_STANDARDS_PILOT_IDS> {
  assertSyntheticStandardsEnvironment(input.environment);
  requireStandardsUuid(input.organisationId, "organisation ID");
  requireStandardsUuid(input.centreId, "centre ID");
  if (input.actorPrincipalId) requireStandardsUuid(input.actorPrincipalId, "actor principal ID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw new SyntheticStandardsSeedError("effective date is invalid");
  }
  return inSerializableTransaction(async (transaction) => {
    await transaction.exec`SELECT pg_advisory_xact_lock(202608134)`;
    await assertSourceContext(transaction, input.organisationId, input.centreId);
    await insertPilotContent(
      transaction,
      input.organisationId,
      input.centreId,
      input.effectiveFrom,
      input.activate,
      input.actorPrincipalId,
    );
    return SYNTHETIC_STANDARDS_PILOT_IDS;
  });
}
