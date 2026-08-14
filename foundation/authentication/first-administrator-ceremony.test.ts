import { randomUUID } from "node:crypto";
import type { EnvironmentMeta } from "encore.dev";
import { beforeAll, describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContext } from "../authorization/context-loader";
import { authorise } from "../authorization/policy";
import { canonicalRoleBundle } from "../authorization/roles";
import { centreSuccessDB } from "../db";
import { bootstrapLocalFirstAdministrator } from "./local-first-administrator-bootstrap";
import {
  assertLocalDevelopmentEnvironment,
  linkLocalEntraIdentity,
} from "./local-identity-linker";
import {
  formatFirstAdministratorCeremonyReport,
  runFirstAdministratorCeremony,
  type FirstAdministratorCeremonyDependencies,
  type FirstAdministratorCeremonyInput,
} from "./first-administrator-ceremony";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const UNTRUSTED_TENANT_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_KEY = `microsoft_entra:${TENANT_ID}`;
const AT = new Date("2026-08-14T02:00:00.000Z");

const STAGING = { cloud: "encore", name: "staging", type: "development" } as const;
const PRODUCTION = { cloud: "gcp", name: "production", type: "production" } as const;
const LOCAL = { cloud: "local", name: "local", type: "development" } as const;
const PREVIEW = { cloud: "encore", name: "pr-42", type: "ephemeral" } as const;
const CLOUD_DEVELOPMENT = {
  cloud: "encore",
  name: "development",
  type: "development",
} as const;

const BOOTSTRAP_AUDIT_ACTION = "identity.first_administrator_bootstrap.completed";
const MAPPING_AUDIT_ACTION =
  "identity.first_administrator_bootstrap.mapping_linked";

type CeremonyEnvironment = Pick<EnvironmentMeta, "cloud" | "name" | "type">;

function dependencies(
  environment: CeremonyEnvironment = STAGING,
): FirstAdministratorCeremonyDependencies {
  return {
    environment,
    configuredTenantId: TENANT_ID,
  };
}

