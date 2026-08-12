import type { EnvironmentMeta } from "encore.dev";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  boundedInvitationRetryDelayMilliseconds,
  InvitationDeliveryError,
  type InvitationDeliveryRequest,
} from "./email";
import {
  GRAPH_PROVIDER_REFERENCE,
  GRAPH_SENDER_ADDRESS,
  GRAPH_SENDER_DISPLAY_NAME,
  MicrosoftGraphAccessTokenProvider,
  MicrosoftGraphInvitationEmailAdapter,
  createInvitationEmailAdapter,
  invitationEmailAdapterMode,
  renderStagingInvitationEmail,
  retryAfterMilliseconds,
  type InvitationEmailHttpTransport,
} from "./microsoft-graph-invitation-email";

const TENANT_ID = "27026100-3522-48b5-8e95-80230afc4127";
const CLIENT_ID = "5e8ce11c-ade3-4baa-82f6-351919b444ca";
const CLIENT_SECRET = "synthetic-unit-test-secret-never-a-real-credential";

const request: InvitationDeliveryRequest = {
  recipientEmail: "candidate@brightsteps.example",
  invitationUrl: "https://bright-steps-centre-success-staging.vercel.app/invitations/accept",
  invitationCode: "synthetic-invitation-code<&>",
  expiresAt: new Date("2026-08-15T12:00:00.000Z"),
  idempotencyKey: "synthetic-outbox-idempotency-key",
};

function tokenResponse(accessToken = "synthetic-access-token", expiresIn = 3_600): Response {
  return Response.json({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" });
}

function configuration() {
  return { tenantId: TENANT_ID, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
}

function environment(
  cloud: EnvironmentMeta["cloud"],
  name: string,
  type: EnvironmentMeta["type"],
): EnvironmentMeta {
  return { cloud, name, type };
}

function expectDeliveryError(
  error: unknown,
  errorClass: string,
  retryable: boolean,
): void {
  expect(error).toBeInstanceOf(InvitationDeliveryError);
  expect(error).toMatchObject({ errorClass, retryable });
  expect(String(error)).not.toContain(CLIENT_SECRET);
  expect(String(error)).not.toContain("synthetic-access-token");
}

afterEach(() => vi.restoreAllMocks());

describe("Microsoft Graph app-only token provider", () => {
  test("uses the exact tenant endpoint, client credentials scope, cache, refresh skew, and singleflight", async () => {
    let now = Date.parse("2026-08-12T00:00:00.000Z");
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const transport: InvitationEmailHttpTransport = async (input, init) => {
      calls.push({ input, init });
      await Promise.resolve();
      return tokenResponse(`synthetic-access-token-${calls.length}`, 120);
    };
    const provider = new MicrosoftGraphAccessTokenProvider(configuration(), transport, () => now);

    const [first, concurrent] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);
    expect(first).toBe("synthetic-access-token-1");
    expect(concurrent).toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    );
    expect(calls[0].init.method).toBe("POST");
    const body = calls[0].init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });

    expect(await provider.getAccessToken()).toBe(first);
    expect(calls).toHaveLength(1);
    now += 61_000;
    expect(await provider.getAccessToken()).toBe("synthetic-access-token-2");
    expect(calls).toHaveLength(2);
  });

  test.each([
    [401, "graph.authentication_configuration", false],
    [403, "graph.authentication_configuration", false],
    [429, "graph.token_rate_limited", true],
    [503, "graph.token_unavailable", true],
  ] as const)("classifies token endpoint status %i safely", async (status, errorClass, retryable) => {
    const provider = new MicrosoftGraphAccessTokenProvider(
      configuration(),
      async () => new Response("provider detail must not escape", {
        status,
        headers: status === 429 ? { "retry-after": "60" } : undefined,
      }),
    );
    try {
      await provider.getAccessToken();
      throw new Error("expected token acquisition to fail");
    } catch (error) {
      expectDeliveryError(error, errorClass, retryable);
      if (status === 429) expect(error).toMatchObject({ retryAfterMs: 60_000 });
    }
  });

  test("rejects malformed success payloads and configuration without exposing provider detail", async () => {
    const provider = new MicrosoftGraphAccessTokenProvider(
      configuration(),
      async () => Response.json({ access_token: "", expires_in: 3_600 }),
    );
    await expect(provider.getAccessToken()).rejects.toMatchObject({
      errorClass: "graph.authentication_configuration",
      retryable: false,
    });
    expect(() => new MicrosoftGraphAccessTokenProvider({
      tenantId: "common",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })).toThrowError(InvitationDeliveryError);
  });

  test.each([
    [undefined, 3_600],
    ["synthetic-access-token", undefined],
    ["synthetic-access-token", "3600"],
    ["synthetic-access-token", 60],
    ["synthetic-access-token", 0],
  ])("rejects invalid access token expiry payload %#", async (accessToken, expiresIn) => {
    const provider = new MicrosoftGraphAccessTokenProvider(
      configuration(),
      async () => Response.json({
        ...(accessToken === undefined ? {} : { access_token: accessToken }),
        ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
        token_type: "Bearer",
      }),
    );
    await expect(provider.getAccessToken()).rejects.toMatchObject({
      errorClass: "graph.authentication_configuration",
      retryable: false,
    });
  });

  test("classifies token timeout and non-abort network failures", async () => {
    const timeoutProvider = new MicrosoftGraphAccessTokenProvider(
      configuration(),
      (_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      Date.now,
      1,
    );
    await expect(timeoutProvider.getAccessToken()).rejects.toMatchObject({
      errorClass: "graph.token_timeout",
      retryable: true,
    });

    const networkProvider = new MicrosoftGraphAccessTokenProvider(
      configuration(),
      async () => { throw new Error("synthetic network failure"); },
    );
    await expect(networkProvider.getAccessToken()).rejects.toMatchObject({
      errorClass: "graph.network_failure",
      retryable: true,
    });
  });
});

