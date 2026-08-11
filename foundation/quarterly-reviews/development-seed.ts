import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { centreSuccessDB } from "../db";
import { assertLocalDevelopmentEnvironment } from "../authentication/local-identity-linker";
import type { AuditOutcome, FindingSeverity } from "./types";

const ORGANISATION_ID = "b5c00000-0000-4000-8000-000000000001";
const EFFECTIVE_FROM = new Date("2026-08-11T00:00:00.000Z");

export const QUARTERLY_REVIEW_DEVELOPMENT_IDS = Object.freeze({
  organisationId: ORGANISATION_ID,
  stateUnitId: "b5c20000-0000-4000-8000-000000000001",
  regionUnitId: "b5c20000-0000-4000-8000-000000000002",
  centreIds: [
    "b5c20000-0000-4000-8000-000000000011",
    "b5c20000-0000-4000-8000-000000000012",
    "b5c20000-0000-4000-8000-000000000013",
  ],
  areaManagerPrincipalId: "b5c20000-0000-4000-8000-000000000021",
  centreDirectorPrincipalIds: [
    "b5c20000-0000-4000-8000-000000000022",
    "b5c20000-0000-4000-8000-000000000023",
    "b5c20000-0000-4000-8000-000000000024",
  ],
  complianceManagerPrincipalId: "b5c20000-0000-4000-8000-000000000025",
  templateId: "b5c20000-0000-4000-8000-000000000061",
  scoringPolicyId: "b5c20000-0000-4000-8000-000000000062",
  templateVersionId: "b5c20000-0000-4000-8000-000000000063",
});

const centres = [
  { id: QUARTERLY_REVIEW_DEVELOPMENT_IDS.centreIds[0], code: "DEV-NORTH", name: "Synthetic North Centre" },
  { id: QUARTERLY_REVIEW_DEVELOPMENT_IDS.centreIds[1], code: "DEV-CENTRAL", name: "Synthetic Central Centre" },
  { id: QUARTERLY_REVIEW_DEVELOPMENT_IDS.centreIds[2], code: "DEV-SOUTH", name: "Synthetic South Centre" },
];

const people = [
  { id: QUARTERLY_REVIEW_DEVELOPMENT_IDS.areaManagerPrincipalId, name: "Synthetic Area Manager", role: "area_manager", scope: "region" },
  ...QUARTERLY_REVIEW_DEVELOPMENT_IDS.centreDirectorPrincipalIds.map((id, index) => ({
    id,
    name: `Synthetic Centre Director ${index + 1}`,
    role: "centre_director",
    scope: `centre:${index}`,
  })),
  { id: QUARTERLY_REVIEW_DEVELOPMENT_IDS.complianceManagerPrincipalId, name: "Synthetic Compliance Manager", role: "compliance_manager", scope: "organisation" },
];

const sections = [
  { id: "b5c20000-0000-4000-8000-000000000071", key: "centre_documentation", title: "Centre Documentation" },
  { id: "b5c20000-0000-4000-8000-000000000072", key: "health_safety", title: "Health & Safety" },
  { id: "b5c20000-0000-4000-8000-000000000073", key: "team_records", title: "Team Records" },
  { id: "b5c20000-0000-4000-8000-000000000074", key: "physical_environment", title: "Physical Environment" },
];

const items = [
  ["required_centre_document_available", "Required centre document available", 0, false, "optional"],
  ["document_review_recorded", "Document review recorded", 0, false, "none"],
  ["previous_action_followed_up", "Previous action followed up", 0, false, "optional"],
  ["emergency_information_available", "Emergency information available", 1, true, "required"],
  ["safety_review_recorded", "Internal safety review recorded", 1, true, "required"],
  ["first_aid_resources_observed", "First aid resources observed", 1, false, "optional"],
  ["required_training_evidence_available", "Required training evidence available", 2, false, "required"],
  ["team_record_review_completed", "Team record review completed", 2, false, "optional"],
  ["follow_up_responsibility_clear", "Follow-up responsibility is clear", 2, false, "none"],
  ["environment_inspection_completed", "Environment inspection completed", 3, false, "required"],
  ["maintenance_follow_up_recorded", "Maintenance follow-up recorded", 3, false, "optional"],
  ["positive_environment_practice", "Positive environment practice observed", 3, false, "optional"],
] as const;

