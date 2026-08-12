import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { bootstrapLocalFirstAdministrator, LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS } from "../authentication/local-first-administrator-bootstrap";
import { centreSuccessDB } from "../db";
import { QUARTERLY_REVIEW_DEVELOPMENT_IDS as seedIds, seedLocalQuarterlyReviewDevelopmentData } from "../quarterly-reviews/development-seed";
import { CorrectiveActionDailySource } from "./corrective-action-source";
import { PeopleAccessDailySource } from "./people-access-source";
import { QuarterlyReviewDailySource } from "./quarterly-review-source";
import { buildDailySuccess, DailySuccessError } from "./service";
import { DailySourceUnavailableError } from "./types";

const localEnvironment = { cloud: "local" as const, name: "local", type: "development" as const };
const AT = new Date("2034-08-11T10:00:00.000Z");
let criticalActionId: string;
let criticalVerificationActionId: string;
let activeAuditId: string;
let finalisedAuditId: string;

async function insertDailySourceFixture(): Promise<void> {
  const itemRows = await centreSuccessDB.queryAll<{ id: string }>`
    SELECT id FROM audit_template_items
    WHERE organisation_id = ${seedIds.organisationId}
      AND template_version_id = ${seedIds.templateVersionId}
    ORDER BY sort_order, id
    LIMIT 3
  `;
  const [criticalItem, completedItem, reviewItem] = itemRows;
  if (!criticalItem || !completedItem || !reviewItem) throw new Error("development items unavailable");

  activeAuditId = randomUUID();
  finalisedAuditId = randomUUID();
  const actionRunId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_runs (
      id, organisation_id, centre_id, template_version_id,
      auditor_principal_id, review_period_start, status, started_at,
      overall_score, critical_finding_count, finalised_at, finalised_by_principal_id
    ) VALUES
      (${actionRunId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
       ${seedIds.templateVersionId}, ${seedIds.areaManagerPrincipalId},
       '2034-01-01', 'IN_PROGRESS', ${AT}, 100, 1, NULL, NULL),
      (${activeAuditId}, ${seedIds.organisationId}, ${seedIds.centreIds[1]},
       ${seedIds.templateVersionId}, ${seedIds.areaManagerPrincipalId},
       '2034-04-01', 'IN_PROGRESS', ${AT}, NULL, 0, NULL, NULL),
      (${finalisedAuditId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
       ${seedIds.templateVersionId}, ${seedIds.areaManagerPrincipalId},
       '2034-07-01', 'FINALISED', ${AT}, 95, 0, ${AT}, ${seedIds.areaManagerPrincipalId})
  `;

  const verificationResponseId = randomUUID();
  const verificationFindingId = randomUUID();
  criticalVerificationActionId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_responses (
      id, organisation_id, audit_run_id, audit_item_id, outcome,
      comment, selected_owner_principal_id, responded_by_principal_id
    ) VALUES (
      ${verificationResponseId}, ${seedIds.organisationId}, ${actionRunId}, ${reviewItem.id},
      'NON_COMPLIANT', 'Synthetic verification fixture.',
      ${seedIds.centreDirectorPrincipalIds[0]}, ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO findings (
      id, organisation_id, centre_id, audit_run_id, audit_response_id,
      item_lineage_key, severity, description, source_classification,
      status, created_by_principal_id
    ) VALUES (
      ${verificationFindingId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${actionRunId}, ${verificationResponseId}, 'daily_success_verification_fixture',
      'CRITICAL', 'Synthetic critical verification finding.', 'BSA_DEVELOPMENT_TEST',
      'OPEN', ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO corrective_actions (
      id, organisation_id, centre_id, finding_id, owner_principal_id,
      title, required_remediation, evidence_requirement, severity, due_at,
      independent_verification_required, status,
      remediation_submitted_by_principal_id, remediation_submitted_at
    ) VALUES (
      ${criticalVerificationActionId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${verificationFindingId}, ${seedIds.centreDirectorPrincipalIds[0]},
      'Synthetic critical verification action', 'Verify the synthetic remediation.',
      'required', 'CRITICAL', ${new Date(AT.getTime() + 60 * 60 * 1000)}, TRUE,
      'VERIFICATION_REQUIRED', ${seedIds.centreDirectorPrincipalIds[0]}, ${AT}
    )
  `;

  const responseId = randomUUID();
  const findingId = randomUUID();
  criticalActionId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_responses (
      id, organisation_id, audit_run_id, audit_item_id, outcome,
      comment, selected_owner_principal_id, responded_by_principal_id
    ) VALUES (
      ${responseId}, ${seedIds.organisationId}, ${actionRunId}, ${criticalItem.id},
      'IMMEDIATE_ACTION_REQUIRED', 'Synthetic Daily Success critical fixture.',
      ${seedIds.centreDirectorPrincipalIds[0]}, ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO findings (
      id, organisation_id, centre_id, audit_run_id, audit_response_id,
      item_lineage_key, severity, description, source_classification,
      status, created_by_principal_id
    ) VALUES (
      ${findingId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${actionRunId}, ${responseId}, 'daily_success_critical_fixture',
      'CRITICAL', 'Synthetic critical finding for Daily Success projection.',
      'BSA_DEVELOPMENT_TEST', 'OPEN', ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO corrective_actions (
      id, organisation_id, centre_id, finding_id, owner_principal_id,
      title, required_remediation, evidence_requirement, severity, due_at,
      independent_verification_required, status
    ) VALUES (
      ${criticalActionId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${findingId}, ${seedIds.centreDirectorPrincipalIds[0]},
      'Synthetic critical Daily Success action',
      'Complete the synthetic remediation.', 'required', 'CRITICAL',
      ${new Date(AT.getTime() + 2 * 60 * 60 * 1000)}, TRUE, 'OPEN'
    )
  `;

  const completedResponseId = randomUUID();
  const completedFindingId = randomUUID();
  const completedActionId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_responses (
      id, organisation_id, audit_run_id, audit_item_id, outcome,
      comment, selected_owner_principal_id, responded_by_principal_id
    ) VALUES (
      ${completedResponseId}, ${seedIds.organisationId}, ${actionRunId},
      ${completedItem.id}, 'NON_COMPLIANT', 'Synthetic completed fixture.',
      ${seedIds.centreDirectorPrincipalIds[0]}, ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO findings (
      id, organisation_id, centre_id, audit_run_id, audit_response_id,
      item_lineage_key, severity, description, source_classification,
      status, created_by_principal_id
    ) VALUES (
      ${completedFindingId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${actionRunId}, ${completedResponseId}, 'daily_success_completed_fixture',
      'HIGH', 'Synthetic completed finding.', 'BSA_DEVELOPMENT_TEST',
      'RESOLVED', ${seedIds.areaManagerPrincipalId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO corrective_actions (
      id, organisation_id, centre_id, finding_id, owner_principal_id,
      title, required_remediation, evidence_requirement, severity, due_at,
      independent_verification_required, status, closed_at
    ) VALUES (
      ${completedActionId}, ${seedIds.organisationId}, ${seedIds.centreIds[0]},
      ${completedFindingId}, ${seedIds.centreDirectorPrincipalIds[0]},
      'Synthetic completed-today action', 'Completed synthetic remediation.',
      'none', 'HIGH', ${new Date(AT.getTime() - 60_000)}, FALSE, 'CLOSED', ${AT}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO corrective_action_events (
      id, organisation_id, corrective_action_id, actor_principal_id,
      event_type, from_status, to_status, occurred_at, event_sequence
    ) VALUES (
      ${randomUUID()}, ${seedIds.organisationId}, ${completedActionId},
      ${seedIds.areaManagerPrincipalId}, 'remediation.verified',
      'VERIFICATION_REQUIRED', 'CLOSED', ${AT}, 1
    )
  `;

  const pendingPrincipalId = randomUUID();
  const invitationId = randomUUID();
  const proposalId = randomUUID();
  const systemAdministratorRole = await centreSuccessDB.queryRow<{ id: string; version: number }>`
    SELECT id, version FROM role_definitions
    WHERE organisation_id = ${seedIds.organisationId}
      AND role_key = 'system_administrator' AND status = 'active'
  `;
  if (!systemAdministratorRole) throw new Error("System Administrator role unavailable");
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${pendingPrincipalId}, 'Synthetic Daily Access Candidate', 'pending')
  `;
  await centreSuccessDB.exec`
    INSERT INTO access_invitations (
      id, organisation_id, pending_principal_id, intended_email, status,
      privilege_class, package_digest, reason, created_by_principal_id, expires_at
    ) VALUES (
      ${invitationId}, ${seedIds.organisationId}, ${pendingPrincipalId},
      'daily-candidate@example.invalid', 'DRAFT',
      'PRIVILEGED', ${Buffer.alloc(32, 7)}, 'Synthetic Daily Success invitation.',
      ${LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS.operatorPrincipalId},
      ${new Date(AT.getTime() + 24 * 60 * 60 * 1000)}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO invitation_role_proposals (
      id, organisation_id, invitation_id, role_definition_id, role_key,
      role_version, privilege_class, ordinal, effective_from
    ) VALUES (
      ${proposalId}, ${seedIds.organisationId}, ${invitationId},
      ${systemAdministratorRole.id}, 'system_administrator',
      ${systemAdministratorRole.version}, 'PRIVILEGED', 1, ${AT}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO invitation_scope_proposals (
      id, organisation_id, invitation_role_proposal_id, scope_type, effective_from
    ) VALUES (
      ${randomUUID()}, ${seedIds.organisationId}, ${proposalId}, 'organisation', ${AT}
    )
  `;
  await centreSuccessDB.exec`
    UPDATE access_invitations
    SET status = 'AWAITING_PRIVILEGED_APPROVAL', updated_at = ${AT}, lock_version = lock_version + 1
    WHERE organisation_id = ${seedIds.organisationId} AND id = ${invitationId}
  `;
}

interface PortfolioFixture {
  organisationId: string;
  principalId: string;
  assignmentId: string;
  scopeId: string;
  centreIds: string[];
}

async function createPortfolioFixture(
  centreCount: number,
  timezone = "Australia/Sydney",
  roleKey: "area_manager" | "centre_director" = "area_manager",
): Promise<PortfolioFixture> {
  const organisationId = randomUUID();
  const principalId = randomUUID();
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  const scopeId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${organisationId}, ${`Daily query fixture ${centreCount}`}, 'active', ${timezone})
  `;
  const centreIds: string[] = [];
  for (let index = 0; index < centreCount; index += 1) {
    const centreId = randomUUID();
    centreIds.push(centreId);
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES (
        ${centreId}, ${organisationId}, ${`DS-${centreCount}-${index}`},
        ${`Daily Success Centre ${index + 1}`}, 'SYNTHETIC', ${timezone}, 'active'
      )
    `;
  }
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${`Daily Area Manager ${centreCount}`}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (id, organisation_id, principal_id, status, effective_from)
    VALUES (${membershipId}, ${organisationId}, ${principalId}, 'active', '2030-01-01')
  `;
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${organisationId} AND role_key = ${roleKey} AND status = 'active'
  `;
  if (!role) throw new Error(`${roleKey} role unavailable`);
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${organisationId}, ${membershipId}, ${role.id},
      'active', '2030-01-01', 'system', 'Synthetic Daily Success query fixture.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, effective_from
    ) VALUES (${scopeId}, ${organisationId}, ${assignmentId}, 'organisation', '2030-01-01')
  `;
  return { organisationId, principalId, assignmentId, scopeId, centreIds };
}

async function makeCentreHierarchyAmbiguous(fixture: PortfolioFixture, centreId: string): Promise<void> {
  const firstUnit = randomUUID();
  const secondUnit = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisational_units (
      id, organisation_id, kind, code, name, status, effective_from
    ) VALUES
      (${firstUnit}, ${fixture.organisationId}, 'region', ${`DS-A-${firstUnit.slice(0, 6)}`}, 'Synthetic Region A', 'active', '2030-01-01'),
      (${secondUnit}, ${fixture.organisationId}, 'region', ${`DS-B-${secondUnit.slice(0, 6)}`}, 'Synthetic Region B', 'active', '2030-01-01')
  `;
  await centreSuccessDB.exec`
    INSERT INTO centre_organisational_unit_memberships (
      id, organisation_id, centre_id, organisational_unit_id, effective_from
    ) VALUES
      (${randomUUID()}, ${fixture.organisationId}, ${centreId}, ${firstUnit}, '2030-01-01'),
      (${randomUUID()}, ${fixture.organisationId}, ${centreId}, ${secondUnit}, '2030-01-01')
  `;
}

async function addRepresentativePortfolioSourceRows(fixture: PortfolioFixture): Promise<void> {
  const templateId = randomUUID();
  const policyId = randomUUID();
  const versionId = randomUUID();
  const sectionId = randomUUID();
  const itemId = randomUUID();
  const submitterId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${submitterId}, 'Synthetic remediation submitter', 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_templates (
      id, organisation_id, template_key, title, audit_type, status
    ) VALUES (
      ${templateId}, ${fixture.organisationId}, 'daily_success_representative',
      'Synthetic Daily Success representative review', 'quarterly_review', 'active'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_scoring_policies (
      id, organisation_id, policy_key, version, name, status, source_classification
    ) VALUES (
      ${policyId}, ${fixture.organisationId}, 'daily_success_representative', 1,
      'Synthetic Daily Success policy', 'draft', 'BSA_DEVELOPMENT_TEST'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_performance_bands (
      id, organisation_id, scoring_policy_id, band_code, label,
      minimum_score, maximum_score, priority, below_internal_threshold
    ) VALUES (
      ${randomUUID()}, ${fixture.organisationId}, ${policyId}, 'REPRESENTATIVE',
      'Representative', 0, 100, 1, FALSE
    )
  `;
  await centreSuccessDB.exec`
    UPDATE audit_scoring_policies SET status = 'active'
    WHERE organisation_id = ${fixture.organisationId} AND id = ${policyId}
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_template_versions (
      id, organisation_id, audit_template_id, scoring_policy_id, version,
      title, instructions, status, effective_from, source_classification, synthetic
    ) VALUES (
      ${versionId}, ${fixture.organisationId}, ${templateId}, ${policyId}, 1,
      'Synthetic Daily Success template', 'Synthetic performance fixture only.',
      'draft', '2030-01-01', 'BSA_DEVELOPMENT_TEST', TRUE
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_template_sections (
      id, organisation_id, template_version_id, stable_key, title, sort_order
    ) VALUES (
      ${sectionId}, ${fixture.organisationId}, ${versionId},
      'representative', 'Representative section', 1
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_template_items (
      id, organisation_id, template_version_id, section_id, lineage_key,
      wording, sort_order, scoring_weight, scored, critical,
      evidence_requirement, applicability, source_classification
    ) VALUES (
      ${itemId}, ${fixture.organisationId}, ${versionId}, ${sectionId},
      'representative_item', 'Representative synthetic item', 1, 1, TRUE,
      FALSE, 'required', 'required', 'BSA_DEVELOPMENT_TEST'
    )
  `;
  await centreSuccessDB.exec`
    UPDATE audit_template_versions SET status = 'active'
    WHERE organisation_id = ${fixture.organisationId} AND id = ${versionId}
  `;
  for (const [index, centreId] of fixture.centreIds.entries()) {
    const auditId = randomUUID();
    const responseId = randomUUID();
    const findingId = randomUUID();
    const actionId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_runs (
        id, organisation_id, centre_id, template_version_id,
        auditor_principal_id, review_period_start, status, started_at
      ) VALUES (
        ${auditId}, ${fixture.organisationId}, ${centreId}, ${versionId},
        ${fixture.principalId}, '2034-01-01', 'IN_PROGRESS', ${AT}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_responses (
        id, organisation_id, audit_run_id, audit_item_id, outcome,
        comment, selected_owner_principal_id, responded_by_principal_id
      ) VALUES (
        ${responseId}, ${fixture.organisationId}, ${auditId}, ${itemId},
        'NON_COMPLIANT', ${`Synthetic response ${index + 1}`},
        ${fixture.principalId}, ${fixture.principalId}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO findings (
        id, organisation_id, centre_id, audit_run_id, audit_response_id,
        item_lineage_key, severity, description, source_classification,
        status, created_by_principal_id
      ) VALUES (
        ${findingId}, ${fixture.organisationId}, ${centreId}, ${auditId},
        ${responseId}, ${`representative_${index}`}, 'HIGH',
        ${`Synthetic finding ${index + 1}`}, 'BSA_DEVELOPMENT_TEST',
        'OPEN', ${fixture.principalId}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO corrective_actions (
        id, organisation_id, centre_id, finding_id, owner_principal_id,
        title, required_remediation, evidence_requirement, severity, due_at,
        independent_verification_required, status,
        remediation_submitted_by_principal_id, remediation_submitted_at
      ) VALUES (
        ${actionId}, ${fixture.organisationId}, ${centreId}, ${findingId},
        ${fixture.principalId}, ${`Synthetic verification ${index + 1}`},
        'Verify synthetic remediation.', 'required', 'HIGH',
        ${new Date(AT.getTime() + (index + 1) * 60_000)}, TRUE,
        'VERIFICATION_REQUIRED', ${submitterId}, ${AT}
      )
    `;
  }
}

describe.sequential("Milestone 3A Daily Success live projection", () => {
  beforeAll(async () => {
    await bootstrapLocalFirstAdministrator({ environment: localEnvironment });
    await seedLocalQuarterlyReviewDevelopmentData({ environment: localEnvironment });
    await insertDailySourceFixture();
  });

  test("projects Centre Director work, critical risk, completed today, and finalised acknowledgement", async () => {
    const result = await buildDailySuccess({
      principalId: seedIds.centreDirectorPrincipalIds[0],
      request: { perspective: "centre", centreId: seedIds.centreIds[0] },
    }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.status).toBe("ready");
    expect(result.response.sections[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: criticalActionId,
        riskLevel: "CRITICAL",
        responsibility: "YOU_NEED_TO_ACT",
      }),
    ]));
    const finalisedReview = result.response.sections
      .flatMap((section) => section.items)
      .find((item) => item.sourceId === finalisedAuditId);
    expect(finalisedReview).toBeDefined();
    expect(finalisedReview?.due).toBeUndefined();
    expect(result.response.positiveContext).toMatchObject({
      completedTodayCount: 1,
      recentTitles: ["Synthetic completed-today action"],
    });
    expect(JSON.stringify(result.response)).not.toContain("original_filename");
  });

  test("uses worst authorised risk for Area Manager portfolio even with a high audit score", async () => {
    const result = await buildDailySuccess({
      principalId: seedIds.areaManagerPrincipalId,
      request: { perspective: "portfolio" },
    }, { now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource });
    expect(result.response.attentionCentres[0]).toMatchObject({
      centreId: seedIds.centreIds[0],
      attentionBand: "URGENT",
    });
    expect(result.response.attentionCentres[0].criticalCount).toBeGreaterThanOrEqual(1);
    expect(result.response.sections.flatMap((section) => section.items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: activeAuditId, whyShown: { code: "AUDIT_REQUIRES_ACTION", label: expect.any(String) } }),
      expect.objectContaining({
        sourceId: criticalVerificationActionId,
        riskLevel: "CRITICAL",
        verification: { required: true, eligible: true },
      }),
    ]));
    expect(result.response.verificationItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: criticalVerificationActionId,
        riskLevel: "CRITICAL",
        cta: { route: `/area-manager/verification/${criticalVerificationActionId}`, label: "Verify action" },
      }),
    ]));
  });

  test("keeps Compliance minimal and System Administrator administration-only", async () => {
    const compliance = await buildDailySuccess({
      principalId: seedIds.complianceManagerPrincipalId,
      request: { perspective: "compliance" },
    }, { now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource });
    expect(compliance.response.aggregateCounts.active).toBeGreaterThan(0);
    expect(compliance.response.sections.flatMap((section) => section.items).every((item) => item.sourceType === "corrective_action")).toBe(true);
    expect(compliance.response.verificationItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: criticalVerificationActionId }),
    ]));

    const administrator = await buildDailySuccess({
      principalId: LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS.targetPrincipalId,
      request: { perspective: "administration" },
    }, { now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource });
    expect(administrator.response.availablePerspectives.map((item) => item.kind)).toEqual(["administration"]);
    expect(administrator.response.sections.flatMap((section) => section.items)).toEqual([
      expect.objectContaining({ sourceType: "people_access", whyShown: expect.objectContaining({ code: "PRIVILEGED_APPROVAL_REQUIRED" }) }),
    ]);
    expect(JSON.stringify(administrator.response)).not.toContain("Synthetic critical Daily Success action");
  });

  test("fails requested cross-scope perspectives and reflects portfolio removal on the next request", async () => {
    const fixture = await createPortfolioFixture(1);
    const first = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
    });
    expect(first.response.activePerspective?.kind).toBe("portfolio");
    await expect(buildDailySuccess({
      principalId: fixture.principalId,
      request: { perspective: "centre", centreId: seedIds.centreIds[0] },
    }, { now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource })).rejects.toMatchObject({ code: "access_denied" });

    await centreSuccessDB.exec`
      UPDATE assignment_scopes SET effective_to = ${AT}
      WHERE organisation_id = ${fixture.organisationId} AND id = ${fixture.scopeId}
    `;
    const afterRemoval = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => new Date(AT.getTime() + 1), correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
    });
    expect(afterRemoval.response.status).toBe("unsupported");
    expect(afterRemoval.response.aggregateCounts.active).toBe(0);
  });

  test.each(["suspended", "revoked"] as const)(
    "denies a %s principal before loading Daily Success content",
    async (status) => {
      const fixture = await createPortfolioFixture(1);
      await centreSuccessDB.exec`
        UPDATE principals SET status = ${status}
        WHERE id = ${fixture.principalId}
      `;
      await expect(buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
        now: () => AT,
        correctiveActionSource: CorrectiveActionDailySource,
        quarterlyReviewSource: QuarterlyReviewDailySource,
        peopleAccessSource: PeopleAccessDailySource,
      })).rejects.toMatchObject({ code: "access_denied" });
    },
  );

  test("reports a failed adapter as partial and never claims on track", async () => {
    const fixture = await createPortfolioFixture(2);
    await addRepresentativePortfolioSourceRows(fixture);
    const result = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT,
      correctiveActionSource: { collect: async () => { throw new DailySourceUnavailableError("corrective_actions"); } },
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response).toMatchObject({
      status: "partial",
      warning: "Some priorities could not be checked.",
      sourceHealth: expect.arrayContaining([{ source: "corrective_actions", status: "unavailable" }]),
    });
    expect(result.response.positiveContext?.onTrackCentreCount).toBeUndefined();
    expect(result.response.sections.flatMap((section) => section.items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "quarterly_review", whyShown: expect.objectContaining({ code: "AUDIT_REQUIRES_ACTION" }) }),
    ]));
    expect(result.response.aggregateCounts).toEqual({ coverage: "partial" });
    expect(result.response.attentionCentres.length).toBeGreaterThan(0);
    expect(result.response.attentionCentres.every((centre) =>
      centre.coverage === "partial" &&
      centre.criticalCount === undefined &&
      centre.overdueCount === undefined &&
      centre.dueTodayCount === undefined,
    )).toBe(true);
  });

  test("preserves corrective-action data but publishes no false zeros when quarterly reviews are unavailable", async () => {
    const result = await buildDailySuccess({
      principalId: seedIds.areaManagerPrincipalId,
      request: { perspective: "portfolio" },
    }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: { collect: async () => { throw new DailySourceUnavailableError("quarterly_reviews"); } },
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.status).toBe("partial");
    expect(result.response.sections.flatMap((section) => section.items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: criticalVerificationActionId }),
    ]));
    expect(result.response.attentionCentres.every((centre) => centre.coverage === "partial")).toBe(true);
    expect(result.response.positiveContext?.onTrackCentreCount).toBeUndefined();
  });

  test("fails the request for an unexpected adapter invariant instead of masking it as partial", async () => {
    const fixture = await createPortfolioFixture(1);
    await expect(buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT,
      correctiveActionSource: { collect: async () => { throw new TypeError("synthetic invariant defect"); } },
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    })).rejects.toMatchObject({ code: "context_unavailable" });
  });

  test("fails safely for an invalid authoritative timezone", async () => {
    const fixture = await createPortfolioFixture(1, "Australia/Not_A_Zone");
    await expect(buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
    })).rejects.toEqual(new DailySuccessError("context_unavailable"));
  });

  test("excludes a persisted withdrawn corrective action while retaining its source history", async () => {
    const fixture = await createPortfolioFixture(1);
    await addRepresentativePortfolioSourceRows(fixture);
    const action = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM corrective_actions WHERE organisation_id = ${fixture.organisationId}
    `;
    if (!action) throw new Error("representative action unavailable");
    await centreSuccessDB.exec`
      UPDATE corrective_actions
      SET status = 'WITHDRAWN', withdrawn_at = ${AT},
          withdrawn_by_principal_id = ${fixture.principalId},
          withdrawal_reason = 'Synthetic acceptance-remediation withdrawal.'
      WHERE organisation_id = ${fixture.organisationId} AND id = ${action.id}
    `;
    const result = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.sections.flatMap((section) => section.items).some((item) => item.sourceId === action.id)).toBe(false);
    expect(await centreSuccessDB.queryRow<{ status: string }>`
      SELECT status FROM corrective_actions
      WHERE organisation_id = ${fixture.organisationId} AND id = ${action.id}
    `).toEqual({ status: "WITHDRAWN" });
  });

  test("isolates an invalid centre while preserving valid portfolio results as partial", async () => {
    const fixture = await createPortfolioFixture(2);
    await makeCentreHierarchyAmbiguous(fixture, fixture.centreIds[1]);
    const result = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.status).toBe("partial");
    expect(result.response.authorisationHealth.status).toBe("partial");
    expect(result.response.warning).toBe("Some priorities could not be checked.");
    expect(result.response.positiveContext?.onTrackCentreCount).toBeUndefined();
    expect(result.response.attentionCentres.map((centre) => centre.centreId)).toEqual([
      fixture.centreIds[0],
    ]);
    expect(JSON.stringify(result.response)).not.toContain(fixture.centreIds[1]);
  });

  test("fails a Centre Director's own invalid-centre projection safely", async () => {
    const fixture = await createPortfolioFixture(1, "Australia/Sydney", "centre_director");
    await makeCentreHierarchyAmbiguous(fixture, fixture.centreIds[0]);
    await expect(buildDailySuccess({
      principalId: fixture.principalId,
      request: { perspective: "centre", centreId: fixture.centreIds[0] },
    }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    })).rejects.toMatchObject({ code: "centre_context_unavailable" });
  });

  test("records the representative source query plan before considering an index", async () => {
    const plan = await centreSuccessDB.queryAll<{ "QUERY PLAN": string }>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT action.id, action.centre_id, action.status, action.due_at
      FROM corrective_actions AS action
      WHERE action.organisation_id = ${seedIds.organisationId}
        AND action.centre_id = ANY(${seedIds.centreIds}::uuid[])
        AND action.status NOT IN ('CLOSED', 'WITHDRAWN')
      ORDER BY action.due_at, action.id
    `;
    const text = plan.map((row) => row["QUERY PLAN"]).join(" | ");
    console.info(`[daily-success-explain] ${text}`);
    expect(text).toContain("corrective_actions");
    expect(text).toContain("Execution Time");
  });

  test("reflects source completion on the next request without Daily Success mutation state", async () => {
    const completedAt = new Date(AT.getTime() + 5 * 60 * 1000);
    await centreSuccessDB.exec`
      UPDATE corrective_actions
      SET status = 'CLOSED', closed_at = ${completedAt}, updated_at = ${completedAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${seedIds.organisationId} AND id = ${criticalActionId}
    `;
    await centreSuccessDB.exec`
      INSERT INTO corrective_action_events (
        id, organisation_id, corrective_action_id, actor_principal_id,
        event_type, from_status, to_status, occurred_at, event_sequence
      ) VALUES (
        ${randomUUID()}, ${seedIds.organisationId}, ${criticalActionId},
        ${seedIds.areaManagerPrincipalId}, 'remediation.verified',
        'VERIFICATION_REQUIRED', 'CLOSED', ${completedAt}, 1
      )
    `;
    const result = await buildDailySuccess({
      principalId: seedIds.centreDirectorPrincipalIds[0],
      request: { perspective: "centre", centreId: seedIds.centreIds[0] },
    }, {
      now: () => new Date(completedAt.getTime() + 60_000),
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.sections.flatMap((section) => section.items).some((item) => item.sourceId === criticalActionId)).toBe(false);
    expect(result.response.positiveContext?.recentTitles).toContain("Synthetic critical Daily Success action");
  });

  test("excludes cross-centre records and derives aggregates only from the authorised subset", async () => {
    const fixture = await createPortfolioFixture(2, "Australia/Sydney", "centre_director");
    await centreSuccessDB.exec`
      UPDATE assignment_scopes
      SET scope_type = 'centre', centre_id = ${fixture.centreIds[0]}, organisational_unit_id = NULL
      WHERE organisation_id = ${fixture.organisationId} AND id = ${fixture.scopeId}
    `;
    await addRepresentativePortfolioSourceRows(fixture);
    const organisationTotal = await centreSuccessDB.queryRow<{ total: number | string }>`
      SELECT count(*) AS total FROM corrective_actions
      WHERE organisation_id = ${fixture.organisationId}
    `;
    const result = await buildDailySuccess({
      principalId: fixture.principalId,
      request: { perspective: "centre", centreId: fixture.centreIds[0] },
    }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    const items = result.response.sections.flatMap((section) => section.items);
    expect(Number(organisationTotal?.total)).toBe(2);
    expect(result.response.aggregateCounts.active).toBe(1);
    expect(items.every((item) => item.centreId === fixture.centreIds[0])).toBe(true);
    expect(JSON.stringify(result.response)).not.toContain(fixture.centreIds[1]);
  });

  test("projects only an Area Manager's strict subset of the organisation portfolio", async () => {
    const fixture = await createPortfolioFixture(3);
    await centreSuccessDB.exec`
      UPDATE assignment_scopes
      SET scope_type = 'centre', centre_id = ${fixture.centreIds[1]}, organisational_unit_id = NULL
      WHERE organisation_id = ${fixture.organisationId} AND id = ${fixture.scopeId}
    `;
    await addRepresentativePortfolioSourceRows(fixture);
    const result = await buildDailySuccess({
      principalId: fixture.principalId,
      request: { perspective: "portfolio" },
    }, {
      now: () => AT,
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(result.response.attentionCentres.map((centre) => centre.centreId)).toEqual([
      fixture.centreIds[1],
    ]);
    expect(result.response.aggregateCounts.active).toBe(2);
    expect(JSON.stringify(result.response)).not.toContain(fixture.centreIds[0]);
    expect(JSON.stringify(result.response)).not.toContain(fixture.centreIds[2]);
  });

  test("removes completed-today context immediately after centre scope loss", async () => {
    const fixture = await createPortfolioFixture(1, "Australia/Sydney", "centre_director");
    await centreSuccessDB.exec`
      UPDATE assignment_scopes
      SET scope_type = 'centre', centre_id = ${fixture.centreIds[0]}, organisational_unit_id = NULL
      WHERE organisation_id = ${fixture.organisationId} AND id = ${fixture.scopeId}
    `;
    await addRepresentativePortfolioSourceRows(fixture);
    const action = await centreSuccessDB.queryRow<{ id: string; actor: string }>`
      SELECT id, remediation_submitted_by_principal_id AS actor
      FROM corrective_actions WHERE organisation_id = ${fixture.organisationId}
      LIMIT 1
    `;
    if (!action) throw new Error("representative action unavailable");
    await centreSuccessDB.exec`
      UPDATE corrective_actions SET status = 'CLOSED', closed_at = ${AT}
      WHERE organisation_id = ${fixture.organisationId} AND id = ${action.id}
    `;
    await centreSuccessDB.exec`
      INSERT INTO corrective_action_events (
        id, organisation_id, corrective_action_id, actor_principal_id,
        event_type, from_status, to_status, occurred_at, event_sequence
      ) VALUES (
        ${randomUUID()}, ${fixture.organisationId}, ${action.id}, ${action.actor},
        'remediation.verified', 'VERIFICATION_REQUIRED', 'CLOSED', ${AT}, 1
      )
    `;
    const before = await buildDailySuccess({
      principalId: fixture.principalId,
      request: { perspective: "centre", centreId: fixture.centreIds[0] },
    }, {
      now: () => new Date(AT.getTime() + 60_000),
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(before.response.positiveContext?.completedTodayCount).toBe(1);
    await centreSuccessDB.exec`
      UPDATE assignment_scopes SET effective_to = ${new Date(AT.getTime() + 60_000)}
      WHERE organisation_id = ${fixture.organisationId} AND id = ${fixture.scopeId}
    `;
    const after = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => new Date(AT.getTime() + 60_001),
      correctiveActionSource: CorrectiveActionDailySource,
      quarterlyReviewSource: QuarterlyReviewDailySource,
      peopleAccessSource: PeopleAccessDailySource,
    });
    expect(after.response.status).toBe("unsupported");
    expect(after.response.positiveContext).toBeUndefined();
  });

  test("keeps query count bounded for 1, 5, and 20 centres", async () => {
    const counts: number[] = [];
    for (const centreCount of [1, 5, 20]) {
      const fixture = await createPortfolioFixture(centreCount);
      await addRepresentativePortfolioSourceRows(fixture);
      const result = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
        now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
      });
      counts.push(result.diagnostics.queryCount);
    }
    console.info(`[daily-success-query-count] centres=1,5,20 queries=${counts.join(",")}`);
    expect(counts.every((count) => count > 0 && count <= 16)).toBe(true);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    expect(counts[2]).toBeLessThan(20);
  });

  test("records controlled warm 20-centre p50/p95 evidence with representative source rows", async () => {
    const fixture = await createPortfolioFixture(20);
    await addRepresentativePortfolioSourceRows(fixture);
    const coldStarted = performance.now();
    const cold = await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
      now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
    });
    const coldMs = performance.now() - coldStarted;
    expect(cold.response.aggregateCounts.active).toBeGreaterThanOrEqual(20);
    expect(cold.response.verificationItems).toHaveLength(5);
    const samples: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const started = performance.now();
      await buildDailySuccess({ principalId: fixture.principalId, request: {} }, {
        now: () => AT, correctiveActionSource: CorrectiveActionDailySource, quarterlyReviewSource: QuarterlyReviewDailySource, peopleAccessSource: PeopleAccessDailySource,
      });
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.ceil(samples.length * 0.50) - 1];
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    console.info(`[daily-success-benchmark] centres=20 source_rows=40 cold_ms=${coldMs.toFixed(1)} warm_samples=${samples.length} p50_ms=${p50.toFixed(1)} p95_ms=${p95.toFixed(1)}`);
    expect(p50).toBeGreaterThanOrEqual(0);
    expect(p95).toBeGreaterThanOrEqual(0);
  });
});
