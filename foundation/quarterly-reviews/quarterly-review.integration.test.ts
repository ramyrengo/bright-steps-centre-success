import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { loadPrincipalAuthorisationContext } from "../authorization/context-loader";
import { authorise } from "../authorization/policy";
import { filterCentreResourcesByCapability } from "./authorization";
import { bootstrapLocalFirstAdministrator, LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS } from "../authentication/local-first-administrator-bootstrap";
import { centreSuccessDB } from "../db";
import {
  QUARTERLY_REVIEW_DEVELOPMENT_IDS as ids,
  seedLocalQuarterlyReviewDevelopmentData,
} from "./development-seed";
import {
  completeEvidenceUpload,
  getEvidenceAccess,
  quarterlyReviewEvidence,
  requestEvidenceUpload,
} from "./evidence";
import {
  listCorrectiveActionsForPrincipal,
  loadCorrectiveActionDetail,
  loadQuarterlyAuditView,
} from "./queries";
import {
  acknowledgeAudit,
  finaliseQuarterlyAudit,
  loadComplianceOversight,
  markAuditReady,
  returnCorrectiveAction,
  saveAuditResponse,
  startCorrectiveAction,
  startQuarterlyAudit,
  submitCorrectiveAction,
  verifyAndCloseCorrectiveAction,
} from "./service";
import { QuarterlyReviewError, type AuditOutcome } from "./types";

const localEnvironment = {
  cloud: "local" as const,
  name: "local",
  type: "development" as const,
};
const AT = new Date("2026-08-11T10:00:00.000Z");

async function respondToEveryItem(
  auditId: string,
  outcomes: Record<number, AuditOutcome>,
  at: Date = AT,
): Promise<void> {
  const view = await loadQuarterlyAuditView({
    organisationId: ids.organisationId,
    principalId: ids.areaManagerPrincipalId,
    auditId,
  });
  const items = view.sections.flatMap((section) => section.items);
  for (let index = 0; index < items.length; index += 1) {
    const outcome = outcomes[index] ?? "COMPLIANT";
    await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId,
        itemId: items[index].id,
        outcome,
        ...(outcome === "COMPLIANT"
          ? {}
          : { comment: `Synthetic test reason for ${outcome}` }),
      },
      at: new Date(at.getTime() + index * 1000),
    });
  }
}

async function respondToUnansweredItems(
  auditId: string,
  at: Date,
): Promise<void> {
  const view = await loadQuarterlyAuditView({
    organisationId: ids.organisationId,
    principalId: ids.areaManagerPrincipalId,
    auditId,
  });
  let offset = 0;
  for (const item of view.sections.flatMap((section) => section.items)) {
    if (item.response) continue;
    await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: { auditId, itemId: item.id, outcome: "COMPLIANT" },
      at: new Date(at.getTime() + offset * 1000),
    });
    offset += 1;
  }
}

