import { currentRequest } from "encore.dev";
import { APIError, Gateway, type Header } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import log from "encore.dev/log";
import { parseBearerToken } from "./bearer-token";
import {
  EntraAccessTokenError,
  EntraAuthenticationConfigurationError,
  verifyEntraAccessToken,
  type VerifiedEntraIdentity,
} from "./entra-access-token-verifier";
import { loadRuntimeEntraVerificationConfig } from "./entra-configuration";
import {
  createEntraJwksResolver,
  EntraKeyResolutionUnavailableError,
} from "./entra-jwks";
import {
  resolveActivePrincipalForEntraIdentity,
  type ActivePrincipalResolution,
} from "./external-identity";

export interface AuthenticationParams {
  authorization: Header<"Authorization">;
}

/** Trusted request identity. Business permissions remain in PostgreSQL. */
export interface CentreSuccessAuthData {
  userID: string;
}

export interface AuthenticationDependencies {
  verifyToken: (token: string) => Promise<VerifiedEntraIdentity>;
  resolvePrincipal: (
    identity: VerifiedEntraIdentity,
  ) => Promise<ActivePrincipalResolution>;
}

interface RuntimeVerifier {
  configurationKey: string;
  verify: (token: string) => Promise<VerifiedEntraIdentity>;
}

let runtimeVerifier: RuntimeVerifier | undefined;

function getRuntimeVerifier(): RuntimeVerifier {
  const configuration = loadRuntimeEntraVerificationConfig();
  const configurationKey = [
    configuration.tenantId,
    configuration.apiClientId,
    configuration.webClientId,
  ].join(":");

  if (runtimeVerifier?.configurationKey === configurationKey) {
    return runtimeVerifier;
  }

  const keyResolver = createEntraJwksResolver({
    tenantId: configuration.tenantId,
  });
  runtimeVerifier = {
    configurationKey,
    verify: (token) =>
      verifyEntraAccessToken(token, configuration, { keyResolver }),
  };
  return runtimeVerifier;
}

/**
 * Reuses the exact gateway verifier at the invitation-candidate boundary.
 * It returns only the durable Entra tenant/object identity and never creates
 * trusted Centre Success AuthData.
 */
export function verifyRuntimeEntraAccessToken(
  token: string,
): Promise<VerifiedEntraIdentity> {
  return getRuntimeVerifier().verify(token);
}

const runtimeDependencies: AuthenticationDependencies = {
  verifyToken: (token) => getRuntimeVerifier().verify(token),
  resolvePrincipal: resolveActivePrincipalForEntraIdentity,
};

type AuthenticationFailureReason =
  | "credential_missing_or_malformed"
  | "token_invalid"
  | "trust_material_unavailable"
  | "identity_lookup_unavailable"
  | "identity_not_provisioned";

const AUTH_FAILURE_LOG_COOLDOWN_MS = 30_000;
const lastAuthenticationFailureLog = new Map<AuthenticationFailureReason, number>();

/** Logs no token, claim, external identifier, credential, or database detail. */
function logAuthenticationFailure(reason: AuthenticationFailureReason): void {
  const now = Date.now();
  const lastLoggedAt = lastAuthenticationFailureLog.get(reason);
  if (
    lastLoggedAt !== undefined &&
    now - lastLoggedAt < AUTH_FAILURE_LOG_COOLDOWN_MS
  ) {
    return;
  }

  lastAuthenticationFailureLog.set(reason, now);
  const request = currentRequest();
  log.warn("authentication request rejected", {
    correlationId:
      request?.trace?.extCorrelationId ?? request?.trace?.traceId ?? "unavailable",
    reason,
  });
}

/**
 * Converts a verified external identity into the smallest trusted internal
 * identity accepted by Encore. No client-selected principal, role, capability,
 * organisation, centre, or Entra claim is copied into AuthData.
 */
export async function authenticateEntraRequest(
  params: { authorization?: unknown },
  dependencies: AuthenticationDependencies = runtimeDependencies,
): Promise<CentreSuccessAuthData> {
  let token: string;
  try {
    token = parseBearerToken(params.authorization);
  } catch {
    logAuthenticationFailure("credential_missing_or_malformed");
    throw APIError.unauthenticated("authentication required");
  }

  let identity: VerifiedEntraIdentity;
  try {
    identity = await dependencies.verifyToken(token);
  } catch (error) {
    if (
      error instanceof EntraAuthenticationConfigurationError ||
      error instanceof EntraKeyResolutionUnavailableError
    ) {
      logAuthenticationFailure("trust_material_unavailable");
      throw APIError.unavailable("authentication is temporarily unavailable");
    }

    if (error instanceof EntraAccessTokenError) {
      logAuthenticationFailure("token_invalid");
      throw APIError.unauthenticated("authentication required");
    }

    logAuthenticationFailure("trust_material_unavailable");
    throw APIError.unavailable("authentication is temporarily unavailable");
  }

  let resolution: ActivePrincipalResolution;
  try {
    resolution = await dependencies.resolvePrincipal(identity);
  } catch {
    logAuthenticationFailure("identity_lookup_unavailable");
    throw APIError.unavailable("authentication is temporarily unavailable");
  }

  if (resolution.status !== "active") {
    logAuthenticationFailure("identity_not_provisioned");
    throw APIError.unauthenticated("authentication required").withDetails({
      reason: "account_not_provisioned",
    });
  }

  return { userID: resolution.principalId };
}

export const centreSuccessAuthentication = authHandler<
  AuthenticationParams,
  CentreSuccessAuthData
>((params) => authenticateEntraRequest(params));

/** One application gateway applies the central handler to protected APIs. */
export const gateway = new Gateway({
  authHandler: centreSuccessAuthentication,
});
