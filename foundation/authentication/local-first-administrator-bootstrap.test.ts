import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContext } from "../authorization/context-loader";
import { authorise } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import {
  bootstrapLocalFirstAdministrator,
  LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS,
} from "./local-first-administrator-bootstrap";

const LOCAL_DEPENDENCIES = {
  environment: {
    cloud: "local",
    name: "local",
    type: "development",
  } as const,
};

async function stableRowCounts(): Promise<Record<string, number>> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  const row = await centreSuccessDB.queryRow<Record<string, number>>`
    SELECT
      (SELECT count(*)::integer FROM organisations
       WHERE id = ${ids.organisationId}) AS organisations,
      (SELECT count(*)::integer FROM principals
       WHERE id IN (${ids.operatorPrincipalId}, ${ids.targetPrincipalId})) AS principals,
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE id IN (${ids.operatorMembershipId}, ${ids.targetMembershipId})) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE id IN (${ids.operatorAssignmentId}, ${ids.targetAssignmentId})) AS assignments,
      (SELECT count(*)::integer FROM assignment_scopes
       WHERE id IN (${ids.operatorScopeId}, ${ids.targetScopeId})) AS scopes,
      (SELECT count(*)::integer FROM external_identity_mappings
       WHERE principal_id IN (
         ${ids.operatorPrincipalId},
         ${ids.targetPrincipalId}
       )) AS mappings
  `;

  if (row === null) {
    throw new Error("synthetic bootstrap count query returned no row");
  }
  return row;
}

