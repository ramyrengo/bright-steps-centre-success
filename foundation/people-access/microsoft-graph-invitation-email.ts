import type { EnvironmentMeta } from "encore.dev";
import {
  DevelopmentInvitationEmailAdapter,
  InvitationDeliveryError,
  type InvitationDeliveryRequest,
  type InvitationDeliveryResult,
  type InvitationEmailAdapter,
} from "./email";

export const GRAPH_SENDER_ADDRESS = "centresuccess@brightstepsacademy.com.au";
export const GRAPH_SENDER_DISPLAY_NAME = "Bright Steps Centre Success";
export const GRAPH_PROVIDER_REFERENCE = "microsoft-graph:accepted";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_TOKEN_TIMEOUT_MS = 5_000;
const GRAPH_SEND_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_RETRY_AFTER_MS = 10 * 60_000;

export type InvitationEmailAdapterMode = "development" | "microsoft_graph" | "disabled";
export type InvitationEmailHttpTransport = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface MicrosoftGraphClientConfiguration {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface CachedAccessToken {
  value: string;
  expiresAtMs: number;
}

interface AccessTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function validateClientConfiguration(
  configuration: MicrosoftGraphClientConfiguration,
): MicrosoftGraphClientConfiguration {
  const tenantId = configuration.tenantId.trim().toLowerCase();
  const clientId = configuration.clientId.trim().toLowerCase();
  if (!isGuid(tenantId) || !isGuid(clientId) || configuration.clientSecret.length < 1) {
    throw new InvitationDeliveryError("graph.authentication_configuration", false);
  }
  return { tenantId, clientId, clientSecret: configuration.clientSecret };
}

export function retryAfterMilliseconds(response: Response, nowMs: number): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/u.test(value)) {
    return Math.min(Number(value) * 1_000, MAX_RETRY_AFTER_MS);
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(value)) {
    return undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(date - nowMs, 0), MAX_RETRY_AFTER_MS);
}

function networkFailure(errorClass: string): InvitationDeliveryError {
  return new InvitationDeliveryError(errorClass, true);
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A transport-level cleanup failure must not replace the reviewed safe
    // classification for the provider response.
  }
}

async function requestWithTimeout(
  transport: InvitationEmailHttpTransport,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutErrorClass: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await transport(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw networkFailure(timeoutErrorClass);
    }
    throw networkFailure("graph.network_failure");
  } finally {
    clearTimeout(timeout);
  }
}

export class MicrosoftGraphAccessTokenProvider {
  private cachedToken?: CachedAccessToken;
  private inflight?: Promise<string>;
  private readonly configuration: MicrosoftGraphClientConfiguration;

  constructor(
    configuration: MicrosoftGraphClientConfiguration,
    private readonly transport: InvitationEmailHttpTransport = fetch,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = GRAPH_TOKEN_TIMEOUT_MS,
  ) {
    this.configuration = validateClientConfiguration(configuration);
  }

