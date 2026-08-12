import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { decodeJwt } from "jose";
import type { VerifiedEntraIdentity } from "../authentication/entra-access-token-verifier";
import { PeopleAccessError } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_BYTES = 32;

export function normaliseInvitationEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new PeopleAccessError("invalid_input", "email is invalid");
  }
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new PeopleAccessError("invalid_input", "email is invalid");
  }
  return email;
}

export function generateInvitationToken(): string {
  return randomBytes(INVITATION_BYTES).toString("base64url");
}

export function invitationTokenDigest(token: string, key: string): Buffer {
  if (token.length < 40 || token.length > 100 || key.length < 32) {
    throw new PeopleAccessError("invalid_input", "invitation credential is invalid");
  }
  return createHmac("sha256", key).update(token, "utf8").digest();
}

type BinaryValue = ArrayBuffer | ArrayBufferView;

function binaryBuffer(value: BinaryValue): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function constantTimeDigestMatch(left: BinaryValue, right: BinaryValue): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(binaryBuffer(left), binaryBuffer(right));
}

function deliveryKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32) {
    throw new PeopleAccessError("temporarily_unavailable", "invitation delivery is unavailable");
  }
  return decoded;
}

export interface EncryptedInvitationToken {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptInvitationToken(
  token: string,
  key: string,
): EncryptedInvitationToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deliveryKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptInvitationToken(
  encrypted: { ciphertext: BinaryValue; iv: BinaryValue; tag: BinaryValue },
  key: string,
): string {
  const decipher = createDecipheriv("aes-256-gcm", deliveryKey(key), binaryBuffer(encrypted.iv));
  decipher.setAuthTag(binaryBuffer(encrypted.tag));
  return Buffer.concat([
    decipher.update(binaryBuffer(encrypted.ciphertext)),
    decipher.final(),
  ]).toString("utf8");
}

export type IdentityCorrelation =
  | { outcome: "matched"; email: string }
  | { outcome: "review"; reason: "missing_email" | "email_mismatch" | "guest_or_ambiguous" };

/**
 * Reads correlation evidence only after the same token has passed the M2A
 * cryptographic verifier. It never uses email as permanent identity or access.
 */
export function correlateVerifiedInvitationIdentity(input: {
  compactJwt: string;
  verifiedIdentity: VerifiedEntraIdentity;
  intendedEmail: string;
}): IdentityCorrelation {
  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(input.compactJwt);
  } catch {
    return { outcome: "review", reason: "missing_email" };
  }

  if (
    claims.tid !== input.verifiedIdentity.tenantId ||
    claims.oid !== input.verifiedIdentity.objectId ||
    claims.acct === 1 ||
    typeof claims.idp === "string" ||
    (typeof claims.preferred_username === "string" && claims.preferred_username.includes("#EXT#"))
  ) {
    return { outcome: "review", reason: "guest_or_ambiguous" };
  }

  if (typeof claims.email !== "string") {
    return { outcome: "review", reason: "missing_email" };
  }
  const email = claims.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email !== input.intendedEmail) {
    return { outcome: "review", reason: "email_mismatch" };
  }
  return { outcome: "matched", email };
}
