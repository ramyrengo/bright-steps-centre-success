import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { canonicalRoleBundle } from "../authorization/roles";
import { centreSuccessDB } from "../db";
import { assertLocalDevelopmentEnvironment } from "./local-identity-linker";

const EFFECTIVE_FROM = new Date("2026-08-11T00:00:00.000Z");
const ORGANISATION_NAME = "Bright Steps Academy — Local Development";
const OPERATOR_NAME = "Local Bootstrap Operator";
const TARGET_NAME = "Local System Administrator";
const ASSIGNMENT_REASON =
  "Approved synthetic local first-administrator bootstrap.";
const AUDIT_ACTION = "identity.local_bootstrap.completed";
const SYSTEM_ADMINISTRATOR_DESCRIPTION =
  "Foundation technical and People & Access administration without implicit business-content access.";
const SYSTEM_ADMINISTRATOR_ROLE = canonicalRoleBundle("system_administrator");
const SYSTEM_ADMINISTRATOR_CAPABILITIES = [
  ...SYSTEM_ADMINISTRATOR_ROLE.capabilities,
].sort();

/** Stable identifiers make the deliberately narrow local bootstrap repeatable. */
export const LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS = Object.freeze({
  organisationId: "b5c00000-0000-4000-8000-000000000001",
  operatorPrincipalId: "b5c00000-0000-4000-8000-000000000002",
  targetPrincipalId: "b5c00000-0000-4000-8000-000000000003",
  operatorMembershipId: "b5c00000-0000-4000-8000-000000000004",
  targetMembershipId: "b5c00000-0000-4000-8000-000000000005",
  operatorAssignmentId: "b5c00000-0000-4000-8000-000000000006",
  operatorScopeId: "b5c00000-0000-4000-8000-000000000007",
  targetAssignmentId: "b5c00000-0000-4000-8000-000000000008",
  targetScopeId: "b5c00000-0000-4000-8000-000000000009",
});

export type LocalFirstAdministratorBootstrapFailureCode =
  | "bootstrap_conflict"
  | "canonical_role_unavailable";

export class LocalFirstAdministratorBootstrapError extends Error {
  readonly code: LocalFirstAdministratorBootstrapFailureCode;

  constructor(code: LocalFirstAdministratorBootstrapFailureCode) {
    super(`local first-administrator bootstrap rejected: ${code}`);
    this.name = "LocalFirstAdministratorBootstrapError";
    this.code = code;
  }
}

export interface LocalFirstAdministratorBootstrapDependencies {
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
}

export interface LocalFirstAdministratorBootstrapResult {
  organisationId: string;
  operatorPrincipalId: string;
  targetPrincipalId: string;
}

interface OrganisationRow {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_timezone: string;
}

interface PrincipalRow {
  id: string;
  display_name: string;
  status: "pending" | "active" | "suspended" | "revoked";
}

interface MembershipRow {
  id: string;
  organisation_id: string;
  principal_id: string;
  status: "active" | "inactive";
  effective_from: Date;
  effective_to: Date | null;
}

interface CanonicalRoleRow {
  id: string;
  role_key: string;
  name: string;
  description: string;
  version: number;
  status: "active" | "inactive";
  source_template_key: string | null;
  source_template_version: number | null;
  template_name: string;
  template_description: string;
  template_status: "active" | "inactive";
}

interface CapabilityRow {
  capability_code: string;
}

interface AssignmentRow {
  id: string;
  organisation_id: string;
  organisation_membership_id: string;
  role_definition_id: string;
  status: "active" | "inactive";
  effective_from: Date;
  effective_to: Date | null;
  granted_by_principal_id: string | null;
  grant_source_type: "principal" | "system" | "bootstrap";
  reason: string;
}

interface ScopeRow {
  id: string;
  organisation_id: string;
  role_assignment_id: string;
  scope_type: "organisation" | "organisational_unit" | "centre";
  organisational_unit_id: string | null;
  centre_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
}

interface AuditRow {
  actor_principal_id: string | null;
  organisation_id: string | null;
  resource_id: string | null;
  scope_type: string;
  scope_id: string | null;
  context: Record<string, unknown>;
}

function conflict(): never {
  throw new LocalFirstAdministratorBootstrapError("bootstrap_conflict");
}

function isSameInstant(value: Date, expected: Date): boolean {
  return value.getTime() === expected.getTime();
}

