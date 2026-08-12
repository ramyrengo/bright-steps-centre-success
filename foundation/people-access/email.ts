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
