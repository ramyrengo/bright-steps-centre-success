import { centreSuccessDB } from "../db";
import type {
  InvitationScopeSummary,
  InvitationSummary,
  PeopleListResponse,
  PersonSummary,
  ProposedScope,
} from "./types";
import type { PeopleAccessOptionsResponse } from "./contracts";
import { PeopleAccessError } from "./types";

type QueryExecutor = Pick<typeof centreSuccessDB, "queryAll" | "queryRow">;

async function withPeopleQuerySnapshot<T>(
  query: (executor: QueryExecutor) => Promise<T>,
): Promise<T> {
  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const result = await query(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function parseScopes(value: unknown): ProposedScope[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ProposedScope[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (row.scopeType === "organisation") return [{ scopeType: "organisation" }];
    if (row.scopeType === "organisational_unit" && typeof row.organisationalUnitId === "string") {
      return [{ scopeType: "organisational_unit", organisationalUnitId: row.organisationalUnitId }];
    }
    if (row.scopeType === "centre" && typeof row.centreId === "string") {
      return [{ scopeType: "centre", centreId: row.centreId }];
    }
    return [];
  });
}

function parseInvitationScopes(value: unknown): InvitationScopeSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): InvitationScopeSummary[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.displayName !== "string" || row.displayName.length === 0) return [];
    if (row.scopeType === "organisation") {
      return [{ scopeType: "organisation", displayName: row.displayName }];
    }
    if (row.scopeType === "organisational_unit" && typeof row.organisationalUnitId === "string") {
      return [{
        scopeType: "organisational_unit",
        organisationalUnitId: row.organisationalUnitId,
        displayName: row.displayName,
      }];
    }
    if (row.scopeType === "centre" && typeof row.centreId === "string") {
      return [{ scopeType: "centre", centreId: row.centreId, displayName: row.displayName }];
    }
    return [];
  });
}

interface PersonRow {
  principal_id: string;
  display_name: string;
  status: PersonSummary["status"];
  identity_connected: boolean;
  lock_version: number;
}

interface AssignmentRow {
  principal_id: string;
  id: string;
  role_key: string;
  role_name: string;
  scopes: unknown;
}

interface InvitationRow {
  id: string;
  organisation_name: string;
  intended_email: string;
  display_name: string;
  status: InvitationSummary["status"];
  privilege_class: InvitationSummary["privilegeClass"];
  package_version: number;
  requested_by_name: string;
  reason: string;
  expires_at: Date | null;
  lock_version: number;
}

interface ProposalRow {
  invitation_id: string;
  role_key: string;
  role_name: string;
  role_version: number;
  privilege_class: InvitationSummary["privilegeClass"];
  effective_from: Date;
  effective_to: Date | null;
  scopes: unknown;
}

async function loadAssignments(
  executor: QueryExecutor,
  organisationId: string,
): Promise<Map<string, PersonSummary["assignments"]>> {
  const rows = await executor.queryAll<AssignmentRow>`
    SELECT
      membership.principal_id,
      assignment.id,
      role.role_key,
      role.name AS role_name,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'scopeType', scope.scope_type,
          'organisationalUnitId', scope.organisational_unit_id,
          'centreId', scope.centre_id
        ) ORDER BY scope.id
      ) FILTER (WHERE scope.id IS NOT NULL), '[]'::jsonb) AS scopes
    FROM organisation_memberships AS membership
    JOIN role_assignments AS assignment
      ON assignment.organisation_id = membership.organisation_id
     AND assignment.organisation_membership_id = membership.id
     AND assignment.status = 'active'
     AND assignment.effective_from <= now()
     AND (assignment.effective_to IS NULL OR assignment.effective_to > now())
    JOIN role_definitions AS role
      ON role.organisation_id = assignment.organisation_id
     AND role.id = assignment.role_definition_id
    LEFT JOIN assignment_scopes AS scope
      ON scope.organisation_id = assignment.organisation_id
     AND scope.role_assignment_id = assignment.id
     AND scope.effective_from <= now()
     AND (scope.effective_to IS NULL OR scope.effective_to > now())
    WHERE membership.organisation_id = ${organisationId}
    GROUP BY membership.principal_id, assignment.id, role.role_key, role.name
    ORDER BY role.name, assignment.id
  `;
  const result = new Map<string, PersonSummary["assignments"]>();
  for (const row of rows) {
    const items = result.get(row.principal_id) ?? [];
    items.push({ id: row.id, roleKey: row.role_key, roleName: row.role_name, scopes: parseScopes(row.scopes) });
    result.set(row.principal_id, items);
  }
  return result;
}

