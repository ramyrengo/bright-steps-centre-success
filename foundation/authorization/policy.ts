import type { FoundationCapability } from "./capabilities";

export type AuthorisationStatus = "active" | "inactive";

export interface AuthorisationMembership {
  id: string;
  principalId: string;
  organisationId: string;
  status: AuthorisationStatus;
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export type AssignmentScope =
  | { type: "organisation" }
  | { type: "organisational_unit"; organisationalUnitId: string }
  | { type: "centre"; centreId: string };

export interface AuthorisationAssignment {
  id: string;
  organisationId: string;
  membershipId: string;
  roleKey: string;
  capabilities: readonly FoundationCapability[];
  scopes: readonly AssignmentScope[];
  status: AuthorisationStatus;
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export interface PrincipalAuthorisationContext {
  principalId: string;
  principalStatus: AuthorisationStatus;
  activeOrganisationId: string;
  memberships: readonly AuthorisationMembership[];
  assignments: readonly AuthorisationAssignment[];
}

export type AuthorisationResource =
  | {
      kind: "organisation";
      organisationId: string;
    }
  | {
      kind: "organisational_unit";
      organisationId: string;
      organisationalUnitId: string;
    }
  | {
      kind: "centre";
      organisationId: string;
      centreId: string;
      organisationalUnitIds: readonly string[];
    };

export type DenyReason =
  | "invalid_context"
  | "invalid_resource"
  | "principal_inactive"
  | "active_organisation_mismatch"
  | "membership_missing"
  | "membership_ambiguous"
  | "capability_missing"
  | "scope_mismatch";

export type AuthorisationDecision =
  | {
      allowed: true;
      assignmentId: string;
      roleKey: string;
    }
  | {
      allowed: false;
      reason: DenyReason;
    };

export interface AuthoriseInput {
  context: PrincipalAuthorisationContext;
  capability: FoundationCapability;
  resource: AuthorisationResource;
  at?: Date;
}

function isEffective(
  record: {
    status: AuthorisationStatus;
    effectiveFrom: Date;
    effectiveTo?: Date;
  },
  at: Date,
): boolean {
  return (
    record.status === "active" &&
    record.effectiveFrom.getTime() <= at.getTime() &&
    (record.effectiveTo === undefined || record.effectiveTo.getTime() > at.getTime())
  );
}

function isValidResource(resource: AuthorisationResource): boolean {
  if (resource.organisationId.trim().length === 0) {
    return false;
  }

  if (resource.kind === "organisation") {
    return true;
  }

  if (resource.kind === "organisational_unit") {
    return resource.organisationalUnitId.trim().length > 0;
  }

  return (
    resource.centreId.trim().length > 0 &&
    resource.organisationalUnitIds.every((id) => id.trim().length > 0)
  );
}

function scopeMatches(
  scope: AssignmentScope,
  resource: AuthorisationResource,
): boolean {
  switch (scope.type) {
    case "organisation":
      return true;
    case "organisational_unit":
      return (
        (resource.kind === "organisational_unit" &&
          resource.organisationalUnitId === scope.organisationalUnitId) ||
        (resource.kind === "centre" &&
          resource.organisationalUnitIds.includes(scope.organisationalUnitId))
      );
    case "centre":
      return resource.kind === "centre" && resource.centreId === scope.centreId;
  }
}

/**
 * Evaluates one capability request from current server-side facts.
 *
 * A single active assignment must supply both the requested capability and a
 * matching scope. This prevents capabilities and scopes from separate roles
 * being combined into a privilege neither assignment grants on its own. The
 * resource and its effective hierarchy IDs must be resolved by the backend,
 * never copied from an untrusted client assertion.
 */
export function authorise(input: AuthoriseInput): AuthorisationDecision {
  const at = input.at ?? new Date();
  const { context, resource, capability } = input;

  if (
    context.principalId.trim().length === 0 ||
    context.activeOrganisationId.trim().length === 0
  ) {
    return { allowed: false, reason: "invalid_context" };
  }

  if (!isValidResource(resource)) {
    return { allowed: false, reason: "invalid_resource" };
  }

  if (context.principalStatus !== "active") {
    return { allowed: false, reason: "principal_inactive" };
  }

  if (resource.organisationId !== context.activeOrganisationId) {
    return { allowed: false, reason: "active_organisation_mismatch" };
  }

  const activeMemberships = context.memberships.filter(
    (membership) =>
      membership.principalId === context.principalId &&
      membership.organisationId === resource.organisationId &&
      isEffective(membership, at),
  );

  if (activeMemberships.length === 0) {
    return { allowed: false, reason: "membership_missing" };
  }

  if (activeMemberships.length !== 1) {
    return { allowed: false, reason: "membership_ambiguous" };
  }

  const membership = activeMemberships[0];
  const activeAssignments = context.assignments.filter(
    (assignment) =>
      assignment.organisationId === resource.organisationId &&
      assignment.membershipId === membership.id &&
      isEffective(assignment, at),
  );
  const capabilityAssignments = activeAssignments.filter((assignment) =>
    assignment.capabilities.includes(capability),
  );

  if (capabilityAssignments.length === 0) {
    return { allowed: false, reason: "capability_missing" };
  }

  for (const assignment of capabilityAssignments) {
    if (assignment.scopes.some((scope) => scopeMatches(scope, resource))) {
      return {
        allowed: true,
        assignmentId: assignment.id,
        roleKey: assignment.roleKey,
      };
    }
  }

  return { allowed: false, reason: "scope_mismatch" };
}

export function isAuthorised(input: AuthoriseInput): boolean {
  return authorise(input).allowed;
}

export const hasCapabilityAtScope = isAuthorised;

export function canViewCentre(
  context: PrincipalAuthorisationContext,
  resource: Extract<AuthorisationResource, { kind: "centre" }>,
  at?: Date,
): boolean {
  return isAuthorised({
    context,
    capability: "centre.read",
    resource,
    at,
  });
}

export function canManageCentre(
  context: PrincipalAuthorisationContext,
  resource: Extract<AuthorisationResource, { kind: "centre" }>,
  at?: Date,
): boolean {
  return isAuthorised({
    context,
    capability: "centre.manage",
    resource,
    at,
  });
}
