import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { createLocalJWKSet, type JWK } from "jose";
import { describe, expect, test } from "vitest";
import {
  BearerCredentialError,
  parseBearerToken,
} from "./bearer-token";
import {
  EntraAccessTokenError,
  EntraAuthenticationConfigurationError,
  verifyEntraAccessToken,
  type EntraTokenVerificationConfig,
} from "./entra-access-token-verifier";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const WEB_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const KID = "entra-verifier-primary";

const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const unrelatedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

function toPublicJwk(publicKey: KeyObject, kid: string): JWK {
  return {
    ...(publicKey.export({ format: "jwk" }) as JWK),
    alg: "RS256",
    kid,
    use: "sig",
  };
}

const keyResolver = createLocalJWKSet({
  keys: [toPublicJwk(signingKeys.publicKey, KID)],
});

const verificationConfig: EntraTokenVerificationConfig = {
  tenantId: TENANT_ID,
  apiClientId: API_CLIENT_ID,
  webClientId: WEB_CLIENT_ID,
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function currentClaims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: API_CLIENT_ID,
    tid: TENANT_ID,
    oid: OBJECT_ID,
    ver: "2.0",
    scp: "access_as_user",
    azp: WEB_CLIENT_ID,
    iat: NOW_SECONDS - 1,
    nbf: NOW_SECONDS - 1,
    exp: NOW_SECONDS + 60,
    ...overrides,
  };
}

function signToken(options: {
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  privateKey?: KeyObject;
} = {}): string {
  const header = encodeJson({
    alg: "RS256",
    typ: "JWT",
    kid: KID,
    ...options.header,
  });
  const payload = encodeJson(options.claims ?? currentClaims());
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer
    .sign(options.privateKey ?? signingKeys.privateKey)
    .toString("base64url")}`;
}

async function verify(token: string) {
  return verifyEntraAccessToken(token, verificationConfig, {
    keyResolver,
    now: () => NOW,
  });
}

describe("strict bearer transport", () => {
  test.each(["Bearer", "bearer", "BEARER"])(
    "accepts the case-insensitive HTTP %s scheme with one compact JWT",
    (scheme) => {
      const token = signToken();
      expect(parseBearerToken(`${scheme} ${token}`)).toBe(token);
    },
  );

  test.each([
    undefined,
    "",
    "Basic abc.def.ghi",
    "Bearer  abc.def.ghi",
    "Bearer abc.def.ghi ",
    "Bearer abc.def.ghi, Bearer def.ghi.jkl",
    "Bearer not-a-jwt",
  ])("rejects missing or malformed Authorization value %#", (authorization) => {
    expect(() => parseBearerToken(authorization)).toThrow(BearerCredentialError);
  });
});

describe("strict Microsoft Entra access-token verification", () => {
  test("accepts a valid delegated API access token and returns only tid+oid", async () => {
    await expect(verify(signToken())).resolves.toEqual({
      tenantId: TENANT_ID,
      objectId: OBJECT_ID,
    });
  });

  test("ignores tempting Entra roles as a business-authorisation source", async () => {
    await expect(
      verify(
        signToken({
          claims: currentClaims({
            roles: ["System.Administrator", "Executive"],
          }),
        }),
      ),
    ).resolves.toEqual({ tenantId: TENANT_ID, objectId: OBJECT_ID });
  });

  test.each([
    ["invalid signature", {}, unrelatedKeys.privateKey],
    ["expired", { exp: NOW_SECONDS - 6 }, undefined],
    ["future nbf", { nbf: NOW_SECONDS + 60 }, undefined],
    ["future iat", { iat: NOW_SECONDS + 60 }, undefined],
    [
      "wrong issuer",
      { iss: "https://login.microsoftonline.com/common/v2.0" },
      undefined,
    ],
    [
      "wrong tenant",
      { tid: "55555555-5555-4555-8555-555555555555" },
      undefined,
    ],
    ["SPA/ID-token audience", { aud: WEB_CLIENT_ID }, undefined],
    [
      "Microsoft Graph-like audience",
      { aud: "00000003-0000-0000-c000-000000000000" },
      undefined,
    ],
    ["audience list fallback", { aud: [API_CLIENT_ID] }, undefined],
    ["wrong calling client", { azp: API_CLIENT_ID }, undefined],
    ["wrong scope", { scp: "openid profile" }, undefined],
    ["v1 token", { ver: "1.0" }, undefined],
    ["non-GUID object identity", { oid: "user@example.test" }, undefined],
  ] as const)("rejects %s", async (_label, claims, privateKey) => {
    await expect(
      verify(
        signToken({
          claims: currentClaims(claims),
          privateKey,
        }),
      ),
    ).rejects.toBeInstanceOf(EntraAccessTokenError);
  });

  test.each(["scp", "oid", "tid", "azp", "exp", "nbf", "iat"])(
    "rejects a token without required %s",
    async (claim) => {
      const claims = currentClaims();
      delete claims[claim];
      await expect(verify(signToken({ claims }))).rejects.toBeInstanceOf(
        EntraAccessTokenError,
      );
    },
  );

  test.each([
    ["missing typ", { typ: undefined }],
    ["wrong typ", { typ: "at+jwt" }],
    ["missing kid", { kid: undefined }],
  ])("rejects a token with %s", async (_label, header) => {
    await expect(verify(signToken({ header }))).rejects.toBeInstanceOf(
      EntraAccessTokenError,
    );
  });

  test("rejects invalid or collapsed two-registration configuration", async () => {
    await expect(
      verifyEntraAccessToken(signToken(), {
        tenantId: "not-a-guid",
        apiClientId: API_CLIENT_ID,
        webClientId: WEB_CLIENT_ID,
      }, {
        keyResolver,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(EntraAuthenticationConfigurationError);

    await expect(
      verifyEntraAccessToken(signToken(), {
        tenantId: TENANT_ID,
        apiClientId: API_CLIENT_ID,
        webClientId: API_CLIENT_ID,
      }, {
        keyResolver,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(EntraAuthenticationConfigurationError);
  });
});
