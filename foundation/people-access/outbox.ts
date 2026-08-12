import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { CronJob } from "encore.dev/cron";
import { Subscription, Topic } from "encore.dev/pubsub";
import { centreSuccessDB } from "../db";
import { inSerializableTransaction } from "../transactions";
import { loadInvitationSecurityConfiguration } from "./configuration";
import { decryptInvitationToken } from "./security";
import {
  DevelopmentInvitationEmailAdapter,
  type InvitationEmailAdapter,
  type InvitationDeliveryResult,
} from "./email";

const invitationPublicBaseUrl = secret("InvitationPublicBaseUrl");

export interface InvitationDeliveryMessage {
  outboxId: string;
}

export const invitationDeliveryTopic = new Topic<InvitationDeliveryMessage>(
  "people-invitation-delivery",
  { deliveryGuarantee: "at-least-once" },
);

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
  const rows = await centreSuccessDB.queryAll<{ id: string }>`
    SELECT id FROM people_notification_outbox
    WHERE status = 'PENDING' AND next_attempt_at <= now()
    ORDER BY created_at, id
    LIMIT 50
  `;
  let published = 0;
  for (const row of rows) {
    await publish({ outboxId: row.id });
    await centreSuccessDB.exec`
      UPDATE people_notification_outbox
      SET status = 'PUBLISHED', published_at = COALESCE(published_at, now()),
          publish_attempts = publish_attempts + 1, updated_at = now(),
          lock_version = lock_version + 1
      WHERE id = ${row.id} AND status = 'PENDING'
    `;
    published += 1;
  }
  return { published };
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
  expires_at: Date;
}

export async function deliverInvitationOutboxMessage(
  message: InvitationDeliveryMessage,
  adapter: InvitationEmailAdapter = new DevelopmentInvitationEmailAdapter(),
  configuration: { deliveryEncryptionKey: string; publicBaseUrl: string } = {
    deliveryEncryptionKey: loadInvitationSecurityConfiguration().deliveryEncryptionKey,
    publicBaseUrl: invitationPublicBaseUrl(),
  },
): Promise<void> {
  const row = await centreSuccessDB.queryRow<DeliveryRow>`
    SELECT outbox.id, outbox.organisation_id, outbox.recipient_email,
           outbox.encrypted_token, outbox.encryption_iv, outbox.encryption_tag,
           outbox.idempotency_key, outbox.status, generation.expires_at
    FROM people_notification_outbox AS outbox
    JOIN invitation_token_generations AS generation
      ON generation.organisation_id = outbox.organisation_id
     AND generation.id = outbox.token_generation_id
    WHERE outbox.id = ${message.outboxId}
  `;
  if (!row || row.status === "DELIVERED") return;
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
    await inSerializableTransaction(async (transaction) => {
      const current = await transaction.queryRow<{ attempts: number }>`
        SELECT (SELECT count(*)::integer FROM people_notification_delivery_attempts WHERE outbox_id = ${row.id}) AS attempts
        FROM people_notification_outbox WHERE id = ${row.id} FOR UPDATE
      `;
      if (!current) return;
      await transaction.exec`
        INSERT INTO people_notification_delivery_attempts (
          id, organisation_id, outbox_id, attempt_number, status,
          error_class, attempted_at
        ) VALUES (
          gen_random_uuid(), ${row.organisation_id}, ${row.id}, ${current.attempts + 1},
          'RETRYABLE_FAILURE', 'provider_retryable', now()
        )
      `;
      await transaction.exec`
        UPDATE people_notification_outbox
        SET last_error_class = 'provider_retryable', updated_at = now(),
            lock_version = lock_version + 1
        WHERE id = ${row.id}
      `;
    });
    throw error;
  }

  await inSerializableTransaction(async (transaction) => {
    const current = await transaction.queryRow<{ status: string; attempts: number }>`
      SELECT status,
             (SELECT count(*)::integer FROM people_notification_delivery_attempts WHERE outbox_id = ${row.id}) AS attempts
      FROM people_notification_outbox WHERE id = ${row.id} FOR UPDATE
    `;
    if (!current || current.status === "DELIVERED") return;
    await transaction.exec`
      INSERT INTO people_notification_delivery_attempts (
        id, organisation_id, outbox_id, attempt_number, status,
        provider_reference, attempted_at
      ) VALUES (
        gen_random_uuid(), ${row.organisation_id}, ${row.id}, ${current.attempts + 1},
        'DELIVERED', ${result.providerReference}, now()
      )
    `;
    await transaction.exec`
      UPDATE people_notification_outbox
      SET status = 'DELIVERED', delivered_at = now(), updated_at = now(),
          encrypted_token = NULL, encryption_iv = NULL, encryption_tag = NULL,
          lock_version = lock_version + 1
      WHERE id = ${row.id}
    `;
  });
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
    handler: deliverInvitationOutboxMessage,
    maxConcurrency: 10,
    ackDeadline: "30s",
    retryPolicy: { minBackoff: "10s", maxBackoff: "10m", maxRetries: 20 },
  },
);
