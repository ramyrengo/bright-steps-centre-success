import type {
  InvitationSummary,
  PeopleListResponse,
  PersonSummary,
  PrincipalLifecycleStatus,
  ProposedAssignment,
} from "./types";
import type { EffectiveAccessReport } from "./effective-access";

export interface CreateInvitationRequest {
  email: string;
  displayName: string;
  assignments: ProposedAssignment[];
  reason: string;
}

export interface InvitationIdRequest {
  invitationId: string;
}

export interface VersionedInvitationRequest extends InvitationIdRequest {
  lockVersion: number;
  reason?: string;
}

export interface AcceptInvitationRequest {
  invitationToken: string;
}

export interface AcceptInvitationResponse {
  outcome: "activated" | "awaiting_approval" | "administrator_review";
  invitationStatus: InvitationSummary["status"];
}

export interface PersonIdRequest {
  principalId: string;
}

export interface PersonAccessResponse {
  person: PersonSummary;
}

/**
 * Wraps the report because Encore requires a named interface at the response
 * root, and the report itself is deliberately a union so that a blocked lookup
 * cannot be mistaken for "no access anywhere".
 */
export interface EffectiveAccessResponse {
  report: EffectiveAccessReport;
}

export interface AccessHistoryResponse {
  events: Array<{
    id: string;
    action: string;
    resourceType: string;
    occurredAt: string;
    actorDisplayName: string | null;
    reasonRecorded: boolean;
  }>;
}

export interface AddAssignmentRequest extends PersonIdRequest {
  assignment: ProposedAssignment;
  reason: string;
  principalLockVersion: number;
}

export interface AssignmentMutationRequest extends PersonIdRequest {
  assignmentId: string;
  reason: string;
  principalLockVersion: number;
  replacementScopes?: ProposedAssignment["scopes"];
}

export interface PrincipalLifecycleRequest extends PersonIdRequest {
  reason: string;
  lockVersion: number;
}

export interface PrincipalLifecycleResponse {
  principalId: string;
  status: PrincipalLifecycleStatus;
  lockVersion: number;
}

export interface PeopleAccessOptionsResponse {
  roles: Array<{
    roleKey: string;
    name: string;
    scopeMode: "multi_centre" | "single_centre" | "organisation" | "flexible";
    approval: "standard" | "privileged" | "review";
  }>;
  centres: Array<{ id: string; name: string }>;
  organisationalUnits: Array<{ id: string; name: string; kind: string }>;
}

export type { InvitationSummary, PeopleListResponse, PersonSummary };
