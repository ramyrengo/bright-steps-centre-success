import {
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { isCompactJwt } from "./bearer-token";
import {
  canonicaliseEntraGuid,
  entraIssuer,
} from "./entra-identifiers";
import { EntraKeyResolutionUnavailableError } from "./entra-jwks";

export const ENTRA_REQUIRED_DELEGATED_SCOPE = "access_as_user";
export const ENTRA_CLOCK_TOLERANCE_SECONDS = 5;

export interface EntraTokenVerificationConfig {
  tenantId: string;
  apiClientId: string;
  webClientId: string;
}

export interface VerifiedEntraIdentity {
  tenantId: string;
  objectId: string;
}

export interface EntraTokenVerifierDependencies {
  keyResolver: JWTVerifyGetKey;
  now?: () => Date;
}

export class EntraAuthenticationConfigurationError extends Error {
  constructor() {
    super("Microsoft Entra authentication configuration rejected");
    this.name = "EntraAuthenticationConfigurationError";
  }
}

export class EntraAccessTokenError extends Error {
  constructor() {
    super("Microsoft Entra access token rejected");
    this.name = "EntraAccessTokenError";
  }
}

export interface ValidatedEntraTokenVerificationConfig {
  tenantId: string;
  apiClientId: string;
  webClientId: string;
  issuer: string;
}

export function validateEntraTokenVerificationConfig(
  config: EntraTokenVerificationConfig,
): ValidatedEntraTokenVerificationConfig {
  const tenantId = canonicaliseEntraGuid(config.tenantId);
  const apiClientId = canonicaliseEntraGuid(config.apiClientId);
  const webClientId = canonicaliseEntraGuid(config.webClientId);

  if (
    tenantId === null ||
    apiClientId === null ||
    webClientId === null ||
    apiClientId === webClientId
  ) {
    throw new EntraAuthenticationConfigurationError();
  }

  return {
    tenantId,
    apiClientId,
    webClientId,
    issuer: entraIssuer(tenantId),
  };
}

function hasRequiredScope(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return value.split(" ").includes(ENTRA_REQUIRED_DELEGATED_SCOPE);
}

function isNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasStrictClaims(
  payload: JWTPayload,
  config: ValidatedEntraTokenVerificationConfig,
  now: Date,
): payload is JWTPayload & {
  aud: string;
  azp: string;
  exp: number;
  iat: number;
  nbf: number;
  oid: string;
  scp: string;
  tid: string;
  ver: "2.0";
} {
  const tid = canonicaliseEntraGuid(payload.tid);
  const oid = canonicaliseEntraGuid(payload.oid);
  const azp = canonicaliseEntraGuid(payload.azp);
  const nowSeconds = Math.floor(now.getTime() / 1_000);

  return (
    typeof payload.aud === "string" &&
    payload.aud === config.apiClientId &&
    tid === config.tenantId &&
    oid !== null &&
    azp === config.webClientId &&
    payload.ver === "2.0" &&
    hasRequiredScope(payload.scp) &&
    isNumericDate(payload.exp) &&
    isNumericDate(payload.nbf) &&
    isNumericDate(payload.iat) &&
    payload.nbf < payload.exp &&
    payload.iat <= payload.exp &&
    payload.iat <= nowSeconds + ENTRA_CLOCK_TOLERANCE_SECONDS
  );
}

/**
 * Verifies a v2 delegated access token minted for the Centre Success API.
 * Business roles and scopes are deliberately ignored; PostgreSQL remains the
 * sole application-authorisation source.
 */
export async function verifyEntraAccessToken(
  token: string,
  config: EntraTokenVerificationConfig,
  dependencies: EntraTokenVerifierDependencies,
): Promise<VerifiedEntraIdentity> {
  if (!isCompactJwt(token)) {
    throw new EntraAccessTokenError();
  }

  const validatedConfig = validateEntraTokenVerificationConfig(config);
  const now = dependencies.now?.() ?? new Date();

  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      dependencies.keyResolver,
      {
        algorithms: ["RS256"],
        issuer: validatedConfig.issuer,
        audience: validatedConfig.apiClientId,
        requiredClaims: [
          "aud",
          "azp",
          "exp",
          "iat",
          "iss",
          "nbf",
          "oid",
          "scp",
          "tid",
          "ver",
        ],
        clockTolerance: ENTRA_CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
      },
    );

    if (
      protectedHeader.alg !== "RS256" ||
      protectedHeader.typ !== "JWT" ||
      typeof protectedHeader.kid !== "string" ||
      protectedHeader.kid.length === 0 ||
      protectedHeader.kid.length > 500 ||
      protectedHeader.kid !== protectedHeader.kid.trim() ||
      !hasStrictClaims(payload, validatedConfig, now)
    ) {
      throw new EntraAccessTokenError();
    }

    return {
      tenantId: validatedConfig.tenantId,
      objectId: canonicaliseEntraGuid(payload.oid)!,
    };
  } catch (error) {
    if (
      error instanceof EntraAuthenticationConfigurationError ||
      error instanceof EntraAccessTokenError
    ) {
      throw error;
    }

    // Key-resolution infrastructure errors must remain distinguishable to the
    // Encore boundary; all signature/claim failures are the same public 401.
    if (error instanceof EntraKeyResolutionUnavailableError) {
      throw error;
    }

    throw new EntraAccessTokenError();
  }
}