async function ensureOrganisation(transaction: Transaction): Promise<boolean> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  const inserted = await transaction.queryRow<{ id: string }>`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (
      ${ids.organisationId},
      ${ORGANISATION_NAME},
      'active',
      'Australia/Sydney'
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  const rows = await transaction.queryAll<OrganisationRow>`
    SELECT id, name, status, default_timezone
    FROM organisations
    WHERE id = ${ids.organisationId}
       OR name = ${ORGANISATION_NAME}
    ORDER BY id
    FOR UPDATE
  `;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.id !== ids.organisationId ||
    row.name !== ORGANISATION_NAME ||
    row.status !== "active" ||
    row.default_timezone !== "Australia/Sydney"
  ) {
    conflict();
  }

  return inserted !== null;
}

async function ensurePrincipal(
  transaction: Transaction,
  principalId: string,
  displayName: string,
): Promise<boolean> {
  const inserted = await transaction.queryRow<{ id: string }>`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${displayName}, 'active')
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;

  const rows = await transaction.queryAll<PrincipalRow>`
    SELECT id, display_name, status
    FROM principals
    WHERE id = ${principalId}
       OR display_name = ${displayName}
    ORDER BY id
    FOR UPDATE
  `;
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.id !== principalId ||
    row.display_name !== displayName ||
    row.status !== "active"
  ) {
    conflict();
  }

  return inserted !== null;
}

async function provisionCanonicalRoleDefinitions(
  transaction: Transaction,
): Promise<void> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  await transaction.exec`
    SELECT provision_canonical_role_definitions(${ids.organisationId}::uuid)
  `;
}

