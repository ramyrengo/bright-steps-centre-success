import { BrowserCacheLocation } from "@azure/msal-browser";
import { describe, expect, test } from "vitest";

import {
  createMsalConfiguration,
  parseEntraPublicConfig,
} from "@/lib/entra-config";

const validInput = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  webClientId: "22222222-2222-2222-2222-222222222222",
  apiClientId: "33333333-3333-3333-3333-333333333333",
  redirectUri: "http://localhost:3000/redirect",
  postLogoutRedirectUri: "http://localhost:3000/",
};

describe("Microsoft Entra public configuration", () => {
  test("derives the single-tenant authority and exact Centre Success API scope", () => {
    const config = parseEntraPublicConfig(validInput);

    expect(config.authority).toBe(
      "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111",
    );
    expect(config.apiScope).toBe(
      "api://33333333-3333-3333-3333-333333333333/access_as_user",
    );
    expect(config.redirectUri).toBe("http://localhost:3000/redirect");
    expect(config.postLogoutRedirectUri).toBe("http://localhost:3000/");
    expect(JSON.stringify(config).toLowerCase()).not.toContain(
      "graph.microsoft.com",
    );
    expect(JSON.stringify(config)).not.toContain("User.Read");
  });

  test("uses only MSAL session storage for browser token caching", () => {
    const publicConfig = parseEntraPublicConfig(validInput);
    const msalConfig = createMsalConfiguration(publicConfig);

    expect(msalConfig.auth).toEqual({
      clientId: validInput.webClientId,
      authority:
        "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111",
      redirectUri: validInput.redirectUri,
      postLogoutRedirectUri: validInput.postLogoutRedirectUri,
    });
    expect(msalConfig.cache?.cacheLocation).toBe(
      BrowserCacheLocation.SessionStorage,
    );
    expect(msalConfig.system?.loggerOptions?.piiLoggingEnabled).toBe(false);
  });

  test.each([
    {
      name: "missing tenant",
      input: { ...validInput, tenantId: "" },
    },
    {
      name: "non-GUID Web client",
      input: { ...validInput, webClientId: "not-a-guid" },
    },
    {
      name: "all-zero API client",
      input: {
        ...validInput,
        apiClientId: "00000000-0000-0000-0000-000000000000",
      },
    },
    {
      name: "same Web and API registration",
      input: { ...validInput, webClientId: validInput.apiClientId },
    },
    {
      name: "non-bridge callback",
      input: { ...validInput, redirectUri: "http://localhost:3000/" },
    },
    {
      name: "cross-origin logout",
      input: {
        ...validInput,
        postLogoutRedirectUri: "https://example.test/",
      },
    },
    {
      name: "insecure non-loopback callback",
      input: {
        ...validInput,
        redirectUri: "http://example.test/redirect",
        postLogoutRedirectUri: "http://example.test/",
      },
    },
  ])("fails closed for $name", ({ input }) => {
    expect(() => parseEntraPublicConfig(input)).toThrow();
  });
});
