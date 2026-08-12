import { randomUUID } from "node:crypto";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import type { FoundationCapability } from "../authorization/capabilities";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { VerifiedEntraIdentity } from "../authentication/entra-access-token-verifier";
import { microsoftEntraProviderKey } from "../authentication/external-identity";
import { inSerializableTransaction } from "../transactions";
import type {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  PrincipalLifecycleResponse,
} from "./contracts";
import { loadInvitationSecurityConfiguration } from "./configuration";
import {
  canonicalPackageDigest,
  classifyAssignmentPackage,
  legacyPackageDigest,
} from "./package-policy";
import { getInvitationSummary, getPersonSummary } from "./queries";
import {
  constantTimeDigestMatch,
  correlateVerifiedInvitationIdentity,
  encryptInvitationToken,
  generateInvitationToken,
  invitationTokenDigest,
  normaliseInvitationEmail,
} from "./security";
import type {
  InvitationStatus,
  InvitationSummary,
  PersonSummary,
  PrivilegeClass,
  ProposedAssignment,
  ProposedScope,
} from "./types";
import { PeopleAccessError, requireReason, requireUuid } from "./types";

const INVITATION_EXPIRY_MS = 72 * 60 * 60 * 1_000;
const ACTIVE_INVITATION_STATUSES = new Set<InvitationStatus>([
  "DRAFT",
  "SENT",
  "IDENTITY_VERIFIED",
  "AWAITING_PRIVILEGED_APPROVAL",
  "ADMINISTRATOR_REVIEW",
]);

export interface PeopleAccessWorkflowDependencies {
  now: () => Date;
  randomId: () => string;
  randomToken: () => string;
  tokenDigestKey: string;
  deliveryEncryptionKey: string;
}

function runtimeDependencies(): PeopleAccessWorkflowDependencies {
  const security = loadInvitationSecurityConfiguration();
  return {
    now: () => new Date(),
    randomId: randomUUID,
    randomToken: generateInvitationToken,
    ...security,
  };
}

function safeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new PeopleAccessError("invalid_input", "display name is invalid");
  }
  const result = value.trim();
  if (result.length < 1 || result.length > 200) {
    throw new PeopleAccessError("invalid_input", "display name is invalid");
  }
  return result;
}

function parseEffectiveInstant(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) {
    throw new PeopleAccessError("invalid_input", "effective date is invalid");
  }
  return result;
}

function validateEffectiveWindow(assignment: ProposedAssignment, now: Date) {
  const effectiveFrom = parseEffectiveInstant(assignment.effectiveFrom, now);
  const effectiveTo = assignment.effectiveTo
    ? parseEffectiveInstant(assignment.effectiveTo, now)
    : null;
  if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new PeopleAccessError("invalid_input", "effective window is invalid");
  }
  return { effectiveFrom, effectiveTo };
}

async function recordInvitationEvent(
  transaction: Transaction,
  input: {
    organisationId: string;
    invitationId: string;
    actorPrincipalId?: string;
    eventType: string;
    fromStatus?: InvitationStatus;
    toStatus: InvitationStatus;
    reason?: string;
    context?: Record<string, string | number | boolean | null>;
    occurredAt: Date;
    eventId?: string;
  },
): Promise<void> {
  const sequence = await transaction.queryRow<{ next_sequence: number }>`
    SELECT COALESCE(max(event_sequence), 0)::integer + 1 AS next_sequence
    FROM invitation_events
    WHERE invitation_id = ${input.invitationId}
  `;
  await transaction.exec`
    INSERT INTO invitation_events (
      id, organisation_id, invitation_id, actor_principal_id, event_type,
      from_status, to_status, reason, context, occurred_at, event_sequence
    ) VALUES (
      ${input.eventId ?? randomUUID()}, ${input.organisationId}, ${input.invitationId},
      ${input.actorPrincipalId ?? null}, ${input.eventType}, ${input.fromStatus ?? null},
      ${input.toStatus}, ${input.reason ?? null}, ${input.context ?? {}},
      ${input.occurredAt}, ${sequence?.next_sequence ?? 1}
    )
  `;
}

interface RoleRow {
  id: string;
  role_key: string;
  name: string;
  version: number;
  status: "active" | "inactive";
  source_template_key: string | null;
  source_template_version: number | null;
  template_status: "active" | "inactive" | null;
}

async function validateScopeFacts(
  transaction: Transaction,
  organisationId: string,
  scope: ProposedScope,
  at: Date,
): Promise<void> {
  if (scope.scopeType === "organisation") return;
  if (scope.scopeType === "centre") {
    const centre = await transaction.queryRow<{ id: string }>`
      SELECT id FROM centres
      WHERE organisation_id = ${organisationId}
        AND id = ${requireUuid(scope.centreId, "centre ID")}
        AND status = 'active'
    `;
    if (!centre) throw new PeopleAccessError("invalid_input", "scope is not available");
    return;
  }
  const unit = await transaction.queryRow<{ id: string }>`
    SELECT id FROM organisational_units
    WHERE organisation_id = ${organisationId}
      AND id = ${requireUuid(scope.organisationalUnitId, "unit ID")}
      AND status = 'active'
      AND effective_from <= ${at}
      AND (effective_to IS NULL OR effective_to > ${at})
  `;
  if (!unit) throw new PeopleAccessError("invalid_input", "scope is not available");
}

async function assertCurrentPeopleAuthority(
  transaction: Transaction,
  organisationId: string,
  principalId: string,
  requiredCapabilities: FoundationCapability[],
  at: Date,
): Promise<void> {
  const rows = await transaction.queryAll<{ assignment_id: string; capability_code: string }>`
    SELECT assignment.id AS assignment_id, role_capability.capability_code
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
     AND membership.organisation_id = ${organisationId}
     AND membership.status = 'active'
     AND membership.effective_from <= ${at}
     AND (membership.effective_to IS NULL OR membership.effective_to > ${at})
    JOIN role_assignments AS assignment
      ON assignment.organisation_id = membership.organisation_id
     AND assignment.organisation_membership_id = membership.id
     AND assignment.status = 'active'
     AND assignment.effective_from <= ${at}
     AND (assignment.effective_to IS NULL OR assignment.effective_to > ${at})
    JOIN role_definitions AS role
      ON role.organisation_id = assignment.organisation_id
     AND role.id = assignment.role_definition_id
     AND role.status = 'active'
    JOIN role_capabilities AS role_capability
      ON role_capability.role_definition_id = role.id
    JOIN assignment_scopes AS scope
      ON scope.organisation_id = assignment.organisation_id
     AND scope.role_assignment_id = assignment.id
     AND scope.scope_type = 'organisation'
     AND scope.effective_from <= ${at}
     AND (scope.effective_to IS NULL OR scope.effective_to > ${at})
    WHERE principal.id = ${principalId}
      AND principal.status = 'active'
      AND EXISTS (
        SELECT 1 FROM external_identity_mappings AS mapping
        WHERE mapping.principal_id = principal.id
          AND mapping.status = 'active'
          AND mapping.provider_key LIKE 'microsoft_entra:%'
      )
      AND (
        SELECT count(*) FROM organisation_memberships AS current_membership
        WHERE current_membership.principal_id = principal.id
          AND current_membership.organisation_id = ${organisationId}
          AND current_membership.status = 'active'
          AND current_membership.effective_from <= ${at}
          AND (current_membership.effective_to IS NULL OR current_membership.effective_to > ${at})
      ) = 1
    FOR SHARE OF principal, membership, assignment, role, scope
  `;
  const byAssignment = new Map<string, Set<string>>();
  for (const row of rows) {
    const codes = byAssignment.get(row.assignment_id) ?? new Set<string>();
    codes.add(row.capability_code);
    byAssignment.set(row.assignment_id, codes);
  }
  if (![...byAssignment.values()].some((codes) =>
    requiredCapabilities.every((required) => codes.has(required)))) {
    throw new PeopleAccessError("access_denied", "resource is not available");
  }
}

