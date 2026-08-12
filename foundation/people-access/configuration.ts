import { secret } from "encore.dev/config";

const invitationTokenDigestKey = secret("InvitationTokenDigestKey");
const invitationDeliveryEncryptionKey = secret("InvitationDeliveryEncryptionKey");

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
