import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { buildCentreQualityDetail, buildCentreQualityWorkspace, CentreQualityError } from "./service";

/**
 * Centre Quality & Performance runs against a fully isolated organisation so
 * every assertion is deterministic and unaffected by other integration files
 * that mutate the shared development seed.
 */

const AT = new Date("2035-08-12T02:00:00.000Z");
const TIMEZONE = "Australia/Sydney";
const now = () => AT;

interface QualityFixture {
  organisationId: string;
  centreIds: string[];
  areaManagerId: string;
  centreDirectorId: string;
  complianceManagerId: string;
  systemAdministratorId: string;
  outsiderId: string;
  templateVersionId: string;
  otherTemplateVersionId: string;
  itemIds: string[];
  sectionIds: string[];
  criticalActionId: string;
  verificationActionId: string;
  closedActionId: string;
}

let fixture: QualityFixture;

async function grant(
  organisationId: string,
  principalId: string,
  displayName: string,
  roleKey: string,
  scope: { type: "organisation" } | { type: "centre"; centreId: string },
): Promise<void> {
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${displayName}, 'active')
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
      'active', '2030-01-01', 'system', 'Synthetic Centre Quality fixture.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
    ) VALUES (
      ${randomUUID()}, ${organisationId}, ${assignmentId}, ${scope.type},
      ${scope.type === "centre" ? scope.centreId : null}, '2030-01-01'
    )
  `;
}

async function finalisedRun(
  organisationId: string,
  centreId: string,
  auditorId: string,
  templateVersionId: string,
  reviewPeriodStart: string,
  values: {
    overallScore: number | null;
    criticalFindingCount?: number;
    highFindingCount?: number;
    positivePracticeCount?: number;
    bandLabel?: string;
  },
): Promise<string> {
  const runId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_runs (
      id, organisation_id, centre_id, template_version_id, auditor_principal_id,
      review_period_start, status, started_at, finalised_at, finalised_by_principal_id,
      overall_score, performance_band_label, coverage_percent,
      critical_finding_count, high_finding_count, action_count, positive_practice_count
    ) VALUES (
      ${runId}, ${organisationId}, ${centreId}, ${templateVersionId}, ${auditorId},
      ${reviewPeriodStart}, 'FINALISED', ${AT}, ${AT}, ${auditorId},
      ${values.overallScore}, ${values.bandLabel ?? "Synthetic internal band"}, 100,
      ${values.criticalFindingCount ?? 0}, ${values.highFindingCount ?? 0}, 0,
      ${values.positivePracticeCount ?? 0}
    )
  `;
  return runId;
}

