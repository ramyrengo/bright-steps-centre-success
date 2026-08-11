import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import type { JWK } from "jose";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  EntraAccessTokenError,
  verifyEntraAccessToken,
  type EntraTokenVerificationConfig,
} from "./entra-access-token-verifier";
import {
  ENTRA_JWKS_MAX_TRUST_MS,
  ENTRA_JWKS_REFRESH_INTERVAL_MS,
  ENTRA_JWKS_REMOTE_COOLDOWN_MS,
  ENTRA_JWKS_REQUEST_TIMEOUT_MS,
  EntraJwksResolver,
  EntraKeyResolutionUnavailableError,
} from "./entra-jwks";

const START_MS = Date.parse("2026-08-11T00:00:00.000Z");
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const WEB_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;
const ISSUER_TEMPLATE = "https://login.microsoftonline.com/{tenantid}/v2.0";

const oldKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const newKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const unknownKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

const verificationConfig: EntraTokenVerificationConfig = {
  tenantId: TENANT_ID,
  apiClientId: API_CLIENT_ID,
  webClientId: WEB_CLIENT_ID,
};

function toJwk(
  publicKey: KeyObject,
  kid: string,
  issuer: string | undefined = ISSUER,
): JWK {
  return {
    ...(publicKey.export({ format: "jwk" }) as JWK),
    alg: "RS256",
    kid,
    use: "sig",
    ...(issuer === undefined ? {} : { issuer }),
  } as JWK;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signToken(privateKey: KeyObject, kid: string): string {
  const now = Math.floor(START_MS / 1_000);
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid });
  const payload = encodeJson({
    iss: ISSUER,
    aud: API_CLIENT_ID,
    tid: TENANT_ID,
    oid: OBJECT_ID,
    ver: "2.0",
    scp: "access_as_user",
    azp: WEB_CLIENT_ID,
    iat: now - 1,
    nbf: now - 1,
    exp: now + 48 * 60 * 60,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

interface RemoteFixture {
  nowMs: number;
  keys: JWK[];
  fail: boolean;
  metadataIssuer: string;
  metadataJwksUri: string;
  calls: string[];
  fetch: typeof globalThis.fetch;
}

function createRemoteFixture(keys: JWK[]): RemoteFixture {
  const fixture: RemoteFixture = {
    nowMs: START_MS,
    keys,
    fail: false,
    metadataIssuer: ISSUER,
    metadataJwksUri: JWKS_URL,
    calls: [],
    fetch: undefined as unknown as typeof globalThis.fetch,
  };

  fixture.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fixture.calls.push(url);
    if (fixture.fail) {
      throw new Error("synthetic remote failure");
    }

    if (url === DISCOVERY_URL) {
      return new Response(
        JSON.stringify({
          issuer: fixture.metadataIssuer,
          jwks_uri: fixture.metadataJwksUri,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === JWKS_URL) {
      return new Response(JSON.stringify({ keys: fixture.keys }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;

  return fixture;
}

function createVerifier(fixture: RemoteFixture) {
  const resolver = new EntraJwksResolver({
    tenantId: TENANT_ID,
    fetch: fixture.fetch,
    now: () => fixture.nowMs,
  });

  return (token: string) =>
    verifyEntraAccessToken(token, verificationConfig, {
      keyResolver: resolver.resolve,
      now: () => new Date(fixture.nowMs),
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Microsoft Entra OIDC/JWKS resolver", () => {
  test("caches a trusted JWKS instead of fetching on every request", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");

    await expect(verify(token)).resolves.toBeDefined();
    await expect(verify(token)).resolves.toBeDefined();

    expect(fixture.calls).toEqual([DISCOVERY_URL, JWKS_URL]);
  });

  test("attempts a periodic refresh on the first request after one hour", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");

    await verify(token);
    fixture.nowMs += ENTRA_JWKS_REFRESH_INTERVAL_MS;
    await verify(token);

    expect(fixture.calls).toEqual([
      DISCOVERY_URL,
      JWKS_URL,
      DISCOVERY_URL,
      JWKS_URL,
    ]);
  });

  test("refreshes once for an unknown kid, accepts a rotated key, then rate-limits misses", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    await verify(signToken(oldKeys.privateKey, "old"));

    fixture.keys = [
      toJwk(oldKeys.publicKey, "old"),
      toJwk(newKeys.publicKey, "new"),
    ];
    fixture.nowMs += ENTRA_JWKS_REMOTE_COOLDOWN_MS;
    await expect(verify(signToken(newKeys.privateKey, "new"))).resolves.toBeDefined();

    await expect(
      verify(signToken(unknownKeys.privateKey, "never-published")),
    ).rejects.toBeInstanceOf(EntraAccessTokenError);
    expect(fixture.calls).toHaveLength(4);
  });

  test("denies an unknown kid when one controlled refresh still does not publish it", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    await verify(signToken(oldKeys.privateKey, "old"));

    fixture.nowMs += ENTRA_JWKS_REMOTE_COOLDOWN_MS;
    await expect(
      verify(signToken(unknownKeys.privateKey, "never-published")),
    ).rejects.toBeInstanceOf(EntraAccessTokenError);

    expect(fixture.calls).toEqual([
      DISCOVERY_URL,
      JWKS_URL,
      DISCOVERY_URL,
      JWKS_URL,
    ]);
  });

  test("singleflights concurrent unknown-kid refreshes", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    await verify(signToken(oldKeys.privateKey, "old"));

    fixture.keys = [
      toJwk(oldKeys.publicKey, "old"),
      toJwk(newKeys.publicKey, "new"),
    ];
    fixture.nowMs += ENTRA_JWKS_REMOTE_COOLDOWN_MS;
    const rotated = signToken(newKeys.privateKey, "new");
    await Promise.all(Array.from({ length: 12 }, () => verify(rotated)));

    expect(fixture.calls).toHaveLength(4);
  });

  test("uses last-known-good keys after a refresh failure while trust is under 24 hours", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");
    await verify(token);

    fixture.fail = true;
    fixture.nowMs += ENTRA_JWKS_REFRESH_INTERVAL_MS;
    await expect(verify(token)).resolves.toBeDefined();
    expect(fixture.calls).toHaveLength(3);
  });

  test("never trusts a cached signing key for 24 hours or longer", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");
    await verify(token);

    fixture.fail = true;
    fixture.nowMs += ENTRA_JWKS_MAX_TRUST_MS;
    await expect(verify(token)).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
  });

  test("fails closed if the key-cache clock moves backwards", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");
    await verify(token);

    fixture.nowMs -= 1;
    await expect(verify(token)).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
    expect(fixture.calls).toHaveLength(2);
  });

  test("applies one global five-minute cooldown after a failed remote attempt", async () => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    fixture.fail = true;
    const verify = createVerifier(fixture);
    const token = signToken(oldKeys.privateKey, "old");

    await expect(verify(token)).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
    await expect(verify(token)).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
    expect(fixture.calls).toEqual([DISCOVERY_URL]);
  });

  test("accepts Microsoft's exact tenant issuer template on a signing key", async () => {
    const fixture = createRemoteFixture([
      toJwk(oldKeys.publicKey, "old", ISSUER_TEMPLATE),
    ]);
    const verify = createVerifier(fixture);

    await expect(verify(signToken(oldKeys.privateKey, "old"))).resolves.toBeDefined();
  });

  test("rejects a signing key bound to a foreign concrete tenant issuer", async () => {
    const fixture = createRemoteFixture([
      toJwk(
        oldKeys.publicKey,
        "old",
        "https://login.microsoftonline.com/55555555-5555-4555-8555-555555555555/v2.0",
      ),
    ]);
    const verify = createVerifier(fixture);

    await expect(verify(signToken(oldKeys.privateKey, "old"))).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
  });

  test.each([
    ["foreign issuer", "https://login.microsoftonline.com/common/v2.0", JWKS_URL],
    [
      "foreign JWKS URL",
      ISSUER,
      "https://attacker.example.test/keys",
    ],
  ])("rejects %s in OIDC discovery metadata", async (_label, issuer, jwksUri) => {
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    fixture.metadataIssuer = issuer;
    fixture.metadataJwksUri = jwksUri;
    const verify = createVerifier(fixture);

    await expect(verify(signToken(oldKeys.privateKey, "old"))).rejects.toBeInstanceOf(
      EntraKeyResolutionUnavailableError,
    );
    expect(fixture.calls).toEqual([DISCOVERY_URL]);
  });

  test("aborts remote resolution after five seconds", async () => {
    vi.useFakeTimers();
    const fixture = createRemoteFixture([toJwk(oldKeys.publicKey, "old")]);
    fixture.fetch = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("synthetic abort")),
        );
      })) as typeof globalThis.fetch;
    const verify = createVerifier(fixture);
    const rejection = expect(
      verify(signToken(oldKeys.privateKey, "old")),
    ).rejects.toBeInstanceOf(EntraKeyResolutionUnavailableError);

    await vi.advanceTimersByTimeAsync(ENTRA_JWKS_REQUEST_TIMEOUT_MS);
    await rejection;
  });
});
