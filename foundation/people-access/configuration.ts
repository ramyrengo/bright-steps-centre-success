import { secret } from "encore.dev/config";

const invitationTokenDigestKey = secret("InvitationTokenDigestKey");
const invitationDeliveryEncryptionKey = secret("InvitationDeliveryEncryptionKey");
const microsoftGraphClientSecret = secret("MicrosoftGraphClientSecret");

export interface InvitationSecurityConfiguration {
  tokenDigestKey: string;
  deliveryEncryptionKey: string;
}

export function loadInvitationSecurityConfiguration(): InvitationSecurityConfiguration {
  return {
    tokenDigestKey: invitationTokenDigestKey(),
    deliveryEncryptionKey: invitationDeliveryEncryptionKey(),
  };
}

/** Read only after the trusted runtime selector has enabled staging Graph delivery. */
export function loadMicrosoftGraphClientSecret(): string {
  return microsoftGraphClientSecret();
}
