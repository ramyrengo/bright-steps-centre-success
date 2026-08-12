import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createLocalJWKSet, type JWK } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { authorise } from "../authorization/policy";
import { loadPrincipalAuthorisationContext } from "../authorization/context-loader";
import { centreSuccessDB } from "../db";
import {
  verifyEntraAccessToken,
  type EntraTokenVerificationConfig,
} from "../authentication/entra-access-token-verifier";
import { acceptInvitationCandidate } from "./api";
import {
  acceptInvitation,
  addRoleAssignment,
  approvePrivilegedInvitation,
  cancelInvitation,
  createInvitation,
  replaceAssignmentScope,
  sendInvitation,
  transitionPrincipalLifecycle,
  type PeopleAccessWorkflowDependencies,
} from "./service";
import {
  claimInvitationDeliveriesForDispatch,
  deliverInvitationOutboxMessage,
  dispatchPendingInvitationDeliveries,
} from "./outbox";
import { getAccessHistory, getInvitationSummary } from "./queries";
import { InvitationDeliveryError, type InvitationDeliveryRequest } from "./email";

const TENANT_ID = "27026100-3522-48b5-8e95-80230afc4127";
const TEST_API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const TEST_WEB_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const TEST_SIGNING_KID = "people-access-candidate-boundary";
const DECISION_AT = new Date("2026-08-11T12:00:00.000Z");
const candidateSigningKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

function publicJwk(publicKey: KeyObject): JWK {
  return {
    ...(publicKey.export({ format: "jwk" }) as JWK),
    alg: "RS256",
    kid: TEST_SIGNING_KID,
    use: "sig",
  };
}

const candidateKeyResolver = createLocalJWKSet({
  keys: [publicJwk(candidateSigningKeys.publicKey)],
});
const candidateVerificationConfig: EntraTokenVerificationConfig = {
  tenantId: TENANT_ID,
  apiClientId: TEST_API_CLIENT_ID,
  webClientId: TEST_WEB_CLIENT_ID,
};

interface Fixture {
  organisationId: string;
  centreA: string;
  centreB: string;
  inviterId: string;
  approverId: string;
}

let fixture: Fixture;

async function addAdministrator(organisationId: string, label: string): Promise<string> {
  const principalId = randomUUID();
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${organisationId}
      AND role_key = 'system_administrator'
      AND status = 'active'
  `;
  if (!role) throw new Error("System Administrator role missing");
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status) VALUES (${principalId}, ${label}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO external_identity_mappings (
      id, principal_id, provider_key, provider_subject, status, last_verified_at
    ) VALUES (
      ${randomUUID()}, ${principalId}, ${`microsoft_entra:${TENANT_ID}`}, ${randomUUID()}, 'active', now()
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id, organisation_id, principal_id, status, effective_from
    ) VALUES (${membershipId}, ${organisationId}, ${principalId}, 'active', '2026-01-01')
  `;
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, granted_by_principal_id, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${organisationId}, ${membershipId}, ${role.id}, 'active',
      '2026-01-01', NULL, 'bootstrap', 'Synthetic integration-test administrator.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, effective_from
    ) VALUES (${randomUUID()}, ${organisationId}, ${assignmentId}, 'organisation', '2026-01-01')
  `;
  return principalId;
}

async function addCentre(organisationId: string, label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO centres (
      id, organisation_id, code, name, jurisdiction_code, timezone, status
    ) VALUES (
      ${id}, ${organisationId}, ${id.slice(0, 12)}, ${label}, 'NSW', 'Australia/Sydney', 'active'
    )
  `;
  return id;
}

beforeAll(async () => {
  const organisationId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${organisationId}, 'People Access integration organisation', 'active', 'Australia/Sydney')
  `;
  const centreA = await addCentre(organisationId, "People Access Centre A");
  const centreB = await addCentre(organisationId, "People Access Centre B");
  const inviterId = await addAdministrator(organisationId, "People Access Inviter");
  const approverId = await addAdministrator(organisationId, "People Access Approver");
  fixture = { organisationId, centreA, centreB, inviterId, approverId };
});

function harness(start = DECISION_AT) {
  let now = start;
  let latestToken = "";
  const deliveryEncryptionKey = randomBytes(32).toString("base64");
  const dependencies: PeopleAccessWorkflowDependencies = {
    now: () => now,
    randomId: randomUUID,
    randomToken: () => {
      latestToken = randomBytes(32).toString("base64url");
      return latestToken;
    },
    tokenDigestKey: "integration-digest-key-material-32-bytes-minimum",
    deliveryEncryptionKey,
  };
  return {
    dependencies,
    token: () => latestToken,
    setNow: (value: Date) => { now = value; },
    deliveryEncryptionKey,
  };
}

function candidateJwt(email: string, objectId: string, extras: Record<string, unknown> = {}): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    tid: TENANT_ID,
    oid: objectId,
    email,
    ...extras,
  })}.signature`;
}