async function loadInvitationProposals(
  executor: QueryExecutor,
  organisationId: string,
): Promise<Map<string, InvitationSummary["assignments"]>> {
  const rows = await executor.queryAll<ProposalRow>`
    SELECT
      proposal.invitation_id,
      proposal.role_key,
      role.name AS role_name,
      proposal.role_version,
      proposal.privilege_class,
      proposal.effective_from,
      proposal.effective_to,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'scopeType', scope.scope_type,
          'organisationalUnitId', scope.organisational_unit_id,
          'centreId', scope.centre_id,
          'displayName', CASE scope.scope_type
            WHEN 'organisation' THEN organisation.name
            WHEN 'organisational_unit' THEN organisational_unit.name
            WHEN 'centre' THEN centre.name
          END
        ) ORDER BY scope.id
      ) FILTER (WHERE scope.id IS NOT NULL), '[]'::jsonb) AS scopes
    FROM invitation_role_proposals AS proposal
    JOIN organisations AS organisation
      ON organisation.id = proposal.organisation_id
    JOIN role_definitions AS role
      ON role.organisation_id = proposal.organisation_id
     AND role.id = proposal.role_definition_id
    LEFT JOIN invitation_scope_proposals AS scope
      ON scope.organisation_id = proposal.organisation_id
     AND scope.invitation_role_proposal_id = proposal.id
    LEFT JOIN organisational_units AS organisational_unit
      ON organisational_unit.organisation_id = scope.organisation_id
     AND organisational_unit.id = scope.organisational_unit_id
    LEFT JOIN centres AS centre
      ON centre.organisation_id = scope.organisation_id
     AND centre.id = scope.centre_id
    WHERE proposal.organisation_id = ${organisationId}
    GROUP BY proposal.invitation_id, proposal.ordinal, proposal.role_key,
             proposal.role_version, proposal.privilege_class,
             proposal.effective_from, proposal.effective_to, role.name,
             organisation.name
    ORDER BY proposal.ordinal
  `;
  const result = new Map<string, InvitationSummary["assignments"]>();
  for (const row of rows) {
    const items = result.get(row.invitation_id) ?? [];
    items.push({
      roleKey: row.role_key,
      roleName: row.role_name,
      roleVersion: row.role_version,
      privilegeClass: row.privilege_class,
      effectiveFrom: row.effective_from.toISOString(),
      effectiveTo: row.effective_to?.toISOString() ?? null,
      scopes: parseInvitationScopes(row.scopes),
    });
    result.set(row.invitation_id, items);
  }
  return result;
}

async function listPeopleAndInvitationsFromSnapshot(
  organisationId: string,
  executor: QueryExecutor,
): Promise<PeopleListResponse> {
  const peopleRows = await executor.queryAll<PersonRow>`
    SELECT DISTINCT
      principal.id AS principal_id,
      principal.display_name,
      principal.status,
      EXISTS (
        SELECT 1 FROM external_identity_mappings AS mapping
        WHERE mapping.principal_id = principal.id AND mapping.status = 'active'
      ) AS identity_connected,
      principal.lock_version
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
     AND membership.organisation_id = ${organisationId}
    ORDER BY principal.display_name, principal.id
  `;
  const invitationRows = await executor.queryAll<InvitationRow>`
    SELECT invitation.id, organisation.name AS organisation_name,
           invitation.intended_email, principal.display_name,
           invitation.status, invitation.privilege_class,
           invitation.package_version, requester.display_name AS requested_by_name,
           invitation.reason, invitation.expires_at, invitation.lock_version
    FROM access_invitations AS invitation
    JOIN organisations AS organisation ON organisation.id = invitation.organisation_id
    JOIN principals AS principal ON principal.id = invitation.pending_principal_id
    JOIN principals AS requester ON requester.id = invitation.created_by_principal_id
    WHERE invitation.organisation_id = ${organisationId}
    ORDER BY invitation.created_at DESC, invitation.id
  `;
  const assignments = await loadAssignments(executor, organisationId);
  const proposals = await loadInvitationProposals(executor, organisationId);
  return {
    people: peopleRows.map((row) => ({
      principalId: row.principal_id,
      displayName: row.display_name,
      status: row.status,
      microsoftIdentity: row.identity_connected ? "connected" : "not_connected",
      assignments: assignments.get(row.principal_id) ?? [],
      lockVersion: row.lock_version,
    })),
    invitations: invitationRows.map((row) => ({
      id: row.id,
      organisationName: row.organisation_name,
      intendedEmail: row.intended_email,
      displayName: row.display_name,
      status: row.status,
      privilegeClass: row.privilege_class,
      packageVersion: row.package_version,
      requestedByName: row.requested_by_name,
      requestReason: row.reason,
      expiresAt: row.expires_at?.toISOString() ?? null,
      lockVersion: row.lock_version,
      assignments: proposals.get(row.id) ?? [],
    })),
  };
}

export async function listPeopleAndInvitations(
  organisationId: string,
): Promise<PeopleListResponse> {
  return withPeopleQuerySnapshot((executor) =>
    listPeopleAndInvitationsFromSnapshot(organisationId, executor),
  );
}

