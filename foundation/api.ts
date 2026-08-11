import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { AuthorisationContextError } from "./authorization/context-loader";
import type { CentreSuccessAuthData } from "./authentication/auth-handler";
import {
  AuthenticatedPrincipalContextError,
  loadAuthenticatedPrincipalContext,
} from "./authentication/principal-context";
import { centreSuccessDB } from "./db";

export interface FoundationHealthResponse {
  status: "operational";
  milestone: "1";
  backend: "connected";
  database: "available";
  checkedAt: string;
}

export interface FoundationMeResponse {
  provisioningStatus: "provisioned" | "not_provisioned";
  principal?: {
    id: string;
    displayName: string;
  };
  activeOrganisation?: {
    id: string;
    name: string;
  };
}

export interface FoundationMeDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  loadPrincipalContext: typeof loadAuthenticatedPrincipalContext;
}

const foundationMeRuntimeDependencies: FoundationMeDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  loadPrincipalContext: loadAuthenticatedPrincipalContext,
};

/**
 * Public liveness/readiness proof for local development and the foundation
 * shell. It intentionally exposes no organisation, centre, or principal data.
 */
export const health = api(
  { expose: true, method: "GET", path: "/foundation/health" },
  async (): Promise<FoundationHealthResponse> => {
    try {
      const row = await centreSuccessDB.queryRow<{ ready: boolean }>`
        SELECT TRUE AS ready
      `;

      if (!row?.ready) {
        throw new Error("database readiness query returned no result");
      }
    } catch (cause) {
      throw APIError.unavailable(
        "foundation database is unavailable",
        cause instanceof Error ? cause : undefined,
      );
    }

    return {
      status: "operational",
      milestone: "1",
      backend: "connected",
      database: "available",
      checkedAt: new Date().toISOString(),
    };
  },
);

/** @internal Testable protected-endpoint boundary; not an exposed API itself. */
export async function loadFoundationMe(
  dependencies: FoundationMeDependencies = foundationMeRuntimeDependencies,
): Promise<FoundationMeResponse> {
  const authData = dependencies.getTrustedAuthData();
  if (authData == null) {
    throw APIError.unauthenticated("authentication required");
  }

  try {
    const context = await dependencies.loadPrincipalContext(authData.userID);

    if (context.provisioningStatus === "not_provisioned") {
      return { provisioningStatus: "not_provisioned" };
    }

    return {
      provisioningStatus: "provisioned",
      principal: context.principal,
      activeOrganisation: context.activeOrganisation,
    };
  } catch (error) {
    if (
      error instanceof AuthenticatedPrincipalContextError ||
      error instanceof AuthorisationContextError
    ) {
      throw APIError.permissionDenied(
        "Centre Success access is not available",
      ).withDetails({ reason: "access_denied" });
    }

    throw APIError.unavailable("Centre Success context is temporarily unavailable");
  }
}

/**
 * Minimal protected proof of Entra -> internal principal -> PostgreSQL
 * authorisation context. It intentionally returns no grants or Entra claims.
 */
export const me = api(
  { expose: true, auth: true, method: "GET", path: "/foundation/me" },
  (): Promise<FoundationMeResponse> => loadFoundationMe(),
);
