import { randomUUID } from "node:crypto";
import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { canonicalRoleBundle } from "../authorization/roles";
import { centreSuccessDB } from "../db";
import {
  evaluateReviewedEnvironmentGate,
  REVIEWED_APPLY_ENVIRONMENT_NAMES,
  REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
} from "../operations/reviewed-environment-gate";
import { canonicaliseEntraGuid } from "./entra-identifiers";
import { microsoftEntraProviderKey } from "./external-identity";

/**
 * Production first-administrator ceremony — ADR-0021 D5.
 *
 * This is the most privileged operation in the system: it creates the first
 * principal who can then grant everyone else access. Every property below is
 * deliberate.
 *
 * - **No API surface.** Nothing here is exported through `encore.dev/api`, and
 *   the only caller is `scripts/bootstrap-first-administrator.ts`, run out of
 *   band through `encore exec`. It is reachable from no browser and appears in
 *   no generated client.
 * - **It discovers nobody.** The first administrator's Entra `tid + oid` is
 *   explicit operator input supplied on the command line. There is no code path
 *   by which an identity arrives from a request, a claim, or a directory call.
 *   The only thing consulted besides the operator's arguments is the tenant this
 *   deployment is already configured to trust, which can only narrow the input.
 * - **It is a bootstrap, never a recovery or escalation tool.** It refuses if
 *   the target organisation already holds any principal, and it refuses if this
 *   ceremony has ever completed there before — the second check reads the
 *   append-only audit log, which cannot be deleted, so removing the membership
 *   rows does not re-arm it. A second invocation fails loudly.
 * - **It creates exactly one canonical System Administrator assignment and
 *   exactly one external-identity mapping**, reusing the ADR-0006 canonical role
 *   template. It mints no bespoke role and attaches no extra capability, and it
 *   asserts the resulting counts are one rather than at least one.
 *
 * The local-only paths in `local-first-administrator-bootstrap.ts` and
 * `local-identity-linker.ts` are untouched and keep refusing every non-local
 * environment. Nothing here widens them; this is a separate ceremony, as D5
 * requires.
 */

const ADVISORY_LOCK_KEY_HIGH = 1112691796;
const ADVISORY_LOCK_KEY_LOW = 20260815;

const CEREMONY_VERSION = 1;

/**
 * Marks every audit event this ceremony writes. The action names and this
 * source are what make a production bootstrap distinguishable from an ordinary
 * People & Access grant when the audit log is read later.
 */
const CEREMONY_SOURCE = "production_first_administrator_ceremony";

const BOOTSTRAP_AUDIT_ACTION = "identity.first_administrator_bootstrap.completed";
const MAPPING_AUDIT_ACTION =
  "identity.first_administrator_bootstrap.mapping_linked";
const CEREMONY_AUDIT_ACTIONS = [
  BOOTSTRAP_AUDIT_ACTION,
  MAPPING_AUDIT_ACTION,
] as const;

const ASSIGNMENT_REASON_PREFIX = "ADR-0021 D5 first-administrator ceremony: ";

const SYSTEM_ADMINISTRATOR_ROLE = canonicalRoleBundle("system_administrator");
const SYSTEM_ADMINISTRATOR_DESCRIPTION =
  "Foundation technical and People & Access administration without implicit business-content access.";
const SYSTEM_ADMINISTRATOR_CAPABILITIES = [
  ...SYSTEM_ADMINISTRATOR_ROLE.capabilities,
].sort();

/**
 * The closed set of environments this ceremony may **apply** in.
 *
 * ADR-0021 D3 fixes the topology as `local`, `development`, `preview`,
 * `staging`, and `production`. Only the two deployed environments D5 names are
 * listed: staging, where the ceremony is rehearsed end to end, and production.
 * `local` is deliberately absent — it already has its own guarded bootstrap and
 * that guard is not being widened. Adding an environment here is a code change
 * that goes through review; it is not something an operator flag can do.
 *
 * The values now live in `operations/reviewed-environment-gate.ts` so that the
 * organisation reference load applies the identical gate instead of a second
 * copy of it. They are re-exported here unchanged: the list this ceremony may
 * apply in is `["staging", "production"]`, exactly as before.
 */