async function ensureMembership(
  transaction: Transaction,
  membershipId: string,
  principalId: string,
): Promise<boolean> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  let rows = await transaction.queryAll<MembershipRow>`
    SELECT
      id,
      organisation_id,
      principal_id,
      status,
      effective_from,
      effective_to
    FROM organisation_memberships
    WHERE id = ${membershipId}
       OR (
         organisation_id = ${ids.organisationId}
         AND principal_id = ${principalId}
       )
    ORDER BY id
    FOR UPDATE
  `;

  let created = false;
  if (rows.length === 0) {
    const inserted = await transaction.queryRow<{ id: string }>`
      INSERT INTO organisation_memberships (
        id,
        organisation_id,
        principal_id,
        status,
        effective_from
      ) VALUES (
        ${membershipId},
        ${ids.organisationId},
        ${principalId},
        'active',
        ${EFFECTIVE_FROM}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    created = inserted !== null;
    rows = await transaction.queryAll<MembershipRow>`
      SELECT
        id,
        organisation_id,
        principal_id,
        status,
        effective_from,
        effective_to
      FROM organisation_memberships
      WHERE id = ${membershipId}
         OR (
           organisation_id = ${ids.organisationId}
           AND principal_id = ${principalId}
         )
      ORDER BY id
      FOR UPDATE
    `;
  }

  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.id !== membershipId ||
    row.organisation_id !== ids.organisationId ||
    row.principal_id !== principalId ||
    row.status !== "active" ||
    !isSameInstant(row.effective_from, EFFECTIVE_FROM) ||
    row.effective_to !== null
  ) {
    conflict();
  }

  return created;
}

async function loadCanonicalSystemAdministratorRole(
  transaction: Transaction,
): Promise<CanonicalRoleRow> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  const roles = await transaction.queryAll<CanonicalRoleRow>`
    SELECT
      definition.id,
      definition.role_key,
      definition.name,
      definition.description,
      definition.version,
      definition.status,
      definition.source_template_key,
      definition.source_template_version,
      template.name AS template_name,
      template.description AS template_description,
      template.status AS template_status
    FROM role_definitions AS definition
    JOIN canonical_role_templates AS template
      ON template.role_key = definition.source_template_key
     AND template.version = definition.source_template_version
    WHERE definition.organisation_id = ${ids.organisationId}
      AND definition.role_key = 'system_administrator'
      AND definition.status = 'active'
      AND template.status = 'active'
    ORDER BY definition.id
    FOR UPDATE OF definition
  `;

  if (roles.length !== 1) {
    throw new LocalFirstAdministratorBootstrapError(
      "canonical_role_unavailable",
    );
  }

  const role = roles[0];
  if (
    role.role_key !== SYSTEM_ADMINISTRATOR_ROLE.key ||
    role.name !== SYSTEM_ADMINISTRATOR_ROLE.name ||
    role.description !== SYSTEM_ADMINISTRATOR_DESCRIPTION ||
    role.version !== SYSTEM_ADMINISTRATOR_ROLE.version ||
    role.status !== "active" ||
    role.source_template_key !== SYSTEM_ADMINISTRATOR_ROLE.key ||
    role.source_template_version !== SYSTEM_ADMINISTRATOR_ROLE.version ||
    role.template_name !== SYSTEM_ADMINISTRATOR_ROLE.name ||
    role.template_description !== SYSTEM_ADMINISTRATOR_DESCRIPTION ||
    role.template_status !== "active"
  ) {
    throw new LocalFirstAdministratorBootstrapError(
      "canonical_role_unavailable",
    );
  }

  const definitionCapabilities = await transaction.queryAll<CapabilityRow>`
    SELECT capability_code
    FROM role_capabilities
    WHERE role_definition_id = ${role.id}
    ORDER BY capability_code
  `;
  const templateCapabilities = await transaction.queryAll<CapabilityRow>`
    SELECT capability_code
    FROM canonical_role_template_capabilities
    WHERE role_key = ${SYSTEM_ADMINISTRATOR_ROLE.key}
      AND role_version = ${SYSTEM_ADMINISTRATOR_ROLE.version}
    ORDER BY capability_code
  `;
  const roleCapabilityCodes = definitionCapabilities.map(
    ({ capability_code }) => capability_code,
  );
  const templateCapabilityCodes = templateCapabilities.map(
    ({ capability_code }) => capability_code,
  );
  if (
    roleCapabilityCodes.length !== SYSTEM_ADMINISTRATOR_CAPABILITIES.length ||
    templateCapabilityCodes.length !==
      SYSTEM_ADMINISTRATOR_CAPABILITIES.length ||
    roleCapabilityCodes.some(
      (capability, index) =>
        capability !== SYSTEM_ADMINISTRATOR_CAPABILITIES[index],
    ) ||
    templateCapabilityCodes.some(
      (capability, index) =>
        capability !== SYSTEM_ADMINISTRATOR_CAPABILITIES[index],
    )
  ) {
    throw new LocalFirstAdministratorBootstrapError(
      "canonical_role_unavailable",
    );
  }

  return role;
}

async function ensureAssignment(
  transaction: Transaction,
  roleDefinitionId: string,
  assignmentId: string,
  membershipId: string,
): Promise<boolean> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  let rows = await transaction.queryAll<AssignmentRow>`
    SELECT
      id,
      organisation_id,
      organisation_membership_id,
      role_definition_id,
      status,
      effective_from,
      effective_to,
      granted_by_principal_id,
      grant_source_type,
      reason
    FROM role_assignments
    WHERE id = ${assignmentId}
       OR organisation_membership_id = ${membershipId}
    ORDER BY id
    FOR UPDATE
  `;

  let created = false;
  if (rows.length === 0) {
    const inserted = await transaction.queryRow<{ id: string }>`
      INSERT INTO role_assignments (
        id,
        organisation_id,
        organisation_membership_id,
        role_definition_id,
        status,
        effective_from,
        effective_to,
        granted_by_principal_id,
        grant_source_type,
        reason
      ) VALUES (
        ${assignmentId},
        ${ids.organisationId},
        ${membershipId},
        ${roleDefinitionId},
        'active',
        ${EFFECTIVE_FROM},
        NULL,
        NULL,
        'bootstrap',
        ${ASSIGNMENT_REASON}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    created = inserted !== null;
    rows = await transaction.queryAll<AssignmentRow>`
      SELECT
        id,
        organisation_id,
        organisation_membership_id,
        role_definition_id,
        status,
        effective_from,
        effective_to,
        granted_by_principal_id,
        grant_source_type,
        reason
      FROM role_assignments
      WHERE id = ${assignmentId}
         OR organisation_membership_id = ${membershipId}
      ORDER BY id
      FOR UPDATE
    `;
  }

  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.id !== assignmentId ||
    row.organisation_id !== ids.organisationId ||
    row.organisation_membership_id !== membershipId ||
    row.role_definition_id !== roleDefinitionId ||
    row.status !== "active" ||
    !isSameInstant(row.effective_from, EFFECTIVE_FROM) ||
    row.effective_to !== null ||
    row.granted_by_principal_id !== null ||
    row.grant_source_type !== "bootstrap" ||
    row.reason !== ASSIGNMENT_REASON
  ) {
    conflict();
  }

  return created;
}

