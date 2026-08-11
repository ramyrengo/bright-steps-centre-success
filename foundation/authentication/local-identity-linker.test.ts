import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import {
  assertLocalDevelopmentEnvironment,
  linkLocalEntraIdentity,
} from "./local-identity-linker";

const AT = new Date("2026-08-11T08:00:00.000Z");
const EFFECTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_DEPENDENCIES = {
  configuredTenantId: TENANT_ID,
  environment: {
    cloud: "local",
    name: "local",
    type: "development",
  } as const,
};

async function createOrganisation(label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${label}, 'active', 'Australia/Sydney')
  `;
  return id;
}

async function createPrincipalWithMembership(
  organisationId: string,
  label: string,
): Promise<{ principalId: string; membershipId: string }> {
  const principalId = randomUUID();
  const membershipId = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${label}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id,
      organisation_id,
      principal_id,
      status,
      effective_from
    ) VALUES (
      ${membershipId},
      ${organisationId},
      ${principalId},
      'active',
      ${EFFECTIVE_FROM}
    )
  `;

  return { principalId, membershipId };
}

async function grantIdentityMappingAdministration(
  organisationId: string,
  membershipId: string,
): Promise<void> {
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id
    FROM role_definitions
    WHERE organisation_id = ${organisationId}
      AND role_key = 'system_administrator'
      AND status = 'active'
  `;

  if (role === null) {
    throw new Error("synthetic System Administrator role was not provisioned");
  }

  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id,
      organisation_id,
      organisation_membership_id,
      role_definition_id,
      status,
      effective_from,
      grant_source_type,
      reason
    ) VALUES (
      ${assignmentId},
      ${organisationId},
      ${membershipId},
      ${role.id},
      'active',
      ${EFFECTIVE_FROM},
      'bootstrap',
      'Synthetic local-linker operator grant.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id,
      organisation_id,
      role_assignment_id,
      scope_type,
      effective_from
    ) VALUES (
      ${randomUUID()},
      ${organisationId},
      ${assignmentId},
      'organisation',
      ${EFFECTIVE_FROM}
    )
  `;
}

