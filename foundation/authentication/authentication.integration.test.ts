import {
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { APIError } from "encore.dev/api";
import { createLocalJWKSet, type JWK } from "jose";
import { describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { centreSuccessDB } from "../db";
import {
  authenticateEntraRequest,
  type AuthenticationDependencies,
} from "./auth-handler";
import {
  verifyEntraAccessToken,
  type EntraTokenVerificationConfig,
} from "./entra-access-token-verifier";
import {
  microsoftEntraProviderKey,
  resolveActivePrincipalForEntraIdentity,
} from "./external-identity";
import {
  AuthenticatedPrincipalContextError,
  loadAuthenticatedPrincipalContext,
} from "./principal-context";

const DECISION_AT = new Date("2026-08-11T00:00:00.000Z");
const DECISION_AT_SECONDS = Math.floor(DECISION_AT.getTime() / 1_000);
const MEMBERSHIP_START = new Date("2026-01-01T00:00:00.000Z");
const EXPIRED_ASSIGNMENT_END = new Date("2026-06-01T00:00:00.000Z");
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_TENANT_ID = "55555555-5555-4555-8555-555555555555";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const WEB_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const KID = "entra-integration-primary";

const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...(signingKeys.publicKey.export({ format: "jwk" }) as JWK),
  alg: "RS256",
  kid: KID,
  use: "sig",
};
const keyResolver = createLocalJWKSet({ keys: [publicJwk] });
const verificationConfig: EntraTokenVerificationConfig = {
  tenantId: TENANT_ID,
  apiClientId: API_CLIENT_ID,
  webClientId: WEB_CLIENT_ID,
};

const authenticationDependencies: AuthenticationDependencies = {
  verifyToken: (token) =>
    verifyEntraAccessToken(token, verificationConfig, {
      keyResolver,
      now: () => DECISION_AT,
    }),
  resolvePrincipal: resolveActivePrincipalForEntraIdentity,
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signAccessToken(
  oid: string,
  privateKey: KeyObject = signingKeys.privateKey,
): string {
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: KID });
  const payload = encodeJson({
    iss: ISSUER,
    aud: API_CLIENT_ID,
    tid: TENANT_ID,
    oid,
    ver: "2.0",
    scp: "access_as_user",
    azp: WEB_CLIENT_ID,
    iat: DECISION_AT_SECONDS - 1,
    nbf: DECISION_AT_SECONDS - 1,
    exp: DECISION_AT_SECONDS + 60,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

async function authenticateOid(oid: string) {
  return authenticateEntraRequest(
    { authorization: `Bearer ${signAccessToken(oid)}` },
    authenticationDependencies,
  );
}

async function addOrganisation(label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${label}, 'active', 'Australia/Sydney')
  `;
  return id;
}

async function addPrincipal(
  label: string,
  status: "pending" | "active" | "suspended" | "revoked" = "active",
): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${id}, ${label}, ${status})
  `;
  return id;
}

async function addMapping(
  oid: string,
  principalId: string,
  status: "active" | "inactive" = "active",
  tenantId = TENANT_ID,
): Promise<void> {
  const providerKey = microsoftEntraProviderKey(tenantId);
  if (providerKey === null) {
    throw new Error("synthetic tenant identifier was invalid");
  }

  await centreSuccessDB.exec`
    INSERT INTO external_identity_mappings (
      id,
      principal_id,
      provider_key,
      provider_subject,
      status,
      last_verified_at
    ) VALUES (
      ${randomUUID()},
      ${principalId},
      ${providerKey},
      ${oid},
      ${status},
      ${DECISION_AT}
    )
  `;
}

async function addMembership(
  organisationId: string,
  principalId: string,
): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id,
      organisation_id,
      principal_id,
      status,
      effective_from
    ) VALUES (
      ${id},
      ${organisationId},
      ${principalId},
      'active',
      ${MEMBERSHIP_START}
    )
  `;
  return id;
}

async function addCentre(organisationId: string, label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO centres (
      id,
      organisation_id,
      code,
      name,
      jurisdiction_code,
      timezone,
      status
    ) VALUES (
      ${id},
      ${organisationId},
      ${id.slice(0, 12)},
      ${label},
      'NSW',
      'Australia/Sydney',
      'active'
    )
  `;
  return id;
}

