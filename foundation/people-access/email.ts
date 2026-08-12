import { createHash } from "node:crypto";

export interface InvitationDeliveryRequest {
  recipientEmail: string;
  invitationUrl: string;
  invitationCode: string;
  expiresAt: Date;
  idempotencyKey: string;
}

export interface InvitationDeliveryResult {
  providerReference: string;
}

export interface InvitationEmailAdapter {
  deliverInvitation(request: InvitationDeliveryRequest): Promise<InvitationDeliveryResult>;
}

const DEFAULT_INVITATION_RETRY_DELAY_MS = 10_000;
const MIN_INVITATION_RETRY_DELAY_MS = 1_000;
const MAX_INVITATION_RETRY_DELAY_MS = 10 * 60_000;

export function boundedInvitationRetryDelayMilliseconds(value?: number): number {
  const delay = value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_INVITATION_RETRY_DELAY_MS)
    : DEFAULT_INVITATION_RETRY_DELAY_MS;
  return Math.max(delay, MIN_INVITATION_RETRY_DELAY_MS);
}

export class InvitationDeliveryError extends Error {
  constructor(
    readonly errorClass: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super("invitation email delivery failed");
    this.name = "InvitationDeliveryError";
  }
}

/**
 * Deterministic development adapter. It performs no network I/O and emits no
 * email address, invitation credential, identity, role, or scope to logs.
 */
export class DevelopmentInvitationEmailAdapter implements InvitationEmailAdapter {
  async deliverInvitation(request: InvitationDeliveryRequest): Promise<InvitationDeliveryResult> {
    return {
      providerReference: `development-noop:${createHash("sha256")
        .update(request.idempotencyKey)
        .digest("hex")
        .slice(0, 24)}`,
    };
  }
}