async function loadAndValidateRole(
  transaction: Transaction,
  organisationId: string,
  roleKey: string,
): Promise<RoleRow> {
  const rows = await transaction.queryAll<RoleRow>`
    SELECT definition.id, definition.role_key, definition.name, definition.version,
           definition.status, definition.source_template_key,
           definition.source_template_version, template.status AS template_status
    FROM role_definitions AS definition
    LEFT JOIN canonical_role_templates AS template
      ON template.role_key = definition.source_template_key
     AND template.version = definition.source_template_version
    WHERE definition.organisation_id = ${organisationId}
      AND definition.role_key = ${roleKey}
      AND definition.status = 'active'
    FOR UPDATE OF definition
  `;
  if (
    rows.length !== 1 ||
    rows[0].source_template_key !== rows[0].role_key ||
    rows[0].source_template_version !== rows[0].version ||
    rows[0].template_status !== "active"
  ) {
    throw new PeopleAccessError("invalid_input", "role is not available");
  }
  return rows[0];
}

async function validatePackageFacts(
  transaction: Transaction,
  organisationId: string,
  assignments: ProposedAssignment[],
  at: Date,
): Promise<Array<{ input: ProposedAssignment; role: RoleRow; effectiveFrom: Date; effectiveTo: Date | null }>> {
  const result = [];
  for (const assignment of assignments) {
    const role = await loadAndValidateRole(transaction, organisationId, assignment.roleKey);
    const window = validateEffectiveWindow(assignment, at);
    if (window.effectiveTo && window.effectiveTo.getTime() <= at.getTime()) {
      throw new PeopleAccessError("invalid_input", "effective window is no longer current");
    }
    for (const scope of assignment.scopes) {
      await validateScopeFacts(transaction, organisationId, scope, at);
    }
    result.push({ input: assignment, role, ...window });
  }
  return result;
}

export async function createInvitation(
  input: {
    organisationId: string;
    actorPrincipalId: string;
    request: CreateInvitationRequest;
  },
  dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies(),
): Promise<InvitationSummary> {
  const organisationId = requireUuid(input.organisationId, "organisation ID");
  const actorPrincipalId = requireUuid(input.actorPrincipalId, "actor ID");
  const intendedEmail = normaliseInvitationEmail(input.request.email);
  const displayName = safeDisplayName(input.request.displayName);
  const reason = requireReason(input.request.reason);
  const occurredAt = dependencies.now();
  const normalisedAssignments = input.request.assignments.map((assignment) => {
    const window = validateEffectiveWindow(assignment, occurredAt);
    return {
      ...assignment,
      effectiveFrom: window.effectiveFrom.toISOString(),
      effectiveTo: window.effectiveTo?.toISOString(),
    };
  });
  const privilegeClass = classifyAssignmentPackage(normalisedAssignments);
  const invitationId = dependencies.randomId();
  const principalId = dependencies.randomId();

  await inSerializableTransaction(async (transaction) => {
    await transaction.exec`SELECT pg_advisory_xact_lock(hashtextextended(${organisationId}, 20504))`;
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.invitationManage, capability.assignmentManage],
      occurredAt,
    );
    const resolved = await validatePackageFacts(transaction, organisationId, normalisedAssignments, occurredAt);
    const packageDigest = canonicalPackageDigest({
      organisationId,
      privilegeClass,
      assignments: resolved.map((assignment) => ({
        roleDefinitionId: assignment.role.id,
        roleKey: assignment.role.role_key,
        roleVersion: assignment.role.version,
        privilegeClass,
        scopes: assignment.input.scopes,
        effectiveFrom: assignment.effectiveFrom.toISOString(),
        effectiveTo: assignment.effectiveTo?.toISOString() ?? null,
      })),
    });
    await transaction.exec`
      INSERT INTO principals (id, display_name, status, created_at, updated_at)
      VALUES (${principalId}, ${displayName}, 'pending', ${occurredAt}, ${occurredAt})
    `;
    await transaction.exec`
      INSERT INTO access_invitations (
        id, organisation_id, pending_principal_id, intended_email, status,
        privilege_class, package_version, package_digest, reason, created_by_principal_id,
        created_at, updated_at
      ) VALUES (
        ${invitationId}, ${organisationId}, ${principalId}, ${intendedEmail}, 'DRAFT',
        ${privilegeClass}, 2, ${packageDigest}, ${reason}, ${actorPrincipalId},
        ${occurredAt}, ${occurredAt}
      )
    `;
    for (let index = 0; index < resolved.length; index += 1) {
      const assignment = resolved[index];
      const proposalId = dependencies.randomId();
      await transaction.exec`
        INSERT INTO invitation_role_proposals (
          id, organisation_id, invitation_id, role_definition_id, role_key,
          role_version, privilege_class, ordinal, effective_from, effective_to,
          created_at
        ) VALUES (
          ${proposalId}, ${organisationId}, ${invitationId}, ${assignment.role.id},
          ${assignment.role.role_key}, ${assignment.role.version}, ${privilegeClass},
          ${index + 1}, ${assignment.effectiveFrom}, ${assignment.effectiveTo}, ${occurredAt}
        )
      `;
      for (const scope of assignment.input.scopes) {
        await transaction.exec`
          INSERT INTO invitation_scope_proposals (
            id, organisation_id, invitation_role_proposal_id, scope_type,
            organisational_unit_id, centre_id, effective_from, effective_to,
            created_at
          ) VALUES (
            ${dependencies.randomId()}, ${organisationId}, ${proposalId}, ${scope.scopeType},
            ${scope.scopeType === "organisational_unit" ? scope.organisationalUnitId : null},
            ${scope.scopeType === "centre" ? scope.centreId : null},
            ${assignment.effectiveFrom}, ${assignment.effectiveTo}, ${occurredAt}
          )
        `;
      }
    }
    await recordInvitationEvent(transaction, {
      organisationId,
      invitationId,
      actorPrincipalId,
      eventType: "INVITATION_CREATED",
      toStatus: "DRAFT",
      reason,
      context: { privilegeClass, packageVersion: 2 },
      occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId,
      actorPrincipalId,
      action: "invitation.created",
      resourceType: "access_invitation",
      resourceId: invitationId,
      scopeType: "organisation",
      scopeId: organisationId,
      context: { privilegeClass, packageVersion: 2, reasonRecorded: true },
      occurredAt,
    });
  });
  return getInvitationSummary(organisationId, invitationId);
}

interface LockedInvitationRow {
  id: string;
  organisation_id: string;
  pending_principal_id: string;
  intended_email: string;
  status: InvitationStatus;
  privilege_class: PrivilegeClass;
  package_version: number;
  package_digest: ArrayBuffer;
  created_by_principal_id: string;
  verified_provider_key: string | null;
  verified_provider_subject: string | null;
  expires_at: Date | null;
  lock_version: number;
}

async function lockInvitation(
  transaction: Transaction,
  organisationId: string,
  invitationId: string,
): Promise<LockedInvitationRow> {
  const row = await transaction.queryRow<LockedInvitationRow>`
    SELECT id, organisation_id, pending_principal_id, intended_email, status,
           privilege_class, package_version, package_digest,
           created_by_principal_id, verified_provider_key,
           verified_provider_subject, expires_at, lock_version
    FROM access_invitations
    WHERE organisation_id = ${organisationId} AND id = ${invitationId}
    FOR UPDATE
  `;
  if (!row) throw new PeopleAccessError("not_found", "resource is not available");
  return row;
}

