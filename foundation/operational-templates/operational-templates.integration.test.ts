import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import type { OperationalTemplateContentInput } from "./contracts";
import {
  assignOperationalTemplate,
  createOperationalTemplateDraft,
  getOperationalTemplateVersion,
  getOperationalTemplateWorkspace,
  listOperationalTemplateAssignmentOptions,
  listOperationalTemplates,
  previewOperationalTemplateDraft,
  publishOperationalTemplate,
  retireOperationalTemplate,
  updateOperationalTemplateDraft,
} from "./service";

const ORGANISATION = "f0201000-0000-4000-8000-000000000001";
const CENTRE = "f0201000-0000-4000-8000-000000000002";
const OTHER_CENTRE = "f0201000-0000-4000-8000-000000000003";
const AREA_MANAGER = "f0201000-0000-4000-8000-000000000004";
const SYSTEM_ADMINISTRATOR = "f0201000-0000-4000-8000-000000000005";
const DECISION_AT = new Date("2026-08-13T02:00:00.000Z");
const dependencies = { now: () => DECISION_AT };

let templateId: string;
let versionId: string;
let publishedLockVersion: number;

const content: OperationalTemplateContentInput = {
  title: "Opening readiness",
  instructions: "Complete this internal operational form before opening.",
  metadata: { owner: "operations", pilot: true },
  sections: [{
    title: "Readiness",
    instructions: "Record the current position.",
    order: 1,
    questions: [
      { label: "Opening note", order: 1, required: true, type: "short_text", maxLength: 120 },
      { label: "Detailed context", order: 2, required: false, type: "long_text", maxLength: 2_000 },
      {
        label: "Readiness state",
        order: 3,
        required: true,
        type: "single_choice",
        options: [{ value: "ready", label: "Ready" }, { value: "follow_up", label: "Needs follow-up" }],
      },
      {
        label: "Areas checked",
        order: 4,
        required: false,
        type: "multiple_choice",
        options: [{ value: "inside", label: "Inside" }, { value: "outside", label: "Outside" }],
      },
      { label: "Rooms ready", order: 5, required: true, type: "numeric", minimum: 0, maximum: 20 },
      { label: "Check time", order: 6, required: true, type: "time", earliest: "06:00", latest: "10:00" },
    ],
  }],
};

async function seedPrincipal(
  principalId: string,
  roleKey: "area_manager" | "system_administrator",
  centreId?: string,
): Promise<void> {
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${ORGANISATION}
      AND role_key = ${roleKey}
      AND status = 'active'
  `;
  if (!role) throw new Error(`role is unavailable: ${roleKey}`);
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${`Template test ${roleKey}`}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id, organisation_id, principal_id, status, effective_from
    ) VALUES (
      ${membershipId}, ${ORGANISATION}, ${principalId}, 'active', '2026-08-01'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${ORGANISATION}, ${membershipId}, ${role.id},
      'active', '2026-08-01', 'system', 'Synthetic operational-template integration test.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
    ) VALUES (
      ${randomUUID()}, ${ORGANISATION}, ${assignmentId},
      ${centreId ? "centre" : "organisation"}, ${centreId ?? null}, '2026-08-01'
    )
  `;
}