async function correctiveAction(
  organisationId: string,
  centreId: string,
  runId: string,
  itemId: string,
  auditorId: string,
  ownerId: string | null,
  overrides: {
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: string;
    dueAt: Date;
    title: string;
    findingStatus?: "OPEN" | "RESOLVED";
    createAction?: boolean;
    independentVerification?: boolean;
    submittedBy?: string | null;
    closedAt?: Date;
  },
): Promise<string> {
  const responseId = randomUUID();
  const findingId = randomUUID();
  const actionId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_responses (
      id, organisation_id, audit_run_id, audit_item_id, outcome,
      comment, responded_by_principal_id
    ) VALUES (
      ${responseId}, ${organisationId}, ${runId}, ${itemId}, 'NON_COMPLIANT',
      'Synthetic Centre Quality fixture response.', ${auditorId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO findings (
      id, organisation_id, centre_id, audit_run_id, audit_response_id,
      item_lineage_key, severity, description, source_classification,
      status, created_by_principal_id
    ) VALUES (
      ${findingId}, ${organisationId}, ${centreId}, ${runId}, ${responseId},
      ${`centre_quality_${actionId.slice(0, 8)}`}, ${overrides.severity},
      'Synthetic Centre Quality finding.', 'BSA_DEVELOPMENT_TEST',
      ${overrides.findingStatus ?? "OPEN"}, ${auditorId}
    )
  `;
  if (overrides.createAction === false) return findingId;
  await centreSuccessDB.exec`
    INSERT INTO corrective_actions (
      id, organisation_id, centre_id, finding_id, owner_principal_id,
      title, required_remediation, evidence_requirement, severity, due_at,
      independent_verification_required, status,
      remediation_submitted_by_principal_id, remediation_submitted_at, closed_at
    ) VALUES (
      ${actionId}, ${organisationId}, ${centreId}, ${findingId}, ${ownerId},
      ${overrides.title}, 'Synthetic remediation instruction.', 'optional',
      ${overrides.severity}, ${overrides.dueAt},
      ${overrides.independentVerification ?? false}, ${overrides.status},
      ${overrides.submittedBy ?? null},
      ${overrides.submittedBy ? AT : null},
      ${overrides.closedAt ?? null}
    )
  `;
  return actionId;
}

async function createQualityFixture(centreCount = 3): Promise<QualityFixture> {
  const organisationId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${organisationId}, ${`Centre Quality fixture ${organisationId.slice(0, 8)}`}, 'active', ${TIMEZONE})
  `;
  const centreIds = Array.from({ length: centreCount }, () => randomUUID());
  const baseNames = ["Zephyr Quality Centre", "Ashgrove Quality Centre", "Belmore Quality Centre"];
  const centreNames = centreIds.map(
    (_, index) => baseNames[index] ?? `Scale Quality Centre ${String(index).padStart(2, "0")}`,
  );
  for (const [index, centreId] of centreIds.entries()) {
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES (
        ${centreId}, ${organisationId}, ${`CQ-${organisationId.slice(0, 4)}-${index}`},
        ${centreNames[index]}, 'SYNTHETIC', ${TIMEZONE}, 'active'
      )
    `;
  }

  const areaManagerId = randomUUID();
  const centreDirectorId = randomUUID();
  const complianceManagerId = randomUUID();
  const systemAdministratorId = randomUUID();
  const outsiderId = randomUUID();
  await grant(organisationId, areaManagerId, "Quality Area Manager", "area_manager", { type: "organisation" });
  await grant(organisationId, centreDirectorId, "Quality Centre Director", "centre_director", { type: "centre", centreId: centreIds[0] });
  await grant(organisationId, complianceManagerId, "Quality Compliance Manager", "compliance_manager", { type: "organisation" });
  await grant(organisationId, systemAdministratorId, "Quality System Administrator", "system_administrator", { type: "organisation" });
  await grant(organisationId, outsiderId, "Quality Educator", "educator", { type: "centre", centreId: centreIds[2] });

  const templateId = randomUUID();
  const policyId = randomUUID();
  const templateVersionId = randomUUID();
  const otherTemplateVersionId = randomUUID();
  const sectionIds = [randomUUID(), randomUUID(), randomUUID()];
  const sectionId = sectionIds[0];
  const itemIds = Array.from({ length: 6 }, () => randomUUID());
  await centreSuccessDB.exec`
    INSERT INTO audit_templates (id, organisation_id, template_key, title, audit_type, status)
    VALUES (${templateId}, ${organisationId}, 'centre_quality_fixture', 'Synthetic internal review', 'quarterly_review', 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO audit_scoring_policies (id, organisation_id, policy_key, version, name, status, source_classification)
    VALUES (${policyId}, ${organisationId}, 'centre_quality_fixture', 1, 'Synthetic policy', 'draft', 'BSA_DEVELOPMENT_TEST')
  `;
  // Template content is immutable once released, so build it as a draft first.
  for (const [index, versionId] of [templateVersionId, otherTemplateVersionId].entries()) {
    await centreSuccessDB.exec`
      INSERT INTO audit_template_versions (
        id, organisation_id, audit_template_id, scoring_policy_id, version,
        title, instructions, status, effective_from, source_classification, synthetic
      ) VALUES (
        ${versionId}, ${organisationId}, ${templateId}, ${policyId}, ${index + 1},
        'Synthetic internal review', 'Synthetic internal instructions.',
        'draft', '2030-01-01', 'BSA_DEVELOPMENT_TEST', TRUE
      )
    `;
  }
  const sectionTitles = ["Centre documentation", "Learning environment", "Family engagement"];
  for (const [index, id] of sectionIds.entries()) {
    await centreSuccessDB.exec`
      INSERT INTO audit_template_sections (id, organisation_id, template_version_id, stable_key, title, sort_order)
      VALUES (
        ${id}, ${organisationId}, ${templateVersionId},
        ${`synthetic_section_${index}`}, ${sectionTitles[index]}, ${index + 1}
      )
    `;
  }
  for (const [index, itemId] of itemIds.entries()) {
    await centreSuccessDB.exec`
      INSERT INTO audit_template_items (
        id, organisation_id, template_version_id, section_id, lineage_key, wording,
        sort_order, scoring_weight, scored, critical, evidence_requirement,
        applicability, source_classification
      ) VALUES (
        ${itemId}, ${organisationId}, ${templateVersionId}, ${sectionId},
        ${`synthetic_item_${index}`}, ${`Synthetic internal review item ${index + 1}`},
        ${index + 1}, 1, TRUE, FALSE, 'optional', 'required', 'BSA_DEVELOPMENT_TEST'
      )
    `;
  }
  await centreSuccessDB.exec`
    UPDATE audit_template_versions SET status = 'active'
    WHERE organisation_id = ${organisationId} AND id = ${templateVersionId}
  `;

  // Centre 0 carries two comparable finalised quarters plus live corrective work.
  const previousRun = await finalisedRun(organisationId, centreIds[0], areaManagerId, templateVersionId, "2035-01-01", {
    overallScore: 84, criticalFindingCount: 2, positivePracticeCount: 1,
  });
  const latestRun = await finalisedRun(organisationId, centreIds[0], areaManagerId, templateVersionId, "2035-04-01", {
    overallScore: 91, criticalFindingCount: 0, positivePracticeCount: 3,
  });
  // Real per-section results for both comparable quarters on centre 0.
  const sectionScores: readonly (readonly [number | null, number | null, number])[] = [
    [72, 68, 100],   // below overall in both quarters, improving
    [98, 91, 100],   // above overall
    [null, null, 40], // scored nothing, partly observed
  ];
  for (const [index, id] of sectionIds.entries()) {
    const [latestScore, previousScore, coverage] = sectionScores[index];
    await centreSuccessDB.exec`
      INSERT INTO audit_section_results (
        organisation_id, audit_run_id, section_id,
        eligible_weight, achieved_weight, score, coverage_percent
      ) VALUES (
        ${organisationId}, ${latestRun}, ${id}, 1, 1, ${latestScore}, ${coverage}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO audit_section_results (
        organisation_id, audit_run_id, section_id,
        eligible_weight, achieved_weight, score, coverage_percent
      ) VALUES (
        ${organisationId}, ${previousRun}, ${id}, 1, 1, ${previousScore}, ${coverage}
      )
    `;
  }

  const positiveResponseId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO audit_responses (
      id, organisation_id, audit_run_id, audit_item_id, outcome, comment, responded_by_principal_id
    ) VALUES (
      ${positiveResponseId}, ${organisationId}, ${latestRun}, ${itemIds[0]},
      'POSITIVE_PRACTICE', 'Synthetic positive practice.', ${areaManagerId}
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO positive_observations (
      id, organisation_id, centre_id, audit_run_id, audit_response_id, description, created_by_principal_id
    ) VALUES (
      ${randomUUID()}, ${organisationId}, ${centreIds[0]}, ${latestRun}, ${positiveResponseId},
      'Educators consistently model calm transitions.', ${areaManagerId}
    )
  `;
  const criticalActionId = await correctiveAction(
    organisationId, centreIds[0], previousRun, itemIds[1], areaManagerId, centreDirectorId,
    { severity: "CRITICAL", status: "IN_PROGRESS", dueAt: new Date("2035-08-20T02:00:00.000Z"), title: "Synthetic critical action" },
  );
  const verificationActionId = await correctiveAction(
    organisationId, centreIds[0], previousRun, itemIds[2], areaManagerId, centreDirectorId,
    {
      severity: "HIGH", status: "VERIFICATION_REQUIRED", dueAt: new Date("2035-08-25T02:00:00.000Z"),
      title: "Synthetic verification action", independentVerification: true, submittedBy: centreDirectorId,
    },
  );
  const closedActionId = await correctiveAction(
    organisationId, centreIds[0], previousRun, itemIds[3], areaManagerId, centreDirectorId,
    {
      severity: "MEDIUM", status: "CLOSED", dueAt: new Date("2035-08-01T02:00:00.000Z"),
      title: "Synthetic completed action", findingStatus: "RESOLVED",
      closedAt: new Date("2035-08-05T02:00:00.000Z"),
    },
  );
  // An uncovered critical finding: the clearest support signal.
  await correctiveAction(
    organisationId, centreIds[0], latestRun, itemIds[4], areaManagerId, null,
    { severity: "CRITICAL", status: "OPEN", dueAt: AT, title: "unused", createAction: false },
  );

  // Centre 1 has exactly one finalised quarter and no open work.
  await finalisedRun(organisationId, centreIds[1], areaManagerId, templateVersionId, "2035-04-01", {
    overallScore: 96, positivePracticeCount: 2,
  });

  // Centre 2 has no finalised review at all.
  return {
    organisationId,
    centreIds,
    areaManagerId,
    centreDirectorId,
    complianceManagerId,
    systemAdministratorId,
    outsiderId,
    templateVersionId,
    otherTemplateVersionId,
    itemIds,
    sectionIds,
    criticalActionId,
    verificationActionId,
    closedActionId,
  };
}

describe("Centre Quality & Performance authorised projection", () => {
  beforeAll(async () => {
    fixture = await createQualityFixture();
  });

  test("gives a Centre Director exactly one centre view and no other centre's facts", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.centreDirectorId, request: {} },
      { now },
    );
    expect(result.response.status).toBe("ready");
    expect(result.response.activeView).toMatchObject({ kind: "centre", centreId: fixture.centreIds[0] });
    expect(result.response.availableViews).toHaveLength(1);
    expect(result.response.centres.map((centre) => centre.centreId)).toEqual([fixture.centreIds[0]]);
    const serialised = JSON.stringify(result.response);
    expect(serialised).not.toContain(fixture.centreIds[1]);
    expect(serialised).not.toContain(fixture.centreIds[2]);
  });

  test("reports previous-quarter comparison only from two comparable finalised reviews", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.centreDirectorId, request: {} },
      { now },
    );
    const centre = result.response.centres[0];
    expect(centre.latestReview).toMatchObject({
      quarterLabel: "Q2 2035",
      reviewPeriodStart: "2035-04-01",
      overallScore: 91,
    });
    expect(centre.comparison).toMatchObject({
      available: true,
      comparable: true,
      trend: "IMPROVED",
      scoreDelta: 7,
      criticalDelta: -2,
    });
    expect(centre.comparison.previous).toMatchObject({ quarterLabel: "Q1 2035", overallScore: 84 });
  });

  test("surfaces critical, verification and completed corrective-action facts for the centre", async () => {
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.centreDirectorId, centreId: fixture.centreIds[0] },
      { now },
    );
    expect(detail.response.status).toBe("ready");
    expect(detail.response.centre.actions).toMatchObject({
      total: 2,
      critical: 1,
      awaitingVerification: 1,
      overdue: 0,
    });
    expect(detail.response.centre.uncoveredCriticalFindings).toBe(1);
    expect(detail.response.centre.focus).toBe("NEEDS_SUPPORT");
    expect(detail.response.centre.focusReason).toContain("critical review finding");

    const ids = detail.response.openActions.map((action) => action.correctiveActionId);
    expect(ids).toEqual([fixture.criticalActionId, fixture.verificationActionId]);
    expect(detail.response.completedActions.map((action) => action.correctiveActionId)).toEqual([
      fixture.closedActionId,
    ]);
    expect(detail.response.uncoveredFindings).toHaveLength(1);
    expect(detail.response.strengths[0]?.description).toContain("calm transitions");
  });

  test("shows where a centre is strong and where to focus, from stored section results", async () => {
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.centreDirectorId, centreId: fixture.centreIds[0] },
      { now },
    );
    // Focus areas first, then template order: documentation (72 < 91 overall),
    // family engagement (unscored), learning environment (98 >= 91).
    expect(detail.response.sectionResults.map((section) => section.title)).toEqual([
      "Centre documentation",
      "Family engagement",
      "Learning environment",
    ]);
    expect(detail.response.sectionResults[0]).toMatchObject({
      standing: "FOCUS",
      score: 72,
      previousScore: 68,
      scoreDelta: 4,
      trend: "IMPROVED",
      coveragePercent: 100,
    });
    expect(detail.response.sectionResults[2]).toMatchObject({
      standing: "STRONG",
      score: 98,
      trend: "IMPROVED",
    });
  });

  test("reports an unscored section as not scored and states its observed coverage", async () => {
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.centreDirectorId, centreId: fixture.centreIds[0] },
      { now },
    );
    const unscored = detail.response.sectionResults.find(
      (section) => section.title === "Family engagement",
    );
    expect(unscored).toMatchObject({ standing: "NOT_SCORED", coveragePercent: 40 });
    expect(unscored?.score).toBeUndefined();
    expect(unscored?.scoreDelta).toBeUndefined();
    expect(unscored?.trend).toBe("NOT_COMPARABLE");
  });

  test("omits section movement when the previous quarter used a different template", async () => {
    const isolated = await createQualityFixture();
    const latestRun = await finalisedRun(
      isolated.organisationId, isolated.centreIds[2], isolated.areaManagerId,
      isolated.templateVersionId, "2035-04-01", { overallScore: 90 },
    );
    await finalisedRun(
      isolated.organisationId, isolated.centreIds[2], isolated.areaManagerId,
      isolated.otherTemplateVersionId, "2035-01-01", { overallScore: 60 },
    );
    for (const [index, id] of isolated.sectionIds.entries()) {
      await centreSuccessDB.exec`
        INSERT INTO audit_section_results (
          organisation_id, audit_run_id, section_id,
          eligible_weight, achieved_weight, score, coverage_percent
        ) VALUES (
          ${isolated.organisationId}, ${latestRun}, ${id}, 1, 1, ${88 + index}, 100
        )
      `;
    }
    const detail = await buildCentreQualityDetail(
      { principalId: isolated.areaManagerId, centreId: isolated.centreIds[2] },
      { now },
    );
    // Both quarters are finalised, but the earlier one used a superseded
    // template version, so no section movement may be claimed.
    expect(detail.response.reviewHistory).toHaveLength(2);
    expect(detail.response.centre.comparison).toMatchObject({
      available: true,
      comparable: false,
      trend: "NOT_COMPARABLE",
    });
    expect(detail.response.sectionResults.length).toBeGreaterThan(0);
    for (const section of detail.response.sectionResults) {
      expect(section.score).toBeDefined();
      expect(section.previousScore).toBeUndefined();
      expect(section.scoreDelta).toBeUndefined();
      expect(section.trend).toBe("NOT_COMPARABLE");
    }
  });

  test("returns no section results for a centre with no finalised review", async () => {
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[2] },
      { now },
    );
    expect(detail.response.sectionResults).toEqual([]);
    expect(detail.response.centre.focus).toBe("AWAITING_FIRST_REVIEW");
  });

  test("exposes no section result to a principal without quarterly audit read", async () => {
    await expect(
      buildCentreQualityDetail(
        { principalId: fixture.systemAdministratorId, centreId: fixture.centreIds[0] },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("preserves verification independence for the principal who submitted remediation", async () => {
    const director = await buildCentreQualityDetail(
      { principalId: fixture.centreDirectorId, centreId: fixture.centreIds[0] },
      { now },
    );
    const asDirector = director.response.openActions.find(
      (action) => action.correctiveActionId === fixture.verificationActionId,
    );
    expect(asDirector?.responsibility).toBe("WAITING_ON_SOMEONE_ELSE");

    const areaManager = await buildCentreQualityDetail(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[0] },
      { now },
    );
    const asAreaManager = areaManager.response.openActions.find(
      (action) => action.correctiveActionId === fixture.verificationActionId,
    );
    expect(asAreaManager?.responsibility).toBe("YOU_NEED_TO_ACT");
    expect(asAreaManager?.cta.route).toBe(`/area-manager/verification/${fixture.verificationActionId}`);
  });

  test("gives an Area Manager the whole authorised portfolio grouped for coaching, not ranked", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    expect(result.response.status).toBe("ready");
    expect(result.response.centres).toHaveLength(3);
    // Grouped by the support a centre needs, then alphabetically inside the
    // group: Zephyr (needs support), Belmore (no review yet), Ashgrove (steady).
    expect(result.response.centres.map((centre) => centre.centreName)).toEqual([
      "Zephyr Quality Centre",
      "Belmore Quality Centre",
      "Ashgrove Quality Centre",
    ]);
    expect(result.response.centres.map((centre) => centre.centreId)).toEqual([
      fixture.centreIds[0],
      fixture.centreIds[2],
      fixture.centreIds[1],
    ]);
    expect(result.response.focusGroups.map((group) => group.focus)).toEqual([
      "NEEDS_SUPPORT",
      "AWAITING_FIRST_REVIEW",
      "STEADY",
    ]);
    expect(result.response.summary).toMatchObject({
      coverage: "complete",
      centreCount: 3,
      needsSupportCount: 1,
      steadyCount: 1,
      awaitingFirstReviewCount: 1,
      awaitingVerificationCount: 1,
    });
  });

  test("distinguishes an empty centre from a steady centre rather than inventing data", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    const steady = result.response.centres.find((centre) => centre.centreId === fixture.centreIds[1]);
    expect(steady).toMatchObject({ focus: "STEADY" });
    expect(steady?.latestReview).toMatchObject({ quarterLabel: "Q2 2035", overallScore: 96 });
    expect(steady?.comparison).toMatchObject({ available: false, trend: "NOT_COMPARABLE" });
    expect(steady?.comparison.scoreDelta).toBeUndefined();

    const empty = result.response.centres.find((centre) => centre.centreId === fixture.centreIds[2]);
    expect(empty).toMatchObject({ focus: "AWAITING_FIRST_REVIEW", strengthsCount: 0 });
    expect(empty?.latestReview).toBeUndefined();
    expect(empty?.comparison).toEqual({
      available: false,
      comparable: false,
      trend: "NOT_COMPARABLE",
    });
    expect(empty?.actions).toMatchObject({ total: 0, critical: 0, overdue: 0 });
  });

  test("gives a Compliance Manager organisation-wide oversight of the same source facts", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.complianceManagerId, request: { view: "organisation" } },
      { now },
    );
    expect(result.response.activeView).toMatchObject({ kind: "organisation" });
    expect(result.response.centres).toHaveLength(3);
    // One open critical corrective action plus one uncovered critical finding.
    expect(result.response.summary.openCriticalCount).toBe(2);
    expect(result.response.summary).toMatchObject({ coverage: "complete", centreCount: 3 });
  });

  test("asks a multi-capability principal to choose rather than guessing a view", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.complianceManagerId, request: {} },
      { now },
    );
    // The canonical Compliance Manager also holds corrective_action.verify, so
    // both an organisation and a portfolio view are genuinely authorised.
    expect(result.response.status).toBe("selection_required");
    expect(result.response.activeView).toBeUndefined();
    expect(result.response.availableViews.map((view) => view.kind).sort()).toEqual([
      "organisation",
      "portfolio",
    ]);
    expect(result.response.centres).toEqual([]);
  });

  test("gives a System Administrator no business quality projection at all", async () => {
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.systemAdministratorId, request: {} },
      { now },
    );
    expect(result.response.status).toBe("unsupported");
    expect(result.response.availableViews).toEqual([]);
    expect(result.response.centres).toEqual([]);
    const serialised = JSON.stringify(result.response);
    for (const centreId of fixture.centreIds) expect(serialised).not.toContain(centreId);

    await expect(
      buildCentreQualityDetail(
        { principalId: fixture.systemAdministratorId, centreId: fixture.centreIds[0] },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("denies a centre the principal is not currently authorised for", async () => {
    await expect(
      buildCentreQualityDetail(
        { principalId: fixture.centreDirectorId, centreId: fixture.centreIds[1] },
        { now },
      ),
    ).rejects.toBeInstanceOf(CentreQualityError);
    await expect(
      buildCentreQualityWorkspace(
        { principalId: fixture.centreDirectorId, request: { view: "centre", centreId: fixture.centreIds[1] } },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("denies a principal holding no quality capability for the centre", async () => {
    await expect(
      buildCentreQualityDetail(
        { principalId: fixture.outsiderId, centreId: fixture.centreIds[2] },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test.each([
    ["not-a-uuid"],
    ["../../etc/passwd"],
    ["00000000-0000-0000-0000-000000000000"],
    ["11111111-1111-4111-8111-111111111111' OR '1'='1"],
  ])("rejects the malformed or unknown centre identifier %s safely", async (centreId) => {
    await expect(
      buildCentreQualityDetail({ principalId: fixture.areaManagerId, centreId }, { now }),
    ).rejects.toBeInstanceOf(CentreQualityError);
  });

  test("never accepts a client-supplied centre outside the authorised view", async () => {
    const foreignOrganisation = await createQualityFixture();
    await expect(
      buildCentreQualityDetail(
        { principalId: fixture.areaManagerId, centreId: foreignOrganisation.centreIds[0] },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const result = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    expect(JSON.stringify(result.response)).not.toContain(foreignOrganisation.centreIds[0]);
  });

  test("reflects a removed assignment on the very next request", async () => {
    const temporary = await createQualityFixture();
    const before = await buildCentreQualityWorkspace(
      { principalId: temporary.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    expect(before.response.centres).toHaveLength(3);
    await centreSuccessDB.exec`
      UPDATE role_assignments SET status = 'inactive'
      WHERE organisation_id = ${temporary.organisationId}
        AND organisation_membership_id IN (
          SELECT id FROM organisation_memberships
          WHERE organisation_id = ${temporary.organisationId}
            AND principal_id = ${temporary.areaManagerId}
        )
    `;
    const after = await buildCentreQualityWorkspace(
      { principalId: temporary.areaManagerId, request: {} },
      { now },
    );
    expect(after.response.status).toBe("unsupported");
    expect(after.response.centres).toEqual([]);
  });

  test("keeps the database query count constant for 1, 3 and 20 centre portfolios", async () => {
    const single = await buildCentreQualityWorkspace(
      { principalId: fixture.centreDirectorId, request: {} },
      { now },
    );
    const portfolio = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    const scale = await createQualityFixture(20);
    const large = await buildCentreQualityWorkspace(
      { principalId: scale.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    expect(large.response.centres).toHaveLength(20);
    // Authorization is evaluated in memory, so no centre adds a query.
    expect([
      single.diagnostics.queryCount,
      portfolio.diagnostics.queryCount,
      large.diagnostics.queryCount,
    ]).toEqual([14, 14, 14]);
  });

  test("keeps the centre detail query count constant regardless of portfolio size", async () => {
    const small = await buildCentreQualityDetail(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[0] },
      { now },
    );
    const scale = await createQualityFixture(20);
    const large = await buildCentreQualityDetail(
      { principalId: scale.areaManagerId, centreId: scale.centreIds[0] },
      { now },
    );
    expect(small.diagnostics.queryCount).toBe(large.diagnostics.queryCount);
    // 14 workspace queries plus the three centre-detail list queries.
    expect(small.diagnostics.queryCount).toBe(17);
  });

  test("orders centres and focus groups deterministically across repeated requests", async () => {
    const first = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    const second = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    expect(first.response.centres.map((centre) => centre.centreId)).toEqual(
      second.response.centres.map((centre) => centre.centreId),
    );
    expect(first.response.focusGroups).toEqual(second.response.focusGroups);
  });

  test("marks the response private and never caches it", async () => {
    const workspace = await buildCentreQualityWorkspace(
      { principalId: fixture.areaManagerId, request: { view: "portfolio" } },
      { now },
    );
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[0] },
      { now },
    );
    expect(workspace.response.cacheControl).toBe("private, no-store");
    expect(detail.response.cacheControl).toBe("private, no-store");
  });

  test("exposes no invitation, evidence filename, or identity claim in the projection", async () => {
    const detail = await buildCentreQualityDetail(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[0] },
      { now },
    );
    const serialised = JSON.stringify(detail.response);
    expect(serialised).not.toMatch(/invitation|evidence_item|@|oid|tid|token/iu);
    expect(serialised).not.toContain(fixture.centreDirectorId);
  });
});