export async function sendInvitation(
  input: {
    organisationId: string;
    invitationId: string;
    actorPrincipalId: string;
    expectedLockVersion: number;
    resend: boolean;
  },
  dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies(),
): Promise<InvitationSummary> {
  const organisationId = requireUuid(input.organisationId);
  const invitationId = requireUuid(input.invitationId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const occurredAt = dependencies.now();
  const expiresAt = new Date(occurredAt.getTime() + INVITATION_EXPIRY_MS);
  const token = dependencies.randomToken();
  const tokenDigest = invitationTokenDigest(token, dependencies.tokenDigestKey);
  const encrypted = encryptInvitationToken(token, dependencies.deliveryEncryptionKey);

  const outcome: "sent" | "expired" = await inSerializableTransaction(async (transaction) => {
    const invitation = await lockInvitation(transaction, organisationId, invitationId);
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.invitationManage],
      occurredAt,
    );
    if (invitation.lock_version !== input.expectedLockVersion) {
      throw new PeopleAccessError("version_conflict", "invitation changed");
    }
    if ((!input.resend && invitation.status !== "DRAFT") ||
        (input.resend && !ACTIVE_INVITATION_STATUSES.has(invitation.status))) {
      throw new PeopleAccessError("invalid_state", "invitation cannot be sent");
    }
    if (
      input.resend
      && invitation.expires_at
      && invitation.expires_at.getTime() <= occurredAt.getTime()
    ) {
      await transaction.exec`
        UPDATE invitation_token_generations
        SET status = 'EXPIRED', updated_at = ${occurredAt},
            lock_version = lock_version + 1
        WHERE invitation_id = ${invitationId} AND status = 'CURRENT'
      `;
      await transaction.exec`
        UPDATE access_invitations
        SET status = 'EXPIRED', updated_at = ${occurredAt},
            lock_version = lock_version + 1
        WHERE id = ${invitationId}
      `;
      await recordInvitationEvent(transaction, {
        organisationId,
        invitationId,
        actorPrincipalId,
        eventType: "INVITATION_EXPIRED",
        fromStatus: invitation.status,
        toStatus: "EXPIRED",
        occurredAt,
      });
      await recordAuditEventWithExecutor(transaction, {
        organisationId,
        actorPrincipalId,
        action: "invitation.expired",
        resourceType: "access_invitation",
        resourceId: invitationId,
        scopeType: "organisation",
        scopeId: organisationId,
        context: { source: "resend_expiry_check" },
        occurredAt,
      });
      return "expired";
    }

    const generation = await transaction.queryRow<{ next_generation: number }>`
      SELECT COALESCE(max(generation), 0)::integer + 1 AS next_generation
      FROM invitation_token_generations WHERE invitation_id = ${invitationId}
    `;
    if (input.resend) {
      await transaction.exec`
        UPDATE invitation_token_generations
        SET status = 'INVALIDATED', invalidated_at = ${occurredAt},
            updated_at = ${occurredAt}, lock_version = lock_version + 1
        WHERE invitation_id = ${invitationId} AND status = 'CURRENT'
      `;
    }
    const generationId = dependencies.randomId();
    const generationNumber = generation?.next_generation ?? 1;
    await transaction.exec`
      INSERT INTO invitation_token_generations (
        id, organisation_id, invitation_id, generation, token_digest, status,
        expires_at, created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${generationId}, ${organisationId}, ${invitationId}, ${generationNumber},
        ${tokenDigest}, 'CURRENT', ${expiresAt}, ${actorPrincipalId},
        ${occurredAt}, ${occurredAt}
      )
    `;
    await transaction.exec`
      INSERT INTO people_notification_outbox (
        id, organisation_id, invitation_id, token_generation_id,
        idempotency_key, recipient_email, encrypted_token, encryption_iv,
        encryption_tag, status, next_attempt_at, created_at, updated_at
      ) VALUES (
        ${dependencies.randomId()}, ${organisationId}, ${invitationId}, ${generationId},
        ${`invitation:${invitationId}:generation:${generationNumber}`},
        ${invitation.intended_email}, ${encrypted.ciphertext}, ${encrypted.iv},
        ${encrypted.tag}, 'PENDING', ${occurredAt}, ${occurredAt}, ${occurredAt}
      )
    `;
    const eventType = input.resend ? "INVITATION_RESENT" : "INVITATION_SENT";
    await transaction.exec`
      UPDATE access_invitations
      SET status = 'SENT', expires_at = ${expiresAt}, sent_at = ${occurredAt},
          verified_provider_key = NULL, verified_provider_subject = NULL,
          verification_reason = NULL, updated_at = ${occurredAt},
          lock_version = lock_version + 1
      WHERE id = ${invitationId}
    `;
    await recordInvitationEvent(transaction, {
      organisationId,
      invitationId,
      actorPrincipalId,
      eventType,
      fromStatus: invitation.status,
      toStatus: "SENT",
      context: { generation: generationNumber, expiresInHours: 72 },
      occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId,
      actorPrincipalId,
      action: input.resend ? "invitation.resent" : "invitation.sent",
      resourceType: "access_invitation",
      resourceId: invitationId,
      scopeType: "organisation",
      scopeId: organisationId,
      context: { generation: generationNumber, expiresInHours: 72 },
      occurredAt,
    });
    return "sent";
  });
  if (outcome === "expired") {
    throw new PeopleAccessError("invitation_expired", "invitation has expired");
  }
  return getInvitationSummary(organisationId, invitationId);
}