export const CEREMONY_APPLY_ENVIRONMENT_NAMES = REVIEWED_APPLY_ENVIRONMENT_NAMES;

/** Environments that additionally require the explicit confirmation flag. */
export const CEREMONY_CONFIRMATION_ENVIRONMENT_NAMES =
  REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FirstAdministratorCeremonyFailureCode =
  | "environment_not_declared"
  | "environment_mismatch"
  | "environment_not_permitted"
  | "environment_type_not_permitted"
  | "production_confirmation_required"
  | "confirmation_not_applicable"
  | "invalid_input"
  | "tenant_not_trusted"
  | "organisation_not_found"
  | "organisation_not_active"
  | "organisation_already_populated"
  | "already_bootstrapped"
  | "identity_already_mapped"
  | "canonical_role_unavailable"
  | "exactly_one_violated";

export class FirstAdministratorCeremonyError extends Error {
  readonly code: FirstAdministratorCeremonyFailureCode;
  readonly detail: string;

  constructor(code: FirstAdministratorCeremonyFailureCode, detail = "") {
    super(
      `first-administrator ceremony refused: ${code}${detail ? ` (${detail})` : ""}`,
    );
    this.name = "FirstAdministratorCeremonyError";
    this.code = code;
    this.detail = detail;
  }
}

export interface FirstAdministratorCeremonyInput {
  /**
   * The environment the operator believes they are pointed at, typed out in
   * full. It is matched against `appMeta().environment.name`; a mismatch refuses
   * before any database work. An operator who thinks they are on staging and is
   * actually connected to production gets a refusal, not an administrator.
   */
  declaredEnvironment: string;
  /**
   * The organisation to bootstrap. There is deliberately no default and no
   * committed identifier: the target is named by the operator every time.
   */
  organisationId: string;
  /** Entra tenant id (`tid`), supplied out of band by the operator. */
  tenantId: string;
  /** Entra object id (`oid`), supplied out of band by the operator. */
  oid: string;
  /** `principals.display_name` is NOT NULL and is never a committed constant. */
  displayName: string;
  /** Recorded on the assignment and in both audit events. */
  reason: string;
  /** Dry run is the default. Nothing commits unless this is explicitly true. */
  apply?: boolean;
  /** Required only when applying to production. Refused anywhere else. */
  confirmProduction?: boolean;
}

export interface FirstAdministratorCeremonyDependencies {
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
  /**
   * The tenant this deployment already trusts for token verification. An
   * operator-supplied `tid` that does not match it is refused, because an
   * administrator in an untrusted tenant could never sign in. This is local
   * runtime configuration, not directory discovery.
   */
  configuredTenantId: string;
  now?: () => Date;
}

export interface CeremonyEnvironmentReport {
  declared: string;
  name: string;
  type: string;
  cloud: string;
  confirmationRequired: boolean;
}

export interface CeremonyCounts {
  principals: number;
  memberships: number;
  assignments: number;
  scopes: number;
  principalMappings: number;
  subjectMappings: number;
  roleCapabilities: number;
  auditEvents: number;
}

export interface FirstAdministratorCeremonyReport {
  mode: "dry_run" | "apply";
  environment: CeremonyEnvironmentReport;
  organisationId: string;
  organisationName: string;
  principalId: string;
  membershipId: string;
  assignmentId: string;
  scopeId: string;
  mappingId: string;
  roleKey: string;
  roleVersion: number;
  capabilities: readonly string[];
  auditActions: readonly string[];
  counts: CeremonyCounts;
  /**
   * The People & Access reachability definition from migration 017, evaluated
   * after the deferred guard has been forced to run. One means the created
   * administrator is genuinely able to administer the organisation.
   */
  reachableSystemAdministrators: number;
  occurredAt: string;
  committed: boolean;
}

interface ValidatedCeremonyInput {
  organisationId: string;
  providerKey: string;
  providerSubject: string;
  displayName: string;
  reason: string;
}

interface OrganisationRow {
  id: string;
  name: string;
  status: string;
}