describe("Microsoft Graph invitation email adapter", () => {
  test("sends one minimal branded staging message from the fixed mailbox and accepts only 202", async () => {
    const tokenProvider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => tokenResponse());
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const adapter = new MicrosoftGraphInvitationEmailAdapter(
      tokenProvider,
      async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 202 });
      },
    );

    await expect(adapter.deliverInvitation(request)).resolves.toEqual({
      providerReference: GRAPH_PROVIDER_REFERENCE,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(
      `https://graph.microsoft.com/v1.0/users/${GRAPH_SENDER_ADDRESS}/sendMail`,
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      authorization: "Bearer synthetic-access-token",
      "content-type": "application/json",
    });
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload).toMatchObject({
      message: {
        subject: expect.stringMatching(/STAGING/u),
        toRecipients: [{ emailAddress: { address: request.recipientEmail } }],
        replyTo: [{ emailAddress: { address: GRAPH_SENDER_ADDRESS, name: GRAPH_SENDER_DISPLAY_NAME } }],
      },
      saveToSentItems: false,
    });
    expect(payload.message).not.toHaveProperty("from");
    expect(payload.message.body.contentType).toBe("HTML");
    expect(payload.message.body.content).toContain("Access Centre Success");
    expect(payload.message.body.content).toContain("Microsoft account");
    expect(payload.message.body.content).toContain("Staging environment");
    expect(payload.message.body.content).toContain(request.invitationUrl);
    expect(payload.message.body.content).toContain("synthetic-invitation-code&lt;&amp;&gt;");
    expect(JSON.stringify(payload)).not.toMatch(/\brole\b|\bscope\b|\bpermission\b/iu);
    expect(JSON.stringify(payload)).not.toContain(request.idempotencyKey);
  });

  test.each([
    [401, "graph.authentication_configuration", false],
    [403, "graph.mailbox_authorization", true],
    [400, "graph.request_rejected", false],
    [429, "graph.rate_limited", true],
    [500, "graph.service_unavailable", true],
  ] as const)("classifies sendMail status %i without provider body leakage", async (status, errorClass, retryable) => {
    const tokenProvider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => tokenResponse());
    const adapter = new MicrosoftGraphInvitationEmailAdapter(
      tokenProvider,
      async () => new Response("sensitive provider response body", {
        status,
        headers: status === 429 ? { "retry-after": "120" } : undefined,
      }),
    );
    try {
      await adapter.deliverInvitation(request);
      throw new Error("expected sendMail to fail");
    } catch (error) {
      expectDeliveryError(error, errorClass, retryable);
      if (status === 429) expect(error).toMatchObject({ retryAfterMs: 120_000 });
    }
  });

  test("invalidates a cached token on 401, fetches once, and retries send once", async () => {
    let tokenCalls = 0;
    const provider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => {
      tokenCalls += 1;
      return tokenResponse(`synthetic-access-token-${tokenCalls}`);
    });
    expect(await provider.getAccessToken()).toBe("synthetic-access-token-1");
    const authorizations: string[] = [];
    const adapter = new MicrosoftGraphInvitationEmailAdapter(provider, async (_input, init) => {
      authorizations.push((init.headers as Record<string, string>).authorization);
      return new Response(null, { status: authorizations.length === 1 ? 401 : 202 });
    });
    await expect(adapter.deliverInvitation(request)).resolves.toEqual({
      providerReference: GRAPH_PROVIDER_REFERENCE,
    });
    expect(tokenCalls).toBe(2);
    expect(authorizations).toEqual([
      "Bearer synthetic-access-token-1",
      "Bearer synthetic-access-token-2",
    ]);
  });

  test("permanently fails after one fresh-token retry also returns 401", async () => {
    let tokenCalls = 0;
    let sendCalls = 0;
    const provider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => {
      tokenCalls += 1;
      return tokenResponse(`synthetic-access-token-${tokenCalls}`);
    });
    await provider.getAccessToken();
    const adapter = new MicrosoftGraphInvitationEmailAdapter(provider, async () => {
      sendCalls += 1;
      return new Response(null, { status: 401 });
    });
    await expect(adapter.deliverInvitation(request)).rejects.toMatchObject({
      errorClass: "graph.authentication_configuration",
      retryable: false,
    });
    expect(tokenCalls).toBe(2);
    expect(sendCalls).toBe(2);
  });

  test("does not poison token refresh after a failed refresh", async () => {
    let tokenCalls = 0;
    let sendCalls = 0;
    const provider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => {
      tokenCalls += 1;
      if (tokenCalls === 2) return new Response(null, { status: 503 });
      return tokenResponse(`synthetic-access-token-${tokenCalls}`);
    });
    await provider.getAccessToken();
    const adapter = new MicrosoftGraphInvitationEmailAdapter(provider, async () => {
      sendCalls += 1;
      return new Response(null, { status: sendCalls === 1 ? 401 : 202 });
    });
    await expect(adapter.deliverInvitation(request)).rejects.toMatchObject({
      errorClass: "graph.token_unavailable",
      retryable: true,
    });
    await expect(adapter.deliverInvitation(request)).resolves.toEqual({
      providerReference: GRAPH_PROVIDER_REFERENCE,
    });
    expect(tokenCalls).toBe(3);
    expect(sendCalls).toBe(2);
  });

  test("treats send timeout as retryable and ambiguous without logging secrets", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tokenProvider = new MicrosoftGraphAccessTokenProvider(configuration(), async () => tokenResponse());
    const adapter = new MicrosoftGraphInvitationEmailAdapter(
      tokenProvider,
      (_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      Date.now,
      1,
    );
    await expect(adapter.deliverInvitation(request)).rejects.toMatchObject({
      errorClass: "graph.send_timeout_ambiguous",
      retryable: true,
    });
    expect(log).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("escapes dynamic content and retains separate link and invitation-code semantics", () => {
    const html = renderStagingInvitationEmail({
      ...request,
      invitationUrl: 'https://example.test/?next=<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Invitation code:");
  });
});

describe("bounded Retry-After parsing", () => {
  const now = Date.parse("2026-08-12T00:00:00.000Z");
  test.each([
    ["120", 120_000],
    [new Date(now + 90_000).toUTCString(), 90_000],
    [new Date(now - 90_000).toUTCString(), 0],
    ["not-a-date", undefined],
    ["-1", undefined],
    ["NaN", undefined],
    ["999999999999999999999", 600_000],
  ])("parses and clamps %s", (value, expected) => {
    const response = new Response(null, { status: 429, headers: { "retry-after": value } });
    expect(retryAfterMilliseconds(response, now)).toBe(expected);
  });

  test("returns undefined when Retry-After is absent", () => {
    expect(retryAfterMilliseconds(new Response(null, { status: 429 }), now)).toBeUndefined();
  });

  test.each([
    [undefined, 10_000],
    [Number.NaN, 10_000],
    [Number.POSITIVE_INFINITY, 10_000],
    [-1, 10_000],
    [0, 1_000],
    [2_000, 2_000],
    [999_999_999, 600_000],
  ])("bounds scheduler delay %s", (value, expected) => {
    expect(boundedInvitationRetryDelayMilliseconds(value)).toBe(expected);
  });
});

describe("trusted environment selection", () => {
  test.each([
    [environment("local", "local", "development"), "development"],
    [environment("local", "test", "test"), "development"],
    [environment("encore", "staging", "development"), "microsoft_graph"],
    [environment("encore", "production", "production"), "disabled"],
    [environment("encore", "pr-123", "ephemeral"), "disabled"],
    [environment("encore", "another-development", "development"), "disabled"],
  ] as const)("selects %s as %s", (metadata, expected) => {
    expect(invitationEmailAdapterMode(metadata)).toBe(expected);
  });

  test("keeps local/test no-network and fails closed outside exact staging", async () => {
    const graphConfiguration = vi.fn(() => configuration());
    const local = createInvitationEmailAdapter(
      environment("local", "local", "development"),
      { graphConfiguration, graphTransport: vi.fn() },
    );
    await expect(local.deliverInvitation(request)).resolves.toMatchObject({
      providerReference: expect.stringMatching(/^development-noop:/u),
    });
    expect(graphConfiguration).not.toHaveBeenCalled();

    expect(() => createInvitationEmailAdapter(
      environment("encore", "production", "production"),
      { graphConfiguration },
    )).toThrowError(expect.objectContaining({ errorClass: "email.delivery_disabled" }));
    expect(graphConfiguration).not.toHaveBeenCalled();
  });
});