export async function cancelInvitation(input: {
  organisationId: string;
  invitationId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<InvitationSummary> {
  const organisationId = requireUuid(input.organisationId);
  const invitationId = requireUuid(input.invitationId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  await inSerializableTransaction(async (transaction) => {
    const invitation = await lockInvitation(transaction, organisationId, invitationId);
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.invitationManage],
      occurredAt,
    );
    if (invitation.lock_version !== input.expectedLockVersion) {
      throw new PeopleAccessError("version_conflict", "invitation changed");
    }
    if (!ACTIVE_INVITATION_STATUSES.has(invitation.status)) {
      throw new PeopleAccessError("invalid_state", "invitation cannot be cancelled");
    }
    await transaction.exec`
      UPDATE invitation_token_generations
      SET status = 'INVALIDATED', invalidated_at = ${occurredAt},
          updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE invitation_id = ${invitationId} AND status = 'CURRENT'
    `;
    await transaction.exec`
      UPDATE access_invitations
      SET status = 'CANCELLED', cancelled_at = ${occurredAt}, updated_at = ${occurredAt},
          lock_version = lock_version + 1
      WHERE id = ${invitationId}
    `;
    await recordInvitationEvent(transaction, {
      organisationId, invitationId, actorPrincipalId,
      eventType: "INVITATION_CANCELLED", fromStatus: invitation.status,
      toStatus: "CANCELLED", reason, occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId, action: "invitation.cancelled",
      resourceType: "access_invitation", resourceId: invitationId,
      scopeType: "organisation", scopeId: organisationId,
      context: { reasonRecorded: true }, occurredAt,
    });
  });
  return getInvitationSummary(organisationId, invitationId);
}

interface ProposalActivationRow {
  id: string;
  role_definition_id: string;
  role_key: string;
  role_version: number;
  privilege_class: PrivilegeClass;
  effective_from: Date;
  effective_to: Date | null;
  role_status: "active" | "inactive";
  source_template_key: string | null;
  source_template_version: number | null;
  template_status: "active" | "inactive" | null;
}

interface ProposalScopeRow {
  invitation_role_proposal_id: string;
  scope_type: ProposedScope["scopeType"];
  organisational_unit_id: string | null;
  centre_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
}

async function loadActivationPackage(
  transaction: Transaction,
  invitation: LockedInvitationRow,
  occurredAt: Date,
) {
  const proposals = await transaction.queryAll<ProposalActivationRow>`
    SELECT proposal.id, proposal.role_definition_id, proposal.role_key,
           proposal.role_version, proposal.privilege_class,
           proposal.effective_from, proposal.effective_to,
           definition.status AS role_status, definition.source_template_key,
           definition.source_template_version, template.status AS template_status
    FROM invitation_role_proposals AS proposal
    JOIN role_definitions AS definition
      ON definition.organisation_id = proposal.organisation_id
     AND definition.id = proposal.role_definition_id
    LEFT JOIN canonical_role_templates AS template
      ON template.role_key = definition.source_template_key
     AND template.version = definition.source_template_version
    WHERE proposal.organisation_id = ${invitation.organisation_id}
      AND proposal.invitation_id = ${invitation.id}
    ORDER BY proposal.ordinal
    FOR UPDATE OF proposal, definition
  `;
  const scopes = await transaction.queryAll<ProposalScopeRow>`
    SELECT scope.invitation_role_proposal_id, scope.scope_type,
           scope.organisational_unit_id, scope.centre_id,
           scope.effective_from, scope.effective_to
    FROM invitation_scope_proposals AS scope
    JOIN invitation_role_proposals AS proposal
      ON proposal.organisation_id = scope.organisation_id
     AND proposal.id = scope.invitation_role_proposal_id
    WHERE proposal.invitation_id = ${invitation.id}
    ORDER BY proposal.ordinal, scope.id
    FOR UPDATE OF scope
  `;
  if (proposals.length === 0 || proposals.some((proposal) =>
    proposal.role_status !== "active" ||
    proposal.source_template_key !== proposal.role_key ||
    proposal.source_template_version !== proposal.role_version ||
    proposal.template_status !== "active")) {
    throw new PeopleAccessError("invalid_state", "invitation package is no longer available");
  }
  const reconstructed: ProposedAssignment[] = proposals.map((proposal) => ({
    roleKey: proposal.role_key,
    effectiveFrom: proposal.effective_from.toISOString(),
    effectiveTo: proposal.effective_to?.toISOString(),
    scopes: scopes.filter((scope) => scope.invitation_role_proposal_id === proposal.id).map((scope) => {
      if (scope.scope_type === "organisation") return { scopeType: "organisation" };
      if (scope.scope_type === "organisational_unit") {
        return { scopeType: "organisational_unit", organisationalUnitId: scope.organisational_unit_id! };
      }
      return { scopeType: "centre", centreId: scope.centre_id! };
    }),
  }));
  const classification = classifyAssignmentPackage(reconstructed);
  const packageDigest = invitation.package_version === 1
    ? legacyPackageDigest(reconstructed)
    : invitation.package_version === 2
      ? canonicalPackageDigest({
        organisationId: invitation.organisation_id,
        privilegeClass: invitation.privilege_class,
        assignments: proposals.map((proposal, index) => ({
          roleDefinitionId: proposal.role_definition_id,
          roleKey: proposal.role_key,
          roleVersion: proposal.role_version,
          privilegeClass: proposal.privilege_class,
          scopes: reconstructed[index].scopes,
          effectiveFrom: proposal.effective_from.toISOString(),
          effectiveTo: proposal.effective_to?.toISOString() ?? null,
        })),
      })
      : null;
  if (classification !== invitation.privilege_class ||
      packageDigest === null ||
      !constantTimeDigestMatch(packageDigest, invitation.package_digest)) {
    throw new PeopleAccessError("invalid_state", "invitation package changed");
  }
  for (const assignment of reconstructed) {
    const window = validateEffectiveWindow(assignment, occurredAt);
    if (window.effectiveTo && window.effectiveTo.getTime() <= occurredAt.getTime()) {
      throw new PeopleAccessError("invalid_state", "invitation package is no longer current");
    }
    for (const scope of assignment.scopes) {
      await validateScopeFacts(transaction, invitation.organisation_id, scope, occurredAt);
    }
  }
  return { proposals, scopes };
}

async function identityMappingConflict(
  transaction: Transaction,
  invitation: LockedInvitationRow,
  providerKey: string,
  providerSubject: string,
): Promise<boolean> {
  const conflict = await transaction.queryRow<{ principal_id: string }>`
    SELECT principal_id FROM external_identity_mappings
    WHERE provider_key = ${providerKey} AND provider_subject = ${providerSubject}
    FOR UPDATE
  `;
  return Boolean(conflict && conflict.principal_id !== invitation.pending_principal_id);
}

async function ensureIdentityAvailable(
  transaction: Transaction,
  invitation: LockedInvitationRow,
  providerKey: string,
  providerSubject: string,
): Promise<void> {
  if (await identityMappingConflict(transaction, invitation, providerKey, providerSubject)) {
    throw new PeopleAccessError("identity_review_required", "identity requires administrator review");
  }
}

async function activateInvitation(
  transaction: Transaction,
  input: {
    invitation: LockedInvitationRow;
    providerKey: string;
    providerSubject: string;
    actorPrincipalId?: string;
    occurredAt: Date;
    randomId: () => string;
  },
): Promise<void> {
  const { invitation } = input;
  const packageRows = await loadActivationPackage(transaction, invitation, input.occurredAt);
  await ensureIdentityAvailable(transaction, invitation, input.providerKey, input.providerSubject);
  const principal = await transaction.queryRow<{ status: string }>`
    SELECT status FROM principals WHERE id = ${invitation.pending_principal_id} FOR UPDATE
  `;
  if (principal?.status !== "pending") {
    throw new PeopleAccessError("invalid_state", "invitation principal is unavailable");
  }
  await transaction.exec`
    UPDATE principals
    SET status = 'active', updated_at = ${input.occurredAt}, lock_version = lock_version + 1
    WHERE id = ${invitation.pending_principal_id} AND status = 'pending'
  `;
  const membershipId = input.randomId();
  const mappingId = input.randomId();
  await transaction.exec`
    INSERT INTO external_identity_mappings (
      id, principal_id, provider_key, provider_subject, status,
      last_verified_at, created_at, updated_at
    ) VALUES (
      ${mappingId}, ${invitation.pending_principal_id}, ${input.providerKey},
      ${input.providerSubject}, 'active', ${input.occurredAt}, ${input.occurredAt}, ${input.occurredAt}
    )
  `;
  await transaction.exec`
    INSERT INTO organisation_memberships (
      id, organisation_id, principal_id, status, effective_from, created_at, updated_at
    ) VALUES (
      ${membershipId}, ${invitation.organisation_id}, ${invitation.pending_principal_id},
      'active', ${input.occurredAt}, ${input.occurredAt}, ${input.occurredAt}
    )
  `;
  await recordAuditEventWithExecutor(transaction, {
    organisationId: invitation.organisation_id,
    actorPrincipalId: input.actorPrincipalId,
    action: "identity.mapping.activated",
    resourceType: "external_identity_mapping",
    resourceId: mappingId,
    scopeType: "organisation",
    scopeId: invitation.organisation_id,
    context: { source: "invitation" },
    occurredAt: input.occurredAt,
  });
  await recordAuditEventWithExecutor(transaction, {
    organisationId: invitation.organisation_id,
    actorPrincipalId: input.actorPrincipalId,
    action: "principal.activated",
    resourceType: "principal",
    resourceId: invitation.pending_principal_id,
    scopeType: "organisation",
    scopeId: invitation.organisation_id,
    context: { source: "invitation" },
    occurredAt: input.occurredAt,
  });
  for (const proposal of packageRows.proposals) {
    const assignmentId = input.randomId();
    await transaction.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, granted_by_principal_id,
        grant_source_type, reason, created_at, updated_at
      ) VALUES (
        ${assignmentId}, ${invitation.organisation_id}, ${membershipId},
        ${proposal.role_definition_id}, 'active', ${proposal.effective_from},
        ${proposal.effective_to}, ${input.actorPrincipalId ?? null},
        ${input.actorPrincipalId ? "principal" : "system"},
        'Activated from an approved Centre Success invitation.',
        ${input.occurredAt}, ${input.occurredAt}
      )
    `;
    for (const scope of packageRows.scopes.filter((item) => item.invitation_role_proposal_id === proposal.id)) {
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          organisational_unit_id, centre_id, effective_from, effective_to, created_at
        ) VALUES (
          ${input.randomId()}, ${invitation.organisation_id}, ${assignmentId}, ${scope.scope_type},
          ${scope.organisational_unit_id}, ${scope.centre_id}, ${scope.effective_from},
          ${scope.effective_to}, ${input.occurredAt}
        )
      `;
    }
    await recordAuditEventWithExecutor(transaction, {
      organisationId: invitation.organisation_id,
      actorPrincipalId: input.actorPrincipalId,
      action: "role_assignment.granted",
      resourceType: "role_assignment",
      resourceId: assignmentId,
      scopeType: "organisation",
      scopeId: invitation.organisation_id,
      context: { source: "invitation", reasonRecorded: true },
      occurredAt: input.occurredAt,
    });
  }
  await transaction.exec`
    UPDATE access_invitations
    SET status = 'ACTIVATED', activated_at = ${input.occurredAt}, updated_at = ${input.occurredAt},
        lock_version = lock_version + 1
    WHERE id = ${invitation.id}
  `;
  await recordInvitationEvent(transaction, {
    organisationId: invitation.organisation_id,
    invitationId: invitation.id,
    actorPrincipalId: input.actorPrincipalId,
    eventType: "INVITATION_ACTIVATED",
    fromStatus: invitation.status,
    toStatus: "ACTIVATED",
    context: { assignmentCount: packageRows.proposals.length },
    occurredAt: input.occurredAt,
  });
  await recordAuditEventWithExecutor(transaction, {
    organisationId: invitation.organisation_id,
    actorPrincipalId: input.actorPrincipalId,
    action: "invitation.activated",
    resourceType: "access_invitation",
    resourceId: invitation.id,
    scopeType: "organisation",
    scopeId: invitation.organisation_id,
    context: { assignmentCount: packageRows.proposals.length, identityBound: true },
    occurredAt: input.occurredAt,
  });
}

