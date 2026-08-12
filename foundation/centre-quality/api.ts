import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type {
  CentreQualityDetailRequest,
  CentreQualityDetailResponse,
  CentreQualityWorkspaceRequest,
  CentreQualityWorkspaceResponse,
} from "./contracts";
import {
  buildCentreQualityDetail,
  buildCentreQualityWorkspace,
  CentreQualityError,
} from "./service";

export interface CentreQualityApiDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  buildWorkspace: typeof buildCentreQualityWorkspace;
  buildDetail: typeof buildCentreQualityDetail;
}

const runtimeDependencies: CentreQualityApiDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  buildWorkspace: buildCentreQualityWorkspace,
  buildDetail: buildCentreQualityDetail,
};

/** Maps internal failures to safe, non-disclosing API errors. */
function toApiError(error: unknown): never {
  if (error instanceof CentreQualityError && error.code === "access_denied") {
    throw APIError.permissionDenied("Centre Quality view is not available");
  }
  if (error instanceof CentreQualityError && error.code === "centre_context_unavailable") {
    throw APIError.unavailable("Centre quality could not be checked safely");
  }
  throw APIError.unavailable("Centre Quality is temporarily unavailable");
}

/** @internal Testable protected boundary. */
export async function loadCentreQualityWorkspace(
  request: CentreQualityWorkspaceRequest,
  dependencies: CentreQualityApiDependencies = runtimeDependencies,
): Promise<CentreQualityWorkspaceResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.buildWorkspace({
      principalId: authData.userID,
      request,
    });
    return result.response;
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable protected boundary. */
export async function loadCentreQualityDetail(
  request: CentreQualityDetailRequest,
  dependencies: CentreQualityApiDependencies = runtimeDependencies,
): Promise<CentreQualityDetailResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.buildDetail({
      principalId: authData.userID,
      centreId: request.centreId,
    });
    return result.response;
  } catch (error) {
    return toApiError(error);
  }
}

export const getCentreQualityWorkspace = api(
  { expose: true, auth: true, method: "GET", path: "/centre-quality" },
  (request: CentreQualityWorkspaceRequest): Promise<CentreQualityWorkspaceResponse> =>
    loadCentreQualityWorkspace(request),
);

export const getCentreQualityDetail = api(
  { expose: true, auth: true, method: "GET", path: "/centre-quality/centres/:centreId" },
  (request: CentreQualityDetailRequest): Promise<CentreQualityDetailResponse> =>
    loadCentreQualityDetail(request),
);