  async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      this.now() < this.cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS
    ) {
      return this.cachedToken.value;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchAccessToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  invalidate(): void {
    this.cachedToken = undefined;
  }

  private async fetchAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      grant_type: "client_credentials",
      scope: GRAPH_SCOPE,
    });
    const response = await requestWithTimeout(
      this.transport,
      `https://login.microsoftonline.com/${this.configuration.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      this.timeoutMs,
      "graph.token_timeout",
    );
    if (!response.ok) {
      await discardResponseBody(response);
      if (response.status === 429 || response.status >= 500) {
        throw new InvitationDeliveryError(
          response.status === 429 ? "graph.token_rate_limited" : "graph.token_unavailable",
          true,
          retryAfterMilliseconds(response, this.now()),
        );
      }
      throw new InvitationDeliveryError("graph.authentication_configuration", false);
    }

    let payload: AccessTokenResponse;
    try {
      payload = (await response.json()) as AccessTokenResponse;
    } catch {
      throw new InvitationDeliveryError("graph.authentication_configuration", false);
    }
    if (
      typeof payload.access_token !== "string" ||
      payload.access_token.length < 1 ||
      typeof payload.expires_in !== "number" ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 60 ||
      (payload.token_type !== undefined && payload.token_type !== "Bearer")
    ) {
      throw new InvitationDeliveryError("graph.authentication_configuration", false);
    }
    this.cachedToken = {
      value: payload.access_token,
      expiresAtMs: this.now() + payload.expires_in * 1_000,
    };
    return payload.access_token;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderStagingInvitationEmail(request: InvitationDeliveryRequest): string {
  const invitationUrl = escapeHtml(request.invitationUrl);
  const invitationCode = escapeHtml(request.invitationCode);
  const expiresAt = escapeHtml(request.expiresAt.toISOString());
  return `<!doctype html>
<html lang="en"><body style="font-family:Arial,sans-serif;color:#17213b;line-height:1.5">
<h1 style="font-size:22px">Bright Steps Centre Success</h1>
<p><strong>Staging environment invitation</strong></p>
<p>You have been invited to access Bright Steps Centre Success. Sign in with your approved Bright Steps Microsoft account.</p>
<p><a href="${invitationUrl}" style="background:#2446a8;color:#fff;padding:12px 18px;text-decoration:none;border-radius:4px">Access Centre Success</a></p>
<p>Invitation code: <strong>${invitationCode}</strong></p>
<p>This invitation expires at ${expiresAt}.</p>
<p>For help, reply to this email or contact ${GRAPH_SENDER_ADDRESS}.</p>
</body></html>`;
}

export class MicrosoftGraphInvitationEmailAdapter implements InvitationEmailAdapter {
  constructor(
    private readonly tokenProvider: MicrosoftGraphAccessTokenProvider,
    private readonly transport: InvitationEmailHttpTransport = fetch,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = GRAPH_SEND_TIMEOUT_MS,
  ) {}

  async deliverInvitation(request: InvitationDeliveryRequest): Promise<InvitationDeliveryResult> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.sendInvitation(request, accessToken);
    if (response.status === 401) {
      await discardResponseBody(response);
      this.tokenProvider.invalidate();
      accessToken = await this.tokenProvider.getAccessToken();
      response = await this.sendInvitation(request, accessToken);
    }

    if (response.status === 202) {
      await discardResponseBody(response);
      return { providerReference: GRAPH_PROVIDER_REFERENCE };
    }
    await discardResponseBody(response);
    if (response.status === 401) {
      this.tokenProvider.invalidate();
      throw new InvitationDeliveryError("graph.authentication_configuration", false);
    }
    if (response.status === 403) {
      this.tokenProvider.invalidate();
      throw new InvitationDeliveryError("graph.mailbox_authorization", true);
    }
    if (response.status === 429) {
      throw new InvitationDeliveryError(
        "graph.rate_limited",
        true,
        retryAfterMilliseconds(response, this.now()),
      );
    }
    if (response.status >= 500) {
      throw new InvitationDeliveryError(
        "graph.service_unavailable",
        true,
        retryAfterMilliseconds(response, this.now()),
      );
    }
    throw new InvitationDeliveryError("graph.request_rejected", false);
  }

  private sendInvitation(
    request: InvitationDeliveryRequest,
    accessToken: string,
  ): Promise<Response> {
    return requestWithTimeout(
      this.transport,
      `https://graph.microsoft.com/v1.0/users/${GRAPH_SENDER_ADDRESS}/sendMail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: "[STAGING] Your Bright Steps Centre Success invitation",
            body: {
              contentType: "HTML",
              content: renderStagingInvitationEmail(request),
            },
            toRecipients: [
              { emailAddress: { address: request.recipientEmail } },
            ],
            replyTo: [
              {
                emailAddress: {
                  address: GRAPH_SENDER_ADDRESS,
                  name: GRAPH_SENDER_DISPLAY_NAME,
                },
              },
            ],
          },
          saveToSentItems: false,
        }),
      },
      this.timeoutMs,
      "graph.send_timeout_ambiguous",
    );
  }
}

export function invitationEmailAdapterMode(environment: EnvironmentMeta): InvitationEmailAdapterMode {
  if (environment.cloud === "local" || environment.type === "test") return "development";
  if (
    environment.cloud === "encore" &&
    environment.name === "staging" &&
    environment.type === "development"
  ) {
    return "microsoft_graph";
  }
  return "disabled";
}

export function createInvitationEmailAdapter(
  environment: EnvironmentMeta,
  dependencies: {
    graphConfiguration?: () => MicrosoftGraphClientConfiguration;
    graphTransport?: InvitationEmailHttpTransport;
    now?: () => number;
  } = {},
): InvitationEmailAdapter {
  const mode = invitationEmailAdapterMode(environment);
  if (mode === "development") return new DevelopmentInvitationEmailAdapter();
  if (mode === "disabled") {
    throw new InvitationDeliveryError("email.delivery_disabled", false);
  }
  if (!dependencies.graphConfiguration) {
    throw new InvitationDeliveryError("graph.authentication_configuration", false);
  }
  let configuration: MicrosoftGraphClientConfiguration;
  try {
    configuration = dependencies.graphConfiguration();
  } catch {
    throw new InvitationDeliveryError("graph.authentication_configuration", false);
  }
  const tokenProvider = new MicrosoftGraphAccessTokenProvider(
    configuration,
    dependencies.graphTransport,
    dependencies.now,
  );
  return new MicrosoftGraphInvitationEmailAdapter(
    tokenProvider,
    dependencies.graphTransport,
    dependencies.now,
  );
}