describe.sequential("Area Manager operational template builder", () => {
  beforeAll(async () => {
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${ORGANISATION}, 'Operational Template Test Organisation', 'active', 'Australia/Sydney')
    `;
    await centreSuccessDB.exec`
      INSERT INTO centres (
        id, organisation_id, code, name, jurisdiction_code, timezone, status
      ) VALUES
        (${CENTRE}, ${ORGANISATION}, 'TPL-SYD', 'Template Sydney Centre',
         'NSW', 'Australia/Sydney', 'active'),
        (${OTHER_CENTRE}, ${ORGANISATION}, 'TPL-BNE', 'Template Brisbane Centre',
         'QLD', 'Australia/Brisbane', 'active')
    `;
    await seedPrincipal(AREA_MANAGER, "area_manager", CENTRE);
    await seedPrincipal(SYSTEM_ADMINISTRATOR, "system_administrator");
  });

  test("creates, edits, previews, and publishes a typed draft through the existing template lineage", async () => {
    const created = await createOperationalTemplateDraft({
      principalId: AREA_MANAGER,
      request: content,
    }, dependencies);
    templateId = created.templateId;
    expect(created.lifecycle).toBe("DRAFT");
    expect(created.sections[0].questions).toHaveLength(6);

    const updated = await updateOperationalTemplateDraft({
      principalId: AREA_MANAGER,
      request: {
        ...content,
        templateId,
        lockVersion: created.lockVersion,
        title: "Opening readiness form",
        sections: created.sections.map((section) => ({
          id: section.id,
          title: section.title,
          ...(section.instructions ? { instructions: section.instructions } : {}),
          order: section.order,
          questions: section.questions.map((question) => {
            const source = content.sections[0].questions.find((candidate) =>
              candidate.order === question.order)!;
            return { ...source, id: question.id };
          }),
        })),
      },
    }, dependencies);
    expect(updated.lockVersion).toBe(2);
    expect((await previewOperationalTemplateDraft({ principalId: AREA_MANAGER, templateId })).title)
      .toBe("Opening readiness form");

    const published = await publishOperationalTemplate({
      principalId: AREA_MANAGER,
      request: { templateId, lockVersion: updated.lockVersion },
    }, dependencies);
    versionId = published.versionId;
    publishedLockVersion = updated.lockVersion + 1;
    expect(published).toMatchObject({
      templateId,
      versionNumber: 1,
      lifecycle: "PUBLISHED",
      sourceKind: "BSA_INTERNAL",
      authorId: AREA_MANAGER,
    });
    expect(published.sections[0].questions.map((question) => question.type)).toEqual([
      "short_text",
      "long_text",
      "single_choice",
      "multiple_choice",
      "numeric",
      "time",
    ]);
    const publishedState = await centreSuccessDB.queryRow<{
      template_status: string;
      version_status: string;
      published_at: Date | null;
      published_by_principal_id: string | null;
    }>`
      SELECT template.status AS template_status, version.status AS version_status,
             version.published_at, version.published_by_principal_id
      FROM audit_templates AS template
      JOIN audit_template_versions AS version
        ON version.organisation_id = template.organisation_id
       AND version.audit_template_id = template.id
      WHERE template.organisation_id = ${ORGANISATION}
        AND template.id = ${templateId}
        AND version.id = ${versionId}
    `;
    expect(publishedState).toMatchObject({
      template_status: "active",
      version_status: "active",
      published_by_principal_id: AREA_MANAGER,
    });
    expect(publishedState?.published_at).toEqual(DECISION_AT);
    await expect(getOperationalTemplateVersion({
      principalId: AREA_MANAGER,
      templateId,
      versionId,
    })).resolves.toMatchObject({ versionId, versionNumber: 1 });

    const events = await centreSuccessDB.queryAll<{ action: string; actor_principal_id: string | null }>`
      SELECT action, actor_principal_id
      FROM system_audit_events
      WHERE organisation_id = ${ORGANISATION}
        AND resource_id IN (${templateId}, ${versionId})
      ORDER BY occurred_at, id
    `;
    expect(events).toEqual(expect.arrayContaining([
      { action: "operational_template.draft_created", actor_principal_id: AREA_MANAGER },
      { action: "operational_template.draft_updated", actor_principal_id: AREA_MANAGER },
      { action: "operational_template.published", actor_principal_id: AREA_MANAGER },
    ]));
  });

  test("database constraints keep a published version and its content immutable", async () => {
    await expect(centreSuccessDB.exec`
      UPDATE audit_template_versions SET title = 'Mutated title' WHERE id = ${versionId}
    `).rejects.toThrow(/released audit template versions are immutable/u);
    const section = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM audit_template_sections WHERE template_version_id = ${versionId} LIMIT 1
    `;
    const item = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM audit_template_items WHERE template_version_id = ${versionId} LIMIT 1
    `;
    await expect(centreSuccessDB.exec`
      UPDATE audit_template_sections SET title = 'Mutated section' WHERE id = ${section!.id}
    `).rejects.toThrow(/released audit template content is immutable/u);
    await expect(centreSuccessDB.exec`
      DELETE FROM audit_template_items WHERE id = ${item!.id}
    `).rejects.toThrow(/released audit template content is immutable/u);
  });

  test("assigns DAILY scheduling only to an authorised centre and pins its timezone", async () => {
    const assigned = await assignOperationalTemplate({
      principalId: AREA_MANAGER,
      request: {
        templateId,
        versionId,
        target: { kind: "CENTRES", centreIds: [CENTRE] },
        schedule: {
          frequency: "DAILY",
          opensLocalTime: "07:00",
          dueLocalTime: "09:00",
          effectiveFrom: "2026-08-14",
        },
      },
    }, dependencies);
    expect(assigned).toMatchObject({
      centreCount: 1,
      frequency: "DAILY",
      deployments: [{ centreId: CENTRE, centreTimezone: "Australia/Sydney" }],
    });
    const schedule = await centreSuccessDB.queryRow<{
      frequency: string;
      centre_timezone: string;
      deployment_status: string;
    }>`
      SELECT schedule.frequency, schedule.centre_timezone,
             deployment.status AS deployment_status
      FROM operational_standard_schedule_revisions AS schedule
      JOIN operational_standard_deployments AS deployment
        ON deployment.organisation_id = schedule.organisation_id
       AND deployment.centre_id = schedule.centre_id
       AND deployment.id = schedule.deployment_id
      WHERE schedule.id = ${assigned.deployments[0].scheduleRevisionId}
    `;
    expect(schedule).toEqual({
      frequency: "DAILY",
      centre_timezone: "Australia/Sydney",
      deployment_status: "ACTIVE",
    });

    const before = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count FROM operational_template_assignments
      WHERE organisation_id = ${ORGANISATION}
    `;
    await expect(assignOperationalTemplate({
      principalId: AREA_MANAGER,
      request: {
        templateId,
        versionId,
        target: { kind: "CENTRES", centreIds: [OTHER_CENTRE] },
        schedule: {
          frequency: "DAILY",
          opensLocalTime: "07:00",
          dueLocalTime: "09:00",
          effectiveFrom: "2026-08-14",
        },
      },
    }, dependencies)).rejects.toMatchObject({ code: "access_denied" });
    const after = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count FROM operational_template_assignments
      WHERE organisation_id = ${ORGANISATION}
    `;
    expect(after?.count).toBe(before?.count);
  });

  test("filters assignment visibility to the backend-authorised portfolio and denies technical admin", async () => {
    const library = await listOperationalTemplates({ principalId: AREA_MANAGER, request: {} });
    expect(library.assignmentFilter).toEqual({ kind: "PORTFOLIO" });
    expect(library.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        templateId,
        lifecycle: "PUBLISHED",
        assignedCentres: [{ centreId: CENTRE, centreName: "Template Sydney Centre" }],
      }),
    ]));
    await expect(listOperationalTemplates({
      principalId: AREA_MANAGER,
      request: { centreId: OTHER_CENTRE },
    })).rejects.toMatchObject({ code: "access_denied" });
    await expect(listOperationalTemplates({
      principalId: SYSTEM_ADMINISTRATOR,
      request: {},
    })).rejects.toMatchObject({ code: "access_denied" });
  });

  test("retires attributable lifecycle state without mutating published history", async () => {
    const retired = await retireOperationalTemplate({
      principalId: AREA_MANAGER,
      request: { templateId, lockVersion: publishedLockVersion },
    }, dependencies);
    expect(retired).toEqual({ templateId, lifecycle: "RETIRED", lockVersion: publishedLockVersion + 1 });
    await expect(getOperationalTemplateVersion({
      principalId: AREA_MANAGER,
      templateId,
      versionId,
    })).resolves.toMatchObject({ lifecycle: "RETIRED", versionNumber: 1 });
    const state = await centreSuccessDB.queryRow<{
      template_status: string;
      deployment_status: string;
      version_status: string;
      retired_at: Date;
      retired_by_principal_id: string;
      published_title: string;
    }>`
      SELECT template.status AS template_status, deployment.status AS deployment_status,
             version.status AS version_status, template.retired_at,
             template.retired_by_principal_id, version.title AS published_title
      FROM audit_templates AS template
      JOIN audit_template_versions AS version
        ON version.organisation_id = template.organisation_id
       AND version.audit_template_id = template.id
       AND version.id = ${versionId}
      JOIN operational_standard_deployments AS deployment
        ON deployment.organisation_id = template.organisation_id
       AND deployment.template_version_id = version.id
      WHERE template.id = ${templateId}
    `;
    expect(state).toEqual({
      template_status: "inactive",
      deployment_status: "INACTIVE",
      version_status: "active",
      retired_at: DECISION_AT,
      retired_by_principal_id: AREA_MANAGER,
      published_title: "Opening readiness form",
    });
    await expect(centreSuccessDB.exec`
      UPDATE operational_standard_deployments
      SET status = 'ACTIVE', updated_at = ${new Date(DECISION_AT.getTime() + 60_000)},
          lock_version = lock_version + 1
      WHERE organisation_id = ${ORGANISATION}
        AND template_version_id = ${versionId}
    `).rejects.toThrow(/cannot be reactivated/u);
  });

  test("opens one template as a workspace carrying its draft and permanent version history", async () => {
    const workspace = await getOperationalTemplateWorkspace({
      principalId: AREA_MANAGER,
      templateId,
    });
    expect(workspace).toMatchObject({
      templateId,
      lifecycle: "RETIRED",
      versions: [
        expect.objectContaining({
          versionId,
          versionNumber: 1,
          lifecycle: "PUBLISHED",
          authorId: AREA_MANAGER,
        }),
      ],
    });
    // Retiring the template must not erase the version that produced its
    // historical occurrences.
    expect(workspace.draft).toBeDefined();
    await expect(getOperationalTemplateWorkspace({
      principalId: SYSTEM_ADMINISTRATOR,
      templateId,
    })).rejects.toMatchObject({ code: "access_denied" });
  });

  test("offers only the centres the backend authorises, and omits the notice when the list is complete", async () => {
    const options = await listOperationalTemplateAssignmentOptions({
      principalId: AREA_MANAGER,
    });
    // Exact equality also proves `incompleteNotice` is absent rather than
    // empty: a complete list must never carry a doubt marker, and an
    // incomplete one must never read as complete.
    expect(options).toEqual({
      centres: [{ centreId: CENTRE, centreName: "Template Sydney Centre" }],
      portfolioAvailable: true,
      portfolioCentreCount: 1,
    });
    expect(options.centres).not.toContainEqual(
      expect.objectContaining({ centreId: OTHER_CENTRE }),
    );
    await expect(listOperationalTemplateAssignmentOptions({
      principalId: SYSTEM_ADMINISTRATOR,
    })).rejects.toMatchObject({ code: "access_denied" });
  });

  test("keeps the editable draft after publication, so the next version starts from it", async () => {
    const workspace = await getOperationalTemplateWorkspace({
      principalId: AREA_MANAGER,
      templateId,
    });
    // Publishing snapshots the draft into an immutable version; it does not
    // consume it. Editing a published template updates this same draft, and
    // publishing again produces the next version. That is why the database
    // refuses to delete a draft outright, and why no separate
    // "start a draft from a version" operation is needed.
    expect(workspace.draft).toMatchObject({
      templateId,
      lockVersion: expect.any(Number),
    });
    await expect(centreSuccessDB.exec`
      DELETE FROM operational_template_drafts
      WHERE organisation_id = ${ORGANISATION} AND template_id = ${templateId}
    `).rejects.toThrow(/drafts cannot be deleted/u);
    await expect(getOperationalTemplateVersion({
      principalId: AREA_MANAGER,
      templateId,
      versionId,
    })).resolves.toMatchObject({ versionNumber: 1, lifecycle: "RETIRED" });
  });
});