interface TokenRow {
  id: string;
  organisation_id: string;
  invitation_id: string;
  token_digest: ArrayBuffer;
  status: "CURRENT" | "CONSUMED" | "INVALIDATED" | "EXPIRED";
  expires_at: Date;
}

export async function acceptInvitation(
  input: {
    invitationToken: string;
    compactJwt: string;
    verifiedIdentity: VerifiedEntraIdentity;
  },
  dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies(),
): Promise<AcceptInvitationResponse> {
  const occurredAt = dependencies.now();
  const requestedDigest = invitationTokenDigest(input.invitationToken, dependencies.tokenDigestKey);
  const outcome = await inSerializableTransaction(async (transaction): Promise<AcceptInvitationResponse | { outcome: "expired" }> => {
    const token = await transaction.queryRow<TokenRow>`
      SELECT id, organisation_id, invitation_id, token_digest, status, expires_at
      FROM invitation_token_generations
      WHERE token_digest = ${requestedDigest}
      FOR UPDATE
    `;
    if (!token || !constantTimeDigestMatch(token.token_digest, requestedDigest)) {
      throw new PeopleAccessError("invitation_superseded", "invitation is not available");
    }
    if (token.status === "CONSUMED") {
      throw new PeopleAccessError("invitation_replayed", "invitation was already used");
    }
    if (token.status === "INVALIDATED") {
      throw new PeopleAccessError("invitation_superseded", "invitation was replaced");
    }
    const invitation = await lockInvitation(transaction, token.organisation_id, token.invitation_id);
    if (invitation.status === "CANCELLED") {
      throw new PeopleAccessError("invitation_cancelled", "invitation was cancelled");
    }
    if (invitation.status === "ACTIVATED") {
      throw new PeopleAccessError("invitation_replayed", "invitation was already used");
    }
    if (token.expires_at.getTime() <= occurredAt.getTime()) {
      await transaction.exec`
        UPDATE invitation_token_generations SET status = 'EXPIRED', updated_at = ${occurredAt},
          lock_version = lock_version + 1 WHERE id = ${token.id}
      `;
      await transaction.exec`
        UPDATE access_invitations SET status = 'EXPIRED', updated_at = ${occurredAt},
          lock_version = lock_version + 1 WHERE id = ${invitation.id}
      `;
      await recordInvitationEvent(transaction, {
        organisationId: invitation.organisation_id, invitationId: invitation.id,
        eventType: "INVITATION_EXPIRED", fromStatus: invitation.status,
        toStatus: "EXPIRED", occurredAt,
      });
      return { outcome: "expired" };
    }
    if (token.status !== "CURRENT" || invitation.status !== "SENT") {
      throw new PeopleAccessError("invalid_state", "invitation is not available");
    }
    const correlation = correlateVerifiedInvitationIdentity({
      compactJwt: input.compactJwt,
      verifiedIdentity: input.verifiedIdentity,
      intendedEmail: invitation.intended_email,
    });
    const providerKey = microsoftEntraProviderKey(input.verifiedIdentity.tenantId);
    if (!providerKey) {
      throw new PeopleAccessError("identity_review_required", "identity requires administrator review");
    }
    await transaction.exec`
      UPDATE invitation_token_generations SET status = 'CONSUMED', consumed_at = ${occurredAt},
        updated_at = ${occurredAt}, lock_version = lock_version + 1 WHERE id = ${token.id}
    `;
    const mappingConflict = correlation.outcome === "matched"
      ? await identityMappingConflict(
        transaction,
        invitation,
        providerKey,
        input.verifiedIdentity.objectId,
      )
      : false;
    if (correlation.outcome === "review" || mappingConflict) {
      const reviewReason = correlation.outcome === "review"
        ? correlation.reason
        : "identity_mapping_conflict";
      await transaction.exec`
        UPDATE access_invitations SET status = 'ADMINISTRATOR_REVIEW',
          verification_reason = ${reviewReason}, updated_at = ${occurredAt},
          lock_version = lock_version + 1 WHERE id = ${invitation.id}
      `;
      await recordInvitationEvent(transaction, {
        organisationId: invitation.organisation_id, invitationId: invitation.id,
        eventType: "IDENTITY_REVIEW_REQUIRED", fromStatus: invitation.status,
        toStatus: "ADMINISTRATOR_REVIEW", context: { reason: reviewReason },
        occurredAt,
      });
      await recordAuditEventWithExecutor(transaction, {
        organisationId: invitation.organisation_id,
        action: "invitation.identity_review_required",
        resourceType: "access_invitation", resourceId: invitation.id,
        scopeType: "organisation", scopeId: invitation.organisation_id,
        context: { reason: reviewReason }, occurredAt,
      });
      return { outcome: "administrator_review", invitationStatus: "ADMINISTRATOR_REVIEW" };
    }
    if (invitation.privilege_class !== "STANDARD") {
      await transaction.exec`
        UPDATE access_invitations SET status = 'AWAITING_PRIVILEGED_APPROVAL',
          verified_provider_key = ${providerKey},
          verified_provider_subject = ${input.verifiedIdentity.objectId},
          verification_reason = 'exact_email_match', updated_at = ${occurredAt},
          lock_version = lock_version + 1 WHERE id = ${invitation.id}
      `;
      await recordInvitationEvent(transaction, {
        organisationId: invitation.organisation_id, invitationId: invitation.id,
        eventType: "IDENTITY_VERIFIED", fromStatus: invitation.status,
        toStatus: "AWAITING_PRIVILEGED_APPROVAL",
        context: { correlation: "exact_email_match" }, occurredAt,
      });
      return { outcome: "awaiting_approval", invitationStatus: "AWAITING_PRIVILEGED_APPROVAL" };
    }
    await assertCurrentPeopleAuthority(
      transaction,
      invitation.organisation_id,
      invitation.created_by_principal_id,
      [capability.invitationManage, capability.assignmentManage, capability.identityMappingManage],
      occurredAt,
    );
    await activateInvitation(transaction, {
      invitation,
      providerKey,
      providerSubject: input.verifiedIdentity.objectId,
      actorPrincipalId: invitation.created_by_principal_id,
      occurredAt,
      randomId: dependencies.randomId,
    });
    return { outcome: "activated", invitationStatus: "ACTIVATED" };
  });
  if (outcome.outcome === "expired") {
    throw new PeopleAccessError("invitation_expired", "invitation has expired");
  }
  return outcome;
}