describe("local Microsoft Entra identity linker", () => {
  test("refuses every non-local-development environment", () => {
    expect(() =>
      assertLocalDevelopmentEnvironment({
        cloud: "encore",
        name: "production",
        type: "production",
      }),
    ).toThrow("local_environment_required");

    expect(() =>
      assertLocalDevelopmentEnvironment({
        cloud: "local",
        name: "local",
        type: "development",
      }),
    ).not.toThrow();
  });

  test("enforces local-only execution at the mutator boundary before any write", async () => {
    const oid = randomUUID();

    await expect(
      linkLocalEntraIdentity(
        {
          tenantId: TENANT_ID,
          oid,
          principalId: randomUUID(),
          organisationId: randomUUID(),
          operatorPrincipalId: randomUUID(),
          reason: "A non-local caller must never reach database mutation.",
          at: AT,
        },
        {
          configuredTenantId: TENANT_ID,
          environment: {
            cloud: "encore",
            name: "production",
            type: "production",
          },
        },
      ),
    ).rejects.toThrow("local_environment_required");

    const mappingCount = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM external_identity_mappings
      WHERE provider_key = ${`microsoft_entra:${TENANT_ID}`}
        AND provider_subject = ${oid}
    `;
    expect(mappingCount?.count).toBe(0);
  });

  test("links an existing synthetic principal atomically and records one minimal audit event", async () => {
    const organisationId = await createOrganisation("Local linker organisation");
    const operator = await createPrincipalWithMembership(
      organisationId,
      "Synthetic identity operator",
    );
    const target = await createPrincipalWithMembership(
      organisationId,
      "Synthetic Entra target",
    );
    await grantIdentityMappingAdministration(
      organisationId,
      operator.membershipId,
    );
    const oid = randomUUID();
    const input = {
      tenantId: TENANT_ID,
      oid,
      principalId: target.principalId,
      organisationId,
      operatorPrincipalId: operator.principalId,
      reason: "Connect the approved synthetic local test account.",
      at: AT,
    };

    const linked = await linkLocalEntraIdentity(input, LOCAL_DEPENDENCIES);
    expect(linked.outcome).toBe("linked");

    const mapping = await centreSuccessDB.queryRow<{
      principal_id: string;
      provider_key: string;
      provider_subject: string;
      status: string;
    }>`
      SELECT principal_id, provider_key, provider_subject, status
      FROM external_identity_mappings
      WHERE id = ${linked.mappingId}
    `;
    expect(mapping).toEqual({
      principal_id: target.principalId,
      provider_key: `microsoft_entra:${TENANT_ID}`,
      provider_subject: oid,
      status: "active",
    });

    const audit = await centreSuccessDB.queryRow<{
      actor_principal_id: string | null;
      action: string;
      resource_id: string | null;
      scope_id: string | null;
      context: Record<string, unknown>;
    }>`
      SELECT actor_principal_id, action, resource_id, scope_id, context
      FROM system_audit_events
      WHERE resource_type = 'external_identity_mapping'
        AND resource_id = ${linked.mappingId}
    `;
    expect(audit).toEqual({
      actor_principal_id: operator.principalId,
      action: "identity.mapping.linked",
      resource_id: linked.mappingId,
      scope_id: target.principalId,
      context: {
        provider: "microsoft_entra",
        source: "local_operator_script",
        reason: "Connect the approved synthetic local test account.",
      },
    });
    expect(JSON.stringify(audit)).not.toContain(oid);
    expect(JSON.stringify(audit)).not.toContain(TENANT_ID);

    const repeated = await linkLocalEntraIdentity(input, LOCAL_DEPENDENCIES);
    expect(repeated).toEqual({
      mappingId: linked.mappingId,
      outcome: "already_linked",
    });

    const eventCount = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM system_audit_events
      WHERE resource_type = 'external_identity_mapping'
        AND resource_id = ${linked.mappingId}
    `;
    expect(eventCount?.count).toBe(1);
  });

  test("denies an operator without identity-mapping authority and does not write", async () => {
    const organisationId = await createOrganisation("Denied linker organisation");
    const operator = await createPrincipalWithMembership(
      organisationId,
      "Synthetic unauthorised operator",
    );
    const target = await createPrincipalWithMembership(
      organisationId,
      "Synthetic denied target",
    );
    const oid = randomUUID();

    await expect(
      linkLocalEntraIdentity(
        {
          tenantId: TENANT_ID,
          oid,
          principalId: target.principalId,
          organisationId,
          operatorPrincipalId: operator.principalId,
          reason: "This operator has no approved mapping capability.",
          at: AT,
        },
        LOCAL_DEPENDENCIES,
      ),
    ).rejects.toThrow("operator_not_authorised");

    const mappingCount = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM external_identity_mappings
      WHERE provider_key = ${`microsoft_entra:${TENANT_ID}`}
        AND provider_subject = ${oid}
    `;
    expect(mappingCount?.count).toBe(0);
  });

  test("fails closed when an oid is already mapped to another principal", async () => {
    const organisationId = await createOrganisation("Conflicting linker organisation");
    const operator = await createPrincipalWithMembership(
      organisationId,
      "Synthetic conflict operator",
    );
    const firstTarget = await createPrincipalWithMembership(
      organisationId,
      "Synthetic first Entra target",
    );
    const conflictingTarget = await createPrincipalWithMembership(
      organisationId,
      "Synthetic conflicting Entra target",
    );
    await grantIdentityMappingAdministration(
      organisationId,
      operator.membershipId,
    );
    const oid = randomUUID();
    const common = {
      tenantId: TENANT_ID,
      oid,
      organisationId,
      operatorPrincipalId: operator.principalId,
      reason: "Exercise the local linker conflict boundary.",
      at: AT,
    };

    const first = await linkLocalEntraIdentity(
      { ...common, principalId: firstTarget.principalId },
      LOCAL_DEPENDENCIES,
    );
    await expect(
      linkLocalEntraIdentity(
        { ...common, principalId: conflictingTarget.principalId },
        LOCAL_DEPENDENCIES,
      ),
    ).rejects.toThrow("mapping_conflict");

    const mapping = await centreSuccessDB.queryRow<{ principal_id: string }>`
      SELECT principal_id
      FROM external_identity_mappings
      WHERE id = ${first.mappingId}
    `;
    expect(mapping?.principal_id).toBe(firstTarget.principalId);
  });

  test("rejects an operator-supplied tenant that differs from configured trust", async () => {
    await expect(
      linkLocalEntraIdentity(
        {
          tenantId: "55555555-5555-4555-8555-555555555555",
          oid: randomUUID(),
          principalId: randomUUID(),
          organisationId: randomUUID(),
          operatorPrincipalId: randomUUID(),
          reason: "Tenant mismatch must fail before database work.",
          at: AT,
        },
        LOCAL_DEPENDENCIES,
      ),
    ).rejects.toThrow("invalid_input");
  });
});
