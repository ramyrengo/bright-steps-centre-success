import { APIError } from "encore.dev/api";
import { describe, expect, test, vi } from "vitest";
import { acceptInvitationCandidate } from "./api";

const VALID_TOKEN = "header.payload.signature";
const IDENTITY = {
  tenantId: "27026100-3522-48b5-8e95-80230afc4127",
  objectId: "11111111-2222-4333-8444-555555555555",
};

describe("invitation-candidate authentication boundary", () => {
  test("keeps the opaque invitation credential in the body and reuses verified Entra identity", async () => {
    const verifyAccessToken = vi.fn(async () => IDENTITY);
    const accept = vi.fn(async () => ({
      outcome: "activated" as const,
      invitationStatus: "ACTIVATED" as const,
    }));
    await expect(acceptInvitationCandidate(
      { invitationToken: "opaque-invitation-body-credential" },
      {
        authorizationHeader: () => `Bearer ${VALID_TOKEN}`,
        verifyAccessToken,
        accept,
      },
    )).resolves.toEqual({ outcome: "activated", invitationStatus: "ACTIVATED" });
    expect(verifyAccessToken).toHaveBeenCalledWith(VALID_TOKEN);
    expect(accept).toHaveBeenCalledWith({
      invitationToken: "opaque-invitation-body-credential",
      compactJwt: VALID_TOKEN,
      verifiedIdentity: IDENTITY,
    });
  });

  test("rejects missing or malformed bearer credentials before invitation lookup", async () => {
    for (const authorization of [undefined, "Basic value", "Bearer malformed", "Bearer a.b.c, Bearer d.e.f"]) {
      const verifyAccessToken = vi.fn();
      const accept = vi.fn();
      await acceptInvitationCandidate(
        { invitationToken: "opaque-invitation-body-credential" },
        { authorizationHeader: () => authorization, verifyAccessToken, accept },
      ).then(
        () => { throw new Error("invalid candidate credential was accepted"); },
        (error: unknown) => {
          expect(error).toBeInstanceOf(APIError);
          expect(error).toMatchObject({ code: "unauthenticated" });
        },
      );
      expect(verifyAccessToken).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
    }
  });

  test("never converts a failed external verification into internal AuthData", async () => {
    const accept = vi.fn();
    await expect(acceptInvitationCandidate(
      { invitationToken: "opaque-invitation-body-credential" },
      {
        authorizationHeader: () => `Bearer ${VALID_TOKEN}`,
        verifyAccessToken: async () => { throw new Error("synthetic verification failure"); },
        accept,
      },
    )).rejects.toMatchObject({ code: "unauthenticated" });
    expect(accept).not.toHaveBeenCalled();
  });
});