export async function approvePrivilegedInvitation(input: {
  organisationId: string;
  invitationId: string;
  approverPrincipalId: string;
  expectedLockVersion: number;
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<InvitationSummary> {
  const organisationId = requireUuid(input.organisationId);
  const invitationId = requireUuid(input.invitationId);
  const approverPrincipalId = requireUuid(input.approverPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  await inSerializableTransaction(async (transaction) => {
    const invitation = await lockInvitation(transaction, organisationId, invitationId);
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      approverPrincipalId,
      [capability.privilegedAccessApprove, capability.assignmentManage, capability.identityMappingManage],
      occurredAt,
    );
    if (invitation.lock_version !== input.expectedLockVersion) {
      throw new PeopleAccessError("version_conflict", "invitation changed");
    }
    if (invitation.status !== "AWAITING_PRIVILEGED_APPROVAL" ||
        invitation.privilege_class === "STANDARD" ||
        !invitation.verified_provider_key || !invitation.verified_provider_subject) {
      throw new PeopleAccessError("invalid_state", "invitation is not awaiting approval");
    }
    if (approverPrincipalId === invitation.created_by_principal_id) {
      throw new PeopleAccessError("independent_approval_required", "another System Administrator must approve");
    }
    await loadActivationPackage(transaction, invitation, occurredAt);
    const approvalId = dependencies.randomId();
    await transaction.exec`
      INSERT INTO privileged_invitation_approvals (
        id, organisation_id, invitation_id, approver_principal_id,
        package_version, package_digest, status, reason, created_at
      ) VALUES (
        ${approvalId}, ${organisationId}, ${invitationId}, ${approverPrincipalId},
        ${invitation.package_version}, ${Buffer.from(invitation.package_digest)}, 'APPROVED', ${reason}, ${occurredAt}
      )
    `;
    await recordInvitationEvent(transaction, {
      organisationId, invitationId, actorPrincipalId: approverPrincipalId,
      eventType: "PRIVILEGED_ACCESS_APPROVED",
      fromStatus: invitation.status, toStatus: invitation.status,
      reason, context: { packageVersion: invitation.package_version }, occurredAt,
    });
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId: approverPrincipalId,
      action: "privileged_access.approved",
      resourceType: "privileged_invitation_approval", resourceId: approvalId,
      scopeType: "organisation", scopeId: organisationId,
      context: { packageVersion: invitation.package_version, reasonRecorded: true },
      occurredAt,
    });
    await activateInvitation(transaction, {
      invitation,
      providerKey: invitation.verified_provider_key,
      providerSubject: invitation.verified_provider_subject,
      actorPrincipalId: approverPrincipalId,
      occurredAt,
      randomId: dependencies.randomId,
    });
  });
  return getInvitationSummary(organisationId, invitationId);
}

interface LockedPersonRow {
  id: string;
  status: "active" | "suspended" | "revoked";
  lock_version: number;
  membership_id: string;
  membership_status: "active" | "inactive";
}

async function lockPerson(
  transaction: Transaction,
  organisationId: string,
  principalId: string,
): Promise<LockedPersonRow> {
  const rows = await transaction.queryAll<LockedPersonRow>`
    SELECT principal.id, principal.status, principal.lock_version,
           membership.id AS membership_id, membership.status AS membership_status
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
     AND membership.organisation_id = ${organisationId}
    WHERE principal.id = ${principalId}
    ORDER BY membership.id
    FOR UPDATE OF principal, membership
  `;
  if (rows.length !== 1 || rows[0].status === "revoked" && rows[0].membership_status !== "inactive") {
    throw new PeopleAccessError("not_found", "resource is not available");
  }
  return rows[0];
}

async function assertNotLastAdministrator(
  transaction: Transaction,
  organisationId: string,
  roleKey?: string,
): Promise<void> {
  if (roleKey !== undefined && roleKey !== "system_administrator") return;
  const row = await transaction.queryRow<{ count: number }>`
    SELECT reachable_system_administrator_count(${organisationId}) AS count
  `;
  if ((row?.count ?? 0) <= 1) {
    throw new PeopleAccessError("last_administrator", "another reachable System Administrator is required");
  }
}