export async function getInvitationSummary(
  organisationId: string,
  invitationId: string,
): Promise<InvitationSummary> {
  return withPeopleQuerySnapshot(async (executor) => {
    const all = await listPeopleAndInvitationsFromSnapshot(organisationId, executor);
    const invitation = all.invitations.find((item) => item.id === invitationId);
    if (!invitation) throw new PeopleAccessError("not_found", "resource is not available");
    return invitation;
  });
}

export async function getPersonSummary(
  organisationId: string,
  principalId: string,
): Promise<PersonSummary> {
  return withPeopleQuerySnapshot(async (executor) => {
    const all = await listPeopleAndInvitationsFromSnapshot(organisationId, executor);
    const person = all.people.find((item) => item.principalId === principalId);
    if (!person) throw new PeopleAccessError("not_found", "resource is not available");
    return person;
  });
}

export async function getAccessHistory(
  organisationId: string,
  principalId: string,
) {
  return withPeopleQuerySnapshot(async (executor) => {
  const membership = await executor.queryRow<{ present: boolean }>`
    SELECT TRUE AS present FROM organisation_memberships
    WHERE organisation_id = ${organisationId} AND principal_id = ${principalId}
    LIMIT 1
  `;
  if (!membership) throw new PeopleAccessError("not_found", "resource is not available");
  const rows = await executor.queryAll<{
    id: string;
    action: string;
    resource_type: string;
    occurred_at: Date;
    actor_display_name: string | null;
    reason_recorded: boolean;
  }>`
    SELECT event.id, event.action, event.resource_type, event.occurred_at,
           actor.display_name AS actor_display_name,
           COALESCE((event.context ->> 'reasonRecorded')::boolean, FALSE) AS reason_recorded
    FROM system_audit_events AS event
    LEFT JOIN principals AS actor ON actor.id = event.actor_principal_id
    WHERE event.organisation_id = ${organisationId}
      AND (
        (event.resource_type = 'principal' AND event.resource_id = ${principalId})
        OR event.resource_id IN (
          SELECT invitation.id FROM access_invitations AS invitation
          WHERE invitation.organisation_id = ${organisationId}
            AND invitation.pending_principal_id = ${principalId}
        )
        OR event.resource_id IN (
          SELECT approval.id
          FROM privileged_invitation_approvals AS approval
          JOIN access_invitations AS invitation
            ON invitation.organisation_id = approval.organisation_id
           AND invitation.id = approval.invitation_id
          WHERE invitation.organisation_id = ${organisationId}
            AND invitation.pending_principal_id = ${principalId}
        )
        OR event.resource_id IN (
          SELECT assignment.id
          FROM role_assignments AS assignment
          JOIN organisation_memberships AS target_membership
            ON target_membership.organisation_id = assignment.organisation_id
           AND target_membership.id = assignment.organisation_membership_id
          WHERE target_membership.principal_id = ${principalId}
            AND target_membership.organisation_id = ${organisationId}
        )
        OR event.resource_id IN (
          SELECT mapping.id FROM external_identity_mappings AS mapping
          WHERE mapping.principal_id = ${principalId}
        )
      )
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 500
  `;
  return {
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      occurredAt: row.occurred_at.toISOString(),
      actorDisplayName: row.actor_display_name,
      reasonRecorded: row.reason_recorded,
    })),
  };
  });
}

export async function getPeopleAccessOptions(
  organisationId: string,
): Promise<PeopleAccessOptionsResponse> {
  return withPeopleQuerySnapshot(async (executor) => {
    const roles = await executor.queryAll<{ role_key: string; name: string }>`
      SELECT role_key, name FROM role_definitions
      WHERE organisation_id = ${organisationId}
        AND status = 'active'
        AND source_template_key IS NOT NULL
      ORDER BY name, role_key
    `;
    const centres = await executor.queryAll<{ id: string; name: string }>`
      SELECT id, name FROM centres
      WHERE organisation_id = ${organisationId} AND status = 'active'
      ORDER BY name, id
    `;
    const organisationalUnits = await executor.queryAll<{ id: string; name: string; kind: string }>`
      SELECT id, name, kind FROM organisational_units
      WHERE organisation_id = ${organisationId} AND status = 'active'
        AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
      ORDER BY name, id
    `;
    return {
      roles: roles.map((role) => {
        const scopeMode = role.role_key === "educator" || role.role_key === "area_manager"
          ? "multi_centre" as const
          : role.role_key === "assistant_director" || role.role_key === "centre_director"
            ? "single_centre" as const
            : ["system_administrator", "executive", "compliance_manager"].includes(role.role_key)
              ? "organisation" as const
              : "flexible" as const;
        const approval = ["system_administrator", "executive", "finance", "compliance_manager"].includes(role.role_key)
          ? "privileged" as const
          : ["educator", "assistant_director", "centre_director", "area_manager"].includes(role.role_key)
            ? "standard" as const
            : "review" as const;
        return { roleKey: role.role_key, name: role.name, scopeMode, approval };
      }),
      centres,
      organisationalUnits,
    };
  });
}
