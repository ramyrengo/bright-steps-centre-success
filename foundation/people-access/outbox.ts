import { api } from "encore.dev/api";
import { appMeta } from "encore.dev";
import { secret } from "encore.dev/config";
import { CronJob } from "encore.dev/cron";
import { Subscription, Topic } from "encore.dev/pubsub";
import type { Transaction } from "encore.dev/storage/sqldb";
import { randomUUID } from "node:crypto";
import { centreSuccessDB } from "../db";
import { loadRuntimeEntraConfidentialClientIdentifiers } from "../authentication/entra-configuration";
import {
  loadInvitationSecurityConfiguration,
  loadMicrosoftGraphClientSecret,
} from "./configuration";
import { decryptInvitationToken } from "./security";
import {
  boundedInvitationRetryDelayMilliseconds,
  InvitationDeliveryError,
  type InvitationEmailAdapter,
  type InvitationDeliveryResult,
} from "./email";
import { createInvitationEmailAdapter } from "./microsoft-graph-invitation-email";

const invitationPublicBaseUrl = secret("InvitationPublicBaseUrl");
export const PROVIDER_ATTEMPT_LEASE_MILLISECONDS = 45_000;
export const DISPATCH_LEASE_MILLISECONDS = 60_000;
export const MAX_INVITATION_PROVIDER_ATTEMPTS = 3;

export interface InvitationDeliveryMessage {
  outboxId: string;
}

export const invitationDeliveryTopic = new Topic<InvitationDeliveryMessage>(
  "people-invitation-delivery",
  { deliveryGuarantee: "at-least-once" },
);

interface DispatchClaim {
  outboxId: string;
  leaseId: string;
}

export interface InvitationDeliveryProcessingHooks {
  providerAttemptLeaseMilliseconds?: number;
  beforeReservationCommit?: (reservation: {
    id: string;
    outboxId: string;
    attemptNumber: number;
  }) => Promise<void>;
  afterReservationCommitted?: (reservation: {
    id: string;
    outboxId: string;
    attemptNumber: number;
  }) => Promise<void>;
  beforeResultCommit?: (reservation: {
    id: string;
    outboxId: string;
    attemptNumber: number;
  }) => Promise<void>;
}

function validatedPublicBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invitation public origin is invalid");
  }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("invitation public origin is invalid");
  }
  return url.origin;
}

export async function dispatchPendingInvitationDeliveries(
  publish: (message: InvitationDeliveryMessage) => Promise<string> = (message) =>
    invitationDeliveryTopic.publish(message),
): Promise<{ published: number }> {
  const rows = await claimInvitationDeliveriesForDispatch();
  let published = 0;
  for (const row of rows) {
    try {
      await publish({ outboxId: row.outboxId });
      published += 1;
    } catch (error) {
      // The publish may have reached Pub/Sub even when the caller saw an
      // ambiguous failure. Only return the claim to PENDING if the worker has
      // not already advanced it under the same lease.
      await centreSuccessDB.exec`
        UPDATE people_notification_outbox
        SET status = 'PENDING', next_attempt_at = now(),
            dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${row.outboxId}
          AND status = 'PUBLISHED'
          AND dispatch_lease_id = ${row.leaseId}
      `;
      throw error;
    }
  }
  return { published };
}

