import {
  isFoundationCapability,
  type FoundationCapability,
} from "./capabilities";
import {
  withAuthorisationSnapshot,
  type AuthorisationQueryExecutor,
} from "./database";
import type {
  AssignmentScope,
  AuthorisationAssignment,
  PrincipalAuthorisationContext,
} from "./policy";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthorisationContextFailureCode =
  | "invalid_identifier"
  | "principal_missing"
  | "principal_inactive"
  | "organisation_missing"
  | "organisation_inactive"
  | "membership_missing"
  | "membership_ambiguous"
  | "assignment_context_invalid";

export class AuthorisationContextError extends Error {
  readonly code: AuthorisationContextFailureCode;

  constructor(code: AuthorisationContextFailureCode) {
    super(`authorisation context rejected: ${code}`);
    this.name = "AuthorisationContextError";
    this.code = code;
  }
}

export interface LoadPrincipalAuthorisationContextInput {
  principalId: string;
  activeOrganisationId: string;
  at?: Date;
}

interface PrincipalRow {
  id: string;
  status: "active" | "inactive";
}

interface OrganisationRow {
  id: string;
  status: "active" | "inactive";
}

interface MembershipRow {
  id: string;
  principal_id: string;
  organisation_id: string;
  status: "active" | "inactive";
  effective_from: Date;
  effective_to: Date | null;
}

interface StoredScope {
  type: unknown;
  organisationalUnitId?: unknown;
  centreId?: unknown;
}

interface AssignmentRow {
  id: string;
  organisation_id: string;
  organisation_membership_id: string;
  role_key: string;
  status: "active" | "inactive";
  effective_from: Date;
  effective_to: Date | null;
  capabilities: unknown;
  scopes: unknown;
}

function requireCanonicalUuid(value: string): void {
  if (!CANONICAL_UUID.test(value)) {
    throw new AuthorisationContextError("invalid_identifier");
  }
}

function parseCapabilities(value: unknown): FoundationCapability[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new AuthorisationContextError("assignment_context_invalid");
  }

  return value.filter(isFoundationCapability);
}

function parseScopes(value: unknown): AssignmentScope[] {
  if (!Array.isArray(value)) {
    throw new AuthorisationContextError("assignment_context_invalid");
  }

  return value.map((candidate): AssignmentScope => {
    if (candidate === null || typeof candidate !== "object") {
      throw new AuthorisationContextError("assignment_context_invalid");
    }

    const stored = candidate as StoredScope;

    if (stored.type === "organisation") {
      return { type: "organisation" };
    }

    if (
      stored.type === "organisational_unit" &&
      typeof stored.organisationalUnitId === "string"
    ) {
      return {
        type: "organisational_unit",
        organisationalUnitId: stored.organisationalUnitId,
      };
    }

    if (stored.type === "centre" && typeof stored.centreId === "string") {
      return { type: "centre", centreId: stored.centreId };
    }

    throw new AuthorisationContextError("assignment_context_invalid");
  });
}

/**
 * Loads current principal, membership, assignment, capability, and scope facts.
 * This accepts only a trusted internal principal identifier and is not an API.
 */
export async function loadPrincipalAuthorisationContext(
  input: LoadPrincipalAuthorisationContextInput,
): Promise<PrincipalAuthorisationContext> {
  return withAuthorisationSnapshot((executor) =>
    loadPrincipalAuthorisationContextFromSnapshot(executor, input),
  );
}

/** @internal Shared with the composed database authorizer for one read snapshot. */
export async function loadPrincipalAuthorisationContextFromSnapshot(
  executor: AuthorisationQueryExecutor,
  input: LoadPrincipalAuthorisationContextInput,
): Promise<PrincipalAuthorisationContext> {
  requireCanonicalUuid(input.principalId);
  requireCanonicalUuid(input.activeOrganisationId);
  const at = input.at ?? new Date();

  const principal = await executor.queryRow<PrincipalRow>`
    SELECT id, status
    FROM principals
    WHERE id = ${input.principalId}
  `;

  if (principal === null) {
    throw new AuthorisationContextError("principal_missing");
  }

  if (principal.status !== "active") {
    throw new AuthorisationContextError("principal_inactive");
  }

  const organisation = await executor.queryRow<OrganisationRow>`
    SELECT id, status
    FROM organisations
    WHERE id = ${input.activeOrganisationId}
  `;

  if (organisation === null) {
    throw new AuthorisationContextError("organisation_missing");
  }

  if (organisation.status !== "active") {
    throw new AuthorisationContextError("organisation_inactive");
  }

  const memberships = await executor.queryAll<MembershipRow>`
    SELECT
      id,
      principal_id,
      organisation_id,
      status,
      effective_from,
      effective_to
    FROM organisation_memberships
    WHERE principal_id = ${principal.id}
      AND organisation_id = ${organisation.id}
      AND status = 'active'
      AND effective_from <= ${at}
      AND (effective_to IS NULL OR effective_to > ${at})
    ORDER BY id
  `;

  if (memberships.length === 0) {
    throw new AuthorisationContextError("membership_missing");
  }

  if (memberships.length !== 1) {
    throw new AuthorisationContextError("membership_ambiguous");
  }

  const membership = memberships[0];
  const assignmentRows = await executor.queryAll<AssignmentRow>`
    SELECT
      assignment.id,
      assignment.organisation_id,
      assignment.organisation_membership_id,
      role.role_key,
      assignment.status,
      assignment.effective_from,
      assignment.effective_to,
      COALESCE(
        (
          SELECT jsonb_agg(role_capability.capability_code ORDER BY role_capability.capability_code)
          FROM role_capabilities AS role_capability
          WHERE role_capability.role_definition_id = role.id
        ),
        '[]'::jsonb
      ) AS capabilities,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'type', scope.scope_type,
              'organisationalUnitId', scope.organisational_unit_id,
              'centreId', scope.centre_id
            )
            ORDER BY scope.id
          )
          FROM assignment_scopes AS scope
          WHERE scope.organisation_id = assignment.organisation_id
            AND scope.role_assignment_id = assignment.id
            AND scope.effective_from <= ${at}
            AND (scope.effective_to IS NULL OR scope.effective_to > ${at})
        ),
        '[]'::jsonb
      ) AS scopes
    FROM role_assignments AS assignment
    JOIN role_definitions AS role
      ON role.organisation_id = assignment.organisation_id
     AND role.id = assignment.role_definition_id
    WHERE assignment.organisation_id = ${organisation.id}
      AND assignment.organisation_membership_id = ${membership.id}
      AND assignment.status = 'active'
      AND assignment.effective_from <= ${at}
      AND (assignment.effective_to IS NULL OR assignment.effective_to > ${at})
      AND role.status = 'active'
    ORDER BY assignment.id
  `;

  const assignments: AuthorisationAssignment[] = assignmentRows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    membershipId: row.organisation_membership_id,
    roleKey: row.role_key,
    capabilities: parseCapabilities(row.capabilities),
    scopes: parseScopes(row.scopes),
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? undefined,
  }));

  return {
    principalId: principal.id,
    principalStatus: principal.status,
    activeOrganisationId: organisation.id,
    memberships: [
      {
        id: membership.id,
        principalId: membership.principal_id,
        organisationId: membership.organisation_id,
        status: membership.status,
        effectiveFrom: membership.effective_from,
        effectiveTo: membership.effective_to ?? undefined,
      },
    ],
    assignments,
  };
}
