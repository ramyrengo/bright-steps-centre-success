import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWK,
  type JWTVerifyGetKey,
  type LocalJWKSet,
} from "jose";
import {
  canonicaliseEntraGuid,
  entraDiscoveryUrl,
  entraIssuer,
  entraJwksUrl,
} from "./entra-identifiers";

export const ENTRA_JWKS_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;
export const ENTRA_JWKS_MAX_TRUST_MS = 24 * 60 * 60 * 1_000;
export const ENTRA_JWKS_REMOTE_COOLDOWN_MS = 5 * 60 * 1_000;
export const ENTRA_JWKS_REQUEST_TIMEOUT_MS = 5_000;

const MAX_JWKS_KEYS = 1_000;
const MAX_KEY_ID_LENGTH = 500;
const ENTRA_TENANT_ISSUER_TEMPLATE =
  "https://login.microsoftonline.com/{tenantid}/v2.0";

export interface EntraJwksResolverOptions {
  tenantId: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export type EntraKeyResolutionFailureCode =
  | "configuration_invalid"
  | "remote_unavailable"
  | "stale_key_set"
  | "unknown_signing_key";

export class EntraKeyResolutionUnavailableError extends Error {
  readonly code: Exclude<
    EntraKeyResolutionFailureCode,
    "unknown_signing_key"
  >;

  constructor(
    code: Exclude<EntraKeyResolutionFailureCode, "unknown_signing_key">,
  ) {
    super("Microsoft Entra signing keys are unavailable");
    this.name = "EntraKeyResolutionUnavailableError";
    this.code = code;
  }
}

export class EntraUnknownSigningKeyError extends Error {
  readonly code = "unknown_signing_key" as const;

  constructor() {
    super("Microsoft Entra signing key rejected");
    this.name = "EntraUnknownSigningKeyError";
  }
}

interface CachedKeySet {
  resolver: LocalJWKSet;
  fetchedAt: number;
}

type RefreshResult = "refreshed" | "cooldown" | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRsaSigningJwk(
  value: unknown,
  expectedIssuer: string,
): value is JWK {
  if (!isRecord(value)) {
    return false;
  }

  const kid = value.kid;
  const issuer = value.issuer;
  const hasPrivateMaterial = ["d", "p", "q", "dp", "dq", "qi", "k"].some(
    (field) => field in value,
  );

  return (
    value.kty === "RSA" &&
    (value.alg === undefined || value.alg === "RS256") &&
    (value.use === undefined || value.use === "sig") &&
    typeof kid === "string" &&
    kid.length > 0 &&
    kid.length <= MAX_KEY_ID_LENGTH &&
    kid === kid.trim() &&
    typeof value.n === "string" &&
    value.n.length > 0 &&
    typeof value.e === "string" &&
    value.e.length > 0 &&
    (issuer === undefined ||
      issuer === expectedIssuer ||
      issuer === ENTRA_TENANT_ISSUER_TEMPLATE) &&
    !hasPrivateMaterial
  );
}

function validateJwks(value: unknown, expectedIssuer: string): JSONWebKeySet {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error("invalid JWKS document");
  }

  if (value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
    throw new Error("invalid JWKS key count");
  }

  const keys = value.keys.filter((key) =>
    isSafeRsaSigningJwk(key, expectedIssuer),
  );
  if (keys.length === 0) {
    throw new Error("JWKS contains no trusted RS256 signing keys");
  }

  const kids = keys.map((key) => key.kid);
  if (new Set(kids).size !== kids.length) {
    throw new Error("JWKS contains duplicate signing key identifiers");
  }

  return { keys };
}

/**
 * Stateful, single-tenant Entra signing-key resolver.
 *
 * A successful key set is refreshed on the first request after one hour and
 * is never trusted beyond 24 hours. All remote/unknown-kid refresh attempts
 * share one five-minute cooldown and one in-flight promise, preventing a
 * forged-kid request flood from becoming a Microsoft metadata request flood.
 */
export class EntraJwksResolver {
  readonly resolve: JWTVerifyGetKey;

  private readonly tenantId: string;
  private readonly issuer: string;
  private readonly discoveryUrl: string;
  private readonly expectedJwksUrl: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly now: () => number;
  private cachedKeySet?: CachedKeySet;
  private lastRefreshAttemptAt?: number;
  private refreshInFlight?: Promise<RefreshResult>;