export async function claimInvitationDeliveriesForDispatch(): Promise<DispatchClaim[]> {
  const transaction = await centreSuccessDB.begin();
  try {
    const candidates = await transaction.queryAll<{ id: string }>`
      SELECT id
      FROM people_notification_outbox
      WHERE
        (status = 'PENDING' AND next_attempt_at <= now())
        OR
        (status = 'PUBLISHED' AND dispatch_lease_expires_at <= now())
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    `;
    const claims: DispatchClaim[] = [];
    for (const candidate of candidates) {
      const leaseId = randomUUID();
      const claimed = await transaction.queryRow<{ id: string }>`
        UPDATE people_notification_outbox
        SET status = 'PUBLISHED',
            dispatch_lease_id = ${leaseId},
            dispatch_lease_expires_at = now() + (${DISPATCH_LEASE_MILLISECONDS} * interval '1 millisecond'),
            published_at = COALESCE(published_at, now()),
            publish_attempts = publish_attempts + 1,
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${candidate.id}
        RETURNING id
      `;
      if (claimed) claims.push({ outboxId: claimed.id, leaseId });
    }
    await transaction.commit();
    return claims;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

interface DeliveryRow {
  id: string;
  organisation_id: string;
  recipient_email: string;
  encrypted_token: ArrayBuffer | null;
  encryption_iv: ArrayBuffer | null;
  encryption_tag: ArrayBuffer | null;
  idempotency_key: string;
  status: "PENDING" | "PUBLISHED" | "DELIVERED" | "FAILED";
  next_attempt_at: Date;
  invitation_id: string;
  generation_status: string;
  invitation_status: string;
  expires_at: Date;
  decision_at: Date;
}

interface ProviderAttemptReservation {
  id: string;
  outbox_id: string;
  attempt_number: number;
  status:
    | "RESERVED"
    | "ACCEPTED"
    | "RETRYABLE_FAILURE"
    | "PERMANENT_FAILURE"
    | "AMBIGUOUS"
    | "NOT_SENT_AFTER_REVALIDATION";
  lease_expires_at: Date;
}

let runtimeInvitationEmailAdapter: InvitationEmailAdapter | undefined;

function runtimeEmailAdapter(): InvitationEmailAdapter {
  runtimeInvitationEmailAdapter ??= createInvitationEmailAdapter(appMeta().environment, {
    graphConfiguration: () => ({
      ...loadRuntimeEntraConfidentialClientIdentifiers(),
      clientSecret: loadMicrosoftGraphClientSecret(),
    }),
  });
  return runtimeInvitationEmailAdapter;
}

function deliveryFailure(error: unknown): InvitationDeliveryError {
  return error instanceof InvitationDeliveryError
    ? error
    : new InvitationDeliveryError("provider_retryable", true);
}

async function recordDeliveryFailure(
  transaction: Transaction,
  row: Pick<DeliveryRow, "id" | "organisation_id">,
  reservation: ProviderAttemptReservation,
  failure: InvitationDeliveryError,
): Promise<void> {
  const retryAt = new Date(
    Date.now() + boundedInvitationRetryDelayMilliseconds(failure.retryAfterMs),
  );
  const attemptsExhausted =
    failure.retryable && reservation.attempt_number >= MAX_INVITATION_PROVIDER_ATTEMPTS;
  const terminal = !failure.retryable || attemptsExhausted;
  const errorClass = attemptsExhausted
    ? "delivery_attempts_exhausted"
    : failure.errorClass;
  await transaction.exec`
    UPDATE people_notification_provider_attempts
    SET status = ${failure.retryable ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE"},
        error_class = ${failure.errorClass}, completed_at = now(),
        updated_at = now(), lock_version = lock_version + 1
    WHERE id = ${reservation.id} AND status = 'RESERVED'
  `;
  await transaction.exec`
    INSERT INTO people_notification_delivery_attempts (
      id, organisation_id, outbox_id, attempt_number, status,
      error_class, attempted_at
    ) VALUES (
      gen_random_uuid(), ${row.organisation_id}, ${row.id}, ${reservation.attempt_number},
      ${terminal ? "PERMANENT_FAILURE" : "RETRYABLE_FAILURE"},
      ${errorClass}, now()
    )
  `;
  await transaction.exec`
    UPDATE people_notification_outbox
    SET status = ${terminal ? "FAILED" : "PENDING"},
        next_attempt_at = ${retryAt},
        last_error_class = ${errorClass},
        dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
        updated_at = now(),
        lock_version = lock_version + 1
    WHERE id = ${row.id}
  `;
}

async function markReservationNotSent(
  transaction: Transaction,
  row: Pick<DeliveryRow, "id" | "organisation_id">,
  reservation: ProviderAttemptReservation,
  errorClass: string,
): Promise<void> {
  await transaction.exec`
    UPDATE people_notification_provider_attempts
    SET status = 'NOT_SENT_AFTER_REVALIDATION', error_class = ${errorClass},
        completed_at = now(), updated_at = now(), lock_version = lock_version + 1
    WHERE id = ${reservation.id} AND status = 'RESERVED'
  `;
  await transaction.exec`
    INSERT INTO people_notification_delivery_attempts (
      id, organisation_id, outbox_id, attempt_number, status,
      error_class, attempted_at
    ) VALUES (
      gen_random_uuid(), ${row.organisation_id}, ${row.id}, ${reservation.attempt_number},
      'NOT_SENT_AFTER_REVALIDATION', ${errorClass}, now()
    )
  `;
  await transaction.exec`
    UPDATE people_notification_outbox
    SET status = 'FAILED', last_error_class = ${errorClass},
        dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
        updated_at = now(), lock_version = lock_version + 1
    WHERE id = ${row.id}
  `;
}

type ReservationDecision =
  | { kind: "none" }
  | { kind: "reserved"; reservation: ProviderAttemptReservation };

async function reserveProviderAttempt(
  message: InvitationDeliveryMessage,
  requestedLeaseMilliseconds = PROVIDER_ATTEMPT_LEASE_MILLISECONDS,
  beforeReservationCommit?: InvitationDeliveryProcessingHooks["beforeReservationCommit"],
): Promise<ReservationDecision> {
  const reference = await centreSuccessDB.queryRow<{ invitation_id: string }>`
    SELECT invitation_id FROM people_notification_outbox WHERE id = ${message.outboxId}
  `;
  if (!reference) return { kind: "none" };

  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.queryRow<{ id: string }>`
      SELECT id FROM access_invitations
      WHERE id = ${reference.invitation_id}
      FOR UPDATE
    `;
    const row = await transaction.queryRow<DeliveryRow>`
      SELECT outbox.id, outbox.organisation_id, outbox.invitation_id,
             outbox.recipient_email, outbox.encrypted_token,
             outbox.encryption_iv, outbox.encryption_tag,
             outbox.idempotency_key, outbox.status, outbox.next_attempt_at,
             generation.status AS generation_status,
             invitation.status AS invitation_status,
             generation.expires_at,
             now() AS decision_at
      FROM people_notification_outbox AS outbox
      JOIN invitation_token_generations AS generation
        ON generation.organisation_id = outbox.organisation_id
       AND generation.id = outbox.token_generation_id
      JOIN access_invitations AS invitation
        ON invitation.organisation_id = outbox.organisation_id
       AND invitation.id = outbox.invitation_id
      WHERE outbox.id = ${message.outboxId}
      FOR UPDATE OF outbox
    `;
    if (!row || row.status === "DELIVERED" || row.status === "FAILED") {
      await transaction.commit();
      return { kind: "none" };
    }
    if (row.status === "PENDING" && row.next_attempt_at.getTime() > row.decision_at.getTime()) {
      await transaction.commit();
      return { kind: "none" };
    }
    const reservations = await transaction.queryAll<ProviderAttemptReservation>`
      SELECT id, outbox_id, attempt_number, status, lease_expires_at
      FROM people_notification_provider_attempts
      WHERE outbox_id = ${row.id}
      ORDER BY attempt_number
      FOR UPDATE
    `;
    const now = row.decision_at.getTime();
    for (const existing of reservations) {
      if (existing.status === "RESERVED" && existing.lease_expires_at.getTime() > now) {
        await transaction.commit();
        return { kind: "none" };
      }
      if (existing.status === "RESERVED") {
        await transaction.exec`
          UPDATE people_notification_provider_attempts
          SET status = 'AMBIGUOUS', error_class = 'provider_attempt_interrupted',
              completed_at = now(), updated_at = now(), lock_version = lock_version + 1
          WHERE id = ${existing.id} AND status = 'RESERVED'
        `;
        await transaction.exec`
          INSERT INTO people_notification_delivery_attempts (
            id, organisation_id, outbox_id, attempt_number, status,
            error_class, attempted_at
          ) VALUES (
            gen_random_uuid(), ${row.organisation_id}, ${row.id}, ${existing.attempt_number},
            'AMBIGUOUS', 'provider_attempt_interrupted', now()
          )
        `;
      }
    }

    if (row.generation_status !== "CURRENT" || row.invitation_status !== "SENT") {
      await transaction.exec`
        UPDATE people_notification_outbox
        SET status = 'FAILED', last_error_class = 'invitation_generation_not_current',
            dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${row.id}
      `;
      await transaction.commit();
      return { kind: "none" };
    }
    if (row.expires_at.getTime() <= row.decision_at.getTime()) {
      await transaction.exec`
        UPDATE people_notification_outbox
        SET status = 'FAILED', last_error_class = 'invitation_expired',
            dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${row.id}
      `;
      await transaction.commit();
      return { kind: "none" };
    }

    const nextAttemptNumber = reservations.reduce(
      (maximum, existing) => Math.max(maximum, existing.attempt_number),
      0,
    ) + 1;
    if (nextAttemptNumber > MAX_INVITATION_PROVIDER_ATTEMPTS) {
      await transaction.exec`
        UPDATE people_notification_outbox
        SET status = 'FAILED', last_error_class = 'delivery_attempts_exhausted',
            dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${row.id}
      `;
      await transaction.commit();
      return { kind: "none" };
    }

    const reservationId = randomUUID();
    const leaseMilliseconds = Math.min(
      Math.max(1, requestedLeaseMilliseconds),
      PROVIDER_ATTEMPT_LEASE_MILLISECONDS,
    );
    const reservation = await transaction.queryRow<ProviderAttemptReservation>`
      INSERT INTO people_notification_provider_attempts (
        id, organisation_id, outbox_id, attempt_number, status,
        reserved_at, lease_expires_at, updated_at
      ) VALUES (
        ${reservationId}, ${row.organisation_id}, ${row.id}, ${nextAttemptNumber},
        'RESERVED', now(), now() + (${leaseMilliseconds} * interval '1 millisecond'), now()
      )
      RETURNING id, outbox_id, attempt_number, status, lease_expires_at
    `;
    if (!reservation) throw new Error("provider attempt reservation was not created");
    if (row.status === "PENDING") {
      const dispatchLeaseId = randomUUID();
      await transaction.exec`
        UPDATE people_notification_outbox
        SET status = 'PUBLISHED', dispatch_lease_id = ${dispatchLeaseId},
            dispatch_lease_expires_at = now() + (${DISPATCH_LEASE_MILLISECONDS} * interval '1 millisecond'),
            published_at = COALESCE(published_at, now()),
            updated_at = now(), lock_version = lock_version + 1
        WHERE id = ${row.id}
      `;
    }
    await beforeReservationCommit?.({
      id: reservation.id,
      outboxId: reservation.outbox_id,
      attemptNumber: reservation.attempt_number,
    });
    await transaction.commit();
    return { kind: "reserved", reservation };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function deliverInvitationOutboxMessage(
  message: InvitationDeliveryMessage,
  adapter: InvitationEmailAdapter,
  configuration: { deliveryEncryptionKey: string; publicBaseUrl: string } = {
    deliveryEncryptionKey: loadInvitationSecurityConfiguration().deliveryEncryptionKey,
    publicBaseUrl: invitationPublicBaseUrl(),
  },
  hooks: InvitationDeliveryProcessingHooks = {},
): Promise<void> {
  const decision = await reserveProviderAttempt(
    message,
    hooks.providerAttemptLeaseMilliseconds,
    hooks.beforeReservationCommit,
  );
  if (decision.kind === "none") return;
  const reservation = decision.reservation;
  await hooks.afterReservationCommitted?.({
    id: reservation.id,
    outboxId: reservation.outbox_id,
    attemptNumber: reservation.attempt_number,
  });

  const reference = await centreSuccessDB.queryRow<{ invitation_id: string }>`
    SELECT invitation_id FROM people_notification_outbox WHERE id = ${message.outboxId}
  `;
  if (!reference) return;
  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.queryRow<{ id: string }>`
      SELECT id FROM access_invitations
      WHERE id = ${reference.invitation_id}
      FOR UPDATE
    `;
    const row = await transaction.queryRow<DeliveryRow>`
      SELECT outbox.id, outbox.organisation_id, outbox.invitation_id,
             outbox.recipient_email,
             outbox.encrypted_token, outbox.encryption_iv, outbox.encryption_tag,
             outbox.idempotency_key, outbox.status, outbox.next_attempt_at,
             generation.status AS generation_status,
             invitation.status AS invitation_status,
             generation.expires_at,
             now() AS decision_at
      FROM people_notification_outbox AS outbox
      JOIN invitation_token_generations AS generation
        ON generation.organisation_id = outbox.organisation_id
       AND generation.id = outbox.token_generation_id
      JOIN access_invitations AS invitation
        ON invitation.organisation_id = outbox.organisation_id
       AND invitation.id = outbox.invitation_id
      WHERE outbox.id = ${message.outboxId}
      FOR UPDATE OF outbox
    `;
    if (!row || row.status === "DELIVERED" || row.status === "FAILED") {
      await transaction.commit();
      return;
    }
    const lockedReservation = await transaction.queryRow<ProviderAttemptReservation>`
      SELECT id, outbox_id, attempt_number, status, lease_expires_at
      FROM people_notification_provider_attempts
      WHERE id = ${reservation.id} AND outbox_id = ${row.id}
      FOR UPDATE
    `;
    if (!lockedReservation || lockedReservation.status !== "RESERVED") {
      await transaction.commit();
      return;
    }
    if (row.generation_status !== "CURRENT" || row.invitation_status !== "SENT") {
      await markReservationNotSent(
        transaction,
        row,
        lockedReservation,
        "invitation_generation_not_current",
      );
      await transaction.commit();
      return;
    }
    if (row.expires_at.getTime() <= row.decision_at.getTime()) {
      await markReservationNotSent(
        transaction,
        row,
        lockedReservation,
        "invitation_expired",
      );
      await transaction.commit();
      return;
    }
    if (!row.encrypted_token || !row.encryption_iv || !row.encryption_tag) {
      throw new Error("invitation delivery material is unavailable");
    }
    const invitationCode = decryptInvitationToken(
      { ciphertext: row.encrypted_token, iv: row.encryption_iv, tag: row.encryption_tag },
      configuration.deliveryEncryptionKey,
    );
    let result: InvitationDeliveryResult;
    try {
      result = await adapter.deliverInvitation({
        recipientEmail: row.recipient_email,
        invitationUrl: `${validatedPublicBaseUrl(configuration.publicBaseUrl)}/invitations/accept`,
        invitationCode,
        expiresAt: row.expires_at,
        idempotencyKey: row.idempotency_key,
      });
    } catch (error) {
      await recordDeliveryFailure(
        transaction,
        row,
        lockedReservation,
        deliveryFailure(error),
      );
      await hooks.beforeResultCommit?.({
        id: lockedReservation.id,
        outboxId: lockedReservation.outbox_id,
        attemptNumber: lockedReservation.attempt_number,
      });
      await transaction.commit();
      return;
    }
    await transaction.exec`
      UPDATE people_notification_provider_attempts
      SET status = 'ACCEPTED', provider_reference = ${result.providerReference},
          completed_at = now(), updated_at = now(), lock_version = lock_version + 1
      WHERE id = ${lockedReservation.id} AND status = 'RESERVED'
    `;
    await transaction.exec`
      INSERT INTO people_notification_delivery_attempts (
        id, organisation_id, outbox_id, attempt_number, status,
        provider_reference, attempted_at
      ) VALUES (
        gen_random_uuid(), ${row.organisation_id}, ${row.id},
        ${lockedReservation.attempt_number}, 'DELIVERED',
        ${result.providerReference}, now()
      )
    `;
    await transaction.exec`
      UPDATE people_notification_outbox
      SET status = 'DELIVERED', delivered_at = now(), updated_at = now(),
          last_error_class = NULL,
          dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL,
          encrypted_token = NULL, encryption_iv = NULL, encryption_tag = NULL,
          lock_version = lock_version + 1
      WHERE id = ${row.id}
    `;
    await hooks.beforeResultCommit?.({
      id: lockedReservation.id,
      outboxId: lockedReservation.outbox_id,
      attemptNumber: lockedReservation.attempt_number,
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function deliverInvitationOutboxMessageForRuntime(
  message: InvitationDeliveryMessage,
): Promise<void> {
  let adapter: InvitationEmailAdapter;
  try {
    adapter = runtimeEmailAdapter();
  } catch (error) {
    adapter = { deliverInvitation: async () => Promise.reject(error) };
  }
  await deliverInvitationOutboxMessage(message, adapter);
}

export const dispatchPeopleInvitationOutbox = api(
  { expose: false, method: "POST", path: "/internal/people-access/outbox/dispatch" },
  (): Promise<{ published: number }> => dispatchPendingInvitationDeliveries(),
);

export const peopleInvitationOutboxCron = new CronJob(
  "people-invitation-outbox-dispatch",
  { every: "5m", endpoint: dispatchPeopleInvitationOutbox },
);

export const invitationDeliverySubscription = new Subscription(
  invitationDeliveryTopic,
  "people-invitation-delivery-worker",
  {
    handler: deliverInvitationOutboxMessageForRuntime,
    maxConcurrency: 10,
    ackDeadline: "30s",
    retryPolicy: { minBackoff: "10s", maxBackoff: "10m", maxRetries: 20 },
  },
);