interface CanonicalRoleRow {
  id: string;
  role_key: string;
  name: string;
  description: string;
  version: number;
  status: string;
  source_template_key: string | null;
  source_template_version: number | null;
  template_name: string;
  template_description: string;
  template_status: string;
}

interface CapabilityRow {
  capability_code: string;
}

interface AssignmentRow {
  id: string;
  organisation_id: string;
  organisation_membership_id: string;
  role_definition_id: string;
  status: string;
  granted_by_principal_id: string | null;
  grant_source_type: string;
  effective_to: Date | null;
}

/**
 * The environment gate.
 *
 * The local bootstrap asserts exact local development and refuses everything
 * else. This ceremony cannot copy that assertion — it exists to run in staging
 * and production — so the assertion is replaced by four independent locks rather
 * than dropped:
 *
 * 1. the operator names the target environment explicitly, and it must equal the
 *    running environment reported by `appMeta()`;
 * 2. applying is confined to a closed, reviewed allow-list of environment names;
 * 3. ephemeral and test environment types can never apply, whatever they are
 *    named, so a preview environment cannot impersonate one of those names; and
 * 4. production additionally requires a confirmation flag that is meaningless —
 *    and refused — anywhere else, so it cannot become a habitual paste.
 *
 * A dry run writes nothing and is permitted in any environment, but still has to
 * pass lock 1, so a rehearsal proves something about the environment the
 * operator actually named. The real safety property is environment-independent
 * and enforced separately below: the ceremony refuses if the organisation holds
 * any principal at all.
 *
 * The four locks are implemented in `operations/reviewed-environment-gate.ts`,
 * which was extracted from this function so the organisation reference load
 * applies the same gate. The refusal codes, their order, and their detail text
 * are unchanged; this function still throws this ceremony's own error type.
 */
function assertEnvironmentGate(
  input: FirstAdministratorCeremonyInput,
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
  apply: boolean,
): void {
  const refusal = evaluateReviewedEnvironmentGate(
    {
      declaredEnvironment: input.declaredEnvironment,
      apply,
      confirmProduction: input.confirmProduction,
    },
    environment,
    {
      applyEnvironmentNames: CEREMONY_APPLY_ENVIRONMENT_NAMES,
      confirmationEnvironmentNames: CEREMONY_CONFIRMATION_ENVIRONMENT_NAMES,
      refusedTypeConsequence: "create a real administrator",
      notPermittedNote:
        "local development keeps its own separate guarded bootstrap",
    },
  );

  if (refusal !== null) {
    throw new FirstAdministratorCeremonyError(refusal.code, refusal.detail);
  }
}

function validateInput(
  input: FirstAdministratorCeremonyInput,
  configuredTenantId: string,
): ValidatedCeremonyInput {
  const tenantId = canonicaliseEntraGuid(input.tenantId);
  const providerSubject = canonicaliseEntraGuid(input.oid);
  const providerKey = tenantId === null ? null : microsoftEntraProviderKey(tenantId);

  if (
    tenantId === null ||
    providerKey === null ||
    providerSubject === null ||
    !CANONICAL_UUID.test(input.organisationId)
  ) {
    throw new FirstAdministratorCeremonyError(
      "invalid_input",
      "organisation id, tenant id, and oid must each be a well-formed identifier",
    );
  }

  const expectedTenantId = canonicaliseEntraGuid(configuredTenantId);
  if (expectedTenantId === null || tenantId !== expectedTenantId) {
    throw new FirstAdministratorCeremonyError(
      "tenant_not_trusted",
      "the supplied tenant is not the tenant this deployment is configured to trust",
    );
  }

  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 200) {
    throw new FirstAdministratorCeremonyError(
      "invalid_input",
      "a display name of 1 to 200 characters is required operator input",
    );
  }

  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 400) {
    throw new FirstAdministratorCeremonyError(
      "invalid_input",
      "a reason of 1 to 400 characters is required operator input",
    );
  }

  return {
    organisationId: input.organisationId.toLowerCase(),
    providerKey,
    providerSubject,
    displayName,
    reason,
  };
}

