import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import {
  buildAuthorisedNavigation,
  NavigationError,
  type NavigationResponse,
} from "./service";

export interface NavigationApiDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  build: typeof buildAuthorisedNavigation;
}

const runtimeDependencies: NavigationApiDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  build: buildAuthorisedNavigation,
};

/** @internal Testable protected boundary. */
export async function loadAuthorisedNavigation(
  dependencies: NavigationApiDependencies = runtimeDependencies,
): Promise<NavigationResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  try {
    const result = await dependencies.build({ principalId: authData.userID });
    return result.response;
  } catch (error) {
    if (error instanceof NavigationError && error.code === "access_denied") {
      throw APIError.permissionDenied("navigation is not available");
    }
    throw APIError.unavailable("navigation is temporarily unavailable");
  }
}

export const getAuthorisedNavigationEndpoint = api(
  { expose: true, auth: true, method: "GET", path: "/navigation" },
  (): Promise<NavigationResponse> => loadAuthorisedNavigation(),
);