export async function addRoleAssignment(input: {
  organisationId: string;
  targetPrincipalId: string;
  actorPrincipalId: string;
  assignment: ProposedAssignment;
  expectedPrincipalLockVersion: number;
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<PersonSummary> {
  const organisationId = requireUuid(input.organisationId);
  const targetPrincipalId = requireUuid(input.targetPrincipalId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  const assignment = {
    ...input.assignment,
    effectiveFrom: validateEffectiveWindow(input.assignment, occurredAt).effectiveFrom.toISOString(),
    effectiveTo: validateEffectiveWindow(input.assignment, occurredAt).effectiveTo?.toISOString(),
  };
  if (classifyAssignmentPackage([assignment]) !== "STANDARD") {
    throw new PeopleAccessError("privileged_approval_required", "privileged access requires invitation approval");
  }
  if (targetPrincipalId === actorPrincipalId) {
    throw new PeopleAccessError("access_denied", "self-directed access grants are not permitted");
  }
  await inSerializableTransaction(async (transaction) => {
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.assignmentManage],
      occurredAt,
    );
    const person = await lockPerson(transaction, organisationId, targetPrincipalId);
    if (person.status !== "active" || person.membership_status !== "active") {
      throw new PeopleAccessError("invalid_state", "principal is not active");
    }
    if (person.lock_version !== input.expectedPrincipalLockVersion) {
      throw new PeopleAccessError("version_conflict", "principal changed");
    }
    const [resolved] = await validatePackageFacts(transaction, organisationId, [assignment], occurredAt);
    const assignmentId = dependencies.randomId();
    await transaction.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, granted_by_principal_id,
        grant_source_type, reason, created_at, updated_at
      ) VALUES (
        ${assignmentId}, ${organisationId}, ${person.membership_id}, ${resolved.role.id},
        'active', ${resolved.effectiveFrom}, ${resolved.effectiveTo}, ${actorPrincipalId},
        'principal', ${reason}, ${occurredAt}, ${occurredAt}
      )
    `;
    for (const scope of assignment.scopes) {
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          organisational_unit_id, centre_id, effective_from, effective_to, created_at
        ) VALUES (
          ${dependencies.randomId()}, ${organisationId}, ${assignmentId}, ${scope.scopeType},
          ${scope.scopeType === "organisational_unit" ? scope.organisationalUnitId : null},
          ${scope.scopeType === "centre" ? scope.centreId : null},
          ${resolved.effectiveFrom}, ${resolved.effectiveTo}, ${occurredAt}
        )
      `;
    }
    await transaction.exec`
      UPDATE principals SET updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE id = ${targetPrincipalId}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId, action: "role_assignment.granted",
      resourceType: "role_assignment", resourceId: assignmentId,
      scopeType: "principal", scopeId: targetPrincipalId,
      context: { reasonRecorded: true, source: "people_access" }, occurredAt,
    });
  });
  return getPersonSummary(organisationId, targetPrincipalId);
}

async function lockAssignment(
  transaction: Transaction,
  organisationId: string,
  principalId: string,
  assignmentId: string,
) {
  const row = await transaction.queryRow<{
    id: string;
    role_key: string;
    role_definition_id: string;
    organisation_membership_id: string;
    effective_from: Date;
    effective_to: Date | null;
    status: "active" | "inactive";
  }>`
    SELECT assignment.id, role.role_key, assignment.role_definition_id,
           assignment.organisation_membership_id, assignment.effective_from,
           assignment.effective_to, assignment.status
    FROM role_assignments AS assignment
    JOIN role_definitions AS role
      ON role.organisation_id = assignment.organisation_id
     AND role.id = assignment.role_definition_id
    JOIN organisation_memberships AS membership
      ON membership.organisation_id = assignment.organisation_id
     AND membership.id = assignment.organisation_membership_id
    WHERE assignment.organisation_id = ${organisationId}
      AND assignment.id = ${assignmentId}
      AND membership.principal_id = ${principalId}
    FOR UPDATE OF assignment
  `;
  if (!row || row.status !== "active") {
    throw new PeopleAccessError("not_found", "resource is not available");
  }
  return row;
}

function canonicalScopeKeys(scopes: ProposedScope[]): string[] {
  const keys = scopes.map((scope) => {
    if (scope.scopeType === "organisation") return "organisation:";
    if (scope.scopeType === "organisational_unit") {
      return `organisational_unit:${requireUuid(scope.organisationalUnitId, "unit ID")}`;
    }
    return `centre:${requireUuid(scope.centreId, "centre ID")}`;
  }).sort();
  if (new Set(keys).size !== keys.length) {
    throw new PeopleAccessError("invalid_input", "replacement scope contains duplicates");
  }
  return keys;
}

function equalScopeSets(left: ProposedScope[], right: ProposedScope[]): boolean {
  const leftKeys = canonicalScopeKeys(left);
  const rightKeys = canonicalScopeKeys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]);
}

export async function removeRoleAssignment(input: {
  organisationId: string;
  targetPrincipalId: string;
  assignmentId: string;
  actorPrincipalId: string;
  expectedPrincipalLockVersion: number;
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<PersonSummary> {
  const organisationId = requireUuid(input.organisationId);
  const targetPrincipalId = requireUuid(input.targetPrincipalId);
  const assignmentId = requireUuid(input.assignmentId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  await inSerializableTransaction(async (transaction) => {
    await transaction.exec`SELECT pg_advisory_xact_lock(hashtextextended(${organisationId}, 20503))`;
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.assignmentManage],
      occurredAt,
    );
    const person = await lockPerson(transaction, organisationId, targetPrincipalId);
    if (person.lock_version !== input.expectedPrincipalLockVersion) {
      throw new PeopleAccessError("version_conflict", "principal changed");
    }
    const assignment = await lockAssignment(transaction, organisationId, targetPrincipalId, assignmentId);
    await assertNotLastAdministrator(transaction, organisationId, assignment.role_key);
    await transaction.exec`
      UPDATE assignment_scopes SET effective_to = CASE
        WHEN effective_from < ${occurredAt} THEN ${occurredAt}
        ELSE effective_to
      END
      WHERE organisation_id = ${organisationId} AND role_assignment_id = ${assignmentId}
        AND (effective_to IS NULL OR effective_to > ${occurredAt})
    `;
    await transaction.exec`
      UPDATE role_assignments SET status = 'inactive', effective_to = CASE
        WHEN effective_from < ${occurredAt} THEN ${occurredAt}
        ELSE effective_to
      END,
        updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE id = ${assignmentId}
    `;
    await transaction.exec`
      UPDATE principals SET updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE id = ${targetPrincipalId}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId, action: "role_assignment.ended",
      resourceType: "role_assignment", resourceId: assignmentId,
      scopeType: "principal", scopeId: targetPrincipalId,
      context: { reasonRecorded: true }, occurredAt,
    });
  });
  return getPersonSummary(organisationId, targetPrincipalId);
}

export async function replaceAssignmentScope(input: {
  organisationId: string;
  targetPrincipalId: string;
  assignmentId: string;
  actorPrincipalId: string;
  expectedPrincipalLockVersion: number;
  replacementScopes: ProposedScope[];
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<PersonSummary> {
  const organisationId = requireUuid(input.organisationId);
  const targetPrincipalId = requireUuid(input.targetPrincipalId);
  const assignmentId = requireUuid(input.assignmentId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  if (targetPrincipalId === actorPrincipalId) {
    throw new PeopleAccessError("access_denied", "self-directed scope changes are not permitted");
  }
  await inSerializableTransaction(async (transaction) => {
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.assignmentManage],
      occurredAt,
    );
    const person = await lockPerson(transaction, organisationId, targetPrincipalId);
    if (person.lock_version !== input.expectedPrincipalLockVersion) {
      throw new PeopleAccessError("version_conflict", "principal changed");
    }
    const current = await lockAssignment(transaction, organisationId, targetPrincipalId, assignmentId);
    const replacement: ProposedAssignment = {
      roleKey: current.role_key,
      scopes: input.replacementScopes,
      effectiveFrom: occurredAt.toISOString(),
      effectiveTo: current.effective_to?.toISOString(),
    };
    if (classifyAssignmentPackage([replacement]) !== "STANDARD") {
      throw new PeopleAccessError("privileged_approval_required", "privileged access requires independent approval");
    }
    const [resolved] = await validatePackageFacts(transaction, organisationId, [replacement], occurredAt);
    const currentScopeRows = await transaction.queryAll<{
      scope_type: ProposedScope["scopeType"];
      organisational_unit_id: string | null;
      centre_id: string | null;
    }>`
      SELECT scope_type, organisational_unit_id, centre_id
      FROM assignment_scopes
      WHERE organisation_id = ${organisationId}
        AND role_assignment_id = ${assignmentId}
        AND effective_from <= ${occurredAt}
        AND (effective_to IS NULL OR effective_to > ${occurredAt})
      ORDER BY scope_type, organisational_unit_id, centre_id
      FOR UPDATE
    `;
    const currentScopes: ProposedScope[] = currentScopeRows.map((scope) => {
      if (scope.scope_type === "organisation") return { scopeType: "organisation" };
      if (scope.scope_type === "organisational_unit") {
        return {
          scopeType: "organisational_unit",
          organisationalUnitId: scope.organisational_unit_id!,
        };
      }
      return { scopeType: "centre", centreId: scope.centre_id! };
    });
    if (equalScopeSets(currentScopes, input.replacementScopes)) return;
    await transaction.exec`
      UPDATE assignment_scopes SET effective_to = CASE
        WHEN effective_from < ${occurredAt} THEN ${occurredAt}
        ELSE effective_to
      END
      WHERE organisation_id = ${organisationId} AND role_assignment_id = ${assignmentId}
        AND (effective_to IS NULL OR effective_to > ${occurredAt})
    `;
    await transaction.exec`
      UPDATE role_assignments SET status = 'inactive', effective_to = CASE
        WHEN effective_from < ${occurredAt} THEN ${occurredAt}
        ELSE effective_to
      END,
        updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE id = ${assignmentId}
    `;
    const replacementId = dependencies.randomId();
    await transaction.exec`
      INSERT INTO role_assignments (
        id, organisation_id, organisation_membership_id, role_definition_id,
        status, effective_from, effective_to, granted_by_principal_id,
        grant_source_type, reason, created_at, updated_at
      ) VALUES (
        ${replacementId}, ${organisationId}, ${current.organisation_membership_id},
        ${current.role_definition_id}, 'active', ${resolved.effectiveFrom},
        ${resolved.effectiveTo}, ${actorPrincipalId}, 'principal', ${reason},
        ${occurredAt}, ${occurredAt}
      )
    `;
    for (const scope of input.replacementScopes) {
      await transaction.exec`
        INSERT INTO assignment_scopes (
          id, organisation_id, role_assignment_id, scope_type,
          organisational_unit_id, centre_id, effective_from, effective_to, created_at
        ) VALUES (
          ${dependencies.randomId()}, ${organisationId}, ${replacementId}, ${scope.scopeType},
          ${scope.scopeType === "organisational_unit" ? scope.organisationalUnitId : null},
          ${scope.scopeType === "centre" ? scope.centreId : null},
          ${resolved.effectiveFrom}, ${resolved.effectiveTo}, ${occurredAt}
        )
      `;
    }
    await transaction.exec`
      UPDATE principals SET updated_at = ${occurredAt}, lock_version = lock_version + 1
      WHERE id = ${targetPrincipalId}
    `;
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId, action: "assignment_scope.replaced",
      resourceType: "role_assignment", resourceId: replacementId,
      scopeType: "principal", scopeId: targetPrincipalId,
      context: { previousAssignmentId: assignmentId, reasonRecorded: true }, occurredAt,
    });
  });
  return getPersonSummary(organisationId, targetPrincipalId);
}

