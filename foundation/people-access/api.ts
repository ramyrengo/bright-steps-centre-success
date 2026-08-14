import { currentRequest } from "encore.dev";
import { api, APIError } from "encore.dev/api";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { parseBearerToken } from "../authentication/bearer-token";
import {
  verifyRuntimeEntraAccessToken,
} from "../authentication/auth-handler";
import type { VerifiedEntraIdentity } from "../authentication/entra-access-token-verifier";
import { requireOrganisationCapability } from "../quarterly-reviews/authorization";
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  AccessHistoryResponse,
  AddAssignmentRequest,
  AssignmentMutationRequest,
  CreateInvitationRequest,
  EffectiveAccessResponse,
  InvitationIdRequest,
  InvitationSummary,
  PeopleListResponse,
  PeopleAccessOptionsResponse,
  PersonAccessResponse,
  PersonIdRequest,
  PrincipalLifecycleRequest,
  PrincipalLifecycleResponse,
  VersionedInvitationRequest,
} from "./contracts";
import {
  requirePeopleAdministrator,
  toPeopleAccessApiError,
} from "./authorization";
import { getEffectiveAccess } from "./effective-access";
import {
  getAccessHistory as getAccessHistoryQuery,
  getInvitationSummary,
  getPersonSummary,
  getPeopleAccessOptions,
  listPeopleAndInvitations,
} from "./queries";
import {
  acceptInvitation as acceptInvitationWorkflow,
  addRoleAssignment,
  approvePrivilegedInvitation,
  cancelInvitation,
  createInvitation as createInvitationWorkflow,
  removeRoleAssignment,
  replaceAssignmentScope,
  sendInvitation as sendInvitationWorkflow,
  transitionPrincipalLifecycle,
} from "./service";
import { PeopleAccessError, requireReason, requireUuid } from "./types";

