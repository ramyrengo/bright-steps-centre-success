import { describe, expect, test, vi } from "vitest";

import {
  createAuthenticatedCentreSuccessClient,
  createCentreSuccessAuth,
  parseEncoreApiBaseUrl,
} from "@/lib/centre-success-client";

describe("authenticated Centre Success client", () => {
  test("provides a fresh Entra API bearer token through generated Encore auth", async () => {
    const getToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first-api-access-token")
      .mockResolvedValueOnce("second-api-access-token");
    const auth = createCentreSuccessAuth(getToken);

    await expect(auth()).resolves.toEqual({
      authorization: "Bearer first-api-access-token",
    });
    await expect(auth()).resolves.toEqual({
      authorization: "Bearer second-api-access-token",
    });
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  test("fails closed instead of generating an unauthenticated request", async () => {
    const getToken = vi.fn<() => Promise<string>>().mockResolvedValue("  ");
    const auth = createCentreSuccessAuth(getToken);

    await expect(auth()).rejects.toThrow(
      "Centre Success access token is unavailable",
    );
  });

  test("lets the generated client own Authorization header transport", async () => {
    const getToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("centre-success-api-token");
    const baseFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        provisioningStatus: "provisioned",
        principal: {
          id: "00000000-0000-4000-8000-000000000001",
          displayName: "Synthetic Centre Director",
        },
        activeOrganisation: {
          id: "00000000-0000-4000-8000-000000000010",
          name: "Synthetic Bright Steps",
        },
      }),
    );
    const client = createAuthenticatedCentreSuccessClient(getToken, {
      baseUrl: "http://localhost:4000",
      fetcher: baseFetcher,
    });

    await client.foundation.me();

    expect(baseFetcher).toHaveBeenCalledOnce();
    expect(baseFetcher.mock.calls[0]?.[0]).toBe(
      "http://localhost:4000/foundation/me",
    );
    expect(
      new Headers(baseFetcher.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer centre-success-api-token");
    expect(baseFetcher.mock.calls[0]?.[1]?.credentials).toBeUndefined();
  });

  test.each([
    ["local hostname", "http://localhost:4000", "http://localhost:4000"],
    ["local IPv4", "http://127.0.0.1:4000/", "http://127.0.0.1:4000"],
    ["local IPv6", "http://[::1]:4000", "http://[::1]:4000"],
    [
      "production HTTPS",
      "https://api.example.test/",
      "https://api.example.test",
    ],
  ])("accepts an origin-only URL for %s", (_name, input, expected) => {
    expect(parseEncoreApiBaseUrl(input)).toBe(expected);
  });

  test.each([
    ["relative URL", "/foundation"],
    ["malformed URL", "not a URL"],
    ["insecure remote origin", "http://api.example.test"],
    ["lookalike loopback", "http://localhost.example.test:4000"],
    ["credentials", "https://operator:secret@api.example.test"],
    ["path", "https://api.example.test/foundation"],
    ["query", "https://api.example.test?organisation=synthetic"],
    ["fragment", "https://api.example.test#token"],
  ])("rejects a backend base URL containing %s", (_name, input) => {
    expect(() => parseEncoreApiBaseUrl(input)).toThrow();
  });

  test("rejects an invalid base URL before creating bearer auth transport", () => {
    const getToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("must-not-be-requested");
    const baseFetcher = vi.fn<typeof fetch>();

    expect(() =>
      createAuthenticatedCentreSuccessClient(getToken, {
        baseUrl: "http://api.example.test",
        fetcher: baseFetcher,
      }),
    ).toThrow("must use HTTPS except on an exact loopback host");
    expect(getToken).not.toHaveBeenCalled();
    expect(baseFetcher).not.toHaveBeenCalled();
  });
});
