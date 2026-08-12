import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  constantTimeDigestMatch,
  correlateVerifiedInvitationIdentity,
  decryptInvitationToken,
  encryptInvitationToken,
  generateInvitationToken,
  invitationTokenDigest,
  normaliseInvitationEmail,
} from "./security";

const TENANT_ID = "27026100-3522-48b5-8e95-80230afc4127";
const OBJECT_ID = "11111111-2222-4333-8444-555555555555";

function compactJwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

describe("People & Access invitation security", () => {
  test("generates a 256-bit opaque credential and stores only a keyed digest", () => {
    const token = generateInvitationToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).not.toContain(".");
    const digest = invitationTokenDigest(token, "d".repeat(32));
    expect(digest).toHaveLength(32);
    expect(digest.toString("utf8")).not.toContain(token);
    expect(constantTimeDigestMatch(digest, invitationTokenDigest(token, "d".repeat(32)))).toBe(true);
    expect(constantTimeDigestMatch(digest, invitationTokenDigest(generateInvitationToken(), "d".repeat(32)))).toBe(false);
  });

  test("encrypts the one-time delivery credential with authenticated encryption", () => {
    const token = generateInvitationToken();
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptInvitationToken(token, key);
    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.tag).toHaveLength(16);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain(token);
    expect(decryptInvitationToken(encrypted, key)).toBe(token);
    encrypted.tag[0] ^= 1;
    expect(() => decryptInvitationToken(encrypted, key)).toThrow();
  });

  test("normalises reviewed email input without making it an identity key", () => {
    expect(normaliseInvitationEmail("  PERSON@BrightSteps.example ")).toBe("person@brightsteps.example");
    expect(() => normaliseInvitationEmail("not-an-email")).toThrow();
  });

  test("uses only an exact verified email claim for automatic correlation", () => {
    const identity = { tenantId: TENANT_ID, objectId: OBJECT_ID };
    const token = compactJwt({ tid: TENANT_ID, oid: OBJECT_ID, email: "person@brightsteps.example" });
    expect(correlateVerifiedInvitationIdentity({
      compactJwt: token,
      verifiedIdentity: identity,
      intendedEmail: "person@brightsteps.example",
    })).toEqual({ outcome: "matched", email: "person@brightsteps.example" });

    for (const claims of [
      { tid: TENANT_ID, oid: OBJECT_ID, preferred_username: "person@brightsteps.example" },
      { tid: TENANT_ID, oid: OBJECT_ID, email: "other@brightsteps.example" },
      { tid: TENANT_ID, oid: OBJECT_ID, email: "person@brightsteps.example", acct: 1 },
      { tid: TENANT_ID, oid: OBJECT_ID, email: "person@brightsteps.example", idp: "foreign" },
      { tid: randomUUID(), oid: OBJECT_ID, email: "person@brightsteps.example" },
    ]) {
      expect(correlateVerifiedInvitationIdentity({
        compactJwt: compactJwt(claims),
        verifiedIdentity: identity,
        intendedEmail: "person@brightsteps.example",
      }).outcome).toBe("review");
    }
  });
});