describe("local first-System-Administrator bootstrap", () => {
  test("is reachable only through the Encore exec package command and defines no HTTP surface", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["identity:bootstrap:local"]).toBe(
      "encore exec -- npx --no-install tsx scripts/bootstrap-local-system-administrator.ts",
    );

    const script = readFileSync(
      new URL("../../scripts/bootstrap-local-system-administrator.ts", import.meta.url),
      "utf8",
    );
    expect(script).not.toContain("encore.dev/api");
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("JSON.stringify");
    expect(script.match(/console\.info\(/g)).toHaveLength(1);
    expect(script).toContain("organisation-id:\n${result.organisationId}");
    expect(script).toContain("principal-id:\n${result.targetPrincipalId}");
    expect(script).toContain(
      "operator-principal-id:\n${result.operatorPrincipalId}",
    );
  });

  test("refuses staging, preview, cloud, and local near-miss environments before mutation", async () => {
    const before = await stableRowCounts();
    const refusedEnvironments = [
      { cloud: "encore", name: "staging", type: "development" },
      { cloud: "encore", name: "pr-123", type: "ephemeral" },
      { cloud: "aws", name: "production", type: "production" },
      { cloud: "aws", name: "local", type: "development" },
      { cloud: "local", name: "staging", type: "development" },
      { cloud: "local", name: "local", type: "test" },
    ] as const;

    for (const environment of refusedEnvironments) {
      await expect(
        bootstrapLocalFirstAdministrator({ environment }),
      ).rejects.toThrow("local_environment_required");
      await expect(stableRowCounts()).resolves.toEqual(before);
    }
  });

  test("atomically creates the least-privilege synthetic facts and is idempotent", async () => {
    const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
    const expectedIds = {
      organisationId: ids.organisationId,
      operatorPrincipalId: ids.operatorPrincipalId,
      targetPrincipalId: ids.targetPrincipalId,
    };
    const [first, concurrent] = await Promise.all([
      bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
      bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
    ]);
    expect(first).toEqual(expectedIds);
    expect(concurrent).toEqual(expectedIds);
    expect(Object.keys(first).sort()).toEqual([
      "operatorPrincipalId",
      "organisationId",
      "targetPrincipalId",
    ]);

    const facts = await centreSuccessDB.queryRow<{
      organisation_name: string;
      operator_name: string;
      target_name: string;
      operator_membership_id: string;
      target_membership_id: string;
      role_key: string;
      source_template_key: string | null;
      operator_assignment_id: string;
      target_assignment_id: string;
      operator_grant_source_type: string;
      target_grant_source_type: string;
      operator_granted_by_principal_id: string | null;
      target_granted_by_principal_id: string | null;
      operator_scope_id: string;
      target_scope_id: string;
      operator_scope_type: string;
      target_scope_type: string;
    }>`
      SELECT
        organisation.name AS organisation_name,
        operator.display_name AS operator_name,
        target.display_name AS target_name,
        operator_membership.id AS operator_membership_id,
        target_membership.id AS target_membership_id,
        role.role_key,
        role.source_template_key,
        operator_assignment.id AS operator_assignment_id,
        target_assignment.id AS target_assignment_id,
        operator_assignment.grant_source_type AS operator_grant_source_type,
        target_assignment.grant_source_type AS target_grant_source_type,
        operator_assignment.granted_by_principal_id AS operator_granted_by_principal_id,
        target_assignment.granted_by_principal_id AS target_granted_by_principal_id,
        operator_scope.id AS operator_scope_id,
        target_scope.id AS target_scope_id,
        operator_scope.scope_type AS operator_scope_type,
        target_scope.scope_type AS target_scope_type
      FROM organisations AS organisation
      JOIN principals AS operator
        ON operator.id = ${ids.operatorPrincipalId}
      JOIN principals AS target
        ON target.id = ${ids.targetPrincipalId}
      JOIN organisation_memberships AS operator_membership
        ON operator_membership.id = ${ids.operatorMembershipId}
       AND operator_membership.organisation_id = organisation.id
       AND operator_membership.principal_id = operator.id
      JOIN organisation_memberships AS target_membership
        ON target_membership.id = ${ids.targetMembershipId}
       AND target_membership.organisation_id = organisation.id
       AND target_membership.principal_id = target.id
      JOIN role_assignments AS operator_assignment
        ON operator_assignment.id = ${ids.operatorAssignmentId}
       AND operator_assignment.organisation_id = organisation.id
       AND operator_assignment.organisation_membership_id = operator_membership.id
      JOIN role_assignments AS target_assignment
        ON target_assignment.id = ${ids.targetAssignmentId}
       AND target_assignment.organisation_id = organisation.id
       AND target_assignment.organisation_membership_id = target_membership.id
      JOIN role_definitions AS role
        ON role.id = operator_assignment.role_definition_id
       AND role.organisation_id = organisation.id
       AND role.id = target_assignment.role_definition_id
      JOIN assignment_scopes AS operator_scope
        ON operator_scope.id = ${ids.operatorScopeId}
       AND operator_scope.role_assignment_id = operator_assignment.id
       AND operator_scope.organisation_id = organisation.id
      JOIN assignment_scopes AS target_scope
        ON target_scope.id = ${ids.targetScopeId}
       AND target_scope.role_assignment_id = target_assignment.id
       AND target_scope.organisation_id = organisation.id
      WHERE organisation.id = ${ids.organisationId}
    `;
    expect(facts).toEqual({
      organisation_name: "Bright Steps Academy — Local Development",
      operator_name: "Local Bootstrap Operator",
      target_name: "Local System Administrator",
      operator_membership_id: ids.operatorMembershipId,
      target_membership_id: ids.targetMembershipId,
      role_key: "system_administrator",
      source_template_key: "system_administrator",
      operator_assignment_id: ids.operatorAssignmentId,
      target_assignment_id: ids.targetAssignmentId,
      operator_grant_source_type: "bootstrap",
      target_grant_source_type: "bootstrap",
      operator_granted_by_principal_id: null,
      target_granted_by_principal_id: null,
      operator_scope_id: ids.operatorScopeId,
      target_scope_id: ids.targetScopeId,
      operator_scope_type: "organisation",
      target_scope_type: "organisation",
    });

    const capabilities = await centreSuccessDB.queryAll<{ capability_code: string }>`
      SELECT capability.capability_code
      FROM role_assignments AS assignment
      JOIN role_capabilities AS capability
        ON capability.role_definition_id = assignment.role_definition_id
      WHERE assignment.id = ${ids.operatorAssignmentId}
      ORDER BY capability.capability_code
    `;
    expect(capabilities.map((row) => row.capability_code)).toEqual([
      "assignment.manage",
      "assignment.read",
      "identity.mapping.manage",
      "principal.manage",
      "principal.read",
      "system.configure",
      "system.health.read",
    ]);

    const decisionAt = new Date("2026-08-11T01:00:00.000Z");
    const resource = {
      kind: "organisation",
      organisationId: ids.organisationId,
    } as const;
    const operatorContext = await loadPrincipalAuthorisationContext({
      principalId: ids.operatorPrincipalId,
      activeOrganisationId: ids.organisationId,
      at: decisionAt,
    });
    expect(
      authorise({
        context: operatorContext,
        capability: FOUNDATION_CAPABILITIES.identityMappingManage,
        resource,
        at: decisionAt,
      }),
    ).toEqual({
      allowed: true,
      assignmentId: ids.operatorAssignmentId,
      roleKey: "system_administrator",
    });

    const targetContext = await loadPrincipalAuthorisationContext({
      principalId: ids.targetPrincipalId,
      activeOrganisationId: ids.organisationId,
      at: decisionAt,
    });
    expect(
      authorise({
        context: targetContext,
        capability: FOUNDATION_CAPABILITIES.systemConfigure,
        resource,
        at: decisionAt,
      }),
    ).toEqual({
      allowed: true,
      assignmentId: ids.targetAssignmentId,
      roleKey: "system_administrator",
    });
    expect(
      authorise({
        context: targetContext,
        capability: FOUNDATION_CAPABILITIES.centreRead,
        resource,
        at: decisionAt,
      }),
    ).toEqual({ allowed: false, reason: "capability_missing" });

    const targetAssignments = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM role_assignments
      WHERE organisation_membership_id = ${ids.targetMembershipId}
    `;
    expect(targetAssignments?.count).toBe(1);

    const mappings = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM external_identity_mappings
      WHERE principal_id IN (
        ${ids.operatorPrincipalId},
        ${ids.targetPrincipalId}
      )
    `;
    expect(mappings?.count).toBe(0);

    const audits = await centreSuccessDB.queryAll<{
      resource_id: string;
      actor_principal_id: string | null;
      context: Record<string, unknown>;
    }>`
      SELECT
        resource_id,
        actor_principal_id,
        context
      FROM system_audit_events
      WHERE action = 'identity.local_bootstrap.completed'
        AND resource_type = 'role_assignment'
        AND resource_id IN (
          ${ids.operatorAssignmentId},
          ${ids.targetAssignmentId}
        )
      ORDER BY resource_id
    `;
    expect(audits).toEqual([
      {
        resource_id: ids.operatorAssignmentId,
        actor_principal_id: null,
        context: {
          bootstrapVersion: 1,
          principalId: ids.operatorPrincipalId,
          principalKind: "operator",
          source: "local_operator_script",
        },
      },
      {
        resource_id: ids.targetAssignmentId,
        actor_principal_id: null,
        context: {
          bootstrapVersion: 1,
          principalId: ids.targetPrincipalId,
          principalKind: "target",
          source: "local_operator_script",
        },
      },
    ]);

    const beforeRepeat = await stableRowCounts();
    await expect(
      bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
    ).resolves.toEqual(expectedIds);
    await expect(stableRowCounts()).resolves.toEqual(beforeRepeat);

    const repeatedAuditCount = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM system_audit_events
      WHERE action = 'identity.local_bootstrap.completed'
        AND resource_type = 'role_assignment'
        AND resource_id IN (
          ${ids.operatorAssignmentId},
          ${ids.targetAssignmentId}
        )
    `;
    expect(repeatedAuditCount?.count).toBe(2);

    await centreSuccessDB.exec`
      UPDATE organisations
      SET name = 'Synthetic conflicting local organisation'
      WHERE id = ${ids.organisationId}
    `;
    try {
      await expect(
        bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
      ).rejects.toThrow("bootstrap_conflict");
    } finally {
      await centreSuccessDB.exec`
        UPDATE organisations
        SET name = 'Bright Steps Academy — Local Development'
        WHERE id = ${ids.organisationId}
      `;
    }
  });

  test("repairs canonical provisioning gaps but rejects altered grants, templates, and reserved names", async () => {
    const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
    await bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES);

    const educatorRole = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id
      FROM role_definitions
      WHERE organisation_id = ${ids.organisationId}
        AND role_key = 'educator'
    `;
    expect(educatorRole).not.toBeNull();
    await centreSuccessDB.exec`
      DELETE FROM role_capabilities
      WHERE role_definition_id = ${educatorRole?.id ?? ids.organisationId}
    `;
    await centreSuccessDB.exec`
      DELETE FROM role_definitions
      WHERE id = ${educatorRole?.id ?? ids.organisationId}
    `;
    await bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES);
    const repairedEducatorRole = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM role_definitions AS role
      JOIN role_capabilities AS capability
        ON capability.role_definition_id = role.id
       AND capability.capability_code = 'centre.read'
      WHERE role.organisation_id = ${ids.organisationId}
        AND role.role_key = 'educator'
        AND role.source_template_key = 'educator'
    `;
    expect(repairedEducatorRole?.count).toBe(1);

    const systemAdministratorRole = await centreSuccessDB.queryRow<{
      id: string;
    }>`
      SELECT id
      FROM role_definitions
      WHERE organisation_id = ${ids.organisationId}
        AND role_key = 'system_administrator'
    `;
    expect(systemAdministratorRole).not.toBeNull();
    await centreSuccessDB.exec`
      INSERT INTO role_capabilities (role_definition_id, capability_code)
      VALUES (
        ${systemAdministratorRole?.id ?? ids.organisationId},
        'centre.read'
      )
      ON CONFLICT DO NOTHING
    `;
    try {
      await expect(
        bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
      ).rejects.toThrow("canonical_role_unavailable");
    } finally {
      await centreSuccessDB.exec`
        DELETE FROM role_capabilities
        WHERE role_definition_id = ${systemAdministratorRole?.id ?? ids.organisationId}
          AND capability_code = 'centre.read'
      `;
    }

    await centreSuccessDB.exec`
      DELETE FROM canonical_role_template_capabilities
      WHERE role_key = 'system_administrator'
        AND role_version = 1
        AND capability_code = 'identity.mapping.manage'
    `;
    try {
      await expect(
        bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
      ).rejects.toThrow("canonical_role_unavailable");
    } finally {
      await centreSuccessDB.exec`
        INSERT INTO canonical_role_template_capabilities (
          role_key,
          role_version,
          capability_code
        ) VALUES ('system_administrator', 1, 'identity.mapping.manage')
        ON CONFLICT DO NOTHING
      `;
    }

    const collisionId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${collisionId}, 'Local Bootstrap Operator', 'active')
    `;
    try {
      await expect(
        bootstrapLocalFirstAdministrator(LOCAL_DEPENDENCIES),
      ).rejects.toThrow("bootstrap_conflict");
    } finally {
      await centreSuccessDB.exec`
        DELETE FROM principals
        WHERE id = ${collisionId}
      `;
    }
  });
});
