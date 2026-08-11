"use client";

import { useMemo } from "react";

import { useCentreSuccessAuthentication } from "./centre-success-authentication";

import Client, {
  Local,
  type BaseURL,
  type AuthDataGenerator,
  type Fetcher,
} from "./client.generated";

export type AccessTokenProvider = () => Promise<string>;

export interface AuthenticatedClientOptions {
  baseUrl?: BaseURL;
  fetcher?: Fetcher;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseEncoreApiBaseUrl(value: string): BaseURL {
  const candidate = value.trim();
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error("NEXT_PUBLIC_ENCORE_API_URL must be an absolute URL");
  }

  if (url.username || url.password) {
    throw new Error("NEXT_PUBLIC_ENCORE_API_URL must not contain credentials");
  }

  if (candidate.includes("?") || candidate.includes("#")) {
    throw new Error(
      "NEXT_PUBLIC_ENCORE_API_URL must not contain a query or fragment",
    );
  }

  if (url.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_ENCORE_API_URL must be an origin without a path");
  }

  const isHttpLoopback =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !isHttpLoopback) {
    throw new Error(
      "NEXT_PUBLIC_ENCORE_API_URL must use HTTPS except on an exact loopback host",
    );
  }

  return url.origin;
}

export function createCentreSuccessAuth(
  getAccessToken: AccessTokenProvider,
): AuthDataGenerator {
  return async () => {
    const token = await getAccessToken();

    if (!token.trim()) {
      throw new Error("Centre Success access token is unavailable");
    }

    return { authorization: `Bearer ${token}` };
  };
}

export function createAuthenticatedCentreSuccessClient(
  getAccessToken: AccessTokenProvider,
  options: AuthenticatedClientOptions = {},
) {
  const baseUrl = parseEncoreApiBaseUrl(
    options.baseUrl ?? process.env.NEXT_PUBLIC_ENCORE_API_URL ?? Local,
  );

  return new Client(baseUrl, {
    auth: createCentreSuccessAuth(getAccessToken),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
}

export function useAuthenticatedCentreSuccessClient() {
  const { getAccessToken } = useCentreSuccessAuthentication();

  return useMemo(
    () => createAuthenticatedCentreSuccessClient(getAccessToken),
    [getAccessToken],
  );
}