async function createOrganisation(label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${label}, 'active', 'Australia/Sydney')
  `;
  return id;
}

function ceremonyInput(
  overrides: Partial<FirstAdministratorCeremonyInput> & {
    organisationId: string;
  },
): FirstAdministratorCeremonyInput {
  return {
    declaredEnvironment: "staging",
    tenantId: TENANT_ID,
    oid: randomUUID(),
    displayName: "Operator-supplied administrator name",
    reason: "Approved first-administrator ceremony rehearsal.",
    ...overrides,
  };
}

interface OrganisationFacts {
  principals: number;
  memberships: number;
  assignments: number;
  scopes: number;
  mappings: number;
  auditEvents: number;
}

async function organisationFacts(
  organisationId: string,
): Promise<OrganisationFacts> {
  const row = await centreSuccessDB.queryRow<OrganisationFacts>`
    SELECT
      (SELECT count(*)::integer FROM principals AS principal
       WHERE EXISTS (
         SELECT 1 FROM organisation_memberships AS membership
         WHERE membership.principal_id = principal.id
           AND membership.organisation_id = ${organisationId}
       )) AS principals,
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE organisation_id = ${organisationId}) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE organisation_id = ${organisationId}) AS assignments,
      (SELECT count(*)::integer FROM assignment_scopes
       WHERE organisation_id = ${organisationId}) AS scopes,
      (SELECT count(*)::integer FROM external_identity_mappings AS mapping
       WHERE EXISTS (
         SELECT 1 FROM organisation_memberships AS membership
         WHERE membership.principal_id = mapping.principal_id
           AND membership.organisation_id = ${organisationId}
       )) AS mappings,
      (SELECT count(*)::integer FROM system_audit_events
       WHERE organisation_id = ${organisationId}) AS "auditEvents"
  `;
  if (row === null) throw new Error("organisation fact query returned no row");
  return row;
}

const NOTHING: OrganisationFacts = {
  principals: 0,
  memberships: 0,
  assignments: 0,
  scopes: 0,
  mappings: 0,
  auditEvents: 0,
};

describe("first-administrator ceremony — environment gate", () => {
  let organisationId: string;

  beforeAll(async () => {
    organisationId = await createOrganisation("Ceremony environment gate");
  });

  test("refuses when the operator does not name the target environment", async () => {
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId, declaredEnvironment: "   " }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "environment_not_declared" });
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses when the declared environment is not the running one", async () => {
    // The operator believes they are on staging; the deployment says otherwise.
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId, declaredEnvironment: "staging" }),
        dependencies(PRODUCTION),
      ),
    ).rejects.toMatchObject({ code: "environment_mismatch" });

    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({
          organisationId,
          declaredEnvironment: "production",
          apply: true,
          confirmProduction: true,
        }),
        dependencies(STAGING),
      ),
    ).rejects.toMatchObject({ code: "environment_mismatch" });
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses to apply anywhere outside the reviewed environment allow-list", async () => {
    for (const environment of [LOCAL, CLOUD_DEVELOPMENT] as const) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({
            organisationId,
            declaredEnvironment: environment.name,
            apply: true,
          }),
          dependencies(environment),
        ),
      ).rejects.toMatchObject({ code: "environment_not_permitted" });
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses to apply in an ephemeral or test environment whatever it is named", async () => {
    for (const environment of [
      PREVIEW,
      { cloud: "encore", name: "staging", type: "ephemeral" },
      { cloud: "local", name: "production", type: "test" },
    ] as const) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({
            organisationId,
            declaredEnvironment: environment.name,
            apply: true,
            confirmProduction: environment.name === "production",
          }),
          dependencies(environment),
        ),
      ).rejects.toMatchObject({ code: "environment_type_not_permitted" });
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses to apply in production without the explicit confirmation flag", async () => {
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({
          organisationId,
          declaredEnvironment: "production",
          apply: true,
        }),
        dependencies(PRODUCTION),
      ),
    ).rejects.toMatchObject({ code: "production_confirmation_required" });
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses the production confirmation flag anywhere but production", async () => {
    // It must not become a habitual paste that is already on the command line
    // when the operator finally points at production.
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({
          organisationId,
          declaredEnvironment: "staging",
          apply: true,
          confirmProduction: true,
        }),
        dependencies(STAGING),
      ),
    ).rejects.toMatchObject({ code: "confirmation_not_applicable" });
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("permits a dry run in any environment, because it cannot commit", async () => {
    for (const environment of [LOCAL, PREVIEW, PRODUCTION] as const) {
      const report = await runFirstAdministratorCeremony(
        ceremonyInput({
          organisationId,
          declaredEnvironment: environment.name,
        }),
        dependencies(environment),
      );
      expect(report.mode).toBe("dry_run");
      expect(report.committed).toBe(false);
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });
});

describe("first-administrator ceremony — operator input", () => {
  let organisationId: string;

  beforeAll(async () => {
    organisationId = await createOrganisation("Ceremony operator input");
  });

  test("refuses a malformed tenant id, oid, or organisation id", async () => {
    const malformed = [
      { tenantId: "not-a-guid" },
      { tenantId: "00000000-0000-0000-0000-000000000000" },
      { oid: "not-a-guid" },
      { oid: "00000000-0000-0000-0000-000000000000" },
      { oid: " 22222222-2222-4222-8222-222222222222 " },
      { organisationId: "not-a-guid" },
    ];

    for (const override of malformed) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({ organisationId, ...override }),
          dependencies(),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses a well-formed tenant that this deployment does not trust", async () => {
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId, tenantId: UNTRUSTED_TENANT_ID }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "tenant_not_trusted" });
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses an empty or oversized display name and reason", async () => {
    for (const override of [
      { displayName: "   " },
      { displayName: "n".repeat(201) },
      { reason: "" },
      { reason: "r".repeat(401) },
    ]) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({ organisationId, ...override }),
          dependencies(),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });

  test("refuses an organisation that does not exist", async () => {
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId: randomUUID() }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "organisation_not_found" });
  });

  test("refuses an organisation that is not active", async () => {
    const inactiveId = await createOrganisation("Ceremony inactive organisation");
    await centreSuccessDB.exec`
      UPDATE organisations SET status = 'inactive' WHERE id = ${inactiveId}
    `;
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId: inactiveId }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "organisation_not_active" });
    expect(await organisationFacts(inactiveId)).toEqual(NOTHING);
  });
});

describe("first-administrator ceremony — it is a bootstrap, never a recovery tool", () => {
  test("refuses when the organisation already holds any principal", async () => {
    const organisationId = await createOrganisation("Ceremony populated organisation");
    const principalId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${principalId}, 'Pre-existing organisation member', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisation_memberships (
        id, organisation_id, principal_id, status, effective_from
      ) VALUES (
        ${randomUUID()}, ${organisationId}, ${principalId}, 'active', ${AT}
      )
    `;

    for (const apply of [false, true]) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({ organisationId, apply }),
          dependencies(),
        ),
      ).rejects.toMatchObject({ code: "organisation_already_populated" });
    }

    const facts = await organisationFacts(organisationId);
    expect(facts.memberships).toBe(1);
    expect(facts.assignments).toBe(0);
    expect(facts.mappings).toBe(0);
  });

  test("refuses on the append-only audit record even when no row remains", async () => {
    // The audit trail cannot be deleted, so removing the membership rows does
    // not re-arm the ceremony. This lock is independent of the row-count one.
    const organisationId = await createOrganisation("Ceremony audit-locked organisation");
    await centreSuccessDB.exec`
      INSERT INTO system_audit_events (
        id, organisation_id, actor_principal_id, action, resource_type,
        resource_id, scope_type, scope_id, context, occurred_at
      ) VALUES (
        ${randomUUID()}, ${organisationId}, NULL, ${BOOTSTRAP_AUDIT_ACTION},
        'organisation', ${organisationId}, 'organisation', ${organisationId},
        ${{ source: "production_first_administrator_ceremony" }}, ${AT}
      )
    `;

    expect((await organisationFacts(organisationId)).memberships).toBe(0);
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "already_bootstrapped" });
  });

  test("refuses an Entra identity that is already mapped to a principal", async () => {
    const mappedOrganisationId = await createOrganisation("Ceremony mapped identity");
    const principalId = randomUUID();
    const oid = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${principalId}, 'Already mapped principal', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO external_identity_mappings (
        id, principal_id, provider_key, provider_subject, status
      ) VALUES (
        ${randomUUID()}, ${principalId}, ${PROVIDER_KEY}, ${oid}, 'active'
      )
    `;

    const emptyOrganisationId = await createOrganisation("Ceremony reusing an oid");
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId: emptyOrganisationId, oid }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "identity_already_mapped" });
    expect(await organisationFacts(emptyOrganisationId)).toEqual(NOTHING);
    expect(mappedOrganisationId).not.toBe(emptyOrganisationId);
  });

  test("refuses when the canonical System Administrator role is not the approved bundle", async () => {
    const organisationId = await createOrganisation("Ceremony divergent role");
    const role = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM role_definitions
      WHERE organisation_id = ${organisationId}
        AND role_key = 'system_administrator'
        AND status = 'active'
    `;
    expect(role).not.toBeNull();
    await centreSuccessDB.exec`
      INSERT INTO role_capabilities (role_definition_id, capability_code)
      VALUES (${role?.id ?? organisationId}, 'centre.read')
      ON CONFLICT DO NOTHING
    `;
    try {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({ organisationId }),
          dependencies(),
        ),
      ).rejects.toMatchObject({ code: "canonical_role_unavailable" });
    } finally {
      await centreSuccessDB.exec`
        DELETE FROM role_capabilities
        WHERE role_definition_id = ${role?.id ?? organisationId}
          AND capability_code = 'centre.read'
      `;
    }
    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
  });
});