async function addExpiredCentreDirectorAssignment(
  organisationId: string,
  membershipId: string,
  centreId: string,
): Promise<void> {
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id
    FROM role_definitions
    WHERE organisation_id = ${organisationId}
      AND role_key = 'centre_director'
      AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
  `;
  if (role === null) {
    throw new Error("canonical Centre Director role was not provisioned");
  }

  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id,
      organisation_id,
      organisation_membership_id,
      role_definition_id,
      status,
      effective_from,
      effective_to,
      grant_source_type,
      reason
    ) VALUES (
      ${assignmentId},
      ${organisationId},
      ${membershipId},
      ${role.id},
      'active',
      ${MEMBERSHIP_START},
      ${EXPIRED_ASSIGNMENT_END},
      'bootstrap',
      'Synthetic expired authentication-gate assignment.'
    )
  `;

  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id,
      organisation_id,
      role_assignment_id,
      scope_type,
      centre_id,
      effective_from,
      effective_to
    ) VALUES (
      ${randomUUID()},
      ${organisationId},
      ${assignmentId},
      'centre',
      ${centreId},
      ${MEMBERSHIP_START},
      ${EXPIRED_ASSIGNMENT_END}
    )
  `;
}

function expectAccountNotProvisioned(error: unknown, reason: string): void {
  expect(error).toBeInstanceOf(APIError);
  expect(error).toMatchObject({
    code: "unauthenticated",
    message: "authentication required",
    details: { reason },
  });
}

describe("Entra identity to internal principal mapping", () => {
  test("rejects a missing Authorization header at the central auth boundary", async () => {
    await authenticateEntraRequest({}, authenticationDependencies).then(
      () => {
        throw new Error("missing credential unexpectedly authenticated");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(APIError);
        expect(error).toMatchObject({
          code: "unauthenticated",
          message: "authentication required",
        });
      },
    );
  });

  test("denies a valid token without an external identity mapping", async () => {
    await authenticateOid(randomUUID()).then(
      () => {
        throw new Error("unmapped token unexpectedly authenticated");
      },
      (error: unknown) => expectAccountNotProvisioned(error, "account_not_provisioned"),
    );
  });

  test("denies a valid token mapped to an inactive principal", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Suspended authentication principal", "suspended");
    await addMapping(oid, principalId);

    await authenticateOid(oid).then(
      () => {
        throw new Error("inactive principal unexpectedly authenticated");
      },
      (error: unknown) => expectAccountNotProvisioned(error, "account_not_provisioned"),
    );
  });

  test("denies a valid token through an inactive external mapping", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Inactive mapping principal");
    await addMapping(oid, principalId, "inactive");

    await authenticateOid(oid).then(
      () => {
        throw new Error("inactive mapping unexpectedly authenticated");
      },
      (error: unknown) => expectAccountNotProvisioned(error, "account_not_provisioned"),
    );
  });

  test("does not resolve the same oid through another tenant provider key", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Foreign tenant mapping principal");
    await addMapping(oid, principalId, "active", FOREIGN_TENANT_ID);

    await authenticateOid(oid).then(
      () => {
        throw new Error("cross-tenant mapping unexpectedly authenticated");
      },
      (error: unknown) => expectAccountNotProvisioned(error, "account_not_provisioned"),
    );
  });

  test("returns only the trusted internal principal ID for an active mapping", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Active authentication principal");
    await addMapping(oid, principalId);

    const authData = await authenticateOid(oid);

    expect(authData).toEqual({ userID: principalId });
    expect(Object.keys(authData)).toEqual(["userID"]);
  });
});

describe("authenticated PostgreSQL authorisation context", () => {
  test("returns identity-only not_provisioned for zero active memberships", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("No organisation principal");
    await addMapping(oid, principalId);

    const authData = await authenticateOid(oid);
    await expect(
      loadAuthenticatedPrincipalContext(authData.userID, DECISION_AT),
    ).resolves.toEqual({ provisioningStatus: "not_provisioned" });
  });

  test("loads context for exactly one active organisation membership", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Context authentication principal");
    const organisationId = await addOrganisation("Authentication context organisation");
    await addMapping(oid, principalId);
    const membershipId = await addMembership(organisationId, principalId);

    const authData = await authenticateOid(oid);
    const context = await loadAuthenticatedPrincipalContext(
      authData.userID,
      DECISION_AT,
    );

    expect(context).toMatchObject({
      provisioningStatus: "provisioned",
      principal: {
        id: principalId,
        displayName: "Context authentication principal",
      },
      activeOrganisation: { id: organisationId },
      authorisation: {
        principalId,
        activeOrganisationId: organisationId,
        memberships: [{ id: membershipId }],
      },
    });
  });

  test("rechecks internal principal revocation on every context load", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Revoked after authentication principal");
    const organisationId = await addOrganisation("Revocation organisation");
    await addMapping(oid, principalId);
    await addMembership(organisationId, principalId);
    const authData = await authenticateOid(oid);

    await centreSuccessDB.exec`
      UPDATE principals SET status = 'revoked' WHERE id = ${principalId}
    `;

    await expect(
      loadAuthenticatedPrincipalContext(authData.userID, DECISION_AT),
    ).rejects.toMatchObject({ code: "principal_unavailable" });
  });

  test("denies a different-organisation access request after valid authentication", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Cross-organisation authentication principal");
    const assignedOrganisationId = await addOrganisation("Assigned authentication organisation");
    const otherOrganisationId = await addOrganisation("Unassigned authentication organisation");
    const otherCentreId = await addCentre(otherOrganisationId, "Unassigned centre");
    await addMapping(oid, principalId);
    await addMembership(assignedOrganisationId, principalId);

    const authData = await authenticateOid(oid);
    await expect(
      authoriseCentreFromDatabase({
        principalId: authData.userID,
        activeOrganisationId: otherOrganisationId,
        centreId: otherCentreId,
        capability: FOUNDATION_CAPABILITIES.centreRead,
        at: DECISION_AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "membership_missing" });
  });

  test("does not let a valid token bypass an expired assignment", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Expired assignment authentication principal");
    const organisationId = await addOrganisation("Expired assignment organisation");
    const centreId = await addCentre(organisationId, "Expired assignment centre");
    await addMapping(oid, principalId);
    const membershipId = await addMembership(organisationId, principalId);
    await addExpiredCentreDirectorAssignment(organisationId, membershipId, centreId);

    const authData = await authenticateOid(oid);
    await expect(
      authoriseCentreFromDatabase({
        principalId: authData.userID,
        activeOrganisationId: organisationId,
        centreId,
        capability: FOUNDATION_CAPABILITIES.centreManage,
        at: DECISION_AT,
      }),
    ).resolves.toEqual({ allowed: false, reason: "capability_missing" });
  });

  test("fails closed when more than one active organisation could be selected", async () => {
    const oid = randomUUID();
    const principalId = await addPrincipal("Ambiguous organisation principal");
    const organisationA = await addOrganisation("Ambiguous organisation A");
    const organisationB = await addOrganisation("Ambiguous organisation B");
    await addMapping(oid, principalId);
    await addMembership(organisationA, principalId);
    await addMembership(organisationB, principalId);

    const authData = await authenticateOid(oid);
    await loadAuthenticatedPrincipalContext(authData.userID, DECISION_AT).then(
      () => {
        throw new Error("ambiguous organisation context unexpectedly loaded");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(AuthenticatedPrincipalContextError);
        expect(error).toMatchObject({ code: "active_organisation_ambiguous" });
      },
    );
  });
});