async function insertAssignmentAudit(
  transaction: Transaction,
  assignmentId: string,
  purpose: string,
): Promise<void> {
  await recordAuditEventWithExecutor(transaction, {
    organisationId: ORGANISATION_ID,
    action: "role_assignment.development_seeded",
    resourceType: "role_assignment",
    resourceId: assignmentId,
    scopeType: "organisation",
    scopeId: ORGANISATION_ID,
    context: { source: "milestone_2b_development", purpose },
    occurredAt: EFFECTIVE_FROM,
  });
}

async function seedPeopleAndAssignments(transaction: Transaction): Promise<void> {
  for (let index = 0; index < people.length; index += 1) {
    const person = people[index];
    const membershipId = `b5c20000-0000-4000-8000-${String(31 + index).padStart(12, "0")}`;
    const assignmentId = `b5c20000-0000-4000-8000-${String(41 + index).padStart(12, "0")}`;
    const scopeId = `b5c20000-0000-4000-8000-${String(51 + index).padStart(12, "0")}`;
    await transaction.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${person.id}, ${person.name}, 'active')
      ON CONFLICT (id) DO NOTHING
    `;
    await transaction.exec`
      INSERT INTO organisation_memberships (
        id, organisation_id, principal_id, status, effective_from
      ) VALUES (
        ${membershipId}, ${ORGANISATION_ID}, ${person.id}, 'active', ${EFFECTIVE_FROM}
      ) ON CONFLICT (id) DO NOTHING
    `;
    const role = await transaction.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${ORGANISATION_ID}
        AND role_key = ${person.role} AND status = 'active'
    `;
    if (!role) throw new Error(`canonical role unavailable: ${person.role}`);
    const inserted = await transaction.queryRow<{ id: string }>`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, grant_source_type, reason
      ) VALUES (
        ${assignmentId}, ${ORGANISATION_ID}, ${membershipId}, ${role.id},
        'active', ${EFFECTIVE_FROM}, 'system',
        'Approved synthetic Milestone 2B local development data.'
      ) ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (person.scope === "organisation") {
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          effective_from
        ) VALUES (
          ${scopeId}, ${ORGANISATION_ID}, ${assignmentId}, 'organisation',
          ${EFFECTIVE_FROM}
        ) ON CONFLICT (id) DO NOTHING
      `;
    } else if (person.scope === "region") {
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          organisational_unit_id, effective_from
        ) VALUES (
          ${scopeId}, ${ORGANISATION_ID}, ${assignmentId}, 'organisational_unit',
          ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.regionUnitId}, ${EFFECTIVE_FROM}
        ) ON CONFLICT (id) DO NOTHING
      `;
    } else {
      const centreIndex = Number(person.scope.split(":")[1]);
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          centre_id, effective_from
        ) VALUES (
          ${scopeId}, ${ORGANISATION_ID}, ${assignmentId}, 'centre',
          ${centres[centreIndex].id}, ${EFFECTIVE_FROM}
        ) ON CONFLICT (id) DO NOTHING
      `;
    }
    if (inserted) await insertAssignmentAudit(transaction, assignmentId, person.role);
  }
}