describe("first-administrator ceremony — dry run", () => {
  test("rehearses the whole ceremony inside a transaction and writes nothing", async () => {
    const organisationId = await createOrganisation("Ceremony dry run");
    const oid = randomUUID();

    const report = await runFirstAdministratorCeremony(
      ceremonyInput({ organisationId, oid }),
      dependencies(),
    );

    expect(report.mode).toBe("dry_run");
    expect(report.committed).toBe(false);
    expect(report.counts).toEqual({
      principals: 1,
      memberships: 1,
      assignments: 1,
      scopes: 1,
      principalMappings: 1,
      subjectMappings: 1,
      roleCapabilities: canonicalRoleBundle("system_administrator").capabilities.length,
      auditEvents: 2,
    });
    // The deferred People & Access guard was forced to run inside the rolled-back
    // transaction, so the rehearsal proves the created administrator is reachable.
    expect(report.reachableSystemAdministrators).toBe(1);
    expect(report.roleKey).toBe("system_administrator");
    expect(report.auditActions).toEqual([
      BOOTSTRAP_AUDIT_ACTION,
      MAPPING_AUDIT_ACTION,
    ]);

    expect(await organisationFacts(organisationId)).toEqual(NOTHING);
    const survivingMapping = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count FROM external_identity_mappings
      WHERE provider_key = ${PROVIDER_KEY} AND provider_subject = ${oid}
    `;
    expect(survivingMapping?.count).toBe(0);

    // A dry run leaves the ceremony armed: it is a rehearsal, not a run.
    const second = await runFirstAdministratorCeremony(
      ceremonyInput({ organisationId, oid }),
      dependencies(),
    );
    expect(second.committed).toBe(false);
  });

  test("renders an operator plan that echoes the identity and names its own risk", async () => {
    const organisationId = await createOrganisation("Ceremony dry run report");
    const oid = randomUUID();
    const rendered = formatFirstAdministratorCeremonyReport(
      await runFirstAdministratorCeremony(
        ceremonyInput({ organisationId, oid }),
        dependencies(),
      ),
      { tenantId: TENANT_ID, oid },
    );

    expect(rendered).toContain("DRY RUN — nothing was written");
    expect(rendered).toContain("ADR-0021 D5");
    // The operator's own terminal is the only place the oid can be checked
    // against the Entra portal, and a mistyped one is not recoverable here.
    expect(rendered).toContain(oid);
    expect(rendered).toContain(TENANT_ID);
    expect(rendered).toContain("refuses to run twice");
    expect(rendered).toContain("no business content, per ADR-0009");
    expect(rendered).toContain("reachable admins     1");
  });
});

describe("first-administrator ceremony — apply", () => {
  let organisationId: string;
  const oid = randomUUID();
  let principalId: string;
  let assignmentId: string;
  let mappingId: string;

  beforeAll(async () => {
    organisationId = await createOrganisation("Ceremony applied organisation");
    const report = await runFirstAdministratorCeremony(
      ceremonyInput({
        organisationId,
        oid,
        apply: true,
        reason: "Approved production readiness Stage 2 rehearsal.",
      }),
      dependencies(),
    );
    expect(report.mode).toBe("apply");
    expect(report.committed).toBe(true);
    principalId = report.principalId;
    assignmentId = report.assignmentId;
    mappingId = report.mappingId;
  });

  test("creates exactly one principal, membership, assignment, scope and mapping", async () => {
    expect(await organisationFacts(organisationId)).toEqual({
      principals: 1,
      memberships: 1,
      assignments: 1,
      scopes: 1,
      mappings: 1,
      auditEvents: 2,
    });

    const assignment = await centreSuccessDB.queryRow<{
      id: string;
      role_key: string;
      version: number;
      source_template_key: string | null;
      status: string;
      grant_source_type: string;
      granted_by_principal_id: string | null;
      effective_to: Date | null;
      scope_type: string;
      organisational_unit_id: string | null;
      centre_id: string | null;
    }>`
      SELECT
        assignment.id,
        role.role_key,
        role.version,
        role.source_template_key,
        assignment.status,
        assignment.grant_source_type,
        assignment.granted_by_principal_id,
        assignment.effective_to,
        scope.scope_type,
        scope.organisational_unit_id,
        scope.centre_id
      FROM role_assignments AS assignment
      JOIN role_definitions AS role
        ON role.organisation_id = assignment.organisation_id
       AND role.id = assignment.role_definition_id
      JOIN assignment_scopes AS scope
        ON scope.organisation_id = assignment.organisation_id
       AND scope.role_assignment_id = assignment.id
      WHERE assignment.organisation_id = ${organisationId}
    `;
    expect(assignment).toEqual({
      id: assignmentId,
      role_key: "system_administrator",
      version: canonicalRoleBundle("system_administrator").version,
      source_template_key: "system_administrator",
      status: "active",
      grant_source_type: "bootstrap",
      granted_by_principal_id: null,
      effective_to: null,
      scope_type: "organisation",
      organisational_unit_id: null,
      centre_id: null,
    });

    const mapping = await centreSuccessDB.queryRow<{
      id: string;
      principal_id: string;
      provider_key: string;
      provider_subject: string;
      status: string;
    }>`
      SELECT id, principal_id, provider_key, provider_subject, status
      FROM external_identity_mappings WHERE id = ${mappingId}
    `;
    expect(mapping).toEqual({
      id: mappingId,
      principal_id: principalId,
      provider_key: PROVIDER_KEY,
      provider_subject: oid,
      status: "active",
    });
  });

  test("grants the canonical System Administrator bundle and no business content", async () => {
    const capabilities = await centreSuccessDB.queryAll<{
      capability_code: string;
    }>`
      SELECT capability.capability_code
      FROM role_assignments AS assignment
      JOIN role_capabilities AS capability
        ON capability.role_definition_id = assignment.role_definition_id
      WHERE assignment.id = ${assignmentId}
      ORDER BY capability.capability_code
    `;
    expect(capabilities.map((row) => row.capability_code)).toEqual(
      [...canonicalRoleBundle("system_administrator").capabilities].sort(),
    );

    // The ceremony stamps effective_from from the database clock rather than a
    // fixture instant, so evaluate the grant just after the real one. Asking
    // relative to AT would ask whether the administrator could act hours before
    // they were created, and the answer to that is correctly no.
    const at = new Date(Date.now() + 60_000);
    const context = await loadPrincipalAuthorisationContext({
      principalId,
      activeOrganisationId: organisationId,
      at,
    });
    const resource = { kind: "organisation", organisationId } as const;

    expect(
      authorise({
        context,
        capability: FOUNDATION_CAPABILITIES.identityMappingManage,
        resource,
        at,
      }),
    ).toEqual({
      allowed: true,
      assignmentId,
      roleKey: "system_administrator",
    });

    // ADR-0009: technical administration confers no business content, and that
    // separation is what makes running this ceremony safe at all.
    for (const capability of [
      FOUNDATION_CAPABILITIES.centreRead,
      FOUNDATION_CAPABILITIES.centreManage,
      FOUNDATION_CAPABILITIES.organisationRead,
      FOUNDATION_CAPABILITIES.quarterlyAuditRead,
      FOUNDATION_CAPABILITIES.findingRead,
      FOUNDATION_CAPABILITIES.correctiveActionRead,
      FOUNDATION_CAPABILITIES.evidenceRead,
      FOUNDATION_CAPABILITIES.evidenceUpload,
      FOUNDATION_CAPABILITIES.budgetSummaryRead,
      FOUNDATION_CAPABILITIES.budgetPositionRead,
      FOUNDATION_CAPABILITIES.complianceOversightRead,
    ]) {
      expect(
        authorise({ context, capability, resource, at }),
      ).toEqual({ allowed: false, reason: "capability_missing" });
    }
  });

  test("writes two minimised append-only audit events carrying no Entra identifier", async () => {
    const events = await centreSuccessDB.queryAll<{
      action: string;
      actor_principal_id: string | null;
      resource_type: string;
      resource_id: string | null;
      scope_type: string;
      scope_id: string | null;
      context: Record<string, unknown>;
    }>`
      SELECT action, actor_principal_id, resource_type, resource_id,
             scope_type, scope_id, context
      FROM system_audit_events
      WHERE organisation_id = ${organisationId}
      ORDER BY action
    `;

    expect(events).toEqual([
      {
        action: BOOTSTRAP_AUDIT_ACTION,
        // NULL, not the created principal: they did not grant themselves this.
        actor_principal_id: null,
        resource_type: "role_assignment",
        resource_id: assignmentId,
        scope_type: "organisation",
        scope_id: organisationId,
        context: {
          ceremonyVersion: 1,
          source: "production_first_administrator_ceremony",
          environment: "staging",
          principalId,
          roleKey: "system_administrator",
          roleVersion: canonicalRoleBundle("system_administrator").version,
          reason: "Approved production readiness Stage 2 rehearsal.",
        },
      },
      {
        action: MAPPING_AUDIT_ACTION,
        actor_principal_id: null,
        resource_type: "external_identity_mapping",
        resource_id: mappingId,
        scope_type: "principal",
        scope_id: principalId,
        context: {
          ceremonyVersion: 1,
          provider: "microsoft_entra",
          source: "production_first_administrator_ceremony",
          environment: "staging",
          reason: "Approved production readiness Stage 2 rehearsal.",
        },
      },
    ]);

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(oid);
    expect(serialised).not.toContain(TENANT_ID);
    expect(serialised).not.toContain(PROVIDER_KEY);
    expect(serialised).not.toContain("Operator-supplied administrator name");

    await expect(
      centreSuccessDB.exec`
        DELETE FROM system_audit_events WHERE organisation_id = ${organisationId}
      `,
    ).rejects.toThrow("append-only");
  });

  test("a second invocation refuses loudly rather than repeating or duplicating", async () => {
    const before = await organisationFacts(organisationId);

    for (const apply of [false, true]) {
      await expect(
        runFirstAdministratorCeremony(
          ceremonyInput({ organisationId, apply, oid: randomUUID() }),
          dependencies(),
        ),
      ).rejects.toMatchObject({ code: "organisation_already_populated" });
    }

    // Re-supplying the same identity is refused too, and no second
    // administrator, assignment, or mapping appeared.
    await expect(
      runFirstAdministratorCeremony(
        ceremonyInput({ organisationId, oid, apply: true }),
        dependencies(),
      ),
    ).rejects.toMatchObject({ code: "organisation_already_populated" });
    expect(await organisationFacts(organisationId)).toEqual(before);
  });
});

describe("first-administrator ceremony — the local guards are untouched", () => {
  test("the shared local assertion still refuses every non-local environment", () => {
    for (const environment of [
      STAGING,
      PRODUCTION,
      PREVIEW,
      CLOUD_DEVELOPMENT,
      { cloud: "aws", name: "local", type: "development" },
      { cloud: "local", name: "staging", type: "development" },
      { cloud: "local", name: "local", type: "test" },
      { cloud: "local", name: "local", type: "production" },
    ] as const) {
      expect(() => assertLocalDevelopmentEnvironment(environment)).toThrow(
        "local_environment_required",
      );
    }

    expect(() => assertLocalDevelopmentEnvironment(LOCAL)).not.toThrow();
  });

  test("the local bootstrap and local linker still refuse before any write", async () => {
    for (const environment of [STAGING, PRODUCTION, PREVIEW] as const) {
      await expect(
        bootstrapLocalFirstAdministrator({ environment }),
      ).rejects.toThrow("local_environment_required");

      await expect(
        linkLocalEntraIdentity(
          {
            tenantId: TENANT_ID,
            oid: randomUUID(),
            principalId: randomUUID(),
            organisationId: randomUUID(),
            operatorPrincipalId: randomUUID(),
            reason: "A non-local caller must never reach database mutation.",
            at: AT,
          },
          { configuredTenantId: TENANT_ID, environment },
        ),
      ).rejects.toThrow("local_environment_required");
    }
  });
});