describe.sequential("Milestone 2B quarterly review vertical slice", () => {
  beforeAll(async () => {
    await bootstrapLocalFirstAdministrator({ environment: localEnvironment });
    await seedLocalQuarterlyReviewDevelopmentData({ environment: localEnvironment });
  });

  test("provisions only reviewed capabilities and filters collections by current centre scope", async () => {
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.areaManagerPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toMatchObject({ allowed: true });

    const unassignedCentreId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO centres (
        id, organisation_id, code, name, jurisdiction_code, timezone, status
      ) VALUES (
        ${unassignedCentreId}, ${ids.organisationId}, ${`UNASSIGNED-${unassignedCentreId.slice(0, 6)}`},
        'Synthetic Unassigned Centre', 'SYNTHETIC', 'Australia/Sydney', 'active'
      )
    `;
    const otherOrganisationId = randomUUID();
    const otherOrganisationCentreId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (
        ${otherOrganisationId}, 'Synthetic Collection Filter Organisation',
        'active', 'Australia/Sydney'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO centres (
        id, organisation_id, code, name, jurisdiction_code, timezone, status
      ) VALUES (
        ${otherOrganisationCentreId}, ${otherOrganisationId},
        ${`CROSS-${otherOrganisationCentreId.slice(0, 6)}`},
        'Synthetic Cross-organisation Centre', 'SYNTHETIC',
        'Australia/Sydney', 'active'
      )
    `;
    const centreDirectorMembership = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM organisation_memberships
      WHERE organisation_id = ${ids.organisationId}
        AND principal_id = ${ids.centreDirectorPrincipalIds[0]}
    `;
    const centreDirectorRole = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${ids.organisationId}
        AND role_key = 'centre_director' AND status = 'active'
    `;
    const expiredPortfolioAssignmentId = randomUUID();
    const expiredPortfolioScopeId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, grant_source_type, reason
      ) VALUES (
        ${expiredPortfolioAssignmentId}, ${ids.organisationId},
        ${centreDirectorMembership!.id}, ${centreDirectorRole!.id}, 'active',
        '2026-07-01T00:00:00.000Z', ${AT}, 'system',
        'Synthetic expired portfolio collection-filter test.'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, centre_id,
        effective_from, effective_to
      ) VALUES (
        ${expiredPortfolioScopeId}, ${ids.organisationId},
        ${expiredPortfolioAssignmentId}, 'centre', ${ids.centreIds[1]},
        '2026-07-01T00:00:00.000Z', ${AT}
      )
    `;
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.areaManagerPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: unassignedCentreId,
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "scope_mismatch" });

    await expect(filterCentreResourcesByCapability(
      {
        principalId: ids.centreDirectorPrincipalIds[0],
        organisationId: ids.organisationId,
      },
      [
        { id: "own-active", centreId: ids.centreIds[0] },
        { id: "old-unassigned", centreId: ids.centreIds[1] },
        { id: "unrelated", centreId: ids.centreIds[2] },
        { id: "cross-organisation", centreId: otherOrganisationCentreId },
      ],
      capability.correctiveActionRemediate,
      AT,
    )).resolves.toEqual([{ id: "own-active", centreId: ids.centreIds[0] }]);

    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.centreDirectorPrincipalIds[0],
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.correctiveActionRemediate,
        at: AT,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.centreDirectorPrincipalIds[0],
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[1],
        capability: capability.correctiveActionRemediate,
        at: AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "scope_mismatch" });
    await expect(
      authoriseCentreFromDatabase({
        principalId: LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS.targetPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditRead,
        at: AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "capability_missing" });

    const complianceContext = await loadPrincipalAuthorisationContext({
      principalId: ids.complianceManagerPrincipalId,
      activeOrganisationId: ids.organisationId,
      at: AT,
    });
    expect(
      authorise({
        context: complianceContext,
        capability: capability.complianceOversightRead,
        resource: { kind: "organisation", organisationId: ids.organisationId },
        at: AT,
      }),
    ).toMatchObject({ allowed: true });

    const executivePrincipalId = randomUUID();
    const executiveMembershipId = randomUUID();
    const executiveAssignmentId = randomUUID();
    const executiveScopeId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${executivePrincipalId}, 'Synthetic Executive Boundary Test', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisation_memberships (
        id, organisation_id, principal_id, status, effective_from
      ) VALUES (
        ${executiveMembershipId}, ${ids.organisationId}, ${executivePrincipalId},
        'active', '2026-08-01T00:00:00.000Z'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, grant_source_type, reason
      ) SELECT
        ${executiveAssignmentId}, ${ids.organisationId}, ${executiveMembershipId}, role.id,
        'active', '2026-08-01T00:00:00.000Z', 'system',
        'Synthetic Milestone 2B executive boundary test.'
      FROM role_definitions AS role
      WHERE role.organisation_id = ${ids.organisationId}
        AND role.role_key = 'executive' AND role.status = 'active'
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, effective_from
      ) VALUES (
        ${executiveScopeId}, ${ids.organisationId}, ${executiveAssignmentId},
        'organisation', '2026-08-01T00:00:00.000Z'
      )
    `;
    await expect(
      authoriseCentreFromDatabase({
        principalId: executivePrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "capability_missing" });
  });

  test("requires explicit owner selection when multiple valid remediation owners exist", async () => {
    const membership = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM organisation_memberships
      WHERE organisation_id = ${ids.organisationId}
        AND principal_id = ${ids.centreDirectorPrincipalIds[2]}
    `;
    const role = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${ids.organisationId}
        AND role_key = 'centre_director' AND status = 'active'
    `;
    const assignmentId = randomUUID();
    const scopeId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, grant_source_type, reason
      ) VALUES (
        ${assignmentId}, ${ids.organisationId}, ${membership!.id}, ${role!.id},
        'active', '2026-08-01T00:00:00.000Z', 'system',
        'Synthetic ambiguity test assignment.'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, centre_id,
        effective_from
      ) VALUES (
        ${scopeId}, ${ids.organisationId}, ${assignmentId}, 'centre',
        ${ids.centreIds[0]}, '2026-08-01T00:00:00.000Z'
      )
    `;
    try {
      const started = await startQuarterlyAudit({
        organisationId: ids.organisationId,
        centreId: ids.centreIds[1],
        actorPrincipalId: ids.areaManagerPrincipalId,
        at: AT,
      });
      const view = await loadQuarterlyAuditView({
        organisationId: ids.organisationId,
        principalId: ids.areaManagerPrincipalId,
        auditId: started.auditId,
      });
      // The extra assignment targets centre 1, so centre 2 still has one valid owner.
      expect(view.ownerCandidates).toHaveLength(1);

      await centreSuccessDB.exec`
        UPDATE assignment_scopes
        SET centre_id = ${ids.centreIds[1]}
        WHERE id = ${scopeId}
      `;
      const response = await saveAuditResponse({
        organisationId: ids.organisationId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        request: {
          auditId: started.auditId,
          itemId: view.sections[1].items[0].id,
          outcome: "IMMEDIATE_ACTION_REQUIRED",
          comment: "Synthetic immediate ambiguity test.",
        },
        at: AT,
      });
      expect(response).toMatchObject({
        immediateFindingCreated: true,
        immediateActionCreated: true,
        ownerResolutionRequired: true,
      });
      const actionBeforeSelection = await centreSuccessDB.queryRow<{ owner_principal_id: string | null }>`
        SELECT action.owner_principal_id
        FROM corrective_actions AS action
        JOIN findings AS finding
          ON finding.organisation_id = action.organisation_id
         AND finding.id = action.finding_id
        WHERE finding.audit_run_id = ${started.auditId}
      `;
      expect(actionBeforeSelection?.owner_principal_id).toBeNull();

      const selected = await saveAuditResponse({
        organisationId: ids.organisationId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        request: {
          auditId: started.auditId,
          itemId: view.sections[1].items[0].id,
          outcome: "IMMEDIATE_ACTION_REQUIRED",
          comment: "Synthetic immediate ambiguity test.",
          selectedOwnerPrincipalId: ids.centreDirectorPrincipalIds[2],
          responseLockVersion: response.lockVersion,
        },
        at: new Date(AT.getTime() + 1000),
      });
      expect(selected.ownerResolutionRequired).toBe(false);
      const actionAfterSelection = await centreSuccessDB.queryRow<{ owner_principal_id: string | null }>`
        SELECT action.owner_principal_id
        FROM corrective_actions AS action
        JOIN findings AS finding
          ON finding.organisation_id = action.organisation_id
         AND finding.id = action.finding_id
        WHERE finding.audit_run_id = ${started.auditId}
      `;
      expect(actionAfterSelection?.owner_principal_id).toBe(ids.centreDirectorPrincipalIds[2]);
    } finally {
      await centreSuccessDB.exec`DELETE FROM assignment_scopes WHERE id = ${scopeId}`;
      await centreSuccessDB.exec`DELETE FROM role_assignments WHERE id = ${assignmentId}`;
    }
  });

  test("creates immediate risk now, reconciles final findings, remediates, verifies and acknowledges", async () => {
    const started = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at: AT,
    });
    expect(started.created).toBe(true);
    const pinnedRun = await centreSuccessDB.queryRow<{ template_version_id: string }>`
      SELECT template_version_id FROM audit_runs
      WHERE organisation_id = ${ids.organisationId} AND id = ${started.auditId}
    `;
    expect(pinnedRun?.template_version_id).toBe(ids.templateVersionId);
    await respondToEveryItem(started.auditId, {
      0: "PARTIALLY_COMPLIANT",
      3: "IMMEDIATE_ACTION_REQUIRED",
      11: "POSITIVE_PRACTICE",
    });
    const responseAuditEvents = await centreSuccessDB.queryRow<{
      count: number;
      leaked_comment: boolean;
    }>`
      SELECT
        count(*)::integer AS count,
        bool_or(context::text ILIKE '%Synthetic test reason%') AS leaked_comment
      FROM system_audit_events
      WHERE organisation_id = ${ids.organisationId}
        AND resource_type = 'quarterly_audit'
        AND resource_id = ${started.auditId}
        AND action IN ('quarterly_audit.response_created', 'quarterly_audit.response_updated')
    `;
    expect(responseAuditEvents).toEqual({ count: 12, leaked_comment: false });

    let view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    expect(view.progress).toEqual({ answered: 12, total: 12 });
    const immediate = view.sections.flatMap((section) => section.items)[3];
    expect(immediate.finding?.severity).toBe("CRITICAL");
    const countsBeforeFinal = await centreSuccessDB.queryRow<{ findings: number; actions: number }>`
      SELECT
        (SELECT count(*)::integer FROM findings WHERE organisation_id = ${ids.organisationId} AND audit_run_id = ${started.auditId}) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action
         JOIN findings AS finding ON finding.organisation_id = action.organisation_id AND finding.id = action.finding_id
         WHERE finding.organisation_id = ${ids.organisationId} AND finding.audit_run_id = ${started.auditId}) AS actions
    `;
    expect(countsBeforeFinal).toEqual({ findings: 1, actions: 1 });

    await markAuditReady({
      organisationId: ids.organisationId, auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date("2026-08-11T11:00:00.000Z"),
    });
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    const final = await finaliseQuarterlyAudit({
      organisationId: ids.organisationId, auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(final).toMatchObject({ status: "FINALISED", score: 87.5, riskStatus: "CRITICAL" });
    const finalCounts = await centreSuccessDB.queryRow<{ findings: number; actions: number; positives: number }>`
      SELECT
        (SELECT count(*)::integer FROM findings WHERE organisation_id = ${ids.organisationId} AND audit_run_id = ${started.auditId}) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action
         JOIN findings AS finding ON finding.organisation_id = action.organisation_id AND finding.id = action.finding_id
         WHERE finding.organisation_id = ${ids.organisationId} AND finding.audit_run_id = ${started.auditId}) AS actions,
        (SELECT count(*)::integer FROM positive_observations WHERE organisation_id = ${ids.organisationId} AND audit_run_id = ${started.auditId}) AS positives
    `;
    expect(finalCounts).toEqual({ findings: 2, actions: 2, positives: 1 });

    const finalisedItem = view.sections.flatMap((section) => section.items)[0];
    await expect(saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: finalisedItem.id,
        outcome: "COMPLIANT",
        responseLockVersion: finalisedItem.response!.lockVersion,
      },
      at: new Date("2026-08-11T12:01:00.000Z"),
    })).rejects.toMatchObject({ code: "invalid_state" });

    await expect(
      centreSuccessDB.exec`
        UPDATE audit_responses SET comment = 'forbidden historical rewrite'
        WHERE organisation_id = ${ids.organisationId} AND audit_run_id = ${started.auditId}
      `,
    ).rejects.toThrow(/finalised audit history is immutable/);
    await expect(
      centreSuccessDB.exec`
        UPDATE audit_template_items SET wording = 'forbidden template rewrite'
        WHERE organisation_id = ${ids.organisationId}
          AND template_version_id = ${ids.templateVersionId}
      `,
    ).rejects.toThrow(/released audit template content is immutable/);

    const owned = await listCorrectiveActionsForPrincipal({
      organisationId: ids.organisationId,
      principalId: ids.centreDirectorPrincipalIds[0],
    });
    const quarterlyActionRows = await centreSuccessDB.queryAll<{ id: string }>`
      SELECT action.id
      FROM corrective_actions AS action
      JOIN findings AS finding
        ON finding.organisation_id = action.organisation_id
       AND finding.id = action.finding_id
      WHERE finding.organisation_id = ${ids.organisationId}
        AND finding.audit_run_id = ${started.auditId}
    `;
    const quarterlyActionIds = new Set(quarterlyActionRows.map((row) => row.id));
    const quarterlyOwned = owned.filter((action) => quarterlyActionIds.has(action.id));
    expect(quarterlyOwned).toHaveLength(2);
    const critical = quarterlyOwned.find((action) => action.severity === "CRITICAL")!;
    const criticalDetail = await loadCorrectiveActionDetail(
      ids.organisationId,
      critical.id,
      ids.centreDirectorPrincipalIds[0],
    );
    expect(criticalDetail.finding.origin).toMatchObject({
      source: "QUARTERLY_AUDIT",
      label: "Quarterly review",
      quarterLabel: "Q3 2026",
      auditId: started.auditId,
    });
    const startedAction = await startCorrectiveAction({
      organisationId: ids.organisationId, actionId: critical.id,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      expectedLockVersion: criticalDetail.lockVersion,
      at: new Date("2026-08-12T00:00:00.000Z"),
    });
    const upload = await requestEvidenceUpload({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      request: {
        targetType: "CORRECTIVE_ACTION",
        targetId: critical.id,
        filename: "synthetic-proof.pdf",
        mediaType: "application/pdf",
      },
    });
    const evidence = await centreSuccessDB.queryRow<{ object_key: string }>`
      SELECT object_key FROM evidence_items
      WHERE organisation_id = ${ids.organisationId} AND id = ${upload.evidenceId}
    `;
    await quarterlyReviewEvidence.upload(
      evidence!.object_key,
      Buffer.from("%PDF-1.4 synthetic development evidence"),
      { contentType: "application/pdf" },
    );
    const completedEvidence = await completeEvidenceUpload({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      evidenceId: upload.evidenceId,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      environment: localEnvironment,
    });
    expect(completedEvidence).toMatchObject({
      scanStatus: "not_scanned",
      availabilityStatus: "AVAILABLE_LOCAL_UNSCANNED",
    });
    await expect(completeEvidenceUpload({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      evidenceId: upload.evidenceId,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      environment: localEnvironment,
    })).resolves.toMatchObject(completedEvidence);
    const completionAuditCount = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM system_audit_events
      WHERE organisation_id = ${ids.organisationId}
        AND resource_type = 'evidence_item'
        AND resource_id = ${upload.evidenceId}
        AND action = 'evidence.upload_completed'
    `;
    expect(completionAuditCount?.count).toBe(1);
    const localAccess = await getEvidenceAccess({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      evidenceId: upload.evidenceId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      environment: localEnvironment,
    });
    expect(localAccess.warning).toMatch(/not been security scanned/i);
    await expect(getEvidenceAccess({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[1],
      evidenceId: upload.evidenceId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      environment: localEnvironment,
    })).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      getEvidenceAccess({
        organisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        evidenceId: upload.evidenceId,
        actorPrincipalId: ids.complianceManagerPrincipalId,
        environment: { cloud: "encore", name: "staging", type: "development" },
      }),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    const submitted = await submitCorrectiveAction({
      organisationId: ids.organisationId, actionId: critical.id,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      expectedLockVersion: startedAction.lockVersion,
      remediationNote: "Synthetic remediation completed and evidence attached.",
      at: new Date("2026-08-12T01:00:00.000Z"),
    });
    const overlappingAssignmentId = randomUUID();
    const overlappingScopeId = randomUUID();
    const centreDirectorMembership = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM organisation_memberships
      WHERE organisation_id = ${ids.organisationId}
        AND principal_id = ${ids.centreDirectorPrincipalIds[0]}
        AND status = 'active'
    `;
    const areaManagerRole = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${ids.organisationId}
        AND role_key = 'area_manager' AND status = 'active'
    `;
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, grant_source_type, reason
      ) VALUES (
        ${overlappingAssignmentId}, ${ids.organisationId}, ${centreDirectorMembership!.id},
        ${areaManagerRole!.id}, 'active', '2026-08-01T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z', 'system',
        'Synthetic overlapping-role independent-verification test.'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, centre_id,
        effective_from, effective_to
      ) VALUES (
        ${overlappingScopeId}, ${ids.organisationId}, ${overlappingAssignmentId},
        'centre', ${ids.centreIds[0]}, '2026-08-01T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z'
      )
    `;
    await expect(authoriseCentreFromDatabase({
      principalId: ids.centreDirectorPrincipalIds[0],
      activeOrganisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      capability: capability.correctiveActionVerify,
      at: new Date("2026-08-12T01:30:00.000Z"),
    })).resolves.toMatchObject({ allowed: true });
    // Defence in depth: even a malformed persisted flag must not permit the
    // submitter to self-verify a critical action while also holding the Area
    // Manager verification capability.
    await centreSuccessDB.exec`
      UPDATE corrective_actions
      SET independent_verification_required = FALSE
      WHERE organisation_id = ${ids.organisationId} AND id = ${critical.id}
    `;
    await expect(
      verifyAndCloseCorrectiveAction({
        organisationId: ids.organisationId, actionId: critical.id,
        actorPrincipalId: ids.centreDirectorPrincipalIds[0],
        expectedLockVersion: submitted.lockVersion,
        at: new Date("2026-08-12T01:30:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await centreSuccessDB.exec`DELETE FROM assignment_scopes WHERE id = ${overlappingScopeId}`;
    await centreSuccessDB.exec`DELETE FROM role_assignments WHERE id = ${overlappingAssignmentId}`;
    const closed = await verifyAndCloseCorrectiveAction({
      organisationId: ids.organisationId, actionId: critical.id,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: submitted.lockVersion,
      verificationNote: "Synthetic independent verification completed.",
      at: new Date("2026-08-12T02:00:00.000Z"),
    });
    expect(closed.status).toBe("CLOSED");
    const criticalHistory = (await loadCorrectiveActionDetail(ids.organisationId, critical.id)).history;
    expect(criticalHistory.map((event) => event.toStatus)).toEqual([
      "OPEN", "IN_PROGRESS", "VERIFICATION_REQUIRED", "CLOSED",
    ]);
    expect(criticalHistory.map((event) => event.eventType)).toEqual([
      "action.created",
      "remediation.started",
      "remediation.submitted_for_verification",
      "remediation.verified_and_closed",
    ]);
    expect(criticalHistory.map((event) => event.occurredAt)).toEqual([
      "2026-08-11T10:00:03.000Z",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T01:00:00.000Z",
      "2026-08-12T02:00:00.000Z",
    ]);
    expect(criticalHistory.flatMap((event) => [event.fromStatus, event.toStatus]))
      .not.toContain("EVIDENCE_SUBMITTED");

    const returnedAction = owned.find((action) => action.id !== critical.id)!;
    const returnedStarted = await startCorrectiveAction({
      organisationId: ids.organisationId,
      actionId: returnedAction.id,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      expectedLockVersion: (await loadCorrectiveActionDetail(ids.organisationId, returnedAction.id)).lockVersion,
      at: new Date("2026-08-12T02:10:00.000Z"),
    });
    const returnedSubmitted = await submitCorrectiveAction({
      organisationId: ids.organisationId,
      actionId: returnedAction.id,
      actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      expectedLockVersion: returnedStarted.lockVersion,
      remediationNote: "Synthetic remediation submitted for review.",
      at: new Date("2026-08-12T02:20:00.000Z"),
    });
    const returned = await returnCorrectiveAction({
      organisationId: ids.organisationId,
      actionId: returnedAction.id,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: returnedSubmitted.lockVersion,
      reason: "Please add one more supporting note.",
      disposition: "MORE_INFORMATION_REQUIRED",
      at: new Date("2026-08-12T02:30:00.000Z"),
    });
    expect(returned.status).toBe("MORE_INFORMATION_REQUIRED");

    const acknowledgement = await acknowledgeAudit({
      organisationId: ids.organisationId, centreId: ids.centreIds[0],
      auditId: started.auditId, actorPrincipalId: ids.centreDirectorPrincipalIds[0],
      comment: "Reviewed synthetic quarterly audit.",
      at: new Date("2026-08-12T03:00:00.000Z"),
    });
    expect(acknowledgement.acknowledgementId).toMatch(/^[0-9a-f-]{36}$/);
    const oversight = await loadComplianceOversight(ids.organisationId, new Date("2026-08-12T04:00:00.000Z"));
    expect(oversight.counts.completed).toBeGreaterThanOrEqual(1);
    expect(oversight.counts.criticalFindings).toBeGreaterThanOrEqual(1);
    expect(oversight.counts.openCorrectiveActions).toBeGreaterThanOrEqual(1);
  });

  test("withdraws corrected critical risk without erasing history and reuses it on finalisation", async () => {
    const at = new Date("2027-02-01T10:00:00.000Z");
    const baseline = await loadComplianceOversight(ids.organisationId, at);
    const started = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[2],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at,
    });
    const initialView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    const criticalItem = initialView.sections.flatMap((section) => section.items)[3];
    const created = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "NOT_OBSERVED",
        comment: "Synthetic critical observation was initially not observed.",
      },
      at,
    });
    expect(created).toMatchObject({
      immediateFindingCreated: true,
      immediateActionCreated: true,
    });
    const historical = await centreSuccessDB.queryRow<{
      finding_id: string; action_id: string;
    }>`
      SELECT finding.id AS finding_id, action.id AS action_id
      FROM findings AS finding
      JOIN corrective_actions AS action
        ON action.organisation_id = finding.organisation_id
       AND action.finding_id = finding.id
      WHERE finding.organisation_id = ${ids.organisationId}
        AND finding.audit_run_id = ${started.auditId}
    `;
    expect(historical).toBeTruthy();
    expect((await loadComplianceOversight(ids.organisationId, at)).counts.criticalFindings)
      .toBe(baseline.counts.criticalFindings + 1);

    await expect(saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "COMPLIANT",
        responseLockVersion: created.lockVersion,
      },
      at: new Date(at.getTime() + 1000),
    })).rejects.toMatchObject({ code: "invalid_input" });

    const corrections = await Promise.allSettled([
      saveAuditResponse({
        organisationId: ids.organisationId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        request: {
          auditId: started.auditId,
          itemId: criticalItem.id,
          outcome: "COMPLIANT",
          responseLockVersion: created.lockVersion,
          responseCorrectionReason: "The original response selected the wrong outcome.",
        },
        at: new Date(at.getTime() + 2000),
      }),
      saveAuditResponse({
        organisationId: ids.organisationId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        request: {
          auditId: started.auditId,
          itemId: criticalItem.id,
          outcome: "COMPLIANT",
          responseLockVersion: created.lockVersion,
          responseCorrectionReason: "Concurrent duplicate correction.",
        },
        at: new Date(at.getTime() + 2000),
      }),
    ]);
    expect(corrections.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(corrections.filter((result) => result.status === "rejected")).toHaveLength(1);
    const correctedIndex = corrections.findIndex((result) => result.status === "fulfilled");
    const corrected = corrections[correctedIndex];
    if (corrected.status !== "fulfilled") throw new Error("expected one successful correction");
    const correctedLockVersion = corrected.value.lockVersion;
    const acceptedCorrectionReason = correctedIndex === 0
      ? "The original response selected the wrong outcome."
      : "Concurrent duplicate correction.";

    const withdrawn = await centreSuccessDB.queryRow<{
      finding_id: string; finding_status: string; finding_reason: string;
      action_id: string; action_status: string; action_reason: string;
      action_events: number; audit_events: number;
    }>`
      SELECT finding.id AS finding_id, finding.status AS finding_status,
             finding.withdrawal_reason AS finding_reason,
             action.id AS action_id, action.status AS action_status,
             action.withdrawal_reason AS action_reason,
             (SELECT count(*)::integer FROM corrective_action_events AS event
              WHERE event.organisation_id = action.organisation_id
                AND event.corrective_action_id = action.id
                AND event.to_status = 'WITHDRAWN') AS action_events,
             (SELECT count(*)::integer FROM system_audit_events AS event
              WHERE event.organisation_id = finding.organisation_id
                AND event.action IN (
                  'finding.withdrawn_after_response_correction',
                  'corrective_action.withdrawn_after_response_correction'
                )
                AND event.resource_id IN (finding.id, action.id)) AS audit_events
      FROM findings AS finding
      JOIN corrective_actions AS action
        ON action.organisation_id = finding.organisation_id
       AND action.finding_id = finding.id
      WHERE finding.organisation_id = ${ids.organisationId}
        AND finding.audit_run_id = ${started.auditId}
    `;
    expect(withdrawn).toMatchObject({
      finding_id: historical!.finding_id,
      action_id: historical!.action_id,
      finding_status: "WITHDRAWN",
      action_status: "WITHDRAWN",
      finding_reason: acceptedCorrectionReason,
      action_reason: acceptedCorrectionReason,
      action_events: 1,
      audit_events: 2,
    });
    const repeatedCorrection = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "COMPLIANT",
        responseLockVersion: correctedLockVersion,
        responseCorrectionReason: "Idempotent retry of the accepted correction.",
      },
      at: new Date(at.getTime() + 2500),
    });
    expect(repeatedCorrection).toMatchObject({
      immediateFindingCreated: false,
      immediateActionCreated: false,
    });
    expect(await centreSuccessDB.queryRow<{ action_events: number; audit_events: number }>`
      SELECT
        (SELECT count(*)::integer FROM corrective_action_events AS event
         WHERE event.organisation_id = ${ids.organisationId}
           AND event.corrective_action_id = ${historical!.action_id}
           AND event.to_status = 'WITHDRAWN') AS action_events,
        (SELECT count(*)::integer FROM system_audit_events AS event
         WHERE event.organisation_id = ${ids.organisationId}
           AND event.action IN (
             'finding.withdrawn_after_response_correction',
             'corrective_action.withdrawn_after_response_correction'
           )
           AND event.resource_id IN (${historical!.finding_id}, ${historical!.action_id})) AS audit_events
    `).toEqual({ action_events: 1, audit_events: 2 });
    const afterWithdrawal = await loadComplianceOversight(ids.organisationId, at);
    expect(afterWithdrawal.counts.criticalFindings).toBe(baseline.counts.criticalFindings);
    expect(afterWithdrawal.counts.openCorrectiveActions).toBe(baseline.counts.openCorrectiveActions);
    expect(await listCorrectiveActionsForPrincipal({
      organisationId: ids.organisationId,
      principalId: ids.centreDirectorPrincipalIds[2],
    })).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: historical!.action_id }),
    ]));

    const partial = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "PARTIALLY_COMPLIANT",
        comment: "Synthetic partial compliance reason.",
        responseLockVersion: repeatedCorrection.lockVersion,
      },
      at: new Date(at.getTime() + 3000),
    });
    const partialRecords = await centreSuccessDB.queryRow<{
      findings: number; actions: number; finding_status: string; action_status: string;
    }>`
      SELECT
        (SELECT count(*)::integer FROM findings WHERE audit_run_id = ${started.auditId}) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action
          JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.audit_run_id = ${started.auditId}) AS actions,
        finding.status AS finding_status, action.status AS action_status
      FROM findings AS finding
      JOIN corrective_actions AS action ON action.finding_id = finding.id
      WHERE finding.audit_run_id = ${started.auditId}
    `;
    expect(partialRecords).toEqual({
      findings: 1,
      actions: 1,
      finding_status: "WITHDRAWN",
      action_status: "WITHDRAWN",
    });
    const withdrawnAgain = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "COMPLIANT",
        responseLockVersion: partial.lockVersion,
        responseCorrectionReason: "The partial-compliance response was also corrected.",
      },
      at: new Date(at.getTime() + 4000),
    });
    const nonCompliant = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "NON_COMPLIANT",
        comment: "Synthetic non-compliance reason.",
        responseLockVersion: withdrawnAgain.lockVersion,
      },
      at: new Date(at.getTime() + 5000),
    });
    await expect(saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "NON_COMPLIANT",
        comment: "Synthetic idempotent retry.",
        responseLockVersion: nonCompliant.lockVersion,
      },
      at: new Date(at.getTime() + 6000),
    })).resolves.toMatchObject({ immediateFindingCreated: false, immediateActionCreated: false });
    expect(await centreSuccessDB.queryRow<{ finding_status: string; action_status: string }>`
      SELECT finding.status AS finding_status, action.status AS action_status
      FROM findings AS finding
      JOIN corrective_actions AS action ON action.finding_id = finding.id
      WHERE finding.audit_run_id = ${started.auditId}
    `).toEqual({ finding_status: "WITHDRAWN", action_status: "WITHDRAWN" });

    await respondToUnansweredItems(started.auditId, new Date(at.getTime() + 10_000));
    let readyView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId,
      auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: readyView.lockVersion,
      at: new Date(at.getTime() + 30_000),
    });
    readyView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await finaliseQuarterlyAudit({
      organisationId: ids.organisationId,
      auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: readyView.lockVersion,
      at: new Date(at.getTime() + 31_000),
    });
    const finalState = await centreSuccessDB.queryRow<{
      critical_finding_count: number; findings: number; actions: number;
    }>`
      SELECT run.critical_finding_count,
        (SELECT count(*)::integer FROM findings WHERE audit_run_id = run.id) AS findings,
        (SELECT count(*)::integer FROM corrective_actions AS action
          JOIN findings AS finding ON finding.id = action.finding_id
          WHERE finding.audit_run_id = run.id) AS actions
      FROM audit_runs AS run WHERE run.id = ${started.auditId}
    `;
    expect(finalState).toEqual({ critical_finding_count: 1, findings: 1, actions: 1 });
    const finalHistorical = await centreSuccessDB.queryRow<{
      finding_id: string; action_id: string; finding_status: string; action_status: string;
    }>`
      SELECT finding.id AS finding_id, action.id AS action_id,
             finding.status AS finding_status, action.status AS action_status
      FROM findings AS finding
      JOIN corrective_actions AS action ON action.finding_id = finding.id
      WHERE finding.audit_run_id = ${started.auditId}
    `;
    expect(finalHistorical).toMatchObject({
      finding_id: historical!.finding_id,
      action_id: historical!.action_id,
      finding_status: "OPEN",
      action_status: "OPEN",
    });
  });

  test("finalises a corrected critical response with no active critical risk", async () => {
    const at = new Date("2027-08-01T10:00:00.000Z");
    const started = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[2],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at,
    });
    const initialView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    const criticalItem = initialView.sections.flatMap((section) => section.items)[3];
    const created = await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "NOT_OBSERVED",
        comment: "Synthetic critical item initially recorded as not observed.",
      },
      at,
    });
    await saveAuditResponse({
      organisationId: ids.organisationId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      request: {
        auditId: started.auditId,
        itemId: criticalItem.id,
        outcome: "COMPLIANT",
        responseLockVersion: created.lockVersion,
        responseCorrectionReason: "The initial outcome was corrected after review.",
      },
      at: new Date(at.getTime() + 1000),
    });
    await respondToUnansweredItems(started.auditId, new Date(at.getTime() + 2000));
    let readyView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId,
      auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: readyView.lockVersion,
      at: new Date(at.getTime() + 20_000),
    });
    readyView = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await finaliseQuarterlyAudit({
      organisationId: ids.organisationId,
      auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: readyView.lockVersion,
      at: new Date(at.getTime() + 21_000),
    });
    expect(await centreSuccessDB.queryRow<{
      critical_finding_count: number;
      finding_status: string;
      action_status: string;
      findings: number;
      actions: number;
    }>`
      SELECT run.critical_finding_count,
             finding.status AS finding_status,
             action.status AS action_status,
             (SELECT count(*)::integer FROM findings WHERE audit_run_id = run.id) AS findings,
             (SELECT count(*)::integer FROM corrective_actions AS counted_action
              JOIN findings AS counted_finding ON counted_finding.id = counted_action.finding_id
              WHERE counted_finding.audit_run_id = run.id) AS actions
      FROM audit_runs AS run
      JOIN findings AS finding ON finding.audit_run_id = run.id
      JOIN corrective_actions AS action ON action.finding_id = finding.id
      WHERE run.id = ${started.auditId}
    `).toEqual({
      critical_finding_count: 0,
      finding_status: "WITHDRAWN",
      action_status: "WITHDRAWN",
      findings: 1,
      actions: 1,
    });
  });

  test("rejects invalid verification and performance-band configuration in PostgreSQL", async () => {
    const versionId = randomUUID();
    const sectionId = randomUUID();
    const itemId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_template_versions (
        id, organisation_id, audit_template_id, scoring_policy_id, version,
        title, instructions, status, effective_from, source_classification, synthetic
      ) VALUES (
        ${versionId}, ${ids.organisationId}, ${ids.templateId}, ${ids.scoringPolicyId}, 99,
        'Synthetic invalid configuration boundary', 'Database constraint test only.',
        'draft', '2027-01-01T00:00:00.000Z', 'BSA_DEVELOPMENT_TEST', TRUE
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_template_sections (
        id, organisation_id, template_version_id, stable_key, title, sort_order
      ) VALUES (
        ${sectionId}, ${ids.organisationId}, ${versionId},
        'acceptance_remediation', 'Acceptance remediation', 1
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_template_items (
        id, organisation_id, template_version_id, section_id, lineage_key,
        wording, sort_order, scoring_weight, scored, critical,
        evidence_requirement, applicability, source_classification
      ) VALUES (
        ${itemId}, ${ids.organisationId}, ${versionId}, ${sectionId},
        'acceptance_remediation.verification', 'Synthetic verification configuration test.',
        1, 1, TRUE, TRUE, 'required', 'required', 'BSA_DEVELOPMENT_TEST'
      )
    `;
    await expect(centreSuccessDB.exec`
      INSERT INTO audit_item_outcome_configurations (
        organisation_id, audit_item_id, outcome, permitted, creates_finding,
        creates_action, immediate, severity, due_days,
        independent_verification_required, required_remediation
      ) VALUES (
        ${ids.organisationId}, ${itemId}, 'IMMEDIATE_ACTION_REQUIRED', TRUE, TRUE,
        TRUE, TRUE, 'CRITICAL', 1, FALSE, 'Synthetic remediation.'
      )
    `).rejects.toThrow(/independent_verification/i);
    await expect(centreSuccessDB.exec`
      INSERT INTO audit_item_outcome_configurations (
        organisation_id, audit_item_id, outcome, permitted, creates_finding,
        creates_action, immediate, severity, due_days,
        independent_verification_required, required_remediation
      ) VALUES (
        ${ids.organisationId}, ${itemId}, 'NON_COMPLIANT', TRUE, TRUE,
        TRUE, FALSE, 'CRITICAL', 1, FALSE, 'Synthetic remediation.'
      )
    `).rejects.toThrow(/independent_verification/i);
    await centreSuccessDB.exec`
      INSERT INTO audit_item_outcome_configurations (
        organisation_id, audit_item_id, outcome, permitted, creates_finding,
        creates_action, immediate, severity, due_days,
        independent_verification_required, required_remediation
      ) VALUES (
        ${ids.organisationId}, ${itemId}, 'NON_COMPLIANT', TRUE, TRUE,
        TRUE, FALSE, 'CRITICAL', 1, TRUE, 'Synthetic remediation.'
      )
    `;
    await expect(centreSuccessDB.exec`
      UPDATE audit_item_outcome_configurations
      SET independent_verification_required = FALSE
      WHERE audit_item_id = ${itemId} AND outcome = 'NON_COMPLIANT'
    `).rejects.toThrow(/independent_verification/i);

    const policyId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_scoring_policies (
        id, organisation_id, policy_key, version, name, status,
        rounding_scale, source_classification
      ) VALUES (
        ${policyId}, ${ids.organisationId}, ${`acceptance-gap-${policyId.slice(0, 8)}`},
        1, 'Synthetic gapped band policy', 'draft', 2, 'BSA_DEVELOPMENT_TEST'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES
        (${randomUUID()}, ${ids.organisationId}, ${policyId}, 'LOW', 'Low', 0, 40, 1, TRUE),
        (${randomUUID()}, ${ids.organisationId}, ${policyId}, 'HIGH', 'High', 50, 100, 2, FALSE)
    `;
    await expect(centreSuccessDB.exec`
      UPDATE audit_scoring_policies SET status = 'active' WHERE id = ${policyId}
    `).rejects.toThrow(/gap or overlap/i);

    const overlapPolicyId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_scoring_policies (
        id, organisation_id, policy_key, version, name, status,
        rounding_scale, source_classification
      ) VALUES (
        ${overlapPolicyId}, ${ids.organisationId},
        ${`acceptance-overlap-${overlapPolicyId.slice(0, 8)}`},
        1, 'Synthetic overlapping band policy', 'draft', 2,
        'BSA_DEVELOPMENT_TEST'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES
        (${randomUUID()}, ${ids.organisationId}, ${overlapPolicyId}, 'LOW', 'Low', 0, 60, 1, TRUE),
        (${randomUUID()}, ${ids.organisationId}, ${overlapPolicyId}, 'HIGH', 'High', 50, 100, 2, FALSE)
    `;
    await expect(centreSuccessDB.exec`
      UPDATE audit_scoring_policies SET status = 'active'
      WHERE id = ${overlapPolicyId}
    `).rejects.toThrow(/gap or overlap/i);
    await expect(centreSuccessDB.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES (
        ${randomUUID()}, ${ids.organisationId}, ${overlapPolicyId},
        'OUT_OF_RANGE', 'Out of range', -1, 0, 3, TRUE
      )
    `).rejects.toThrow();
    await expect(centreSuccessDB.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES (
        ${randomUUID()}, ${ids.organisationId}, ${overlapPolicyId},
        'EMPTY_RANGE', 'Empty range', 80, 80, 3, TRUE
      )
    `).rejects.toThrow();
  });

  test("serializes finalisation, rolls back failed attempts, and revalidates owners", async () => {
    const concurrentAt = new Date("2027-02-02T10:00:00.000Z");
    const concurrent = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[1],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at: concurrentAt,
    });
    await respondToEveryItem(concurrent.auditId, {}, concurrentAt);
    let view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: concurrent.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId,
      auditId: concurrent.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(concurrentAt.getTime() + 20_000),
    });
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: concurrent.auditId,
    });
    const doubleFinalisation = await Promise.allSettled([
      finaliseQuarterlyAudit({
        organisationId: ids.organisationId,
        auditId: concurrent.auditId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        expectedLockVersion: view.lockVersion,
        at: new Date(concurrentAt.getTime() + 30_000),
      }),
      finaliseQuarterlyAudit({
        organisationId: ids.organisationId,
        auditId: concurrent.auditId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        expectedLockVersion: view.lockVersion,
        at: new Date(concurrentAt.getTime() + 30_000),
      }),
    ]);
    expect(doubleFinalisation.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(doubleFinalisation.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count FROM system_audit_events
      WHERE organisation_id = ${ids.organisationId}
        AND resource_id = ${concurrent.auditId}
        AND action = 'quarterly_audit.finalised'
    `)?.count).toBe(1);

    const retryAt = new Date("2027-05-01T10:00:00.000Z");
    const retry = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[0],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at: retryAt,
    });
    await respondToEveryItem(retry.auditId, {}, retryAt);
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: retry.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId,
      auditId: retry.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(retryAt.getTime() + 20_000),
    });
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: retry.auditId,
    });
    const outsiderPrincipalId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${outsiderPrincipalId}, 'Synthetic audit rollback actor', 'active')
    `;
    await centreSuccessDB.exec`
      UPDATE audit_runs SET auditor_principal_id = ${outsiderPrincipalId}
      WHERE id = ${retry.auditId}
    `;
    await expect(finaliseQuarterlyAudit({
      organisationId: ids.organisationId,
      auditId: retry.auditId,
      actorPrincipalId: outsiderPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(retryAt.getTime() + 30_000),
    })).rejects.toThrow(/audit actor does not belong/i);
    expect(await centreSuccessDB.queryRow<{ status: string; results: number }>`
      SELECT run.status,
        (SELECT count(*)::integer FROM audit_section_results WHERE audit_run_id = run.id) AS results
      FROM audit_runs AS run WHERE run.id = ${retry.auditId}
    `).toEqual({ status: "READY_FOR_REVIEW", results: 0 });
    await centreSuccessDB.exec`
      UPDATE audit_runs SET auditor_principal_id = ${ids.areaManagerPrincipalId}
      WHERE id = ${retry.auditId}
    `;
    await expect(finaliseQuarterlyAudit({
      organisationId: ids.organisationId,
      auditId: retry.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(retryAt.getTime() + 31_000),
    })).resolves.toMatchObject({ status: "FINALISED" });

    const ownerAt = new Date("2027-05-02T10:00:00.000Z");
    const ownerRun = await startQuarterlyAudit({
      organisationId: ids.organisationId,
      centreId: ids.centreIds[1],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at: ownerAt,
    });
    await respondToEveryItem(ownerRun.auditId, { 0: "NON_COMPLIANT" }, ownerAt);
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: ownerRun.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId,
      auditId: ownerRun.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(ownerAt.getTime() + 20_000),
    });
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: ownerRun.auditId,
    });
    const ownerAssignment = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT assignment.id
      FROM role_assignments AS assignment
      JOIN organisation_memberships AS membership
        ON membership.organisation_id = assignment.organisation_id
       AND membership.id = assignment.organisation_membership_id
      JOIN assignment_scopes AS scope
        ON scope.organisation_id = assignment.organisation_id
       AND scope.role_assignment_id = assignment.id
      WHERE assignment.organisation_id = ${ids.organisationId}
        AND membership.principal_id = ${ids.centreDirectorPrincipalIds[1]}
        AND scope.centre_id = ${ids.centreIds[1]}
        AND assignment.status = 'active'
    `;
    await centreSuccessDB.exec`
      UPDATE role_assignments SET status = 'inactive'
      WHERE id = ${ownerAssignment!.id}
    `;
    try {
      await expect(finaliseQuarterlyAudit({
        organisationId: ids.organisationId,
        auditId: ownerRun.auditId,
        actorPrincipalId: ids.areaManagerPrincipalId,
        expectedLockVersion: view.lockVersion,
        at: new Date(ownerAt.getTime() + 30_000),
      })).rejects.toMatchObject({ code: "owner_resolution_required" });
    } finally {
      await centreSuccessDB.exec`
        UPDATE role_assignments SET status = 'active'
        WHERE id = ${ownerAssignment!.id}
      `;
    }
    await expect(finaliseQuarterlyAudit({
      organisationId: ids.organisationId,
      auditId: ownerRun.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date(ownerAt.getTime() + 31_000),
    })).resolves.toMatchObject({ status: "FINALISED" });
  });

  test("derives oversight threshold from the audit's pinned performance band", async () => {
    const baseline = (await loadComplianceOversight(
      ids.organisationId,
      new Date("2028-02-01T00:00:00.000Z"),
    )).counts.centresBelowInternalThreshold;
    const policyId = randomUUID();
    const templateId = randomUUID();
    const versionId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_scoring_policies (
        id, organisation_id, policy_key, version, name, status,
        rounding_scale, source_classification
      ) VALUES (
        ${policyId}, ${ids.organisationId}, ${`acceptance-threshold-${policyId.slice(0, 8)}`},
        1, 'Synthetic threshold interpretation', 'draft', 2, 'BSA_DEVELOPMENT_TEST'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_performance_bands (
        id, organisation_id, scoring_policy_id, band_code, label,
        minimum_score, maximum_score, priority, below_internal_threshold
      ) VALUES
        (${randomUUID()}, ${ids.organisationId}, ${policyId}, 'CONFIGURED_OK',
         'Configured as not below threshold', 0, 50, 1, FALSE),
        (${randomUUID()}, ${ids.organisationId}, ${policyId}, 'CONFIGURED_BELOW',
         'Configured as below threshold', 50, 100, 2, TRUE)
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_templates (
        id, organisation_id, template_key, title, audit_type, status
      ) VALUES (
        ${templateId}, ${ids.organisationId}, ${`acceptance-threshold-${templateId.slice(0, 8)}`},
        'Synthetic threshold template', 'quarterly_review', 'active'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_template_versions (
        id, organisation_id, audit_template_id, scoring_policy_id, version,
        title, instructions, status, effective_from, source_classification, synthetic
      ) VALUES (
        ${versionId}, ${ids.organisationId}, ${templateId}, ${policyId}, 1,
        'Synthetic threshold template version', 'Configuration interpretation test only.',
        'draft', '2028-01-01T00:00:00.000Z', 'BSA_DEVELOPMENT_TEST', TRUE
      )
    `;
    const lowScoreRunId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_runs (
        id, organisation_id, centre_id, template_version_id,
        auditor_principal_id, review_period_start, status, started_at,
        finalised_at, finalised_by_principal_id, overall_score,
        performance_band_code, performance_band_label, risk_status
      ) VALUES (
        ${lowScoreRunId}, ${ids.organisationId}, ${ids.centreIds[0]}, ${versionId},
        ${ids.areaManagerPrincipalId}, '2028-01-01', 'FINALISED',
        '2028-01-02T00:00:00.000Z', '2028-01-02T01:00:00.000Z',
        ${ids.areaManagerPrincipalId}, 10, 'CONFIGURED_OK',
        'Configured as not below threshold', 'STRONG'
      )
    `;
    expect((await loadComplianceOversight(
      ids.organisationId,
      new Date("2028-02-01T00:00:00.000Z"),
    )).counts.centresBelowInternalThreshold).toBe(baseline);

    const highScoreRunId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO audit_runs (
        id, organisation_id, centre_id, template_version_id,
        auditor_principal_id, review_period_start, status, started_at,
        finalised_at, finalised_by_principal_id, overall_score,
        performance_band_code, performance_band_label, risk_status
      ) VALUES (
        ${highScoreRunId}, ${ids.organisationId}, ${ids.centreIds[1]}, ${versionId},
        ${ids.areaManagerPrincipalId}, '2028-01-01', 'FINALISED',
        '2028-01-02T00:00:00.000Z', '2028-01-02T01:00:00.000Z',
        ${ids.areaManagerPrincipalId}, 90, 'CONFIGURED_BELOW',
        'Configured as below threshold', 'STRONG'
      )
    `;
    expect((await loadComplianceOversight(
      ids.organisationId,
      new Date("2028-02-01T00:00:00.000Z"),
    )).counts.centresBelowInternalThreshold).toBe(baseline + 1);
  });

  test("supports comparable next-quarter scoring and stable-lineage recurrence", async () => {
    const started = await startQuarterlyAudit({
      organisationId: ids.organisationId, centreId: ids.centreIds[0],
      actorPrincipalId: ids.areaManagerPrincipalId,
      at: new Date("2026-11-01T10:00:00.000Z"),
    });
    await respondToEveryItem(
      started.auditId,
      { 3: "IMMEDIATE_ACTION_REQUIRED" },
      new Date("2026-11-01T10:00:00.000Z"),
    );
    let view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await markAuditReady({
      organisationId: ids.organisationId, auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date("2026-11-01T11:00:00.000Z"),
    });
    view = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    await finaliseQuarterlyAudit({
      organisationId: ids.organisationId, auditId: started.auditId,
      actorPrincipalId: ids.areaManagerPrincipalId,
      expectedLockVersion: view.lockVersion,
      at: new Date("2026-11-01T12:00:00.000Z"),
    });
    const final = await loadQuarterlyAuditView({
      organisationId: ids.organisationId,
      principalId: ids.areaManagerPrincipalId,
      auditId: started.auditId,
    });
    expect(final.previousComparison?.score).toBe(87.5);
    expect(final.previousComparison?.difference).toBe(4.2);
    expect(final.sections.flatMap((section) => section.items)[3].finding?.repeatCount).toBe(2);
    await expect(
      centreSuccessDB.exec`
        UPDATE audit_runs SET overall_score = 100
        WHERE organisation_id = ${ids.organisationId} AND id = ${started.auditId}
      `,
    ).rejects.toThrow(/finalised audit result is immutable/);
    await expect(
      centreSuccessDB.exec`
        UPDATE audit_scoring_outcome_rules SET score_factor = 0.25
        WHERE organisation_id = ${ids.organisationId}
          AND scoring_policy_id = ${ids.scoringPolicyId}
          AND outcome = 'PARTIALLY_COMPLIANT'
      `,
    ).rejects.toThrow(/released audit scoring configuration is immutable/);
  });

  test("fails closed for inactive and cross-organisation principals", async () => {
    await centreSuccessDB.exec`
      UPDATE principals SET status = 'suspended', updated_at = now(), lock_version = lock_version + 1
      WHERE id = ${ids.areaManagerPrincipalId}
    `;
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.areaManagerPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "principal_inactive" });
    await centreSuccessDB.exec`
      UPDATE principals SET status = 'active', updated_at = now(), lock_version = lock_version + 1
      WHERE id = ${ids.areaManagerPrincipalId}
    `;
    const otherOrganisation = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${otherOrganisation}, 'Synthetic Other Organisation', 'active', 'Australia/Sydney')
    `;
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.areaManagerPrincipalId,
        activeOrganisationId: otherOrganisation,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toMatchObject({ allowed: false });

    const expiredPrincipalId = randomUUID();
    const expiredMembershipId = randomUUID();
    const expiredAssignmentId = randomUUID();
    const expiredScopeId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${expiredPrincipalId}, 'Synthetic Expired Assignment', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisation_memberships (
        id, organisation_id, principal_id, status, effective_from
      ) VALUES (
        ${expiredMembershipId}, ${ids.organisationId}, ${expiredPrincipalId},
        'active', '2026-08-01T00:00:00.000Z'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, grant_source_type, reason
      ) SELECT
        ${expiredAssignmentId}, ${ids.organisationId}, ${expiredMembershipId}, role.id,
        'active', '2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
        'system', 'Synthetic expired assignment boundary test.'
      FROM role_definitions AS role
      WHERE role.organisation_id = ${ids.organisationId}
        AND role.role_key = 'area_manager' AND role.status = 'active'
    `;
    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id, organisation_id, role_assignment_id, scope_type, centre_id,
        effective_from, effective_to
      ) VALUES (
        ${expiredScopeId}, ${ids.organisationId}, ${expiredAssignmentId},
        'centre', ${ids.centreIds[0]}, '2026-08-01T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z'
      )
    `;
    await expect(
      authoriseCentreFromDatabase({
        principalId: expiredPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: AT,
      }),
    ).resolves.toMatchObject({ allowed: false });

    await expect(
      loadPrincipalAuthorisationContext({
        principalId: ids.complianceManagerPrincipalId,
        activeOrganisationId: otherOrganisation,
        at: AT,
      }),
    ).rejects.toThrow();
    await expect(
      authoriseCentreFromDatabase({
        principalId: ids.areaManagerPrincipalId,
        activeOrganisationId: ids.organisationId,
        centreId: ids.centreIds[0],
        capability: capability.quarterlyAuditConduct,
        at: new Date("2026-08-10T23:59:59.999Z"),
      }),
    ).resolves.toMatchObject({ allowed: false });
  });
});