export const listPeople = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people" },
  async (): Promise<PeopleListResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalRead);
      return listPeopleAndInvitations(principal.organisationId);
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const getPeopleOptions = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/options" },
  async (): Promise<PeopleAccessOptionsResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationManage);
      return getPeopleAccessOptions(principal.organisationId);
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const createInvitation = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/invitations" },
  async (request: CreateInvitationRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationManage);
      requireOrganisationCapability(principal, capability.assignmentManage);
      return createInvitationWorkflow({
        organisationId: principal.organisationId,
        actorPrincipalId: principal.principalId,
        request,
      });
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const getInvitation = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/invitations/:invitationId" },
  async ({ invitationId }: InvitationIdRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationRead);
      return getInvitationSummary(principal.organisationId, requireUuid(invitationId));
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const sendInvitation = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/invitations/:invitationId/send" },
  async (request: VersionedInvitationRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationManage);
      return sendInvitationWorkflow({
        organisationId: principal.organisationId,
        invitationId: request.invitationId,
        actorPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
        resend: false,
      });
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const resendInvitation = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/invitations/:invitationId/resend" },
  async (request: VersionedInvitationRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationManage);
      return sendInvitationWorkflow({
        organisationId: principal.organisationId,
        invitationId: request.invitationId,
        actorPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
        resend: true,
      });
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const cancelInvitationEndpoint = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/invitations/:invitationId/cancel" },
  async (request: VersionedInvitationRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.invitationManage);
      return cancelInvitation({
        organisationId: principal.organisationId,
        invitationId: request.invitationId,
        actorPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
        reason: requireReason(request.reason),
      });
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const approveInvitation = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/invitations/:invitationId/approve" },
  async (request: VersionedInvitationRequest): Promise<InvitationSummary> => {
    try {
      const principal = await requirePeopleAdministrator(capability.privilegedAccessApprove);
      return approvePrivilegedInvitation({
        organisationId: principal.organisationId,
        invitationId: request.invitationId,
        approverPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
        reason: requireReason(request.reason),
      });
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export interface InvitationCandidateDependencies {
  authorizationHeader: () => unknown;
  verifyAccessToken: (token: string) => Promise<VerifiedEntraIdentity>;
  accept: typeof acceptInvitationWorkflow;
}

const invitationCandidateRuntimeDependencies: InvitationCandidateDependencies = {
  authorizationHeader: () => {
    const request = currentRequest();
    if (request?.type !== "api-call") return undefined;
    return request.headers.authorization ?? request.headers.Authorization;
  },
  verifyAccessToken: verifyRuntimeEntraAccessToken,
  accept: acceptInvitationWorkflow,
};

/** @internal Candidate-only boundary; it never establishes Encore AuthData. */
export async function acceptInvitationCandidate(
  request: AcceptInvitationRequest,
  dependencies: InvitationCandidateDependencies = invitationCandidateRuntimeDependencies,
): Promise<AcceptInvitationResponse> {
  try {
    const compactJwt = parseBearerToken(dependencies.authorizationHeader());
    const verifiedIdentity = await dependencies.verifyAccessToken(compactJwt);
    return await dependencies.accept({
      invitationToken: request.invitationToken,
      compactJwt,
      verifiedIdentity,
    });
  } catch (error) {
    if (error instanceof PeopleAccessError) return toPeopleAccessApiError(error);
    if (error instanceof APIError) throw error;
    throw APIError.unauthenticated("invitation identity could not be verified");
  }
}

export const acceptInvitation = api(
  {
    expose: true,
    auth: false,
    sensitive: true,
    method: "POST",
    path: "/invitations/accept",
  },
  (request: AcceptInvitationRequest): Promise<AcceptInvitationResponse> =>
    acceptInvitationCandidate(request),
);

export const getPerson = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/:principalId" },
  async ({ principalId }: PersonIdRequest): Promise<PersonAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalRead);
      return { person: await getPersonSummary(principal.organisationId, requireUuid(principalId)) };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const getPersonAccess = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/:principalId/access" },
  async ({ principalId }: PersonIdRequest): Promise<PersonAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalRead);
      requireOrganisationCapability(principal, capability.assignmentRead);
      return { person: await getPersonSummary(principal.organisationId, requireUuid(principalId)) };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const getPersonHistory = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/:principalId/history" },
  async ({ principalId }: PersonIdRequest): Promise<AccessHistoryResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.accessHistoryRead);
      return getAccessHistoryQuery(principal.organisationId, requireUuid(principalId));
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const getPersonEffectiveAccess = api(
  { expose: true, auth: true, method: "GET", path: "/admin/people/:principalId/effective-access" },
  async ({ principalId }: PersonIdRequest): Promise<EffectiveAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalRead);
      requireOrganisationCapability(principal, capability.assignmentRead);
      return {
        report: await getEffectiveAccess({
          organisationId: principal.organisationId,
          principalId: requireUuid(principalId),
        }),
      };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const addPersonAssignment = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/:principalId/assignments" },
  async (request: AddAssignmentRequest): Promise<PersonAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.assignmentManage);
      return { person: await addRoleAssignment({
        organisationId: principal.organisationId,
        targetPrincipalId: request.principalId,
        actorPrincipalId: principal.principalId,
        assignment: request.assignment,
        expectedPrincipalLockVersion: request.principalLockVersion,
        reason: request.reason,
      }) };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const replacePersonAssignmentScope = api(
  { expose: true, auth: true, method: "PUT", path: "/admin/people/:principalId/assignments/:assignmentId/scope" },
  async (request: AssignmentMutationRequest): Promise<PersonAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.assignmentManage);
      if (!request.replacementScopes) throw new PeopleAccessError("invalid_input", "replacement scope is required");
      return { person: await replaceAssignmentScope({
        organisationId: principal.organisationId,
        targetPrincipalId: request.principalId,
        assignmentId: request.assignmentId,
        actorPrincipalId: principal.principalId,
        expectedPrincipalLockVersion: request.principalLockVersion,
        replacementScopes: request.replacementScopes,
        reason: request.reason,
      }) };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const removePersonAssignment = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/:principalId/assignments/:assignmentId/remove" },
  async (request: AssignmentMutationRequest): Promise<PersonAccessResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.assignmentManage);
      return { person: await removeRoleAssignment({
        organisationId: principal.organisationId,
        targetPrincipalId: request.principalId,
        assignmentId: request.assignmentId,
        actorPrincipalId: principal.principalId,
        expectedPrincipalLockVersion: request.principalLockVersion,
        reason: request.reason,
      }) };
    } catch (error) {
      return toPeopleAccessApiError(error);
    }
  },
);

export const suspendPerson = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/:principalId/suspend" },
  async (request: PrincipalLifecycleRequest): Promise<PrincipalLifecycleResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalManage);
      return transitionPrincipalLifecycle({
        organisationId: principal.organisationId, targetPrincipalId: request.principalId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        transition: "suspend", reason: request.reason,
      });
    } catch (error) { return toPeopleAccessApiError(error); }
  },
);

export const reactivatePerson = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/:principalId/reactivate" },
  async (request: PrincipalLifecycleRequest): Promise<PrincipalLifecycleResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalManage);
      return transitionPrincipalLifecycle({
        organisationId: principal.organisationId, targetPrincipalId: request.principalId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        transition: "reactivate", reason: request.reason,
      });
    } catch (error) { return toPeopleAccessApiError(error); }
  },
);

export const revokePerson = api(
  { expose: true, auth: true, method: "POST", path: "/admin/people/:principalId/revoke" },
  async (request: PrincipalLifecycleRequest): Promise<PrincipalLifecycleResponse> => {
    try {
      const principal = await requirePeopleAdministrator(capability.principalManage);
      return transitionPrincipalLifecycle({
        organisationId: principal.organisationId, targetPrincipalId: request.principalId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        transition: "revoke", reason: request.reason,
      });
    } catch (error) { return toPeopleAccessApiError(error); }
  },
);