  constructor(options: EntraJwksResolverOptions) {
    const tenantId = canonicaliseEntraGuid(options.tenantId);
    if (tenantId === null || typeof (options.fetch ?? globalThis.fetch) !== "function") {
      throw new EntraKeyResolutionUnavailableError("configuration_invalid");
    }

    this.tenantId = tenantId;
    this.issuer = entraIssuer(tenantId);
    this.discoveryUrl = entraDiscoveryUrl(tenantId);
    this.expectedJwksUrl = entraJwksUrl(tenantId);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.resolve = (header, token) => this.resolveKey(header, token);
  }

  private async fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.fetchImplementation(url, {
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal,
    });

    if (!response.ok) {
      throw new Error("metadata endpoint rejected the request");
    }

    return response.json();
  }

  private async downloadKeySet(): Promise<JSONWebKeySet> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      ENTRA_JWKS_REQUEST_TIMEOUT_MS,
    );

    try {
      const metadata = await this.fetchJson(
        this.discoveryUrl,
        abortController.signal,
      );
      if (
        !isRecord(metadata) ||
        metadata.issuer !== this.issuer ||
        metadata.jwks_uri !== this.expectedJwksUrl
      ) {
        throw new Error("OIDC metadata does not match the configured tenant");
      }

      const jwks = await this.fetchJson(
        this.expectedJwksUrl,
        abortController.signal,
      );
      return validateJwks(jwks, this.issuer);
    } finally {
      clearTimeout(timeout);
    }
  }

  private refreshIfAllowed(): Promise<RefreshResult> {
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }

    const attemptedAt = this.now();
    if (
      this.lastRefreshAttemptAt !== undefined &&
      attemptedAt - this.lastRefreshAttemptAt < ENTRA_JWKS_REMOTE_COOLDOWN_MS
    ) {
      return Promise.resolve("cooldown");
    }

    this.lastRefreshAttemptAt = attemptedAt;
    const refresh = (async (): Promise<RefreshResult> => {
      try {
        const jwks = await this.downloadKeySet();
        this.cachedKeySet = {
          resolver: createLocalJWKSet(jwks),
          fetchedAt: this.now(),
        };
        return "refreshed";
      } catch {
        return "failed";
      }
    })();

    this.refreshInFlight = refresh;
    void refresh.finally(() => {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = undefined;
      }
    });
    return refresh;
  }

  private cachedKeySetIsTrusted(): boolean {
    if (this.cachedKeySet === undefined) {
      return false;
    }

    const age = this.now() - this.cachedKeySet.fetchedAt;
    return age >= 0 && age < ENTRA_JWKS_MAX_TRUST_MS;
  }

  private async resolveKey(
    protectedHeader: Parameters<JWTVerifyGetKey>[0],
    token: Parameters<JWTVerifyGetKey>[1],
  ): Promise<Awaited<ReturnType<JWTVerifyGetKey>>> {
    if (
      protectedHeader.alg !== "RS256" ||
      protectedHeader.typ !== "JWT" ||
      typeof protectedHeader.kid !== "string" ||
      protectedHeader.kid.length === 0 ||
      protectedHeader.kid.length > MAX_KEY_ID_LENGTH ||
      protectedHeader.kid !== protectedHeader.kid.trim()
    ) {
      throw new EntraUnknownSigningKeyError();
    }

    let refreshResult: RefreshResult | undefined;
    if (this.cachedKeySet === undefined) {
      refreshResult = await this.refreshIfAllowed();
    } else {
      const age = this.now() - this.cachedKeySet.fetchedAt;
      if (age < 0 || age >= ENTRA_JWKS_REFRESH_INTERVAL_MS) {
        refreshResult = await this.refreshIfAllowed();
      }
    }

    if (!this.cachedKeySetIsTrusted()) {
      throw new EntraKeyResolutionUnavailableError(
        this.cachedKeySet === undefined ? "remote_unavailable" : "stale_key_set",
      );
    }

    try {
      return await this.cachedKeySet!.resolver(protectedHeader, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) {
        throw new EntraUnknownSigningKeyError();
      }
    }

    // A scheduled/initial refresh already gave this request its one controlled
    // chance. Otherwise, an unknown kid may request one cooldown-protected
    // refresh and one retry against the replacement set.
    if (refreshResult === undefined) {
      refreshResult = await this.refreshIfAllowed();
    }

    if (refreshResult === "failed") {
      throw new EntraKeyResolutionUnavailableError("remote_unavailable");
    }
    if (refreshResult !== "refreshed" || !this.cachedKeySetIsTrusted()) {
      throw new EntraUnknownSigningKeyError();
    }

    try {
      return await this.cachedKeySet!.resolver(protectedHeader, token);
    } catch {
      throw new EntraUnknownSigningKeyError();
    }
  }
}

export function createEntraJwksResolver(
  options: EntraJwksResolverOptions,
): JWTVerifyGetKey {
  return new EntraJwksResolver(options).resolve;
}
