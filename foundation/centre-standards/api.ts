import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type {
  CompleteStandardsCheckRequest,
  CompleteStandardsCheckResponse,
  StandardsCheckDetailResponse,
  StandardsOccurrenceRequest,
  StandardsWorkspaceResponse,
} from "./contracts";
import {
  buildStandardsWorkspace,
  completeStandardsCheck,
  loadStandardsCheckDetail,
} from "./service";
import { CentreStandardsError } from "./types";

function requirePrincipalId(): string {
  const authData = getAuthData() as CentreSuccessAuthData | null;
  if (!authData) throw APIError.unauthenticated("authentication required");
  return authData.userID;
}

function toApiError(error: unknown): never {
  if (error instanceof APIError) throw error;
  if (!(error instanceof CentreStandardsError)) {
    throw APIError.unavailable("Centre Standards is temporarily unavailable");
  }
  switch (error.code) {
    case "invalid_input":
      throw APIError.invalidArgument(error.message);
    case "access_denied":
    case "not_found":
      throw APIError.permissionDenied("check is not available");
    case "invalid_state":
    case "incomplete_response":
      throw APIError.failedPrecondition(error.message).withDetails({ reason: error.code });
    case "context_unavailable":
      throw APIError.unavailable("Centre Standards is temporarily unavailable");
  }
}

export async function loadStandardsWorkspaceEndpoint(): Promise<StandardsWorkspaceResponse> {
  try {
    return (await buildStandardsWorkspace({ principalId: requirePrincipalId() })).response;
  } catch (error) {
    return toApiError(error);
  }
}

export async function loadStandardsCheckEndpoint(
  request: StandardsOccurrenceRequest,
): Promise<StandardsCheckDetailResponse> {
  try {
    return await loadStandardsCheckDetail({
      principalId: requirePrincipalId(),
      occurrenceId: request.occurrenceId,
    });
  } catch (error) {
    return toApiError(error);
  }
}

export async function completeStandardsCheckEndpoint(
  request: CompleteStandardsCheckRequest,
): Promise<CompleteStandardsCheckResponse> {
  try {
    return await completeStandardsCheck({ principalId: requirePrincipalId(), request });
  } catch (error) {
    return toApiError(error);
  }
}

export const getStandardsWorkspace = api(
  { expose: true, auth: true, method: "GET", path: "/standards" },
  (): Promise<StandardsWorkspaceResponse> => loadStandardsWorkspaceEndpoint(),
);

export const getStandardsCheck = api(
  { expose: true, auth: true, method: "GET", path: "/standards/checks/:occurrenceId" },
  (request: StandardsOccurrenceRequest): Promise<StandardsCheckDetailResponse> =>
    loadStandardsCheckEndpoint(request),
);

export const completeStandardsOccurrence = api(
  { expose: true, auth: true, method: "POST", path: "/standards/checks/:occurrenceId/complete" },
  (request: CompleteStandardsCheckRequest): Promise<CompleteStandardsCheckResponse> =>
    completeStandardsCheckEndpoint(request),
);
