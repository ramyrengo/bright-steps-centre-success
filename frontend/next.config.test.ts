import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("the MSAL redirect bridge response headers", () => {
  test("disable caching without setting Cross-Origin-Opener-Policy", async () => {
    const routes = await nextConfig.headers?.();
    const redirect = routes?.find((route) => route.source === "/redirect");

    expect(redirect?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-store, max-age=0, must-revalidate",
    });
    expect(redirect?.headers).toContainEqual({
      key: "Referrer-Policy",
      value: "no-referrer",
    });
    expect(
      redirect?.headers.some(
        (header) => header.key.toLowerCase() === "cross-origin-opener-policy",
      ),
    ).toBe(false);
  });
});