export async function transitionPrincipalLifecycle(input: {
  organisationId: string;
  targetPrincipalId: string;
  actorPrincipalId: string;
  expectedLockVersion: number;
  transition: "suspend" | "reactivate" | "revoke";
  reason: string;
}, dependencies: PeopleAccessWorkflowDependencies = runtimeDependencies()): Promise<PrincipalLifecycleResponse> {
  const organisationId = requireUuid(input.organisationId);
  const targetPrincipalId = requireUuid(input.targetPrincipalId);
  const actorPrincipalId = requireUuid(input.actorPrincipalId);
  const reason = requireReason(input.reason);
  const occurredAt = dependencies.now();
  const nextStatus = input.transition === "suspend" ? "suspended" : input.transition === "reactivate" ? "active" : "revoked";
  const lockVersion = await inSerializableTransaction(async (transaction) => {
    await transaction.exec`SELECT pg_advisory_xact_lock(hashtextextended(${organisationId}, 20503))`;
    await assertCurrentPeopleAuthority(
      transaction,
      organisationId,
      actorPrincipalId,
      [capability.principalManage],
      occurredAt,
    );
    const person = await lockPerson(transaction, organisationId, targetPrincipalId);
    if (person.lock_version !== input.expectedLockVersion) {
      throw new PeopleAccessError("version_conflict", "principal changed");
    }
    if ((input.transition === "suspend" || input.transition === "revoke") && person.status !== "active") {
      throw new PeopleAccessError("invalid_state", "principal lifecycle transition is invalid");
    }
    if (input.transition === "reactivate" && person.status !== "suspended") {
      throw new PeopleAccessError("invalid_state", "principal lifecycle transition is invalid");
    }
    if (input.transition === "reactivate") {
      const identity = await transaction.queryRow<{ present: boolean }>`
        SELECT TRUE AS present
        FROM external_identity_mappings
        WHERE principal_id = ${targetPrincipalId}
          AND status = 'active'
          AND provider_key LIKE 'microsoft_entra:%'
        LIMIT 1
      `;
      if (person.membership_status !== "active" || !identity) {
        throw new PeopleAccessError("invalid_state", "principal cannot be reactivated without current identity and membership");
      }
    }
    if (input.transition !== "reactivate") {
      const hasAdmin = await transaction.queryRow<{ present: boolean }>`
        SELECT TRUE AS present
        FROM role_assignments AS assignment
        JOIN role_definitions AS role ON role.id = assignment.role_definition_id
        WHERE assignment.organisation_id = ${organisationId}
          AND assignment.organisation_membership_id = ${person.membership_id}
          AND assignment.status = 'active'
          AND role.role_key = 'system_administrator'
        LIMIT 1
      `;
      if (hasAdmin) await assertNotLastAdministrator(transaction, organisationId);
    }
    await transaction.exec`
      UPDATE principals SET status = ${nextStatus}, updated_at = ${occurredAt},
        lock_version = lock_version + 1 WHERE id = ${targetPrincipalId}
    `;
    if (input.transition === "revoke") {
      await transaction.exec`
        UPDATE external_identity_mappings SET status = 'inactive', updated_at = ${occurredAt},
          lock_version = lock_version + 1 WHERE principal_id = ${targetPrincipalId} AND status = 'active'
      `;
      await transaction.exec`
        UPDATE assignment_scopes AS scope SET effective_to = CASE
          WHEN scope.effective_from < ${occurredAt} THEN ${occurredAt}
          ELSE scope.effective_to
        END
        FROM role_assignments AS assignment
        WHERE assignment.organisation_id = ${organisationId}
          AND assignment.organisation_membership_id = ${person.membership_id}
          AND scope.organisation_id = assignment.organisation_id
          AND scope.role_assignment_id = assignment.id
          AND (scope.effective_to IS NULL OR scope.effective_to > ${occurredAt})
      `;
      await transaction.exec`
        UPDATE role_assignments SET status = 'inactive', effective_to = CASE
          WHEN effective_from < ${occurredAt} THEN ${occurredAt}
          ELSE effective_to
        END,
          updated_at = ${occurredAt}, lock_version = lock_version + 1
        WHERE organisation_id = ${organisationId}
          AND organisation_membership_id = ${person.membership_id}
          AND status = 'active'
      `;
      await transaction.exec`
        UPDATE organisation_memberships SET status = 'inactive', effective_to = CASE
          WHEN effective_from < ${occurredAt} THEN ${occurredAt}
          ELSE effective_to
        END,
          updated_at = ${occurredAt}, lock_version = lock_version + 1
        WHERE id = ${person.membership_id}
      `;
    }
    const auditAction = input.transition === "suspend"
      ? "principal.suspended"
      : input.transition === "reactivate"
        ? "principal.reactivated"
        : "principal.revoked";
    await recordAuditEventWithExecutor(transaction, {
      organisationId, actorPrincipalId, action: auditAction,
      resourceType: "principal", resourceId: targetPrincipalId,
      scopeType: "principal", scopeId: targetPrincipalId,
      context: { reasonRecorded: true }, occurredAt,
    });
    return person.lock_version + 1;
  });
  return { principalId: targetPrincipalId, status: nextStatus, lockVersion };
}