async function seedTemplate(transaction: Transaction): Promise<void> {
  const ids = QUARTERLY_REVIEW_DEVELOPMENT_IDS;
  const existing = await transaction.queryRow<{ id: string }>`
    SELECT id FROM audit_template_versions
    WHERE organisation_id = ${ORGANISATION_ID} AND id = ${ids.templateVersionId}
  `;
  if (existing) return;

  await transaction.exec`
    INSERT INTO audit_scoring_policies (
      id, organisation_id, policy_key, version, name, status,
      rounding_scale, source_classification
    ) VALUES (
      ${ids.scoringPolicyId}, ${ORGANISATION_ID}, 'development_deduction', 1,
      'BSA Development Weighted Scoring', 'draft', 1, 'BSA_DEVELOPMENT_TEST'
    )
  `;
  const rules: Array<[AuditOutcome, number | null, "included" | "excluded", boolean]> = [
    ["COMPLIANT", 1, "included", false],
    ["POSITIVE_PRACTICE", 1, "included", false],
    ["PARTIALLY_COMPLIANT", 0.5, "included", true],
    ["NON_COMPLIANT", 0, "included", true],
    ["IMMEDIATE_ACTION_REQUIRED", 0, "included", true],
    ["NOT_APPLICABLE", null, "excluded", true],
    ["NOT_OBSERVED", null, "excluded", true],
  ];
  for (const [outcome, factor, treatment, reason] of rules) {
    await transaction.exec`
      INSERT INTO audit_scoring_outcome_rules (
        organisation_id, scoring_policy_id, outcome, score_factor,
        denominator_treatment, requires_reason
      ) VALUES (
        ${ORGANISATION_ID}, ${ids.scoringPolicyId}, ${outcome}, ${factor},
        ${treatment}, ${reason}
      )
    `;
  }
  const bands = [
    ["b5c20000-0000-4000-8000-000000000081", "STRONG", "Strong", 90, 100, 1, false],
    ["b5c20000-0000-4000-8000-000000000082", "MINIMUM_STANDARD_MET", "Minimum Standard Met / Improvement Required", 80, 90, 2, false],
    ["b5c20000-0000-4000-8000-000000000083", "AT_RISK", "At Risk", 70, 80, 3, true],
    ["b5c20000-0000-4000-8000-000000000084", "PRIORITY_INTERVENTION", "Priority Intervention", 0, 70, 4, true],
  ] as const;
  for (const [id, code, label, minimum, maximum, priority, belowThreshold] of bands) {
    await transaction.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES (
        ${id}, ${ORGANISATION_ID}, ${ids.scoringPolicyId}, ${code}, ${label},
        ${minimum}, ${maximum}, ${priority}, ${belowThreshold}
      )
    `;
  }
  await transaction.exec`
    INSERT INTO audit_templates (
      id, organisation_id, template_key, title, audit_type, status
    ) VALUES (
      ${ids.templateId}, ${ORGANISATION_ID}, 'quarterly_centre_review_development',
      'BSA Quarterly Centre Review — Development Template',
      'quarterly_review', 'active'
    )
  `;
  await transaction.exec`
    INSERT INTO audit_template_versions (
      id, organisation_id, audit_template_id, scoring_policy_id, version,
      title, instructions, status, effective_from,
      source_classification, synthetic
    ) VALUES (
      ${ids.templateVersionId}, ${ORGANISATION_ID}, ${ids.templateId},
      ${ids.scoringPolicyId}, 1,
      'BSA Quarterly Centre Review — Development Template',
      'Synthetic non-regulatory content used only to prove the Centre Success workflow.',
      'draft', ${EFFECTIVE_FROM}, 'BSA_DEVELOPMENT_TEST', TRUE
    )
  `;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    await transaction.exec`
      INSERT INTO audit_template_sections (
        id, organisation_id, template_version_id, stable_key, title,
        instructions, sort_order
      ) VALUES (
        ${section.id}, ${ORGANISATION_ID}, ${ids.templateVersionId},
        ${section.key}, ${section.title},
        'Development test content only; do not interpret as a regulatory requirement.',
        ${index + 1}
      )
    `;
  }
  for (let index = 0; index < items.length; index += 1) {
    const [lineage, wording, sectionIndex, critical, evidenceRequirement] = items[index];
    const itemId = `b5c20000-0000-4000-8000-${String(101 + index).padStart(12, "0")}`;
    await transaction.exec`
      INSERT INTO audit_template_items (
        id, organisation_id, template_version_id, section_id, lineage_key,
        wording, instructions, sort_order, scoring_weight, scored, critical,
        evidence_requirement, applicability, source_classification, source_reference
      ) VALUES (
        ${itemId}, ${ORGANISATION_ID}, ${ids.templateVersionId},
        ${sections[sectionIndex].id}, ${lineage}, ${wording},
        'Synthetic BSA development item; it is not an assertion of law or official assessment criterion.',
        ${items.slice(0, index).filter((candidate) => candidate[2] === sectionIndex).length + 1},
        1, TRUE, ${critical}, ${evidenceRequirement}, 'required',
        'BSA_DEVELOPMENT_TEST', 'Synthetic workflow test content'
      )
    `;
    const configurations: Array<{
      outcome: AuditOutcome; finding: boolean; action: boolean; immediate: boolean;
      severity?: FindingSeverity; dueDays?: number; independent?: boolean;
    }> = [
      { outcome: "COMPLIANT", finding: false, action: false, immediate: false },
      { outcome: "POSITIVE_PRACTICE", finding: false, action: false, immediate: false },
      { outcome: "NOT_APPLICABLE", finding: false, action: false, immediate: false },
      {
        outcome: "NOT_OBSERVED", finding: critical, action: critical,
        immediate: false, ...(critical ? { severity: "CRITICAL" as const, dueDays: 1, independent: true } : {}),
      },
      { outcome: "PARTIALLY_COMPLIANT", finding: true, action: true, immediate: false, severity: "MEDIUM", dueDays: 14 },
      { outcome: "NON_COMPLIANT", finding: true, action: true, immediate: false, severity: critical ? "CRITICAL" : "HIGH", dueDays: critical ? 1 : 7, independent: critical },
      { outcome: "IMMEDIATE_ACTION_REQUIRED", finding: true, action: true, immediate: true, severity: "CRITICAL", dueDays: 1, independent: true },
    ];
    for (const configuration of configurations) {
      await transaction.exec`
        INSERT INTO audit_item_outcome_configurations (
          organisation_id, audit_item_id, outcome, permitted,
          creates_finding, creates_action, immediate, severity, due_days,
          independent_verification_required, required_remediation
        ) VALUES (
          ${ORGANISATION_ID}, ${itemId}, ${configuration.outcome}, TRUE,
          ${configuration.finding}, ${configuration.action}, ${configuration.immediate},
          ${configuration.severity ?? null}, ${configuration.dueDays ?? null},
          ${configuration.independent ?? false},
          ${configuration.action ? `Address the synthetic development finding: ${wording}` : null}
        )
      `;
    }
  }
  await transaction.exec`
    UPDATE audit_scoring_policies SET status = 'active'
    WHERE organisation_id = ${ORGANISATION_ID} AND id = ${ids.scoringPolicyId}
  `;
  await transaction.exec`
    UPDATE audit_template_versions SET status = 'active'
    WHERE organisation_id = ${ORGANISATION_ID} AND id = ${ids.templateVersionId}
  `;
}

export async function seedLocalQuarterlyReviewDevelopmentData(input: {
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
}): Promise<typeof QUARTERLY_REVIEW_DEVELOPMENT_IDS> {
  assertLocalDevelopmentEnvironment(input.environment);
  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    await transaction.exec`SELECT pg_advisory_xact_lock(202608112)`;
    const organisation = await transaction.queryRow<{ id: string }>`
      SELECT id FROM organisations
      WHERE id = ${ORGANISATION_ID} AND status = 'active'
      FOR UPDATE
    `;
    if (!organisation) {
      throw new Error("run the reviewed local first-administrator bootstrap first");
    }
    await transaction.exec`
      INSERT INTO organisational_units (
        id, organisation_id, parent_id, kind, code, name, status, effective_from
      ) VALUES
        (${QUARTERLY_REVIEW_DEVELOPMENT_IDS.stateUnitId}, ${ORGANISATION_ID}, NULL,
         'state', 'DEV-STATE', 'Synthetic Development State', 'active', ${EFFECTIVE_FROM}),
        (${QUARTERLY_REVIEW_DEVELOPMENT_IDS.regionUnitId}, ${ORGANISATION_ID},
         ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.stateUnitId}, 'region', 'DEV-REGION',
         'Synthetic Development Region', 'active', ${EFFECTIVE_FROM})
      ON CONFLICT (id) DO NOTHING
    `;
    for (let index = 0; index < centres.length; index += 1) {
      const centre = centres[index];
      await transaction.exec`
        INSERT INTO centres (
          id, organisation_id, code, name, jurisdiction_code, timezone, status
        ) VALUES (
          ${centre.id}, ${ORGANISATION_ID}, ${centre.code}, ${centre.name},
          'SYNTHETIC', 'Australia/Sydney', 'active'
        ) ON CONFLICT (id) DO NOTHING
      `;
      await transaction.exec`
        INSERT INTO centre_organisational_unit_memberships (
          id, organisation_id, centre_id, organisational_unit_id, effective_from
        ) VALUES (
          ${`b5c20000-0000-4000-8000-${String(201 + index).padStart(12, "0")}`},
          ${ORGANISATION_ID}, ${centre.id},
          ${QUARTERLY_REVIEW_DEVELOPMENT_IDS.regionUnitId}, ${EFFECTIVE_FROM}
        ) ON CONFLICT (id) DO NOTHING
      `;
    }
    await seedPeopleAndAssignments(transaction);
    await seedTemplate(transaction);
    await transaction.commit();
    return QUARTERLY_REVIEW_DEVELOPMENT_IDS;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
