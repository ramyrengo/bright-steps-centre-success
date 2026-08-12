export const INVITATION_STATUSES = [
  "DRAFT",
  "SENT",
  "IDENTITY_VERIFIED",
  "AWAITING_PRIVILEGED_APPROVAL",
  "ADMINISTRATOR_REVIEW",
  "ACTIVATED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type InvitationStatus =
  | "DRAFT"
  | "SENT"
  | "IDENTITY_VERIFIED"
  | "AWAITING_PRIVILEGED_APPROVAL"
  | "ADMINISTRATOR_REVIEW"
  | "ACTIVATED"
  | "CANCELLED"
  | "EXPIRED";
export type PrivilegeClass = "STANDARD" | "PRIVILEGED" | "REVIEW";
export type PrincipalLifecycleStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked";
export type ProposedScope =
  | { scopeType: "organisation" }
  | { scopeType: "organisational_unit"; organisationalUnitId: string }
  | { scopeType: "centre"; centreId: string };

export type InvitationScopeSummary =
  | { scopeType: "organisation"; displayName: string }
  | { scopeType: "organisational_unit"; organisationalUnitId: string; displayName: string }
  | { scopeType: "centre"; centreId: string; displayName: string };

export interface ProposedAssignment {
  roleKey: string;
  scopes: ProposedScope[];
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface InvitationSummary {
  id: string;
  organisationName: string;
  intendedEmail: string;
  displayName: string;
  status: InvitationStatus;
  privilegeClass: PrivilegeClass;
  packageVersion: number;
  requestedByName: string;
  requestReason: string;
  expiresAt: string | null;
  lockVersion: number;
  assignments: Array<{
    roleKey: string;
    roleName: string;
    roleVersion: number;
    privilegeClass: PrivilegeClass;
    effectiveFrom: string;
    effectiveTo: string | null;
    scopes: InvitationScopeSummary[];
  }>;
}

export interface PersonSummary {
  principalId: string;
  displayName: string;
  status: PrincipalLifecycleStatus;
  microsoftIdentity: "connected" | "not_connected";
  assignments: Array<{ id: string; roleKey: string; roleName: string; scopes: ProposedScope[] }>;
  lockVersion: number;
}

export interface PeopleListResponse {
  people: PersonSummary[];
  invitations: InvitationSummary[];
}

export type PeopleAccessFailureCode =
  | "invalid_input"
  | "access_denied"
  | "not_found"
  | "version_conflict"
  | "invalid_state"
  | "invitation_expired"
  | "invitation_cancelled"
  | "invitation_superseded"
  | "invitation_replayed"
  | "identity_review_required"
  | "privileged_approval_required"
  | "independent_approval_required"
  | "last_administrator"
  | "temporarily_unavailable";

export class PeopleAccessError extends Error {
  readonly code: PeopleAccessFailureCode;

  constructor(code: PeopleAccessFailureCode, message: string) {
    super(message);
    this.name = "PeopleAccessError";
    this.code = code;
  }
}

export function requireUuid(value: unknown, label = "identifier"): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new PeopleAccessError("invalid_input", `${label} is invalid`);
  }
  return value.toLowerCase();
}

export function requireReason(value: unknown): string {
  if (typeof value !== "string") {
    throw new PeopleAccessError("invalid_input", "reason is required");
  }
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new PeopleAccessError("invalid_input", "reason is invalid");
  }
  return reason;
}
