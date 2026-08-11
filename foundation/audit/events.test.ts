import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { recordAuditEvent, type RecordAuditEventInput } from "./events";

async function createOrganisation(label: string): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${label}, 'active', 'Australia/Sydney')
  `;

  return id;
}

async function createCentre(
  organisationId: string,
  label: string,
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO centres (
      id,
      organisation_id,
      code,
      name,
      jurisdiction_code,
      timezone,
      status
    ) VALUES (
      ${id},
      ${organisationId},
      ${id.slice(0, 12)},
      ${label},
      'NSW',
      'Australia/Sydney',
      'active'
    )
  `;

  return id;
}

async function createPrincipalMembership(
  organisationId: string,
): Promise<string> {
  const principalId = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, 'Synthetic audit actor', 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id,
      organisation_id,
      principal_id,
      status
    ) VALUES (${randomUUID()}, ${organisationId}, ${principalId}, 'active')
  `;

  return principalId;
}

describe("system audit events", () => {
  test("records a system-scoped event with safe context", async () => {
    const recorded = await recordAuditEvent({
      action: "foundation.configuration.verified",
      resourceType: "system.configuration",
      scopeType: "system",
      correlationId: "synthetic-test-correlation",
      context: { source: "automated_test", available: true },
    });

    const stored = await centreSuccessDB.queryRow<{
      action: string;
      resource_type: string;
      scope_type: string;
      correlation_id: string | null;
      context: Record<string, unknown>;
    }>`
      SELECT action, resource_type, scope_type, correlation_id, context
      FROM system_audit_events
      WHERE id = ${recorded.id}
    `;

    expect(stored).toEqual({
      action: "foundation.configuration.verified",
      resource_type: "system.configuration",
      scope_type: "system",
      correlation_id: "synthetic-test-correlation",
      context: { source: "automated_test", available: true },
    });
  });

  test("rejects non-canonical event names before writing", async () => {
    await expect(
      recordAuditEvent({
        action: "Contains spaces",
        resourceType: "system.health",
        scopeType: "system",
      }),
    ).rejects.toThrow("audit action must use a safe canonical name");
  });

  test("database rejects mutation of an appended event", async () => {
    const recorded = await recordAuditEvent({
      action: "foundation.policy.checked",
      resourceType: "authorisation.decision",
      scopeType: "system",
    });

    await expect(
      centreSuccessDB.exec`
        UPDATE system_audit_events
        SET action = 'foundation.policy.changed'
        WHERE id = ${recorded.id}
      `,
    ).rejects.toThrow("system audit events are append-only");

    const stored = await centreSuccessDB.queryRow<{ action: string }>`
      SELECT action
      FROM system_audit_events
      WHERE id = ${recorded.id}
    `;

    expect(stored?.action).toBe("foundation.policy.checked");

    await expect(
      centreSuccessDB.exec`
        DELETE FROM system_audit_events
        WHERE id = ${recorded.id}
      `,
    ).rejects.toThrow("system audit events are append-only");

    const retained = await centreSuccessDB.queryRow<{ event_count: number }>`
      SELECT count(*)::integer AS event_count
      FROM system_audit_events
      WHERE id = ${recorded.id}
    `;

    expect(retained?.event_count).toBe(1);
  });

  test("records a centre event only when scope belongs to its organisation", async () => {
    const organisationA = await createOrganisation("Synthetic organisation A");
    const organisationB = await createOrganisation("Synthetic organisation B");
    const centreA = await createCentre(organisationA, "Synthetic centre A");
    const centreB = await createCentre(organisationB, "Synthetic centre B");
    const organisationAActor = await createPrincipalMembership(organisationA);

    const recorded = await recordAuditEvent({
      organisationId: organisationA,
      actorPrincipalId: organisationAActor,
      action: "foundation.centre.checked",
      resourceType: "centre",
      resourceId: centreA,
      scopeType: "centre",
      scopeId: centreA,
      correlationId: "synthetic-centre-correlation",
      context: { source: "authorization_integration_test", allowed: true },
    });

    const stored = await centreSuccessDB.queryRow<{
      organisation_id: string | null;
      actor_principal_id: string | null;
      action: string;
      resource_type: string;
      resource_id: string | null;
      scope_id: string | null;
      correlation_id: string | null;
      context: Record<string, unknown>;
    }>`
      SELECT
        organisation_id,
        actor_principal_id,
        action,
        resource_type,
        resource_id,
        scope_id,
        correlation_id,
        context
      FROM system_audit_events
      WHERE id = ${recorded.id}
    `;

    expect(stored).toEqual({
      organisation_id: organisationA,
      actor_principal_id: organisationAActor,
      action: "foundation.centre.checked",
      resource_type: "centre",
      resource_id: centreA,
      scope_id: centreA,
      correlation_id: "synthetic-centre-correlation",
      context: { source: "authorization_integration_test", allowed: true },
    });

    await expect(
      recordAuditEvent({
        organisationId: organisationA,
        action: "foundation.centre.checked",
        resourceType: "centre",
        resourceId: centreB,
        scopeType: "centre",
        scopeId: centreB,
      }),
    ).rejects.toThrow(
      "audit centre scope does not belong to organisation",
    );

    await expect(
      recordAuditEvent({
        organisationId: organisationA,
        action: "foundation.centre.checked",
        resourceType: "centre",
        resourceId: centreB,
        scopeType: "centre",
        scopeId: centreA,
      }),
    ).rejects.toThrow(
      "audit centre resource does not belong to organisation",
    );

    const organisationBActor = await createPrincipalMembership(organisationB);

    await expect(
      recordAuditEvent({
        organisationId: organisationA,
        actorPrincipalId: organisationBActor,
        action: "foundation.centre.checked",
        resourceType: "centre",
        resourceId: centreA,
        scopeType: "centre",
        scopeId: centreA,
      }),
    ).rejects.toThrow("audit actor does not belong to organisation");
  });

  test("rejects contradictory organisation and system scope metadata", async () => {
    const organisationA = randomUUID();
    const organisationB = randomUUID();

    await expect(
      recordAuditEvent({
        organisationId: organisationA,
        action: "foundation.organisation.checked",
        resourceType: "organisation",
        resourceId: organisationA,
        scopeType: "organisation",
        scopeId: organisationB,
      }),
    ).rejects.toThrow(
      "organisation audit scope must identify its organisation",
    );

    const invalidSystemScope = {
      organisationId: organisationA,
      action: "foundation.configuration.verified",
      resourceType: "system.configuration",
      scopeType: "system",
      scopeId: organisationA,
    } as unknown as RecordAuditEventInput;

    await expect(recordAuditEvent(invalidSystemScope)).rejects.toThrow(
      "system audit scope cannot include organisation or scope IDs",
    );

    await expect(
      recordAuditEvent({
        action: "foundation.configuration.verified",
        resourceType: "organisation",
        resourceId: organisationA,
        scopeType: "system",
      }),
    ).rejects.toThrow("system audit scope cannot claim a tenant resource");

    await expect(
      centreSuccessDB.exec`
        INSERT INTO system_audit_events (
          id,
          action,
          resource_type,
          resource_id,
          scope_type,
          occurred_at
        ) VALUES (
          ${randomUUID()},
          'foundation.configuration.verified',
          'organisation',
          ${organisationA},
          'system',
          now()
        )
      `,
    ).rejects.toThrow("system_audit_events_organisation_target_check");
  });

  test("rejects an external identity mapping target from another organisation", async () => {
    const organisationA = await createOrganisation(
      "Synthetic mapping audit organisation A",
    );
    const organisationB = await createOrganisation(
      "Synthetic mapping audit organisation B",
    );
    const organisationAActor = await createPrincipalMembership(organisationA);
    const organisationBPrincipal =
      await createPrincipalMembership(organisationB);
    const mappingId = randomUUID();

    await centreSuccessDB.exec`
      INSERT INTO external_identity_mappings (
        id,
        principal_id,
        provider_key,
        provider_subject,
        status
      ) VALUES (
        ${mappingId},
        ${organisationBPrincipal},
        'microsoft_entra:11111111-1111-4111-8111-111111111111',
        ${randomUUID()},
        'active'
      )
    `;

    await expect(
      recordAuditEvent({
        organisationId: organisationA,
        actorPrincipalId: organisationAActor,
        action: "identity.mapping.checked",
        resourceType: "external_identity_mapping",
        resourceId: mappingId,
        scopeType: "principal",
        scopeId: organisationAActor,
      }),
    ).rejects.toThrow(
      "audit external-identity-mapping resource does not belong to organisation",
    );

    await expect(
      recordAuditEvent({
        action: "identity.mapping.checked",
        resourceType: "external_identity_mapping",
        resourceId: mappingId,
        scopeType: "system",
      }),
    ).rejects.toThrow("system audit scope cannot claim a tenant resource");
  });
});