async function loadOrganisation(
  transaction: Transaction,
  organisationId: string,
): Promise<OrganisationRow> {
  const organisation = await transaction.queryRow<OrganisationRow>`
    SELECT id, name, status
    FROM organisations
    WHERE id = ${organisationId}
    FOR UPDATE
  `;

  if (organisation === null) {
    throw new FirstAdministratorCeremonyError(
      "organisation_not_found",
      `no organisation ${organisationId} exists in this environment`,
    );
  }

  if (organisation.status !== "active") {
    throw new FirstAdministratorCeremonyError(
      "organisation_not_active",
      `organisation ${organisationId} is ${organisation.status}`,
    );
  }

  return organisation;
}

/**
 * The real safety property, and the reason this is a bootstrap rather than a
 * recovery tool: a single existing principal in the target organisation stops
 * it. Assignments and scopes cannot exist without a membership, but they are
 * counted anyway so that a partially built organisation also refuses.
 */
async function assertOrganisationHoldsNoPrincipal(
  transaction: Transaction,
  organisationId: string,
): Promise<void> {
  const populated = await transaction.queryRow<{
    memberships: number;
    assignments: number;
    scopes: number;
  }>`
    SELECT
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE organisation_id = ${organisationId}) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE organisation_id = ${organisationId}) AS assignments,
      (SELECT count(*)::integer FROM assignment_scopes
       WHERE organisation_id = ${organisationId}) AS scopes
  `;

  if (populated === null) {
    throw new FirstAdministratorCeremonyError(
      "organisation_already_populated",
      "the population query returned no row",
    );
  }

  if (
    populated.memberships > 0 ||
    populated.assignments > 0 ||
    populated.scopes > 0
  ) {
    throw new FirstAdministratorCeremonyError(
      "organisation_already_populated",
      `organisation already holds ${populated.memberships} membership(s), ` +
        `${populated.assignments} assignment(s), and ${populated.scopes} scope(s); ` +
        "this ceremony is a bootstrap, not a recovery or escalation tool",
    );
  }
}

/**
 * A second, independent refusal that survives row deletion. `system_audit_events`
 * rejects UPDATE and DELETE, so a prior ceremony in this organisation is a fact
 * nobody can quietly remove in order to run it again.
 */
async function assertNotPreviouslyBootstrapped(
  transaction: Transaction,
  organisationId: string,
): Promise<void> {
  const previous = await transaction.queryRow<{ events: number }>`
    SELECT count(*)::integer AS events
    FROM system_audit_events
    WHERE organisation_id = ${organisationId}
      AND action IN (${BOOTSTRAP_AUDIT_ACTION}, ${MAPPING_AUDIT_ACTION})
  `;

  if (previous !== null && previous.events > 0) {
    throw new FirstAdministratorCeremonyError(
      "already_bootstrapped",
      `${previous.events} append-only ceremony audit event(s) already exist for this organisation`,
    );
  }
}

async function assertIdentityUnmapped(
  transaction: Transaction,
  providerKey: string,
  providerSubject: string,
): Promise<void> {
  const existing = await transaction.queryRow<{ id: string }>`
    SELECT id
    FROM external_identity_mappings
    WHERE provider_key = ${providerKey}
      AND provider_subject = ${providerSubject}
    FOR UPDATE
  `;

  if (existing !== null) {
    throw new FirstAdministratorCeremonyError(
      "identity_already_mapped",
      "the supplied Entra identity is already mapped to a principal",
    );
  }
}

/**
 * Verifies — and never repairs — the ADR-0006 canonical System Administrator
 * definition for this organisation. Provisioning is a reviewed path of its own;
 * a ceremony this privileged reads the role, it does not mint or mutate one.
 */