async function ensureScope(
  transaction: Transaction,
  scopeId: string,
  assignmentId: string,
): Promise<boolean> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  let rows = await transaction.queryAll<ScopeRow>`
    SELECT
      id,
      organisation_id,
      role_assignment_id,
      scope_type,
      organisational_unit_id,
      centre_id,
      effective_from,
      effective_to
    FROM assignment_scopes
    WHERE id = ${scopeId}
       OR role_assignment_id = ${assignmentId}
    ORDER BY id
    FOR UPDATE
  `;

  let created = false;
  if (rows.length === 0) {
    const inserted = await transaction.queryRow<{ id: string }>`
      INSERT INTO assignment_scopes (
        id,
        organisation_id,
        role_assignment_id,
        scope_type,
        organisational_unit_id,
        centre_id,
        effective_from,
        effective_to
      ) VALUES (
        ${scopeId},
        ${ids.organisationId},
        ${assignmentId},
        'organisation',
        NULL,
        NULL,
        ${EFFECTIVE_FROM},
        NULL
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    created = inserted !== null;
    rows = await transaction.queryAll<ScopeRow>`
      SELECT
        id,
        organisation_id,
        role_assignment_id,
        scope_type,
        organisational_unit_id,
        centre_id,
        effective_from,
        effective_to
      FROM assignment_scopes
      WHERE id = ${scopeId}
         OR role_assignment_id = ${assignmentId}
      ORDER BY id
      FOR UPDATE
    `;
  }

  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.id !== scopeId ||
    row.organisation_id !== ids.organisationId ||
    row.role_assignment_id !== assignmentId ||
    row.scope_type !== "organisation" ||
    row.organisational_unit_id !== null ||
    row.centre_id !== null ||
    !isSameInstant(row.effective_from, EFFECTIVE_FROM) ||
    row.effective_to !== null
  ) {
    conflict();
  }

  return created;
}

async function ensureAuditEvent(
  transaction: Transaction,
  assignmentId: string,
  principalId: string,
  principalKind: "operator" | "target",
): Promise<boolean> {
  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  const rows = await transaction.queryAll<AuditRow>`
    SELECT
      actor_principal_id,
      organisation_id,
      resource_id,
      scope_type,
      scope_id,
      context
    FROM system_audit_events
    WHERE action = ${AUDIT_ACTION}
      AND resource_type = 'role_assignment'
      AND resource_id = ${assignmentId}
    ORDER BY occurred_at, id
  `;

  if (rows.length === 0) {
    await recordAuditEventWithExecutor(transaction, {
      organisationId: ids.organisationId,
      action: AUDIT_ACTION,
      resourceType: "role_assignment",
      resourceId: assignmentId,
      scopeType: "organisation",
      scopeId: ids.organisationId,
      context: {
        bootstrapVersion: 1,
        principalId,
        principalKind,
        source: "local_operator_script",
      },
    });
    return true;
  }

  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.actor_principal_id !== null ||
    row.organisation_id !== ids.organisationId ||
    row.resource_id !== assignmentId ||
    row.scope_type !== "organisation" ||
    row.scope_id !== ids.organisationId ||
    row.context.bootstrapVersion !== 1 ||
    row.context.principalId !== principalId ||
    row.context.principalKind !== principalKind ||
    row.context.source !== "local_operator_script" ||
    Object.keys(row.context).length !== 4
  ) {
    conflict();
  }

  return false;
}

/**
 * Creates only the synthetic local facts needed to authorise the existing
 * non-HTTP Entra identity linker. It creates no provider mapping or real user.
 */
export async function bootstrapLocalFirstAdministrator(
  dependencies: LocalFirstAdministratorBootstrapDependencies,
): Promise<LocalFirstAdministratorBootstrapResult> {
  // This must remain before centreSuccessDB.begin(): non-local execution cannot
  // open a transaction or reach any mutation path.
  assertLocalDevelopmentEnvironment(dependencies.environment);

  const ids = LOCAL_FIRST_ADMINISTRATOR_BOOTSTRAP_IDS;
  const transaction = await centreSuccessDB.begin();

  try {
    // A transaction-scoped advisory lock makes concurrent invocations observe
    // one fully committed bootstrap before attempting their own idempotent pass.
    await transaction.exec`SELECT pg_advisory_xact_lock(1112691796, 1398034993)`;

    await ensureOrganisation(transaction);
    await provisionCanonicalRoleDefinitions(transaction);
    await ensurePrincipal(
      transaction,
      ids.operatorPrincipalId,
      OPERATOR_NAME,
    );
    await ensurePrincipal(transaction, ids.targetPrincipalId, TARGET_NAME);
    await ensureMembership(
      transaction,
      ids.operatorMembershipId,
      ids.operatorPrincipalId,
    );
    await ensureMembership(
      transaction,
      ids.targetMembershipId,
      ids.targetPrincipalId,
    );

    const role = await loadCanonicalSystemAdministratorRole(transaction);
    await ensureAssignment(
      transaction,
      role.id,
      ids.operatorAssignmentId,
      ids.operatorMembershipId,
    );
    await ensureAssignment(
      transaction,
      role.id,
      ids.targetAssignmentId,
      ids.targetMembershipId,
    );
    await ensureScope(
      transaction,
      ids.operatorScopeId,
      ids.operatorAssignmentId,
    );
    await ensureScope(
      transaction,
      ids.targetScopeId,
      ids.targetAssignmentId,
    );
    await ensureAuditEvent(
      transaction,
      ids.operatorAssignmentId,
      ids.operatorPrincipalId,
      "operator",
    );
    await ensureAuditEvent(
      transaction,
      ids.targetAssignmentId,
      ids.targetPrincipalId,
      "target",
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return {
    organisationId: ids.organisationId,
    operatorPrincipalId: ids.operatorPrincipalId,
    targetPrincipalId: ids.targetPrincipalId,
  };
}
