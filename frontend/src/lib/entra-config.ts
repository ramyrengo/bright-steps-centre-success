import {
  BrowserCacheLocation,
  createStandardPublicClientApplication,
  type Configuration,
  type IPublicClientApplication,
} from "@azure/msal-browser";

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export interface EntraEnvironmentInput {
  tenantId?: string;
  webClientId?: string;
  apiClientId?: string;
  redirectUri?: string;
  postLogoutRedirectUri?: string;
}

export interface EntraPublicConfig {
  tenantId: string;
  webClientId: string;
  apiClientId: string;
  authority: string;
  apiScope: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
}

function requiredGuid(value: string | undefined, name: string): string {
  const candidate = value?.trim().toLowerCase();

  if (!candidate || !GUID_PATTERN.test(candidate) || candidate === ZERO_GUID) {
    throw new Error(`${name} must be a valid GUID`);
  }

  return candidate;
}

function requiredApplicationUrl(
  value: string | undefined,
  name: string,
): URL {
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error(`${name} must use HTTPS except on loopback development hosts`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }

  return url;
}

export function parseEntraPublicConfig(
  input: EntraEnvironmentInput,
): EntraPublicConfig {
  const tenantId = requiredGuid(input.tenantId, "NEXT_PUBLIC_ENTRA_TENANT_ID");
  const webClientId = requiredGuid(
    input.webClientId,
    "NEXT_PUBLIC_ENTRA_WEB_CLIENT_ID",
  );
  const apiClientId = requiredGuid(
    input.apiClientId,
    "NEXT_PUBLIC_ENTRA_API_CLIENT_ID",
  );
  const redirectUri = requiredApplicationUrl(
    input.redirectUri,
    "NEXT_PUBLIC_ENTRA_REDIRECT_URI",
  );
  const postLogoutRedirectUri = requiredApplicationUrl(
    input.postLogoutRedirectUri,
    "NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI",
  );

  if (webClientId === apiClientId) {
    throw new Error("Entra Web and API client IDs must be different");
  }

  if (redirectUri.pathname !== "/redirect") {
    throw new Error("NEXT_PUBLIC_ENTRA_REDIRECT_URI must target /redirect");
  }

  if (postLogoutRedirectUri.pathname !== "/") {
    throw new Error(
      "NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI must target the application root",
    );
  }

  if (redirectUri.origin !== postLogoutRedirectUri.origin) {
    throw new Error("Entra redirect and post-logout URLs must share one origin");
  }

  return {
    tenantId,
    webClientId,
    apiClientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    apiScope: `api://${apiClientId}/access_as_user`,
    redirectUri: redirectUri.toString(),
    postLogoutRedirectUri: postLogoutRedirectUri.toString(),
  };
}

export function readEntraPublicConfig(): EntraPublicConfig {
  return parseEntraPublicConfig({
    tenantId: process.env.NEXT_PUBLIC_ENTRA_TENANT_ID,
    webClientId: process.env.NEXT_PUBLIC_ENTRA_WEB_CLIENT_ID,
    apiClientId: process.env.NEXT_PUBLIC_ENTRA_API_CLIENT_ID,
    redirectUri: process.env.NEXT_PUBLIC_ENTRA_REDIRECT_URI,
    postLogoutRedirectUri:
      process.env.NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI,
  });
}

export function createMsalConfiguration(
  config: EntraPublicConfig,
): Configuration {
  return {
    auth: {
      clientId: config.webClientId,
      authority: config.authority,
      redirectUri: config.redirectUri,
      postLogoutRedirectUri: config.postLogoutRedirectUri,
    },
    cache: {
      cacheLocation: BrowserCacheLocation.SessionStorage,
    },
    system: {
      loggerOptions: {
        piiLoggingEnabled: false,
      },
    },
  };
}

let cachedClient:
  | {
      fingerprint: string;
      promise: Promise<IPublicClientApplication>;
    }
  | undefined;

export function getMsalBrowserClient(
  config: EntraPublicConfig,
): Promise<IPublicClientApplication> {
  const fingerprint = [
    config.tenantId,
    config.webClientId,
    config.redirectUri,
    config.postLogoutRedirectUri,
  ].join("|");

  if (cachedClient?.fingerprint === fingerprint) {
    return cachedClient.promise;
  }

  const promise = createStandardPublicClientApplication(
    createMsalConfiguration(config),
  );
  cachedClient = { fingerprint, promise };
  return promise;
}