async function loadCanonicalSystemAdministratorRole(
  transaction: Transaction,
  organisationId: string,
): Promise<CanonicalRoleRow> {
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
    WHERE definition.organisation_id = ${organisationId}
      AND definition.role_key = 'system_administrator'
      AND definition.status = 'active'
      AND template.status = 'active'
    ORDER BY definition.id
    FOR UPDATE OF definition
  `;

  if (roles.length !== 1) {
    throw new FirstAdministratorCeremonyError(
      "canonical_role_unavailable",
      `${roles.length} active canonical System Administrator definitions found; exactly one is required`,
    );
  }

  const role = roles[0];
  if (
    role.role_key !== SYSTEM_ADMINISTRATOR_ROLE.key ||
    role.name !== SYSTEM_ADMINISTRATOR_ROLE.name ||
    role.description !== SYSTEM_ADMINISTRATOR_DESCRIPTION ||
    role.version !== SYSTEM_ADMINISTRATOR_ROLE.version ||
    role.source_template_key !== SYSTEM_ADMINISTRATOR_ROLE.key ||
    role.source_template_version !== SYSTEM_ADMINISTRATOR_ROLE.version ||
    role.template_name !== SYSTEM_ADMINISTRATOR_ROLE.name ||
    role.template_description !== SYSTEM_ADMINISTRATOR_DESCRIPTION
  ) {
    throw new FirstAdministratorCeremonyError(
      "canonical_role_unavailable",
      "the organisation's System Administrator definition diverges from the canonical template",
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

  for (const [label, rows] of [
    ["definition", definitionCapabilities],
    ["template", templateCapabilities],
  ] as const) {
    const codes = rows.map(({ capability_code }) => capability_code);
    if (
      codes.length !== SYSTEM_ADMINISTRATOR_CAPABILITIES.length ||
      codes.some(
        (code, index) => code !== SYSTEM_ADMINISTRATOR_CAPABILITIES[index],
      )
    ) {
      throw new FirstAdministratorCeremonyError(
        "canonical_role_unavailable",
        `the System Administrator ${label} capabilities are not the canonical set`,
      );
    }
  }

  return role;
}

async function assertCreatedAssignment(
  transaction: Transaction,
  organisationId: string,
  assignmentId: string,
  membershipId: string,
  roleDefinitionId: string,
): Promise<void> {
  const assignment = await transaction.queryRow<AssignmentRow>`
    SELECT
      id,
      organisation_id,
      organisation_membership_id,
      role_definition_id,
      status,
      granted_by_principal_id,
      grant_source_type,
      effective_to
    FROM role_assignments
    WHERE id = ${assignmentId}
  `;

  if (
    assignment === null ||
    assignment.organisation_id !== organisationId ||
    assignment.organisation_membership_id !== membershipId ||
    assignment.role_definition_id !== roleDefinitionId ||
    assignment.status !== "active" ||
    assignment.granted_by_principal_id !== null ||
    assignment.grant_source_type !== "bootstrap" ||
    assignment.effective_to !== null
  ) {
    throw new FirstAdministratorCeremonyError(
      "exactly_one_violated",
      "the created assignment is not the expected open canonical bootstrap grant",
    );
  }
}

async function countCreated(
  transaction: Transaction,
  organisationId: string,
  principalId: string,
  roleDefinitionId: string,
  providerKey: string,
  providerSubject: string,
): Promise<CeremonyCounts> {
  const counts = await transaction.queryRow<CeremonyCounts>`
    SELECT
      (SELECT count(*)::integer FROM principals
       WHERE id = ${principalId} AND status = 'active') AS principals,
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE organisation_id = ${organisationId}) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE organisation_id = ${organisationId}) AS assignments,
      (SELECT count(*)::integer FROM assignment_scopes
       WHERE organisation_id = ${organisationId}) AS scopes,
      (SELECT count(*)::integer FROM external_identity_mappings
       WHERE principal_id = ${principalId}) AS "principalMappings",
      (SELECT count(*)::integer FROM external_identity_mappings
       WHERE provider_key = ${providerKey}
         AND provider_subject = ${providerSubject}) AS "subjectMappings",
      (SELECT count(*)::integer FROM role_capabilities
       WHERE role_definition_id = ${roleDefinitionId}) AS "roleCapabilities",
      (SELECT count(*)::integer FROM system_audit_events
       WHERE organisation_id = ${organisationId}
         AND action IN (${BOOTSTRAP_AUDIT_ACTION}, ${MAPPING_AUDIT_ACTION})) AS "auditEvents"
  `;

  if (counts === null) {
    throw new FirstAdministratorCeremonyError(
      "exactly_one_violated",
      "the verification count query returned no row",
    );
  }

  return counts;
}

/**
 * Asserts the counts are exactly one — never "at least one". Anything else
 * throws, and the transaction rolls back with nothing created.
 */
function assertExactlyOne(counts: CeremonyCounts): void {
  const expected: CeremonyCounts = {
    principals: 1,
    memberships: 1,
    assignments: 1,
    scopes: 1,
    principalMappings: 1,
    subjectMappings: 1,
    roleCapabilities: SYSTEM_ADMINISTRATOR_CAPABILITIES.length,
    auditEvents: CEREMONY_AUDIT_ACTIONS.length,
  };

  const divergent = (Object.keys(expected) as (keyof CeremonyCounts)[])
    .filter((key) => counts[key] !== expected[key])
    .map((key) => `${key}: found ${counts[key]}, required ${expected[key]}`);

  if (divergent.length > 0) {
    throw new FirstAdministratorCeremonyError(
      "exactly_one_violated",
      divergent.join("; "),
    );
  }
}

/**
 * Runs the ceremony, and — only when `apply` is true — commits it.
 *
 * A dry run performs the identical work inside the same transaction and then
 * rolls it back, so every constraint, trigger, and canonical-role check is
 * genuinely exercised and nothing is persisted. The deferred People & Access
 * last-administrator guard is forced to run with `SET CONSTRAINTS ALL IMMEDIATE`
 * before either outcome, because a deferred constraint trigger would otherwise
 * never fire in a transaction that ends in a rollback — a dry run that skipped it
 * would be a weaker rehearsal than it claims to be.
 */
export async function runFirstAdministratorCeremony(
  input: FirstAdministratorCeremonyInput,
  dependencies: FirstAdministratorCeremonyDependencies,
): Promise<FirstAdministratorCeremonyReport> {
  const apply = input.apply === true;

  // Both of these must remain before centreSuccessDB.begin(): a refused
  // environment or a malformed identifier cannot open a transaction at all.
  assertEnvironmentGate(input, dependencies.environment, apply);
  const validated = validateInput(input, dependencies.configuredTenantId);

  // Captured before the transaction starts so that effective_from is at or
  // before the transaction clock. Postgres now() is transaction-start time, and
  // the reachability guard compares against it.
  const occurredAt = (dependencies.now ?? (() => new Date()))();

  const principalId = randomUUID();
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  const scopeId = randomUUID();
  const mappingId = randomUUID();

  const transaction = await centreSuccessDB.begin();
  let committed = false;

  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    await transaction.exec`
      SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY_HIGH}, ${ADVISORY_LOCK_KEY_LOW})
    `;

    const organisation = await loadOrganisation(
      transaction,
      validated.organisationId,
    );
    await assertOrganisationHoldsNoPrincipal(transaction, organisation.id);
    await assertNotPreviouslyBootstrapped(transaction, organisation.id);
    await assertIdentityUnmapped(
      transaction,
      validated.providerKey,
      validated.providerSubject,
    );
    const role = await loadCanonicalSystemAdministratorRole(
      transaction,
      organisation.id,
    );

    await transaction.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${principalId}, ${validated.displayName}, 'active')
    `;
    await transaction.exec`
      INSERT INTO organisation_memberships (
        id,
        organisation_id,
        principal_id,
        status,
        effective_from
      ) VALUES (
        ${membershipId},
        ${organisation.id},
        ${principalId},
        'active',
        ${occurredAt}
      )
    `;
    // grant_source_type 'bootstrap' is the schema's own statement that no
    // principal granted this: role_assignments_grant_actor_check requires
    // granted_by_principal_id to be NULL for a bootstrap grant.
    await transaction.exec`
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
        ${organisation.id},
        ${membershipId},
        ${role.id},
        'active',
        ${occurredAt},
        NULL,
        NULL,
        'bootstrap',
        ${`${ASSIGNMENT_REASON_PREFIX}${validated.reason}`}
      )
    `;
    await transaction.exec`
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
        ${organisation.id},
        ${assignmentId},
        'organisation',
        NULL,
        NULL,
        ${occurredAt},
        NULL
      )
    `;
    await transaction.exec`
      INSERT INTO external_identity_mappings (
        id,
        principal_id,
        provider_key,
        provider_subject,
        status,
        last_verified_at
      ) VALUES (
        ${mappingId},
        ${principalId},
        ${validated.providerKey},
        ${validated.providerSubject},
        'active',
        NULL
      )
    `;

    // actor_principal_id is deliberately NULL on both events. The created
    // administrator did not perform this action — they are its subject — and
    // recording them as the actor would assert that they granted themselves the
    // role, which is exactly the escalation appearance this ceremony must not
    // have. The human operator holds no principal, because none exists yet;
    // they are accountable through the out-of-band change record, and the
    // ceremony itself is attributed by grant_source_type 'bootstrap' and by
    // context.source below.
    await recordAuditEventWithExecutor(transaction, {
      organisationId: organisation.id,
      action: BOOTSTRAP_AUDIT_ACTION,
      resourceType: "role_assignment",
      resourceId: assignmentId,
      scopeType: "organisation",
      scopeId: organisation.id,
      context: {
        ceremonyVersion: CEREMONY_VERSION,
        source: CEREMONY_SOURCE,
        environment: dependencies.environment.name,
        principalId,
        roleKey: SYSTEM_ADMINISTRATOR_ROLE.key,
        roleVersion: SYSTEM_ADMINISTRATOR_ROLE.version,
        reason: validated.reason,
      },
      occurredAt,
    });
    // Deliberately the same minimised shape as the existing local mapping
    // event: provider, source, and reason. No tid, no oid, no provider key, no
    // provider subject, no email, no credential of any kind.
    await recordAuditEventWithExecutor(transaction, {
      organisationId: organisation.id,
      action: MAPPING_AUDIT_ACTION,
      resourceType: "external_identity_mapping",
      resourceId: mappingId,
      scopeType: "principal",
      scopeId: principalId,
      context: {
        ceremonyVersion: CEREMONY_VERSION,
        provider: "microsoft_entra",
        source: CEREMONY_SOURCE,
        environment: dependencies.environment.name,
        reason: validated.reason,
      },
      occurredAt,
    });

    await assertCreatedAssignment(
      transaction,
      organisation.id,
      assignmentId,
      membershipId,
      role.id,
    );
    const counts = await countCreated(
      transaction,
      organisation.id,
      principalId,
      role.id,
      validated.providerKey,
      validated.providerSubject,
    );
    assertExactlyOne(counts);

    // Force the deferred last-administrator guard from migrations 017 and 018 to
    // run now, so that a dry run exercises it exactly as an apply would.
    await transaction.exec`SET CONSTRAINTS ALL IMMEDIATE`;

    const reachable = await transaction.queryRow<{ reachable: number }>`
      SELECT reachable_system_administrator_count(${organisation.id}) AS reachable
    `;
    if (reachable === null || reachable.reachable !== 1) {
      throw new FirstAdministratorCeremonyError(
        "exactly_one_violated",
        `reachable System Administrators: found ${reachable?.reachable ?? "none"}, required 1`,
      );
    }

    if (apply) {
      await transaction.commit();
      committed = true;
    } else {
      // The dry run's whole contract: everything above ran against the real
      // schema and none of it survives.
      await transaction.rollback();
    }

    return {
      mode: apply ? "apply" : "dry_run",
      environment: {
        declared: input.declaredEnvironment.trim(),
        name: dependencies.environment.name,
        type: dependencies.environment.type,
        cloud: dependencies.environment.cloud,
        confirmationRequired: (
          CEREMONY_CONFIRMATION_ENVIRONMENT_NAMES as readonly string[]
        ).includes(dependencies.environment.name),
      },
      organisationId: organisation.id,
      organisationName: organisation.name,
      principalId,
      membershipId,
      assignmentId,
      scopeId,
      mappingId,
      roleKey: role.role_key,
      roleVersion: role.version,
      capabilities: SYSTEM_ADMINISTRATOR_CAPABILITIES,
      auditActions: CEREMONY_AUDIT_ACTIONS,
      counts,
      reachableSystemAdministrators: reachable.reachable,
      occurredAt: occurredAt.toISOString(),
      committed,
    };
  } catch (error) {
    if (!committed) {
      await transaction.rollback();
    }
    throw error;
  }
}

