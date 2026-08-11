import { randomUUID } from "node:crypto";
import { APIError } from "encore.dev/api";
import { describe, expect, test, vi } from "vitest";
import { AuthenticatedPrincipalContextError } from "./authentication/principal-context";
import { health, loadFoundationMe } from "./api";

describe("foundation health API", () => {
  test("reports the Encore backend and PostgreSQL as available", async () => {
    const response = await health();

    expect(response).toMatchObject({
      status: "operational",
      milestone: "1",
      backend: "connected",
      database: "available",
    });
    expect(Number.isNaN(Date.parse(response.checkedAt))).toBe(false);
  });
});

describe("protected foundation identity API", () => {
  test("returns only a safe internal identity and active organisation projection", async () => {
    const principalId = randomUUID();
    const organisationId = randomUUID();
    const membershipId = randomUUID();
    const loadPrincipalContext = vi.fn().mockResolvedValue({
      provisioningStatus: "provisioned",
      principal: {
        id: principalId,
        displayName: "Synthetic authenticated principal",
      },
      activeOrganisation: {
        id: organisationId,
        name: "Synthetic active organisation",
      },
      authorisation: {
        principalId,
        principalStatus: "active",
        activeOrganisationId: organisationId,
        memberships: [
          {
            id: membershipId,
            principalId,
            organisationId,
            status: "active",
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        assignments: [
          {
            id: randomUUID(),
            organisationId,
            membershipId,
            roleKey: "centre_director",
            capabilities: ["centre.read"],
            scopes: [{ type: "organisation" }],
            status: "active",
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      },
    });

    const response = await loadFoundationMe({
      getTrustedAuthData: () => ({ userID: principalId }),
      loadPrincipalContext,
    });

    expect(loadPrincipalContext).toHaveBeenCalledWith(principalId);
    expect(response).toEqual({
      provisioningStatus: "provisioned",
      principal: {
        id: principalId,
        displayName: "Synthetic authenticated principal",
      },
      activeOrganisation: {
        id: organisationId,
        name: "Synthetic active organisation",
      },
    });
    expect(JSON.stringify(response)).not.toContain("centre.read");
    expect(JSON.stringify(response)).not.toContain("centre_director");
  });

  test("returns only not_provisioned for an active identity with zero memberships", async () => {
    const principalId = randomUUID();

    const response = await loadFoundationMe({
      getTrustedAuthData: () => ({ userID: principalId }),
      loadPrincipalContext: vi.fn().mockResolvedValue({
        provisioningStatus: "not_provisioned",
      }),
    });

    expect(response).toEqual({ provisioningStatus: "not_provisioned" });
    expect(Object.keys(response)).toEqual(["provisioningStatus"]);
  });

  test("rejects an absent trusted authentication context", async () => {
    const loadPrincipalContext = vi.fn();

    await loadFoundationMe({
      getTrustedAuthData: () => undefined,
      loadPrincipalContext,
    }).then(
      () => {
        throw new Error("missing authentication unexpectedly reached the endpoint");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(APIError);
        expect(error).toMatchObject({ code: "unauthenticated" });
      },
    );

    expect(loadPrincipalContext).not.toHaveBeenCalled();
  });

  test("denies an authenticated principal with ambiguous tenant context", async () => {
    const principalId = randomUUID();

    await loadFoundationMe({
      getTrustedAuthData: () => ({ userID: principalId }),
      loadPrincipalContext: vi
        .fn()
        .mockRejectedValue(
          new AuthenticatedPrincipalContextError("active_organisation_ambiguous"),
        ),
    }).then(
      () => {
        throw new Error("ambiguous tenant context unexpectedly reached the endpoint");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(APIError);
        expect(error).toMatchObject({
          code: "permission_denied",
          message: "Centre Success access is not available",
          details: { reason: "access_denied" },
        });
      },
    );
  });
});
