"use client";

import {
  EventType,
  InteractionRequiredAuthError,
  InteractionStatus,
  type AccountInfo,
  type EventMessage,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getMsalBrowserClient,
  readEntraPublicConfig,
  type EntraPublicConfig,
} from "./entra-config";

export type CentreSuccessAuthenticationState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "account-selection-required" }
  | { kind: "signed-in"; accountKey: string }
  | { kind: "unavailable" };

export type AccountResolution =
  | { kind: "signed-out" }
  | { kind: "select-single-account"; account: AccountInfo }
  | { kind: "account-selection-required" }
  | { kind: "signed-in"; account: AccountInfo };

export class AuthenticationFlowTransitionError extends Error {
  constructor() {
    super("Authentication interaction is in progress");
    this.name = "AuthenticationFlowTransitionError";
  }
}

export class AuthenticationUnavailableError extends Error {
  constructor() {
    super("Authentication is unavailable");
    this.name = "AuthenticationUnavailableError";
  }
}

export function isAuthenticationFlowTransitionError(
  error: unknown,
): error is AuthenticationFlowTransitionError {
  return error instanceof AuthenticationFlowTransitionError;
}

function normalise(value: string): string {
  return value.toLowerCase();
}

function sameAccount(left: AccountInfo, right: AccountInfo): boolean {
  return (
    normalise(left.homeAccountId) === normalise(right.homeAccountId) &&
    normalise(left.localAccountId) === normalise(right.localAccountId) &&
    normalise(left.tenantId) === normalise(right.tenantId)
  );
}

function isAccountInfo(value: unknown): value is AccountInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AccountInfo>;
  return (
    typeof candidate.homeAccountId === "string" &&
    candidate.homeAccountId.length > 0 &&
    typeof candidate.localAccountId === "string" &&
    candidate.localAccountId.length > 0 &&
    typeof candidate.environment === "string" &&
    candidate.environment.length > 0 &&
    typeof candidate.tenantId === "string" &&
    candidate.tenantId.length > 0 &&
    typeof candidate.username === "string"
  );
}

function loginSuccessAccount(message: EventMessage): AccountInfo | null {
  if (message.eventType !== EventType.LOGIN_SUCCESS || !message.payload) {
    return null;
  }

  // MSAL Browser v5 emits AccountInfo directly for LOGIN_SUCCESS. Treat any
  // other payload shape as an authentication failure instead of accepting the
  // pre-v5 AuthenticationResult shape.
  return isAccountInfo(message.payload) ? message.payload : null;
}

export function resolveCentreSuccessAccount(
  accounts: AccountInfo[],
  activeAccount: AccountInfo | null,
  tenantId: string,
): AccountResolution {
  const expectedTenantId = normalise(tenantId);

  if (activeAccount) {
    if (normalise(activeAccount.tenantId) !== expectedTenantId) {
      return { kind: "account-selection-required" };
    }

    const cachedActiveAccount = accounts.find((account) =>
      sameAccount(account, activeAccount),
    );

    if (cachedActiveAccount) {
      return { kind: "signed-in", account: cachedActiveAccount };
    }
  }

  if (accounts.length === 0) {
    return { kind: "signed-out" };
  }

  if (
    accounts.some((account) => normalise(account.tenantId) !== expectedTenantId)
  ) {
    return { kind: "account-selection-required" };
  }

  if (accounts.length === 1) {
    const [onlyAccount] = accounts;
    return { kind: "select-single-account", account: onlyAccount };
  }

  return { kind: "account-selection-required" };
}

interface CentreSuccessAuthenticationContextValue {
  state: CentreSuccessAuthenticationState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
}

const CentreSuccessAuthenticationContext =
  createContext<CentreSuccessAuthenticationContextValue | null>(null);

export function useCentreSuccessAuthentication(): CentreSuccessAuthenticationContextValue {
  const context = useContext(CentreSuccessAuthenticationContext);

  if (!context) {
    throw new Error(
      "useCentreSuccessAuthentication must be used inside EntraAuthenticationProvider",
    );
  }

  return context;
}

function AuthenticationStartup({
  unavailable = false,
}: Readonly<{
  unavailable?: boolean;
}>) {
  return (
    <main className="foundation-shell">
      <section className="auth-panel" aria-labelledby="auth-startup-title">
        <header className="auth-heading">
          <p className="foundation-eyebrow">Bright Steps</p>
          <h1 id="auth-startup-title" className="auth-title">
            Centre Success
          </h1>
        </header>
        <p className="auth-state-message" role="status" aria-live="polite">
          {unavailable
            ? "Secure sign-in is temporarily unavailable."
            : "Preparing secure sign-in…"}
        </p>
      </section>
    </main>
  );
}