function signedCandidateJwt(email: string, objectId: string): string {
  const now = Math.floor(DECISION_AT.getTime() / 1_000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT", kid: TEST_SIGNING_KID });
  const payload = encode({
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    aud: TEST_API_CLIENT_ID,
    tid: TENANT_ID,
    oid: objectId,
    email,
    ver: "2.0",
    scp: "access_as_user",
    azp: TEST_WEB_CLIENT_ID,
    iat: now - 1,
    nbf: now - 1,
    exp: now + 60,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(candidateSigningKeys.privateKey).toString("base64url")}`;
}

async function createAndSendStandard(h: ReturnType<typeof harness>, email: string) {
  const draft = await createInvitation({
    organisationId: fixture.organisationId,
    actorPrincipalId: fixture.inviterId,
    request: {
      email,
      displayName: "Synthetic Invited Educator",
      assignments: [{
        roleKey: "educator",
        scopes: [
          { scopeType: "centre", centreId: fixture.centreA },
          { scopeType: "centre", centreId: fixture.centreB },
        ],
      }],
      reason: "Synthetic integration invitation.",
    },
  }, h.dependencies);
  return sendInvitation({
    organisationId: fixture.organisationId,
    invitationId: draft.id,
    actorPrincipalId: fixture.inviterId,
    expectedLockVersion: draft.lockVersion,
    resend: false,
  }, h.dependencies);
}

async function createDeliveryFixture(label: string, start = DECISION_AT) {
  const h = harness(start);
  const sent = await createAndSendStandard(
    h,
    `${label}-${randomUUID()}@brightsteps.example`,
  );
  const outbox = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT outbox.id
    FROM people_notification_outbox AS outbox
    JOIN invitation_token_generations AS generation
      ON generation.id = outbox.token_generation_id
    WHERE outbox.invitation_id = ${sent.id}
      AND generation.status = 'CURRENT'
  `;
  if (!outbox) throw new Error("synthetic invitation outbox missing");
  return { h, sent, outboxId: outbox.id };
}

describe("Milestone 2C People & Access PostgreSQL workflows", () => {
  test("migration 016 refuses an unclassifiable inactive legacy principal", async () => {
    const migration = readFileSync(
      new URL("../migrations/016_people_access_capabilities.up.sql", import.meta.url),
      "utf8",
    );
    const preflight = migration.match(/^DO \$\$[\s\S]*?\$\$;/)?.[0];
    expect(preflight).toContain("Classify every inactive principal as suspended or revoked");
    expect(preflight).toContain("Do not rewrite inactive principals to active");
    const transaction = await centreSuccessDB.begin();
    try {
      await transaction.exec`CREATE TEMP TABLE principals (status TEXT NOT NULL) ON COMMIT DROP`;
      await transaction.exec`INSERT INTO principals (status) VALUES ('inactive')`;
      await expect(transaction.rawExec(preflight!)).rejects.toThrow(
        /cannot classify existing inactive principals automatically/,
      );
    } finally {
      await transaction.rollback();
    }
  });

  test("keeps proposals outside active grants, rotates a 72-hour one-time generation, and delivers idempotently", async () => {
    const h = harness();
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: fixture.inviterId,
      request: {
        email: "delivery@brightsteps.example",
        displayName: "Synthetic Delivery Candidate",
        assignments: [{ roleKey: "centre_director", scopes: [{ scopeType: "centre", centreId: fixture.centreA }] }],
        reason: "Exercise secure delivery.",
      },
    }, h.dependencies);
    const before = await centreSuccessDB.queryRow<{ memberships: number; assignments: number; scopes: number }>`
      SELECT
        (SELECT count(*)::integer FROM organisation_memberships WHERE principal_id = (SELECT pending_principal_id FROM access_invitations WHERE id = ${draft.id})) AS memberships,
        (SELECT count(*)::integer FROM role_assignments WHERE organisation_membership_id IN (SELECT id FROM organisation_memberships WHERE principal_id = (SELECT pending_principal_id FROM access_invitations WHERE id = ${draft.id}))) AS assignments,
        (SELECT count(*)::integer FROM assignment_scopes WHERE role_assignment_id IN (SELECT id FROM role_assignments WHERE organisation_membership_id IN (SELECT id FROM organisation_memberships WHERE principal_id = (SELECT pending_principal_id FROM access_invitations WHERE id = ${draft.id})))) AS scopes
    `;
    expect(before).toEqual({ memberships: 0, assignments: 0, scopes: 0 });

    const sent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: draft.lockVersion,
      resend: false,
    }, h.dependencies);
    expect(sent.status).toBe("SENT");
    expect(new Date(sent.expiresAt!).getTime() - DECISION_AT.getTime()).toBe(72 * 60 * 60 * 1_000);
    const stored = await centreSuccessDB.queryRow<{ token_text: string; encrypted_text: string; outbox_id: string }>`
      SELECT encode(generation.token_digest, 'hex') AS token_text,
             encode(outbox.encrypted_token, 'base64') AS encrypted_text,
             outbox.id AS outbox_id
      FROM invitation_token_generations AS generation
      JOIN people_notification_outbox AS outbox ON outbox.token_generation_id = generation.id
      WHERE generation.invitation_id = ${draft.id}
    `;
    expect(stored?.token_text).not.toContain(h.token());
    expect(stored?.encrypted_text).not.toContain(h.token());
    const deliveries: InvitationDeliveryRequest[] = [];
    const adapter = { deliverInvitation: async (request: InvitationDeliveryRequest) => {
      deliveries.push(request);
      return { providerReference: "test-provider-reference" };
    } };
    await Promise.all([
      deliverInvitationOutboxMessage(
        { outboxId: stored!.outbox_id },
        adapter,
        { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
      ),
      deliverInvitationOutboxMessage(
        { outboxId: stored!.outbox_id },
        adapter,
        { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
      ),
    ]);
    await deliverInvitationOutboxMessage(
      { outboxId: stored!.outbox_id },
      adapter,
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].invitationUrl).toBe("http://localhost:3000/invitations/accept");
    expect(deliveries[0].invitationCode).toBe(h.token());
    const erasedDelivery = await centreSuccessDB.queryRow<{
      status: string;
      material_erased: boolean;
      provider_reference: string;
    }>`
      SELECT outbox.status,
             encrypted_token IS NULL
               AND encryption_iv IS NULL
               AND encryption_tag IS NULL AS material_erased,
             attempt.provider_reference
      FROM people_notification_outbox AS outbox
      JOIN people_notification_delivery_attempts AS attempt
        ON attempt.outbox_id = outbox.id
       AND attempt.status = 'DELIVERED'
      WHERE outbox.id = ${stored!.outbox_id}
    `;
    expect(erasedDelivery).toEqual({
      status: "DELIVERED",
      material_erased: true,
      provider_reference: "test-provider-reference",
    });
    const concurrentReservations = await centreSuccessDB.queryAll<{
      attempt_number: number; status: string;
    }>`
      SELECT attempt_number, status
      FROM people_notification_provider_attempts
      WHERE outbox_id = ${stored!.outbox_id}
    `;
    expect(concurrentReservations).toEqual([{ attempt_number: 1, status: "ACCEPTED" }]);

    const previousToken = h.token();
    const resent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: sent.lockVersion,
      resend: true,
    }, h.dependencies);
    expect(resent.status).toBe("SENT");
    expect(h.token()).not.toBe(previousToken);
    const generations = await centreSuccessDB.queryAll<{ status: string }>`
      SELECT status FROM invitation_token_generations WHERE invitation_id = ${draft.id} ORDER BY generation
    `;
    expect(generations.map((row) => row.status)).toEqual(["INVALIDATED", "CURRENT"]);
    const supersededObjectId = randomUUID();
    await expect(acceptInvitation({
      invitationToken: previousToken,
      compactJwt: candidateJwt(draft.intendedEmail, supersededObjectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: supersededObjectId },
    }, h.dependencies)).rejects.toMatchObject({ code: "invitation_superseded" });

    const retryableOutbox = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM people_notification_outbox
      WHERE invitation_id = ${draft.id} AND status = 'PENDING'
      ORDER BY created_at DESC LIMIT 1
    `;
    await expect(deliverInvitationOutboxMessage(
      { outboxId: retryableOutbox!.id },
      { deliverInvitation: async () => { throw new Error("synthetic provider outage containing no credential"); } },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    )).resolves.toBeUndefined();
    const retryState = await centreSuccessDB.queryRow<{
      status: string; error_class: string; attempt_status: string; material_retained: boolean;
    }>`
      SELECT outbox.status, outbox.last_error_class AS error_class,
             attempt.status AS attempt_status,
             outbox.encrypted_token IS NOT NULL
               AND outbox.encryption_iv IS NOT NULL
               AND outbox.encryption_tag IS NOT NULL AS material_retained
      FROM people_notification_outbox AS outbox
      JOIN people_notification_delivery_attempts AS attempt ON attempt.outbox_id = outbox.id
      WHERE outbox.id = ${retryableOutbox!.id}
    `;
    expect(retryState).toEqual({
      status: "PENDING",
      error_class: "provider_retryable",
      attempt_status: "RETRYABLE_FAILURE",
      material_retained: true,
    });
    expect(JSON.stringify(retryState)).not.toContain(h.token());

    const prematureRetry = vi.fn(async () => ({ providerReference: "unexpected-retry" }));
    await deliverInvitationOutboxMessage(
      { outboxId: retryableOutbox!.id },
      { deliverInvitation: prematureRetry },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    expect(prematureRetry).not.toHaveBeenCalled();

    await centreSuccessDB.exec`
      UPDATE people_notification_outbox
      SET next_attempt_at = now() - interval '1 second'
      WHERE id = ${retryableOutbox!.id}
    `;
    let retryableProviderCalls = 1;
    await deliverInvitationOutboxMessage(
      { outboxId: retryableOutbox!.id },
      {
        deliverInvitation: async () => {
          retryableProviderCalls += 1;
          throw new InvitationDeliveryError("graph.mailbox_authorization", true, 1_000);
        },
      },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    const secondRetryState = await centreSuccessDB.queryRow<{
      status: string; error_class: string; attempt_statuses: string[];
    }>`
      SELECT outbox.status, outbox.last_error_class AS error_class,
             array_agg(attempt.status ORDER BY attempt.attempt_number) AS attempt_statuses
      FROM people_notification_outbox AS outbox
      JOIN people_notification_delivery_attempts AS attempt ON attempt.outbox_id = outbox.id
      WHERE outbox.id = ${retryableOutbox!.id}
      GROUP BY outbox.id
    `;
    expect(secondRetryState).toEqual({
      status: "PENDING",
      error_class: "graph.mailbox_authorization",
      attempt_statuses: ["RETRYABLE_FAILURE", "RETRYABLE_FAILURE"],
    });

    await centreSuccessDB.exec`
      UPDATE people_notification_outbox
      SET next_attempt_at = now() - interval '1 second'
      WHERE id = ${retryableOutbox!.id}
    `;
    await deliverInvitationOutboxMessage(
      { outboxId: retryableOutbox!.id },
      {
        deliverInvitation: async () => {
          retryableProviderCalls += 1;
          throw new InvitationDeliveryError("graph.service_unavailable", true);
        },
      },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    const exhaustedState = await centreSuccessDB.queryRow<{
      status: string; error_class: string; attempt_statuses: string[];
      error_classes: string[]; material_retained: boolean;
    }>`
      SELECT outbox.status, outbox.last_error_class AS error_class,
             array_agg(attempt.status ORDER BY attempt.attempt_number) AS attempt_statuses,
             array_agg(attempt.error_class ORDER BY attempt.attempt_number) AS error_classes,
             outbox.encrypted_token IS NOT NULL
               AND outbox.encryption_iv IS NOT NULL
               AND outbox.encryption_tag IS NOT NULL AS material_retained
      FROM people_notification_outbox AS outbox
      JOIN people_notification_delivery_attempts AS attempt ON attempt.outbox_id = outbox.id
      WHERE outbox.id = ${retryableOutbox!.id}
      GROUP BY outbox.id
    `;
    expect(exhaustedState).toEqual({
      status: "FAILED",
      error_class: "delivery_attempts_exhausted",
      attempt_statuses: [
        "RETRYABLE_FAILURE",
        "RETRYABLE_FAILURE",
        "PERMANENT_FAILURE",
      ],
      error_classes: [
        "provider_retryable",
        "graph.mailbox_authorization",
        "delivery_attempts_exhausted",
      ],
      material_retained: true,
    });
    expect(retryableProviderCalls).toBe(3);

    const afterExhaustion = vi.fn(async () => ({ providerReference: "must-not-deliver" }));
    await deliverInvitationOutboxMessage(
      { outboxId: retryableOutbox!.id },
      { deliverInvitation: afterExhaustion },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    expect(afterExhaustion).not.toHaveBeenCalled();
    const publishedIds: string[] = [];
    await dispatchPendingInvitationDeliveries(async (message) => {
      publishedIds.push(message.outboxId);
      return `synthetic-publish-${publishedIds.length}`;
    });
    expect(publishedIds).not.toContain(retryableOutbox!.id);

    const rotatedAfterExhaustion = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: resent.lockVersion,
      resend: true,
    }, h.dependencies);
    expect(rotatedAfterExhaustion.status).toBe("SENT");
    const outboxStatuses = await centreSuccessDB.queryAll<{ status: string }>`
      SELECT outbox.status FROM people_notification_outbox AS outbox
      JOIN invitation_token_generations AS generation
        ON generation.id = outbox.token_generation_id
      WHERE outbox.invitation_id = ${draft.id}
      ORDER BY generation.generation
    `;
    expect(outboxStatuses.map((row) => row.status)).toEqual([
      "DELIVERED",
      "FAILED",
      "PENDING",
    ]);
  });

  test("never delivers a superseded invitation generation after resend", async () => {
    const h = harness();
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: fixture.inviterId,
      request: {
        email: "superseded-delivery@brightsteps.example",
        displayName: "Synthetic Superseded Delivery Candidate",
        assignments: [{
          roleKey: "centre_director",
          scopes: [{ scopeType: "centre", centreId: fixture.centreA }],
        }],
        reason: "Prove current-generation delivery enforcement.",
      },
    }, h.dependencies);
    const sent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: draft.lockVersion,
      resend: false,
    }, h.dependencies);
    const firstOutbox = await centreSuccessDB.queryRow<{ id: string }>`
      SELECT id FROM people_notification_outbox
      WHERE invitation_id = ${draft.id}
    `;
    await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: sent.lockVersion,
      resend: true,
    }, h.dependencies);

    const deliver = vi.fn(async () => ({ providerReference: "must-not-send" }));
    await deliverInvitationOutboxMessage(
      { outboxId: firstOutbox!.id },
      { deliverInvitation: deliver },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    expect(deliver).not.toHaveBeenCalled();
    const state = await centreSuccessDB.queryRow<{
      status: string; error_class: string; provider_attempts: number;
    }>`
      SELECT outbox.status, outbox.last_error_class AS error_class,
             (SELECT count(*)::integer
              FROM people_notification_provider_attempts
              WHERE outbox_id = outbox.id) AS provider_attempts
      FROM people_notification_outbox AS outbox
      WHERE outbox.id = ${firstOutbox!.id}
    `;
    expect(state).toEqual({
      status: "FAILED",
      error_class: "invitation_generation_not_current",
      provider_attempts: 0,
    });
  });

  test("durably consumes at most three provider reservations across accepted-but-unreconciled crashes", async () => {
    const delivery = await createDeliveryFixture("durable-provider-cap");
    const provider = vi.fn(async () => ({ providerReference: "accepted-before-result-rollback" }));
    const failResultTransaction = async () => {
      throw new Error("synthetic result transaction commit failure");
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(deliverInvitationOutboxMessage(
        { outboxId: delivery.outboxId },
        { deliverInvitation: provider },
        {
          deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
          publicBaseUrl: "http://localhost:3000",
        },
        {
          beforeResultCommit: failResultTransaction,
          providerAttemptLeaseMilliseconds: 1,
        },
      )).rejects.toThrow("synthetic result transaction commit failure");

      const persisted = await centreSuccessDB.queryAll<{
        attempt_number: number; status: string;
      }>`
        SELECT attempt_number, status
        FROM people_notification_provider_attempts
        WHERE outbox_id = ${delivery.outboxId}
        ORDER BY attempt_number
      `;
      expect(persisted).toHaveLength(attempt);
      expect(persisted.at(-1)).toEqual({ attempt_number: attempt, status: "RESERVED" });

      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const forbiddenFourthCall = vi.fn(async () => ({ providerReference: "must-not-send" }));
    await deliverInvitationOutboxMessage(
      { outboxId: delivery.outboxId },
      { deliverInvitation: forbiddenFourthCall },
      {
        deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
        publicBaseUrl: "http://localhost:3000",
      },
    );
    expect(provider).toHaveBeenCalledTimes(3);
    expect(forbiddenFourthCall).not.toHaveBeenCalled();

    const state = await centreSuccessDB.queryRow<{
      status: string; error_class: string; reservation_numbers: number[];
      reservation_statuses: string[]; history_statuses: string[];
    }>`
      SELECT outbox.status, outbox.last_error_class AS error_class,
        array_agg(DISTINCT reservation.attempt_number ORDER BY reservation.attempt_number)
          AS reservation_numbers,
        array_agg(DISTINCT reservation.status ORDER BY reservation.status)
          AS reservation_statuses,
        array_agg(DISTINCT history.status ORDER BY history.status)
          AS history_statuses
      FROM people_notification_outbox AS outbox
      JOIN people_notification_provider_attempts AS reservation
        ON reservation.outbox_id = outbox.id
      JOIN people_notification_delivery_attempts AS history
        ON history.outbox_id = outbox.id
      WHERE outbox.id = ${delivery.outboxId}
      GROUP BY outbox.id
    `;
    expect(state).toEqual({
      status: "FAILED",
      error_class: "delivery_attempts_exhausted",
      reservation_numbers: [1, 2, 3],
      reservation_statuses: ["AMBIGUOUS"],
      history_statuses: ["AMBIGUOUS"],
    });
    await expect(centreSuccessDB.exec`
      DELETE FROM people_notification_provider_attempts
      WHERE outbox_id = ${delivery.outboxId} AND attempt_number = 1
    `).rejects.toThrow(/cannot be deleted/);
    await expect(centreSuccessDB.exec`
      UPDATE people_notification_provider_attempts
      SET status = 'RETRYABLE_FAILURE', completed_at = now(), updated_at = now()
      WHERE outbox_id = ${delivery.outboxId} AND attempt_number = 1
    `).rejects.toThrow(/outcome is terminal/);

    await expect(centreSuccessDB.exec`
      INSERT INTO people_notification_provider_attempts (
        id, organisation_id, outbox_id, attempt_number, status,
        reserved_at, lease_expires_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${fixture.organisationId}, ${delivery.outboxId}, 4,
        'RESERVED', now(), now() + interval '1 minute', now()
      )
    `).rejects.toThrow();
  });

  test("never reaches the provider when the reservation transaction cannot commit", async () => {
    const delivery = await createDeliveryFixture("reservation-commit-failure");
    const provider = vi.fn(async () => ({ providerReference: "must-not-send" }));
    await expect(deliverInvitationOutboxMessage(
      { outboxId: delivery.outboxId },
      { deliverInvitation: provider },
      {
        deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
        publicBaseUrl: "http://localhost:3000",
      },
      {
        beforeReservationCommit: async () => {
          throw new Error("synthetic reservation commit failure");
        },
      },
    )).rejects.toThrow("synthetic reservation commit failure");
    expect(provider).not.toHaveBeenCalled();
    const state = await centreSuccessDB.queryRow<{
      status: string; reservations: number;
    }>`
      SELECT outbox.status,
        (SELECT count(*)::integer
         FROM people_notification_provider_attempts
         WHERE outbox_id = outbox.id) AS reservations
      FROM people_notification_outbox AS outbox
      WHERE id = ${delivery.outboxId}
    `;
    expect(state).toEqual({ status: "PENDING", reservations: 0 });
    await expect(centreSuccessDB.exec`
      INSERT INTO people_notification_provider_attempts (
        id, organisation_id, outbox_id, attempt_number, status,
        reserved_at, lease_expires_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${fixture.organisationId}, ${delivery.outboxId}, 2,
        'RESERVED', now(), now() + interval '1 minute', now()
      )
    `).rejects.toThrow(/next contiguous attempt/);
  });

  test("consumes a crash-before-send reservation and permits only the next numbered slot", async () => {
    const delivery = await createDeliveryFixture("crash-before-provider");
    const provider = vi.fn(async () => ({ providerReference: "second-slot-delivery" }));
    await expect(deliverInvitationOutboxMessage(
      { outboxId: delivery.outboxId },
      { deliverInvitation: provider },
      {
        deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
        publicBaseUrl: "http://localhost:3000",
      },
      {
        providerAttemptLeaseMilliseconds: 50,
        afterReservationCommitted: async () => {
          throw new Error("synthetic crash before Graph");
        },
      },
    )).rejects.toThrow("synthetic crash before Graph");
    expect(provider).not.toHaveBeenCalled();

    await deliverInvitationOutboxMessage(
      { outboxId: delivery.outboxId },
      { deliverInvitation: provider },
      {
        deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
        publicBaseUrl: "http://localhost:3000",
      },
    );
    expect(provider).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 60));
    await deliverInvitationOutboxMessage(
      { outboxId: delivery.outboxId },
      { deliverInvitation: provider },
      {
        deliveryEncryptionKey: delivery.h.deliveryEncryptionKey,
        publicBaseUrl: "http://localhost:3000",
      },
    );
    expect(provider).toHaveBeenCalledTimes(1);
    const reservations = await centreSuccessDB.queryAll<{
      attempt_number: number; status: string;
    }>`
      SELECT attempt_number, status
      FROM people_notification_provider_attempts
      WHERE outbox_id = ${delivery.outboxId}
      ORDER BY attempt_number
    `;
    expect(reservations).toEqual([
      { attempt_number: 1, status: "AMBIGUOUS" },
      { attempt_number: 2, status: "ACCEPTED" },
    ]);
  });

  test("recovers stale dispatch claims and compare-and-set reconciliation never overwrites worker outcomes", async () => {
    const stale = await createDeliveryFixture("stale-dispatch-claim");
    const initialClaims = await claimInvitationDeliveriesForDispatch();
    expect(initialClaims.map((claim) => claim.outboxId)).toContain(stale.outboxId);
    const claimedState = await centreSuccessDB.queryRow<{ status: string; has_lease: boolean }>`
      SELECT status,
             dispatch_lease_id IS NOT NULL AND dispatch_lease_expires_at IS NOT NULL AS has_lease
      FROM people_notification_outbox WHERE id = ${stale.outboxId}
    `;
    expect(claimedState).toEqual({ status: "PUBLISHED", has_lease: true });
    const activeLeaseClaims = await claimInvitationDeliveriesForDispatch();
    expect(activeLeaseClaims.map((claim) => claim.outboxId)).not.toContain(stale.outboxId);
    await centreSuccessDB.exec`
      UPDATE people_notification_outbox
      SET dispatch_lease_expires_at = now() - interval '1 second'
      WHERE id = ${stale.outboxId}
    `;
    const recoveredPublications: string[] = [];
    await dispatchPendingInvitationDeliveries(async (message) => {
      recoveredPublications.push(message.outboxId);
      return randomUUID();
    });
    expect(recoveredPublications).toContain(stale.outboxId);
    const publishedWithoutReconciliation = await centreSuccessDB.queryRow<{ status: string }>`
      SELECT status FROM people_notification_outbox WHERE id = ${stale.outboxId}
    `;
    expect(publishedWithoutReconciliation?.status).toBe("PUBLISHED");
    await centreSuccessDB.exec`
      UPDATE people_notification_outbox
      SET dispatch_lease_expires_at = now() - interval '1 second'
      WHERE id = ${stale.outboxId}
    `;
    const republishedAfterAmbiguousSuccess: string[] = [];
    await dispatchPendingInvitationDeliveries(async (message) => {
      republishedAfterAmbiguousSuccess.push(message.outboxId);
      return randomUUID();
    });
    expect(republishedAfterAmbiguousSuccess).toContain(stale.outboxId);

    const scenarios = [
      {
        label: "pending",
        adapter: {
          deliverInvitation: async () => {
            throw new InvitationDeliveryError("graph.service_unavailable", true, 60_000);
          },
        },
        expectedStatus: "PENDING",
      },
      {
        label: "failed",
        adapter: {
          deliverInvitation: async () => {
            throw new InvitationDeliveryError("graph.authentication_configuration", false);
          },
        },
        expectedStatus: "FAILED",
      },
      {
        label: "delivered",
        adapter: {
          deliverInvitation: async () => ({ providerReference: "worker-won-dispatch-race" }),
        },
        expectedStatus: "DELIVERED",
      },
    ] as const;

    for (const scenario of scenarios) {
      const item = await createDeliveryFixture(`dispatch-race-${scenario.label}`);
      await expect(dispatchPendingInvitationDeliveries(async (message) => {
        if (message.outboxId !== item.outboxId) return randomUUID();
        await deliverInvitationOutboxMessage(
          message,
          scenario.adapter,
          {
            deliveryEncryptionKey: item.h.deliveryEncryptionKey,
            publicBaseUrl: "http://localhost:3000",
          },
        );
        throw new Error("synthetic ambiguous publish acknowledgement");
      })).rejects.toThrow("synthetic ambiguous publish acknowledgement");
      const state = await centreSuccessDB.queryRow<{
        status: string; dispatch_lease_id: string | null; next_attempt_at: Date;
      }>`
        SELECT status, dispatch_lease_id, next_attempt_at
        FROM people_notification_outbox WHERE id = ${item.outboxId}
      `;
      expect(state?.status).toBe(scenario.expectedStatus);
      expect(state?.dispatch_lease_id).toBeNull();
      if (scenario.expectedStatus === "PENDING") {
        expect(state!.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 30_000);
      }
    }
  });

  test("materialises elapsed resend invitations as expired at the exact boundary without rotation", async () => {
    const before = await createDeliveryFixture("resend-before-expiry");
    before.h.setNow(new Date(DECISION_AT.getTime() + 72 * 60 * 60 * 1_000 - 1));
    await expect(sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: before.sent.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: before.sent.lockVersion,
      resend: true,
    }, before.h.dependencies)).resolves.toMatchObject({ status: "SENT" });

    for (const offset of [0, 1]) {
      const item = await createDeliveryFixture(`resend-expired-${offset}`);
      item.h.setNow(new Date(DECISION_AT.getTime() + 72 * 60 * 60 * 1_000 + offset));
      await expect(sendInvitation({
        organisationId: fixture.organisationId,
        invitationId: item.sent.id,
        actorPrincipalId: fixture.inviterId,
        expectedLockVersion: item.sent.lockVersion,
        resend: true,
      }, item.h.dependencies)).rejects.toMatchObject({ code: "invitation_expired" });
      const state = await centreSuccessDB.queryRow<{
        invitation_status: string; generation_status: string;
        generations: number; outboxes: number;
      }>`
        SELECT invitation.status AS invitation_status,
               generation.status AS generation_status,
               (SELECT count(*)::integer FROM invitation_token_generations
                WHERE invitation_id = invitation.id) AS generations,
               (SELECT count(*)::integer FROM people_notification_outbox
                WHERE invitation_id = invitation.id) AS outboxes
        FROM access_invitations AS invitation
        JOIN invitation_token_generations AS generation
          ON generation.invitation_id = invitation.id
        WHERE invitation.id = ${item.sent.id}
      `;
      expect(state).toEqual({
        invitation_status: "EXPIRED",
        generation_status: "EXPIRED",
        generations: 1,
        outboxes: 1,
      });
    }

    const concurrent = await createDeliveryFixture("concurrent-resend-expiry");
    concurrent.h.setNow(new Date(DECISION_AT.getTime() + 72 * 60 * 60 * 1_000));
    const requests = await Promise.allSettled([
      sendInvitation({
        organisationId: fixture.organisationId,
        invitationId: concurrent.sent.id,
        actorPrincipalId: fixture.inviterId,
        expectedLockVersion: concurrent.sent.lockVersion,
        resend: true,
      }, concurrent.h.dependencies),
      sendInvitation({
        organisationId: fixture.organisationId,
        invitationId: concurrent.sent.id,
        actorPrincipalId: fixture.inviterId,
        expectedLockVersion: concurrent.sent.lockVersion,
        resend: true,
      }, concurrent.h.dependencies),
    ]);
    expect(requests.every((request) => request.status === "rejected")).toBe(true);
    const concurrentCounts = await centreSuccessDB.queryRow<{
      status: string; generations: number; outboxes: number;
    }>`
      SELECT status,
        (SELECT count(*)::integer FROM invitation_token_generations
         WHERE invitation_id = invitation.id) AS generations,
        (SELECT count(*)::integer FROM people_notification_outbox
         WHERE invitation_id = invitation.id) AS outboxes
      FROM access_invitations AS invitation
      WHERE id = ${concurrent.sent.id}
    `;
    expect(concurrentCounts).toEqual({ status: "EXPIRED", generations: 1, outboxes: 1 });

    const cancelled = await createDeliveryFixture("cancelled-remains-terminal");
    const cancelledSummary = await cancelInvitation({
      organisationId: fixture.organisationId,
      invitationId: cancelled.sent.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: cancelled.sent.lockVersion,
      reason: "Prove elapsed resend cannot rewrite a cancelled invitation.",
    }, cancelled.h.dependencies);
    cancelled.h.setNow(new Date(DECISION_AT.getTime() + 72 * 60 * 60 * 1_000));
    await expect(sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: cancelled.sent.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: cancelledSummary.lockVersion,
      resend: true,
    }, cancelled.h.dependencies)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(getInvitationSummary(
      fixture.organisationId,
      cancelled.sent.id,
    )).resolves.toMatchObject({ status: "CANCELLED" });
  });

  test("serializes cancellation with delivery and never sends after cancellation wins", async () => {
    const h = harness();
    const createSentInvitation = async (suffix: string) => {
      const draft = await createInvitation({
        organisationId: fixture.organisationId,
        actorPrincipalId: fixture.inviterId,
        request: {
          email: `cancel-delivery-${suffix}-${randomUUID()}@brightsteps.example`,
          displayName: `Synthetic Cancel Delivery ${suffix}`,
          assignments: [{
            roleKey: "centre_director",
            scopes: [{ scopeType: "centre", centreId: fixture.centreA }],
          }],
          reason: "Prove cancellation and delivery ordering.",
        },
      }, h.dependencies);
      const sent = await sendInvitation({
        organisationId: fixture.organisationId,
        invitationId: draft.id,
        actorPrincipalId: fixture.inviterId,
        expectedLockVersion: draft.lockVersion,
        resend: false,
      }, h.dependencies);
      const outbox = await centreSuccessDB.queryRow<{ id: string }>`
        SELECT id FROM people_notification_outbox WHERE invitation_id = ${sent.id}
      `;
      return { sent, outboxId: outbox!.id };
    };

    const deliveryWins = await createSentInvitation("delivery-first");
    let releaseDelivery!: () => void;
    let markStarted!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const deliveryRelease = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const adapter = vi.fn(async () => {
      markStarted();
      await deliveryRelease;
      return { providerReference: "test-delivery-before-cancel" };
    });
    const deliveryPromise = deliverInvitationOutboxMessage(
      { outboxId: deliveryWins.outboxId },
      { deliverInvitation: adapter },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    await deliveryStarted;
    let cancelSettled = false;
    const cancelPromise = cancelInvitation({
      organisationId: fixture.organisationId,
      invitationId: deliveryWins.sent.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: deliveryWins.sent.lockVersion,
      reason: "Cancel while provider delivery holds the invitation lock.",
    }, h.dependencies).finally(() => { cancelSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cancelSettled).toBe(false);
    releaseDelivery();
    await deliveryPromise;
    await expect(cancelPromise).resolves.toMatchObject({ status: "CANCELLED" });
    expect(adapter).toHaveBeenCalledTimes(1);

    const cancellationWins = await createSentInvitation("cancel-first");
    await cancelInvitation({
      organisationId: fixture.organisationId,
      invitationId: cancellationWins.sent.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: cancellationWins.sent.lockVersion,
      reason: "Cancel before the worker claims delivery.",
    }, h.dependencies);
    const staleAdapter = vi.fn(async () => ({ providerReference: "must-not-send" }));
    await deliverInvitationOutboxMessage(
      { outboxId: cancellationWins.outboxId },
      { deliverInvitation: staleAdapter },
      { deliveryEncryptionKey: h.deliveryEncryptionKey, publicBaseUrl: "http://localhost:3000" },
    );
    expect(staleAdapter).not.toHaveBeenCalled();
    const cancelledState = await centreSuccessDB.queryRow<{
      invitation_status: string; generation_status: string; outbox_status: string;
      error_class: string;
    }>`
      SELECT invitation.status AS invitation_status,
             generation.status AS generation_status,
             outbox.status AS outbox_status,
             outbox.last_error_class AS error_class
      FROM access_invitations AS invitation
      JOIN invitation_token_generations AS generation ON generation.invitation_id = invitation.id
      JOIN people_notification_outbox AS outbox ON outbox.token_generation_id = generation.id
      WHERE invitation.id = ${cancellationWins.sent.id}
    `;
    expect(cancelledState).toEqual({
      invitation_status: "CANCELLED",
      generation_status: "INVALIDATED",
      outbox_status: "FAILED",
      error_class: "invitation_generation_not_current",
    });
  });

  test("activates a standard multi-centre package atomically and rejects replay/concurrent use", async () => {
    const h = harness();
    const sent = await createAndSendStandard(h, "educator@brightsteps.example");
    const objectId = randomUUID();
    const request = {
      invitationToken: h.token(),
      compactJwt: candidateJwt("educator@brightsteps.example", objectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId },
    };
    const results = await Promise.allSettled([
      acceptInvitation(request, h.dependencies),
      acceptInvitation(request, h.dependencies),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    if (fulfilled.length !== 1) {
      throw new Error(`unexpected concurrent lifecycle results: ${results.map((result) =>
        result.status === "fulfilled" ? "fulfilled" : String(result.reason)).join(" | ")}`);
    }
    expect(results.find((result) => result.status === "fulfilled")).toMatchObject({
      value: { outcome: "activated", invitationStatus: "ACTIVATED" },
    });
    const state = await centreSuccessDB.queryRow<{
      principal_id: string; principal_status: string; memberships: number;
      assignments: number; scopes: number; mappings: number;
    }>`
      SELECT invitation.pending_principal_id AS principal_id,
             principal.status AS principal_status,
             (SELECT count(*)::integer FROM organisation_memberships WHERE principal_id = principal.id) AS memberships,
             (SELECT count(*)::integer FROM role_assignments WHERE organisation_membership_id IN (SELECT id FROM organisation_memberships WHERE principal_id = principal.id)) AS assignments,
             (SELECT count(*)::integer FROM assignment_scopes WHERE role_assignment_id IN (SELECT role_assignment.id FROM role_assignments AS role_assignment JOIN organisation_memberships AS membership ON membership.id = role_assignment.organisation_membership_id WHERE membership.principal_id = principal.id)) AS scopes,
             (SELECT count(*)::integer FROM external_identity_mappings WHERE principal_id = principal.id) AS mappings
      FROM access_invitations AS invitation
      JOIN principals AS principal ON principal.id = invitation.pending_principal_id
      WHERE invitation.id = ${sent.id}
    `;
    expect(state).toMatchObject({ principal_status: "active", memberships: 1, assignments: 1, scopes: 2, mappings: 1 });
    await expect(acceptInvitation(request, h.dependencies)).rejects.toMatchObject({
      code: "invitation_replayed",
    });
    await expect(authoriseCentreFromDatabase({
      principalId: state!.principal_id,
      activeOrganisationId: fixture.organisationId,
      centreId: fixture.centreA,
      capability: capability.centreRead,
      at: DECISION_AT,
    })).resolves.toMatchObject({ allowed: true });
    const auditText = await centreSuccessDB.queryRow<{ value: string }>`
      SELECT string_agg(event.action || ' ' || event.context::text, ' ') AS value
      FROM system_audit_events AS event
      WHERE event.organisation_id = ${fixture.organisationId}
        AND (
          event.resource_id IN (${sent.id}, ${state!.principal_id})
          OR event.resource_id IN (
            SELECT mapping.id FROM external_identity_mappings AS mapping
            WHERE mapping.principal_id = ${state!.principal_id}
          )
          OR event.resource_id IN (
            SELECT assignment.id
            FROM role_assignments AS assignment
            JOIN organisation_memberships AS membership
              ON membership.id = assignment.organisation_membership_id
            WHERE membership.principal_id = ${state!.principal_id}
          )
        )
    `;
    expect(auditText?.value).not.toContain(objectId);
    expect(auditText?.value).not.toContain(h.token());
    expect(auditText?.value).not.toContain(request.compactJwt);
    expect(auditText?.value).not.toContain(sent.intendedEmail);
    const history = await getAccessHistory(fixture.organisationId, state!.principal_id);
    expect(history.events.map((event) => event.action)).toEqual(expect.arrayContaining([
      "invitation.created",
      "invitation.sent",
      "identity.mapping.activated",
      "principal.activated",
      "role_assignment.granted",
      "invitation.activated",
    ]));
  });

  test("uses real cryptographic Entra verification at the public invitation boundary", async () => {
    const h = harness();
    const email = `verified-boundary-${randomUUID()}@brightsteps.example`;
    const sent = await createAndSendStandard(h, email);
    const objectId = randomUUID();
    const compactJwt = signedCandidateJwt(email, objectId);

    await expect(acceptInvitationCandidate(
      { invitationToken: h.token() },
      {
        authorizationHeader: () => `Bearer ${compactJwt}`,
        verifyAccessToken: (token) => verifyEntraAccessToken(
          token,
          candidateVerificationConfig,
          { keyResolver: candidateKeyResolver, now: () => DECISION_AT },
        ),
        accept: (input) => acceptInvitation(input, h.dependencies),
      },
    )).resolves.toEqual({ outcome: "activated", invitationStatus: "ACTIVATED" });

    const mapping = await centreSuccessDB.queryRow<{
      provider_key: string;
      provider_subject: string;
    }>`
      SELECT mapping.provider_key, mapping.provider_subject
      FROM external_identity_mappings AS mapping
      JOIN access_invitations AS invitation
        ON invitation.pending_principal_id = mapping.principal_id
      WHERE invitation.id = ${sent.id}
    `;
    expect(mapping).toEqual({
      provider_key: `microsoft_entra:${TENANT_ID}`,
      provider_subject: objectId,
    });
  });

  test("moves wrong or ambiguous employees to review with zero grants", async () => {
    for (const [email, extras] of [
      ["wrong@brightsteps.example", {}],
      ["intended@brightsteps.example", { acct: 1 }],
    ] as const) {
      const h = harness();
      const intended = `intended-${randomUUID()}@brightsteps.example`;
      const sent = await createAndSendStandard(h, intended);
      const objectId = randomUUID();
      await expect(acceptInvitation({
        invitationToken: h.token(),
        compactJwt: candidateJwt(email, objectId, extras),
        verifiedIdentity: { tenantId: TENANT_ID, objectId },
      }, h.dependencies)).resolves.toEqual({
        outcome: "administrator_review",
        invitationStatus: "ADMINISTRATOR_REVIEW",
      });
      const counts = await centreSuccessDB.queryRow<{ memberships: number; mappings: number }>`
        SELECT
          (SELECT count(*)::integer FROM organisation_memberships WHERE principal_id = invitation.pending_principal_id) AS memberships,
          (SELECT count(*)::integer FROM external_identity_mappings WHERE principal_id = invitation.pending_principal_id) AS mappings
        FROM access_invitations AS invitation WHERE id = ${sent.id}
      `;
      expect(counts).toEqual({ memberships: 0, mappings: 0 });
    }
  });

  test("materialises mapping conflicts for review and atomically denies activation after inviter authority expires", async () => {
    const conflictHarness = harness();
    const email = `mapping-conflict-${randomUUID()}@brightsteps.example`;
    const sent = await createAndSendStandard(conflictHarness, email);
    const existingIdentity = await centreSuccessDB.queryRow<{ provider_subject: string }>`
      SELECT provider_subject FROM external_identity_mappings
      WHERE principal_id = ${fixture.approverId} AND status = 'active'
    `;
    await expect(acceptInvitation({
      invitationToken: conflictHarness.token(),
      compactJwt: candidateJwt(email, existingIdentity!.provider_subject),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: existingIdentity!.provider_subject },
    }, conflictHarness.dependencies)).resolves.toEqual({
      outcome: "administrator_review",
      invitationStatus: "ADMINISTRATOR_REVIEW",
    });
    const conflictState = await centreSuccessDB.queryRow<{ memberships: number; mappings: number; reason: string }>`
      SELECT
        (SELECT count(*)::integer FROM organisation_memberships WHERE principal_id = invitation.pending_principal_id) AS memberships,
        (SELECT count(*)::integer FROM external_identity_mappings WHERE principal_id = invitation.pending_principal_id) AS mappings,
        invitation.verification_reason AS reason
      FROM access_invitations AS invitation WHERE id = ${sent.id}
    `;
    expect(conflictState).toEqual({ memberships: 0, mappings: 0, reason: "identity_mapping_conflict" });

    const expiringInviter = await addAdministrator(fixture.organisationId, "Expiring invitation authority");
    const expiryHarness = harness(new Date(Date.now() + 1_000));
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: expiringInviter,
      request: {
        email: `expired-authority-${randomUUID()}@brightsteps.example`,
        displayName: "Expired authority candidate",
        assignments: [{ roleKey: "centre_director", scopes: [{ scopeType: "centre", centreId: fixture.centreA }] }],
        reason: "Synthetic authority-expiry activation test.",
      },
    }, expiryHarness.dependencies);
    const expirySent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: expiringInviter,
      expectedLockVersion: draft.lockVersion,
      resend: false,
    }, expiryHarness.dependencies);
    const inviterVersion = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM principals WHERE id = ${expiringInviter}
    `;
    await transitionPrincipalLifecycle({
      organisationId: fixture.organisationId,
      targetPrincipalId: expiringInviter,
      actorPrincipalId: fixture.approverId,
      expectedLockVersion: inviterVersion!.lock_version,
      transition: "suspend",
      reason: "Synthetic authority expiry before activation.",
    }, expiryHarness.dependencies);
    const activationObjectId = randomUUID();
    await expect(acceptInvitation({
      invitationToken: expiryHarness.token(),
      compactJwt: candidateJwt(expirySent.intendedEmail, activationObjectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: activationObjectId },
    }, expiryHarness.dependencies)).rejects.toMatchObject({ code: "access_denied" });
    const rollbackState = await centreSuccessDB.queryRow<{
      invitation_status: string; token_status: string; memberships: number; mappings: number;
    }>`
      SELECT invitation.status AS invitation_status, generation.status AS token_status,
        (SELECT count(*)::integer FROM organisation_memberships WHERE principal_id = invitation.pending_principal_id) AS memberships,
        (SELECT count(*)::integer FROM external_identity_mappings WHERE principal_id = invitation.pending_principal_id) AS mappings
      FROM access_invitations AS invitation
      JOIN invitation_token_generations AS generation ON generation.invitation_id = invitation.id
      WHERE invitation.id = ${expirySent.id}
    `;
    expect(rollbackState).toEqual({
      invitation_status: "SENT", token_status: "CURRENT", memberships: 0, mappings: 0,
    });
  });

  test("denies self-directed and cross-organisation assignment escalation", async () => {
    const actor = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM principals WHERE id = ${fixture.inviterId}
    `;
    await expect(addRoleAssignment({
      organisationId: fixture.organisationId,
      targetPrincipalId: fixture.inviterId,
      actorPrincipalId: fixture.inviterId,
      assignment: { roleKey: "centre_director", scopes: [{ scopeType: "centre", centreId: fixture.centreA }] },
      expectedPrincipalLockVersion: actor!.lock_version,
      reason: "Self escalation must fail.",
    }, harness().dependencies)).rejects.toMatchObject({ code: "access_denied" });

    const foreignOrganisationId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${foreignOrganisationId}, 'Cross-organisation assignment target', 'active', 'Australia/Sydney')
    `;
    const foreignPrincipalId = await addAdministrator(foreignOrganisationId, "Foreign assignment target");
    const foreign = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM principals WHERE id = ${foreignPrincipalId}
    `;
    await expect(addRoleAssignment({
      organisationId: fixture.organisationId,
      targetPrincipalId: foreignPrincipalId,
      actorPrincipalId: fixture.inviterId,
      assignment: { roleKey: "centre_director", scopes: [{ scopeType: "centre", centreId: fixture.centreA }] },
      expectedPrincipalLockVersion: foreign!.lock_version,
      reason: "Cross-organisation grant must fail.",
    }, harness().dependencies)).rejects.toMatchObject({ code: "not_found" });

    const foreignHarness = harness();
    const foreignInvitation = await createInvitation({
      organisationId: foreignOrganisationId,
      actorPrincipalId: foreignPrincipalId,
      request: {
        email: `foreign-invitation-${randomUUID()}@brightsteps.example`,
        displayName: "Foreign invitation candidate",
        assignments: [{ roleKey: "system_administrator", scopes: [{ scopeType: "organisation" }] }],
        reason: "Synthetic foreign-organisation invitation.",
      },
    }, foreignHarness.dependencies);
    await expect(getInvitationSummary(
      fixture.organisationId,
      foreignInvitation.id,
    )).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelInvitation({
      organisationId: fixture.organisationId,
      invitationId: foreignInvitation.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: foreignInvitation.lockVersion,
      reason: "Cross-organisation cancellation must fail.",
    }, foreignHarness.dependencies)).rejects.toMatchObject({ code: "not_found" });
  });

  test("replaces complete explicit-centre portfolios atomically without default collapse", async () => {
    const additionalCentres = await Promise.all([
      addCentre(fixture.organisationId, "People Access Centre C"),
      addCentre(fixture.organisationId, "People Access Centre D"),
      addCentre(fixture.organisationId, "People Access Centre E"),
    ]);
    const allCentres = [fixture.centreA, fixture.centreB, ...additionalCentres];
    const h = harness();
    const email = `portfolio-${randomUUID()}@brightsteps.example`;
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: fixture.inviterId,
      request: {
        email,
        displayName: "Synthetic Area Manager portfolio",
        assignments: [{ roleKey: "area_manager", scopes: [{ scopeType: "centre", centreId: fixture.centreA }] }],
        reason: "Synthetic portfolio editor test.",
      },
    }, h.dependencies);
    const sent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: draft.lockVersion,
      resend: false,
    }, h.dependencies);
    const objectId = randomUUID();
    await acceptInvitation({
      invitationToken: h.token(),
      compactJwt: candidateJwt(email, objectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId },
    }, h.dependencies);
    const target = await centreSuccessDB.queryRow<{
      principal_id: string;
      lock_version: number;
      assignment_id: string;
    }>`
      SELECT principal.id AS principal_id, principal.lock_version,
             assignment.id AS assignment_id
      FROM access_invitations AS invitation
      JOIN principals AS principal ON principal.id = invitation.pending_principal_id
      JOIN organisation_memberships AS membership ON membership.principal_id = principal.id
      JOIN role_assignments AS assignment ON assignment.organisation_membership_id = membership.id
      JOIN role_definitions AS role ON role.id = assignment.role_definition_id
      WHERE invitation.id = ${sent.id} AND role.role_key = 'area_manager'
        AND assignment.status = 'active'
    `;
    const oneToTwo = await replaceAssignmentScope({
      organisationId: fixture.organisationId,
      targetPrincipalId: target!.principal_id,
      assignmentId: target!.assignment_id,
      actorPrincipalId: fixture.inviterId,
      expectedPrincipalLockVersion: target!.lock_version,
      replacementScopes: [fixture.centreA, fixture.centreB].map((centreId) => ({ scopeType: "centre" as const, centreId })),
      reason: "Add one centre to the portfolio.",
    }, h.dependencies);
    const twoCentreAssignment = oneToTwo.assignments.find((assignment) => assignment.roleKey === "area_manager")!;
    expect(twoCentreAssignment.scopes.map((scope) => "centreId" in scope ? scope.centreId : "").sort())
      .toEqual([fixture.centreA, fixture.centreB].sort());

    const assignmentsBeforeNoOp = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM role_assignments AS assignment
      JOIN organisation_memberships AS membership ON membership.id = assignment.organisation_membership_id
      WHERE membership.principal_id = ${target!.principal_id}
    `;
    const noOp = await replaceAssignmentScope({
      organisationId: fixture.organisationId,
      targetPrincipalId: target!.principal_id,
      assignmentId: twoCentreAssignment.id,
      actorPrincipalId: fixture.inviterId,
      expectedPrincipalLockVersion: oneToTwo.lockVersion,
      replacementScopes: [fixture.centreB, fixture.centreA].map((centreId) => ({ scopeType: "centre" as const, centreId })),
      reason: "No-op portfolio review.",
    }, h.dependencies);
    expect(noOp.lockVersion).toBe(oneToTwo.lockVersion);
    expect(noOp.assignments.find((assignment) => assignment.roleKey === "area_manager")?.id)
      .toBe(twoCentreAssignment.id);
    const assignmentsAfterNoOp = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM role_assignments AS assignment
      JOIN organisation_memberships AS membership ON membership.id = assignment.organisation_membership_id
      WHERE membership.principal_id = ${target!.principal_id}
    `;
    expect(assignmentsAfterNoOp).toEqual(assignmentsBeforeNoOp);

    const five = await replaceAssignmentScope({
      organisationId: fixture.organisationId,
      targetPrincipalId: target!.principal_id,
      assignmentId: twoCentreAssignment.id,
      actorPrincipalId: fixture.inviterId,
      expectedPrincipalLockVersion: noOp.lockVersion,
      replacementScopes: allCentres.map((centreId) => ({ scopeType: "centre" as const, centreId })),
      reason: "Add the reviewed remaining centres.",
    }, h.dependencies);
    const fiveAssignment = five.assignments.find((assignment) => assignment.roleKey === "area_manager")!;
    expect(fiveAssignment.scopes).toHaveLength(5);
    const fourCentres = allCentres.filter((centreId) => centreId !== additionalCentres[1]);
    const four = await replaceAssignmentScope({
      organisationId: fixture.organisationId,
      targetPrincipalId: target!.principal_id,
      assignmentId: fiveAssignment.id,
      actorPrincipalId: fixture.inviterId,
      expectedPrincipalLockVersion: five.lockVersion,
      replacementScopes: fourCentres.map((centreId) => ({ scopeType: "centre" as const, centreId })),
      reason: "Remove one reviewed centre.",
    }, h.dependencies);
    const fourAssignment = four.assignments.find((assignment) => assignment.roleKey === "area_manager")!;
    expect(fourAssignment.scopes.map((scope) => "centreId" in scope ? scope.centreId : "").sort())
      .toEqual([...fourCentres].sort());

    const foreignOrganisationId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${foreignOrganisationId}, 'Foreign portfolio organisation', 'active', 'Australia/Sydney')
    `;
    const foreignCentre = await addCentre(foreignOrganisationId, "Foreign portfolio centre");
    await expect(replaceAssignmentScope({
      organisationId: fixture.organisationId,
      targetPrincipalId: target!.principal_id,
      assignmentId: fourAssignment.id,
      actorPrincipalId: fixture.inviterId,
      expectedPrincipalLockVersion: four.lockVersion,
      replacementScopes: [{ scopeType: "centre", centreId: foreignCentre }],
      reason: "Foreign scope must fail.",
    }, h.dependencies)).rejects.toMatchObject({ code: "invalid_input" });

    const concurrent = await Promise.allSettled([
      replaceAssignmentScope({
        organisationId: fixture.organisationId,
        targetPrincipalId: target!.principal_id,
        assignmentId: fourAssignment.id,
        actorPrincipalId: fixture.inviterId,
        expectedPrincipalLockVersion: four.lockVersion,
        replacementScopes: [fixture.centreA, fixture.centreB].map((centreId) => ({ scopeType: "centre" as const, centreId })),
        reason: "Concurrent portfolio edit one.",
      }, h.dependencies),
      replaceAssignmentScope({
        organisationId: fixture.organisationId,
        targetPrincipalId: target!.principal_id,
        assignmentId: fourAssignment.id,
        actorPrincipalId: fixture.inviterId,
        expectedPrincipalLockVersion: four.lockVersion,
        replacementScopes: [fixture.centreA, additionalCentres[0]].map((centreId) => ({ scopeType: "centre" as const, centreId })),
        reason: "Concurrent portfolio edit two.",
      }, h.dependencies),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "version_conflict" } });
  });

  test("requires a distinct current System Administrator for privileged activation", async () => {
    const h = harness();
    const email = `privileged-${randomUUID()}@brightsteps.example`;
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: fixture.inviterId,
      request: {
        email,
        displayName: "Synthetic Privileged Candidate",
        assignments: [{ roleKey: "system_administrator", scopes: [{ scopeType: "organisation" }] }],
        reason: "Synthetic privileged invitation.",
      },
    }, h.dependencies);
    const sent = await sendInvitation({
      organisationId: fixture.organisationId, invitationId: draft.id,
      actorPrincipalId: fixture.inviterId, expectedLockVersion: draft.lockVersion,
      resend: false,
    }, h.dependencies);
    const objectId = randomUUID();
    await expect(acceptInvitation({
      invitationToken: h.token(), compactJwt: candidateJwt(email, objectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId },
    }, h.dependencies)).resolves.toEqual({
      outcome: "awaiting_approval",
      invitationStatus: "AWAITING_PRIVILEGED_APPROVAL",
    });
    const awaiting = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM access_invitations WHERE id = ${sent.id}
    `;
    const target = await centreSuccessDB.queryRow<{ principal_id: string }>`
      SELECT pending_principal_id AS principal_id
      FROM access_invitations WHERE id = ${sent.id}
    `;
    await expect(approvePrivilegedInvitation({
      organisationId: fixture.organisationId, invitationId: sent.id,
      approverPrincipalId: target!.principal_id,
      expectedLockVersion: awaiting!.lock_version,
      reason: "The target must never approve their own access.",
    }, h.dependencies)).rejects.toMatchObject({ code: "access_denied" });
    await expect(approvePrivilegedInvitation({
      organisationId: fixture.organisationId, invitationId: sent.id,
      approverPrincipalId: fixture.inviterId,
      expectedLockVersion: awaiting!.lock_version,
      reason: "Self approval must fail.",
    }, h.dependencies)).rejects.toMatchObject({ code: "independent_approval_required" });
    const activated = await approvePrivilegedInvitation({
      organisationId: fixture.organisationId, invitationId: sent.id,
      approverPrincipalId: fixture.approverId,
      expectedLockVersion: awaiting!.lock_version,
      reason: "Independent synthetic approval.",
    }, h.dependencies);
    expect(activated.status).toBe("ACTIVATED");
    const context = await loadPrincipalAuthorisationContext({
      principalId: target!.principal_id,
      activeOrganisationId: fixture.organisationId,
      at: DECISION_AT,
    });
    expect(authorise({
      context,
      capability: capability.invitationManage,
      resource: { kind: "organisation", organisationId: fixture.organisationId },
      at: DECISION_AT,
    })).toMatchObject({ allowed: true, roleKey: "system_administrator" });
    expect(authorise({
      context,
      capability: capability.centreRead,
      resource: { kind: "centre", organisationId: fixture.organisationId, centreId: fixture.centreA, organisationalUnitIds: [] },
      at: DECISION_AT,
    })).toEqual({ allowed: false, reason: "capability_missing" });
  });

  test("denies privileged activation when the reviewed package digest is tampered", async () => {
    const h = harness();
    const email = `tampered-package-${randomUUID()}@brightsteps.example`;
    const draft = await createInvitation({
      organisationId: fixture.organisationId,
      actorPrincipalId: fixture.inviterId,
      request: {
        email,
        displayName: "Synthetic tampered package candidate",
        assignments: [{ roleKey: "system_administrator", scopes: [{ scopeType: "organisation" }] }],
        reason: "Synthetic package-integrity test.",
      },
    }, h.dependencies);
    const sent = await sendInvitation({
      organisationId: fixture.organisationId,
      invitationId: draft.id,
      actorPrincipalId: fixture.inviterId,
      expectedLockVersion: draft.lockVersion,
      resend: false,
    }, h.dependencies);
    const objectId = randomUUID();
    await acceptInvitation({
      invitationToken: h.token(),
      compactJwt: candidateJwt(email, objectId),
      verifiedIdentity: { tenantId: TENANT_ID, objectId },
    }, h.dependencies);
    const awaiting = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM access_invitations WHERE id = ${sent.id}
    `;
    await centreSuccessDB.exec`
      UPDATE access_invitations
      SET package_digest = ${randomBytes(32)}
      WHERE id = ${sent.id}
    `;
    await expect(approvePrivilegedInvitation({
      organisationId: fixture.organisationId,
      invitationId: sent.id,
      approverPrincipalId: fixture.approverId,
      expectedLockVersion: awaiting!.lock_version,
      reason: "Tampered packages must fail closed.",
    }, h.dependencies)).rejects.toMatchObject({ code: "invalid_state" });
    const state = await centreSuccessDB.queryRow<{
      invitation_status: string;
      memberships: number;
      approvals: number;
    }>`
      SELECT invitation.status AS invitation_status,
        (SELECT count(*)::integer FROM organisation_memberships
         WHERE principal_id = invitation.pending_principal_id) AS memberships,
        (SELECT count(*)::integer FROM privileged_invitation_approvals
         WHERE invitation_id = invitation.id) AS approvals
      FROM access_invitations AS invitation WHERE invitation.id = ${sent.id}
    `;
    expect(state).toEqual({
      invitation_status: "AWAITING_PRIVILEGED_APPROVAL",
      memberships: 0,
      approvals: 0,
    });
  });

  test("persists expiry/cancellation and enforces last-admin plus terminal revocation", async () => {
    const h = harness();
    const sent = await createAndSendStandard(h, `expiry-${randomUUID()}@brightsteps.example`);
    h.setNow(new Date(DECISION_AT.getTime() + 72 * 60 * 60 * 1_000));
    await expect(acceptInvitation({
      invitationToken: h.token(),
      compactJwt: candidateJwt("unused@brightsteps.example", randomUUID()),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: randomUUID() },
    }, h.dependencies)).rejects.toMatchObject({ code: "invitation_expired" });
    const expired = await centreSuccessDB.queryRow<{ status: string }>`
      SELECT status FROM access_invitations WHERE id = ${sent.id}
    `;
    expect(expired?.status).toBe("EXPIRED");

    const cancelHarness = harness();
    const cancellable = await createAndSendStandard(cancelHarness, `cancel-${randomUUID()}@brightsteps.example`);
    const cancelled = await cancelInvitation({
      organisationId: fixture.organisationId, invitationId: cancellable.id,
      actorPrincipalId: fixture.inviterId, expectedLockVersion: cancellable.lockVersion,
      reason: "Synthetic cancellation.",
    }, cancelHarness.dependencies);
    expect(cancelled.status).toBe("CANCELLED");
    await expect(acceptInvitation({
      invitationToken: cancelHarness.token(),
      compactJwt: candidateJwt("cancel@brightsteps.example", randomUUID()),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: randomUUID() },
    }, cancelHarness.dependencies)).rejects.toMatchObject({ code: "invitation_superseded" });

    const isolatedOrganisationId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${isolatedOrganisationId}, 'Last administrator guard organisation', 'active', 'Australia/Sydney')
    `;
    const onlyAdmin = await addAdministrator(isolatedOrganisationId, "Only Reachable Administrator");
    const principal = await centreSuccessDB.queryRow<{ lock_version: number }>`
      SELECT lock_version FROM principals WHERE id = ${onlyAdmin}
    `;
    await expect(transitionPrincipalLifecycle({
      organisationId: isolatedOrganisationId,
      targetPrincipalId: onlyAdmin,
      actorPrincipalId: onlyAdmin,
      expectedLockVersion: principal!.lock_version,
      transition: "suspend",
      reason: "Must be denied by last-administrator policy.",
    }, h.dependencies)).rejects.toMatchObject({ code: "last_administrator" });
    await expect(centreSuccessDB.exec`
      UPDATE principals SET status = 'suspended' WHERE id = ${onlyAdmin}
    `).rejects.toThrow(/last reachable System Administrator/);

    const lifecycle = await createAndSendStandard(harness(), `lifecycle-${randomUUID()}@brightsteps.example`);
    const lifecycleToken = await centreSuccessDB.queryRow<{ token_digest: Buffer }>`
      SELECT token_digest FROM invitation_token_generations WHERE invitation_id = ${lifecycle.id}
    `;
    expect(lifecycleToken).not.toBeNull();
  });

  test("database guards every reachable-administrator fact and serialises concurrent removal", async () => {
    async function isolatedAdministrator(label: string) {
      const organisationId = randomUUID();
      await centreSuccessDB.exec`
        INSERT INTO organisations (id, name, status, default_timezone)
        VALUES (${organisationId}, ${label}, 'active', 'Australia/Sydney')
      `;
      const principalId = await addAdministrator(organisationId, `${label} administrator`);
      const facts = await centreSuccessDB.queryRow<{
        mapping_id: string; membership_id: string; assignment_id: string;
        scope_id: string; role_definition_id: string;
      }>`
        SELECT mapping.id AS mapping_id, membership.id AS membership_id,
               assignment.id AS assignment_id, scope.id AS scope_id,
               assignment.role_definition_id
        FROM external_identity_mappings AS mapping
        JOIN organisation_memberships AS membership ON membership.principal_id = mapping.principal_id
        JOIN role_assignments AS assignment ON assignment.organisation_membership_id = membership.id
        JOIN role_definitions AS role ON role.id = assignment.role_definition_id AND role.role_key = 'system_administrator'
        JOIN assignment_scopes AS scope ON scope.role_assignment_id = assignment.id AND scope.scope_type = 'organisation'
        WHERE membership.organisation_id = ${organisationId} AND mapping.principal_id = ${principalId}
      `;
      return { organisationId, principalId, ...facts! };
    }

    const mapping = await isolatedAdministrator("Mapping guard");
    await expect(centreSuccessDB.exec`
      UPDATE external_identity_mappings SET status = 'inactive' WHERE id = ${mapping.mapping_id}
    `).rejects.toThrow(/last reachable System Administrator/);
    const membership = await isolatedAdministrator("Membership guard");
    await expect(centreSuccessDB.exec`
      UPDATE organisation_memberships SET status = 'inactive' WHERE id = ${membership.membership_id}
    `).rejects.toThrow(/last reachable System Administrator/);
    const assignment = await isolatedAdministrator("Assignment guard");
    await expect(centreSuccessDB.exec`
      UPDATE role_assignments SET status = 'inactive' WHERE id = ${assignment.assignment_id}
    `).rejects.toThrow(/last reachable System Administrator/);
    const scope = await isolatedAdministrator("Scope guard");
    await expect(centreSuccessDB.exec`
      DELETE FROM assignment_scopes WHERE id = ${scope.scope_id}
    `).rejects.toThrow(/last reachable System Administrator/);
    const capabilityFact = await isolatedAdministrator("Capability guard");
    for (const requiredCapability of [
      "principal.read",
      "principal.manage",
      "identity.mapping.manage",
      "assignment.read",
      "assignment.manage",
      "invitation.read",
      "invitation.manage",
      "access_history.read",
      "privileged_access.approve",
    ]) {
      await expect(centreSuccessDB.exec`
        DELETE FROM role_capabilities
        WHERE role_definition_id = ${capabilityFact.role_definition_id}
          AND capability_code = ${requiredCapability}
      `).rejects.toThrow(/last reachable System Administrator/);
    }

    const coalesced = await centreSuccessDB.begin();
    let coalescedCommitted = false;
    try {
      await coalesced.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      await coalesced.exec`UPDATE principals SET updated_at = updated_at WHERE id = ${capabilityFact.principalId}`;
      await coalesced.exec`UPDATE external_identity_mappings SET updated_at = updated_at WHERE id = ${capabilityFact.mapping_id}`;
      await coalesced.exec`UPDATE organisation_memberships SET updated_at = updated_at WHERE id = ${capabilityFact.membership_id}`;
      await coalesced.exec`UPDATE role_assignments SET updated_at = updated_at WHERE id = ${capabilityFact.assignment_id}`;
      await coalesced.exec`UPDATE assignment_scopes SET effective_to = effective_to WHERE id = ${capabilityFact.scope_id}`;
      await coalesced.exec`UPDATE role_definitions SET updated_at = updated_at WHERE id = ${capabilityFact.role_definition_id}`;
      await coalesced.exec`
        UPDATE role_capabilities SET capability_code = capability_code
        WHERE role_definition_id = ${capabilityFact.role_definition_id}
          AND capability_code = 'principal.read'
      `;
      const queued = await coalesced.queryRow<{ count: number }>`
        SELECT count(*)::integer AS count
        FROM people_admin_guard_validation_queue
        WHERE transaction_id = txid_current()
          AND organisation_id = ${capabilityFact.organisationId}
      `;
      expect(queued?.count).toBe(1);
      await coalesced.commit();
      coalescedCommitted = true;
    } finally {
      if (!coalescedCommitted) await coalesced.rollback();
    }
    const remainingQueued = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT count(*)::integer AS count
      FROM people_admin_guard_validation_queue
      WHERE organisation_id = ${capabilityFact.organisationId}
    `;
    expect(remainingQueued?.count).toBe(0);

    const concurrentOrganisationId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (${concurrentOrganisationId}, 'Concurrent administrator guard', 'active', 'Australia/Sydney')
    `;
    const first = await addAdministrator(concurrentOrganisationId, "Concurrent administrator one");
    const second = await addAdministrator(concurrentOrganisationId, "Concurrent administrator two");
    const versions = await centreSuccessDB.queryAll<{ id: string; lock_version: number }>`
      SELECT id, lock_version FROM principals WHERE id IN (${first}, ${second}) ORDER BY id
    `;
    const version = new Map(versions.map((row) => [row.id, row.lock_version]));
    const h = harness(new Date(Date.now() + 1_000));
    const results = await Promise.allSettled([
      transitionPrincipalLifecycle({
        organisationId: concurrentOrganisationId, targetPrincipalId: first,
        actorPrincipalId: second, expectedLockVersion: version.get(first)!,
        transition: "suspend", reason: "Concurrent removal one.",
      }, h.dependencies),
      transitionPrincipalLifecycle({
        organisationId: concurrentOrganisationId, targetPrincipalId: second,
        actorPrincipalId: first, expectedLockVersion: version.get(second)!,
        transition: "suspend", reason: "Concurrent removal two.",
      }, h.dependencies),
    ]);
    const fulfilledLifecycle = results.filter((result) => result.status === "fulfilled");
    if (fulfilledLifecycle.length !== 1) {
      throw new Error(`unexpected concurrent administrator results: ${results.map((result) =>
        result.status === "fulfilled" ? "fulfilled" : String(result.reason)).join(" | ")}`);
    }
    const reachable = await centreSuccessDB.queryRow<{ count: number }>`
      SELECT reachable_system_administrator_count(${concurrentOrganisationId}) AS count
    `;
    expect(reachable?.count).toBe(1);
  }, 15_000);

  test("database rejects pending grants, proposal mutation, fictional history, and revoked reactivation", async () => {
    const pendingId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${pendingId}, 'Pending separation candidate', 'pending')
    `;
    await expect(centreSuccessDB.exec`
      INSERT INTO organisation_memberships (
        id, organisation_id, principal_id, status, effective_from
      ) VALUES (${randomUUID()}, ${fixture.organisationId}, ${pendingId}, 'active', now())
    `).rejects.toThrow(/active organisation membership requires an active principal/);

    const h = harness();
    const sent = await createAndSendStandard(h, `immutable-${randomUUID()}@brightsteps.example`);
    await expect(centreSuccessDB.exec`
      UPDATE invitation_role_proposals SET role_key = 'area_manager'
      WHERE invitation_id = ${sent.id}
    `).rejects.toThrow(/immutable after draft review/);
    await expect(centreSuccessDB.exec`
      DELETE FROM invitation_events WHERE invitation_id = ${sent.id}
    `).rejects.toThrow(/append-only/);

    const revokeHarness = harness();
    const standard = await createAndSendStandard(revokeHarness, `revoked-${randomUUID()}@brightsteps.example`);
    const oid = randomUUID();
    await acceptInvitation({
      invitationToken: revokeHarness.token(),
      compactJwt: candidateJwt(standard.intendedEmail, oid),
      verifiedIdentity: { tenantId: TENANT_ID, objectId: oid },
    }, revokeHarness.dependencies);
    const target = await centreSuccessDB.queryRow<{ id: string; lock_version: number }>`
      SELECT principal.id, principal.lock_version
      FROM access_invitations AS invitation
      JOIN principals AS principal ON principal.id = invitation.pending_principal_id
      WHERE invitation.id = ${standard.id}
    `;
    const revoked = await transitionPrincipalLifecycle({
      organisationId: fixture.organisationId, targetPrincipalId: target!.id,
      actorPrincipalId: fixture.inviterId, expectedLockVersion: target!.lock_version,
      transition: "revoke", reason: "Synthetic terminal revocation.",
    }, revokeHarness.dependencies);
    expect(revoked.status).toBe("revoked");
    await expect(centreSuccessDB.exec`
      UPDATE principals SET status = 'active' WHERE id = ${target!.id}
    `).rejects.toThrow(/invalid principal lifecycle transition/);
  });
});
