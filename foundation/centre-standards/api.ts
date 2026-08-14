import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type {
  CompleteStandardsCheckRequest,
  CompleteStandardsCheckResponse,
  SeedSyntheticStandardsPilotRequest,
  SeedSyntheticStandardsPilotResponse,
  StandardsCheckDetailResponse,
  StandardsOccurrenceRequest,
  StandardsWorkspaceResponse,
} from "./contracts";
import {
  buildStandardsWorkspace,
  completeStandardsCheck,
  loadStandardsCheckDetail,
} from "./service";
import { SyntheticStandardsSeedError } from "./synthetic-environment";
import { seedSyntheticStandardsPilotForPrincipal } from "./synthetic-pilot-operation";
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

export async function seedSyntheticStandardsPilotEndpoint(
  request: SeedSyntheticStandardsPilotRequest,
): Promise<SeedSyntheticStandardsPilotResponse> {
  try {
    return await seedSyntheticStandardsPilotForPrincipal({
      principalId: requirePrincipalId(),
      centreId: request.centreId,
      ...(request.effectiveFrom ? { effectiveFrom: request.effectiveFrom } : {}),
      ...(request.activate === undefined ? {} : { activate: request.activate }),
    });
  } catch (error) {
    // The environment refusal is a precondition, not a permission problem, and
    // saying so plainly is the difference between "you may not" and "not here".
    if (error instanceof SyntheticStandardsSeedError) {
      throw APIError.failedPrecondition(error.message).withDetails({
        reason: "synthetic_pilot_unavailable",
      });
    }
    return toApiError(error);
  }
}

/**
 * Administrative, not part of the Centre Standards experience. It is guarded by
 * `system.configure` and refused outright anywhere but local development and
 * the exact `staging` environment.
 */
export const seedSyntheticStandardsPilotRoute = api(
  { expose: true, auth: true, method: "POST", path: "/admin/centre-standards/synthetic-pilot" },
  (request: SeedSyntheticStandardsPilotRequest): Promise<SeedSyntheticStandardsPilotResponse> =>
    seedSyntheticStandardsPilotEndpoint(request),
);
