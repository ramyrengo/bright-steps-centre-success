import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type { DailySuccessRequest, DailySuccessResponse } from "./contracts";
import { buildDailySuccess, DailySuccessError } from "./service";

export interface DailySuccessApiDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  build: typeof buildDailySuccess;
}

const runtimeDependencies: DailySuccessApiDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  build: buildDailySuccess,
};

/** @internal Testable protected boundary. */
export async function loadDailySuccess(
  request: DailySuccessRequest,
  dependencies: DailySuccessApiDependencies = runtimeDependencies,
): Promise<DailySuccessResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.build({ principalId: authData.userID, request });
    return result.response;
  } catch (error) {
    if (error instanceof DailySuccessError && error.code === "access_denied") {
      throw APIError.permissionDenied("Daily Success perspective is not available");
    }
    if (error instanceof DailySuccessError && error.code === "centre_context_unavailable") {
      throw APIError.unavailable("Centre priorities could not be checked safely");
    }
    throw APIError.unavailable("Daily Success is temporarily unavailable");
  }
}

export const getDailySuccess = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/daily-success",
  },
  (request: DailySuccessRequest): Promise<DailySuccessResponse> =>
    loadDailySuccess(request),
);