/**
 * Renders the report an operator reads before approving the real run.
 *
 * The operator's `tid` and `oid` are echoed back deliberately. They are the one
 * input nothing downstream can validate: a well-formed but mistyped `oid`
 * produces an administrator who can never sign in, and this ceremony refuses to
 * run a second time to fix it. Visual comparison against the Entra portal is the
 * only defence, and it is worth more than withholding two identifiers from the
 * operator's own terminal. Neither value reaches the audit log.
 */
export function formatFirstAdministratorCeremonyReport(
  report: FirstAdministratorCeremonyReport,
  operatorIdentity: { tenantId: string; oid: string },
): string {
  const lines: string[] = [];
  const heading =
    report.mode === "dry_run"
      ? "DRY RUN — nothing was written"
      : "APPLIED — the first administrator was created";

  lines.push(`Centre Success first-administrator ceremony — ${heading}`);
  lines.push("ADR-0021 D5. This creates the first principal who can grant everyone else access.");
  lines.push("");
  lines.push(`environment            ${report.environment.name} (type ${report.environment.type}, cloud ${report.environment.cloud})`);
  lines.push(`declared by operator   ${report.environment.declared}  (matched against appMeta)`);
  lines.push(`organisation-id        ${report.organisationId}`);
  lines.push(`organisation-name      ${report.organisationName}`);
  lines.push(`occurred-at            ${report.occurredAt}`);
  lines.push("");
  lines.push("OPERATOR INPUT — verify these against the Entra portal before applying.");
  lines.push(`  tenant-id (tid)      ${operatorIdentity.tenantId}`);
  lines.push(`  object-id  (oid)     ${operatorIdentity.oid}`);
  lines.push("  A well-formed but mistyped oid creates an administrator who can never");
  lines.push("  sign in, and this ceremony refuses to run twice. Check it now.");
  lines.push("");
  lines.push("would create exactly one of each:");
  lines.push(`  principal            ${report.principalId}`);
  lines.push(`  membership           ${report.membershipId}`);
  lines.push(`  role assignment      ${report.assignmentId}  (${report.roleKey} v${report.roleVersion}, grant source bootstrap, granted by nobody)`);
  lines.push(`  assignment scope     ${report.scopeId}  (organisation)`);
  lines.push(`  identity mapping     ${report.mappingId}  (microsoft_entra)`);
  lines.push("");
  lines.push("verified counts (exactly one, not at least one)");
  // A fixed order, not the driver's key order, so two runs are comparable.
  const countLabels: readonly (readonly [keyof CeremonyCounts, string])[] = [
    ["principals", "principals"],
    ["memberships", "memberships"],
    ["assignments", "assignments"],
    ["scopes", "scopes"],
    ["principalMappings", "mappings (principal)"],
    ["subjectMappings", "mappings (subject)"],
    ["roleCapabilities", "role capabilities"],
    ["auditEvents", "audit events"],
  ];
  for (const [key, label] of countLabels) {
    lines.push(`  ${label.padEnd(20)} ${report.counts[key]}`);
  }
  lines.push(`  ${"reachable admins".padEnd(20)} ${report.reachableSystemAdministrators}`);
  lines.push("");
  lines.push(`canonical capabilities granted (${report.capabilities.length}) — no business content, per ADR-0009`);
  for (const capability of report.capabilities) {
    lines.push(`  ${capability}`);
  }
  lines.push("");
  lines.push(`append-only audit events (${report.auditActions.length}), actor NULL, carrying no credential and no Entra identifier`);
  for (const action of report.auditActions) {
    lines.push(`  ${action}`);
  }
  lines.push("");
  lines.push("this ceremony creates nothing else: no organisation, no centre, no");
  lines.push("second principal, no bespoke role, and no business-content capability.");

  return lines.join("\n");
}