export function CentreSuccessAuthenticationStateProvider({
  config,
  children,
}: Readonly<{
  config: EntraPublicConfig;
  children: React.ReactNode;
}>) {
  const { instance, accounts, inProgress } = useMsal();
  const [selectedAccount, setSelectedAccount] = useState<AccountInfo | null>(
    () => instance.getActiveAccount(),
  );
  const [operationFailed, setOperationFailed] = useState(false);
  const interactionRedirect = useRef<Promise<void> | null>(null);

  const accountResolution = useMemo(
    () =>
      resolveCentreSuccessAccount(
        accounts,
        selectedAccount ?? instance.getActiveAccount(),
        config.tenantId,
      ),
    [accounts, config.tenantId, instance, selectedAccount],
  );

  useEffect(() => {
    const callbackId = instance.addEventCallback(
      (message) => {
        const account = loginSuccessAccount(message);
        if (!account) {
          setOperationFailed(true);
          return;
        }

        if (normalise(account.tenantId) !== normalise(config.tenantId)) {
          instance.setActiveAccount(null);
          setSelectedAccount(null);
          setOperationFailed(true);
          return;
        }

        instance.setActiveAccount(account);
        setSelectedAccount(account);
        setOperationFailed(false);
      },
      [EventType.LOGIN_SUCCESS],
    );

    return () => {
      if (callbackId) {
        instance.removeEventCallback(callbackId);
      }
    };
  }, [config.tenantId, instance]);

  useEffect(() => {
    if (inProgress !== InteractionStatus.None) {
      return;
    }

    const activeAccount = instance.getActiveAccount();
    if (
      activeAccount &&
      !accounts.some((account) => sameAccount(account, activeAccount))
    ) {
      instance.setActiveAccount(null);
    }

    if (accountResolution.kind === "select-single-account") {
      instance.setActiveAccount(accountResolution.account);
    }
  }, [accountResolution, accounts, inProgress, instance]);

  const state = useMemo<CentreSuccessAuthenticationState>(() => {
    if (operationFailed) {
      return { kind: "unavailable" };
    }

    if (
      inProgress !== InteractionStatus.None
    ) {
      return { kind: "loading" };
    }

    switch (accountResolution.kind) {
      case "signed-out":
        return { kind: "signed-out" };
      case "account-selection-required":
        return { kind: "account-selection-required" };
      case "select-single-account":
      case "signed-in":
        return {
          kind: "signed-in",
          accountKey: `${accountResolution.account.homeAccountId}:${accountResolution.account.localAccountId}`,
        };
    }
  }, [accountResolution, inProgress, operationFailed]);

  const signIn = useCallback(async () => {
    if (inProgress !== InteractionStatus.None) {
      return;
    }

    setOperationFailed(false);
    try {
      await instance.loginRedirect({
        scopes: [config.apiScope],
        ...(accountResolution.kind === "account-selection-required"
          ? { prompt: "select_account" }
          : {}),
      });
    } catch {
      setOperationFailed(true);
    }
  }, [accountResolution.kind, config.apiScope, inProgress, instance]);

  const signOut = useCallback(async () => {
    if (inProgress !== InteractionStatus.None) {
      return;
    }

    setOperationFailed(false);
    try {
      await instance.logoutRedirect({
        ...(accountResolution.kind === "signed-in" ||
        accountResolution.kind === "select-single-account"
          ? { account: accountResolution.account }
          : {}),
        postLogoutRedirectUri: config.postLogoutRedirectUri,
      });
    } catch {
      setOperationFailed(true);
    }
  }, [accountResolution, config.postLogoutRedirectUri, inProgress, instance]);

  const getAccessToken = useCallback(async () => {
    if (
      inProgress !== InteractionStatus.None ||
      (accountResolution.kind !== "signed-in" &&
        accountResolution.kind !== "select-single-account")
    ) {
      throw new AuthenticationFlowTransitionError();
    }

    const request = {
      scopes: [config.apiScope],
      account: accountResolution.account,
    };

    try {
      const result = await instance.acquireTokenSilent(request);
      if (!result.accessToken) {
        throw new AuthenticationUnavailableError();
      }
      return result.accessToken;
    } catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) {
        throw error;
      }

      if (interactionRedirect.current) {
        await interactionRedirect.current;
        throw new AuthenticationFlowTransitionError();
      }

      const redirect = instance.acquireTokenRedirect(request);
      interactionRedirect.current = redirect;

      try {
        await redirect;
      } catch {
        setOperationFailed(true);
        throw new AuthenticationUnavailableError();
      } finally {
        interactionRedirect.current = null;
      }

      throw new AuthenticationFlowTransitionError();
    }
  }, [accountResolution, config.apiScope, inProgress, instance]);

  const value = useMemo<CentreSuccessAuthenticationContextValue>(
    () => ({ state, signIn, signOut, getAccessToken }),
    [getAccessToken, signIn, signOut, state],
  );

  return (
    <CentreSuccessAuthenticationContext.Provider value={value}>
      {children}
    </CentreSuccessAuthenticationContext.Provider>
  );
}

type AuthenticationBootstrapState =
  | { kind: "loading" }
  | {
      kind: "ready";
      config: EntraPublicConfig;
      instance: IPublicClientApplication;
    }
  | { kind: "unavailable" };

export function EntraAuthenticationProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [bootstrap, setBootstrap] = useState<AuthenticationBootstrapState>({
    kind: "loading",
  });

  useEffect(() => {
    let isCurrent = true;
    let startup: Promise<AuthenticationBootstrapState>;

    try {
      const config = readEntraPublicConfig();
      startup = getMsalBrowserClient(config).then((instance) => ({
        kind: "ready" as const,
        config,
        instance,
      }));
    } catch {
      startup = Promise.resolve({ kind: "unavailable" });
    }

    void startup.then(
      (nextBootstrap) => {
        if (isCurrent) {
          setBootstrap(nextBootstrap);
        }
      },
      () => {
        if (isCurrent) {
          setBootstrap({ kind: "unavailable" });
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, []);

  if (bootstrap.kind === "loading") {
    return <AuthenticationStartup />;
  }

  if (bootstrap.kind === "unavailable") {
    return <AuthenticationStartup unavailable />;
  }

  return (
    <MsalProvider instance={bootstrap.instance}>
      <CentreSuccessAuthenticationStateProvider config={bootstrap.config}>
        {children}
      </CentreSuccessAuthenticationStateProvider>
    </MsalProvider>
  );
}
