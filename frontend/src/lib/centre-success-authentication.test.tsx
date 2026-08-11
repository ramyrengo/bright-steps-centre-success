import {
  EventType,
  InteractionRequiredAuthError,
  InteractionStatus,
  Logger,
  stubbedPublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type EventCallbackFunction,
  type EventMessage,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

const msalReactMocks = vi.hoisted(() => ({
  useMsal: vi.fn(),
}));

vi.mock("@azure/msal-react", () => ({
  MsalProvider: ({ children }: { children: ReactNode }) => children,
  useMsal: msalReactMocks.useMsal,
}));

import {
  AuthenticationFlowTransitionError,
  CentreSuccessAuthenticationStateProvider,
  resolveCentreSuccessAccount,
  useCentreSuccessAuthentication,
} from "@/lib/centre-success-authentication";
import { parseEntraPublicConfig } from "@/lib/entra-config";

const tenantId = "11111111-1111-1111-1111-111111111111";
const config = parseEntraPublicConfig({
  tenantId,
  webClientId: "22222222-2222-2222-2222-222222222222",
  apiClientId: "33333333-3333-3333-3333-333333333333",
  redirectUri: "http://localhost:3000/redirect",
  postLogoutRedirectUri: "http://localhost:3000/",
});

function account(suffix: string, tenant = tenantId): AccountInfo {
  return {
    homeAccountId: `home-${suffix}`,
    localAccountId: `local-${suffix}`,
    environment: "login.microsoftonline.com",
    tenantId: tenant,
    username: `synthetic-${suffix}@example.test`,
  };
}

function loginSuccessEvent(selectedAccount: AccountInfo): EventMessage {
  return {
    eventType: EventType.LOGIN_SUCCESS,
    interactionType: null,
    payload: selectedAccount,
    error: null,
    correlationId: "synthetic-login-correlation",
    timestamp: 1,
  };
}

function instanceWith(
  overrides: Partial<IPublicClientApplication> = {},
): IPublicClientApplication {
  return {
    ...stubbedPublicClientApplication,
    getActiveAccount: vi.fn(() => null),
    setActiveAccount: vi.fn(),
    getAllAccounts: vi.fn(() => []),
    loginRedirect: vi.fn(() => Promise.resolve()),
    logoutRedirect: vi.fn(() => Promise.resolve()),
    acquireTokenSilent: vi.fn(),
    acquireTokenRedirect: vi.fn(() => Promise.resolve()),
    addEventCallback: vi.fn(() => "synthetic-event-callback"),
    removeEventCallback: vi.fn(),
    ...overrides,
  };
}

type AuthenticationContext = ReturnType<
  typeof useCentreSuccessAuthentication
>;
let currentAuthentication: AuthenticationContext | undefined;

function authentication(): AuthenticationContext {
  if (!currentAuthentication) {
    throw new Error("Authentication context was not rendered");
  }

  return currentAuthentication;
}

function AuthenticationProbe() {
  const authenticationContext = useCentreSuccessAuthentication();

  useEffect(() => {
    currentAuthentication = authenticationContext;
  }, [authenticationContext]);

  return (
    <span data-testid="auth-kind">{authenticationContext.state.kind}</span>
  );
}

function renderAuthentication(
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
  inProgress: InteractionStatus = InteractionStatus.None,
) {
  msalReactMocks.useMsal.mockReturnValue({
    instance,
    accounts,
    inProgress,
    logger: new Logger({}),
  });

  return render(
    <CentreSuccessAuthenticationStateProvider config={config}>
      <AuthenticationProbe />
    </CentreSuccessAuthenticationStateProvider>,
  );
}

afterEach(() => {
  cleanup();
  currentAuthentication = undefined;
  msalReactMocks.useMsal.mockReset();
});

describe("MSAL account resolution", () => {
  test("distinguishes zero, one, and multiple cached accounts without choosing an arbitrary first account", () => {
    const first = account("first");
    const second = account("second");

    expect(resolveCentreSuccessAccount([], null, tenantId)).toEqual({
      kind: "signed-out",
    });
    expect(resolveCentreSuccessAccount([first], null, tenantId)).toEqual({
      kind: "select-single-account",
      account: first,
    });
    expect(
      resolveCentreSuccessAccount([first, second], null, tenantId),
    ).toEqual({ kind: "account-selection-required" });
  });

  test("accepts only the explicit active account from the configured tenant", () => {
    const selected = account("selected");
    const other = account("other");
    const foreign = account(
      "foreign",
      "99999999-9999-9999-9999-999999999999",
    );

    expect(
      resolveCentreSuccessAccount([selected, other], selected, tenantId),
    ).toEqual({ kind: "signed-in", account: selected });
    expect(resolveCentreSuccessAccount([foreign], foreign, tenantId)).toEqual({
      kind: "account-selection-required",
    });
    expect(resolveCentreSuccessAccount([], selected, tenantId)).toEqual({
      kind: "signed-out",
    });
  });

  test("explicitly activates the sole cached company account", async () => {
    const onlyAccount = account("only");
    const setActiveAccount = vi.fn();
    const instance = instanceWith({ setActiveAccount });

    renderAuthentication(instance, [onlyAccount]);

    await waitFor(() =>
      expect(screen.getByTestId("auth-kind").textContent).toBe("signed-in"),
    );
    expect(setActiveAccount).toHaveBeenCalledWith(onlyAccount);
  });

  test("establishes the validated account returned by a multi-account login redirect", async () => {
    const first = account("first");
    const selected = account("selected");
    let eventCallback: EventCallbackFunction | undefined;
    const addEventCallback = vi.fn((callback: EventCallbackFunction) => {
      eventCallback = callback;
      return "multi-account-login-callback";
    });
    const removeEventCallback = vi.fn();
    const setActiveAccount = vi.fn();
    const instance = instanceWith({
      addEventCallback,
      removeEventCallback,
      setActiveAccount,
    });

    const { unmount } = renderAuthentication(instance, [first, selected]);
    expect(screen.getByTestId("auth-kind").textContent).toBe(
      "account-selection-required",
    );
    await waitFor(() => expect(addEventCallback).toHaveBeenCalledOnce());

    act(() => eventCallback?.(loginSuccessEvent(selected)));

    await waitFor(() =>
      expect(screen.getByTestId("auth-kind").textContent).toBe("signed-in"),
    );
    expect(setActiveAccount).toHaveBeenCalledWith(selected);
    expect(setActiveAccount).not.toHaveBeenCalledWith(first);
    expect(addEventCallback).toHaveBeenCalledWith(expect.any(Function), [
      EventType.LOGIN_SUCCESS,
    ]);

    unmount();
    expect(removeEventCallback).toHaveBeenCalledWith(
      "multi-account-login-callback",
    );
  });

  test("rejects an account returned for a different tenant", async () => {
    const first = account("first");
    const second = account("second");
    const foreign = account(
      "foreign",
      "99999999-9999-9999-9999-999999999999",
    );
    let eventCallback: EventCallbackFunction | undefined;
    const addEventCallback = vi.fn((callback: EventCallbackFunction) => {
      eventCallback = callback;
      return "foreign-login-callback";
    });
    const setActiveAccount = vi.fn();
    const instance = instanceWith({ addEventCallback, setActiveAccount });

    renderAuthentication(instance, [first, second]);
    await waitFor(() => expect(addEventCallback).toHaveBeenCalledOnce());

    act(() => eventCallback?.(loginSuccessEvent(foreign)));

    await waitFor(() =>
      expect(screen.getByTestId("auth-kind").textContent).toBe("unavailable"),
    );
    expect(setActiveAccount).toHaveBeenCalledWith(null);
    expect(setActiveAccount).not.toHaveBeenCalledWith(foreign);
  });
});

describe("central MSAL interaction adapter", () => {
  test("starts loginRedirect with only the derived Centre Success API scope", async () => {
    const loginRedirect = vi.fn(() => Promise.resolve());
    const instance = instanceWith({ loginRedirect });
    renderAuthentication(instance, []);

    await act(async () => authentication().signIn());

    expect(loginRedirect).toHaveBeenCalledWith({
      scopes: [config.apiScope],
    });
  });

  test("requests explicit account selection when the MSAL cache is ambiguous", async () => {
    const loginRedirect = vi.fn(() => Promise.resolve());
    const instance = instanceWith({ loginRedirect });
    renderAuthentication(instance, [account("first"), account("second")]);

    await act(async () => authentication().signIn());

    expect(loginRedirect).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      prompt: "select_account",
    });
  });

  test("logs out the explicit account and returns to the registered root", async () => {
    const selected = account("selected");
    const logoutRedirect = vi.fn(() => Promise.resolve());
    const instance = instanceWith({
      getActiveAccount: vi.fn(() => selected),
      logoutRedirect,
    });
    renderAuthentication(instance, [selected]);

    await act(async () => authentication().signOut());

    expect(logoutRedirect).toHaveBeenCalledWith({
      account: selected,
      postLogoutRedirectUri: config.postLogoutRedirectUri,
    });
  });

  test("returns only the custom-API access token from acquireTokenSilent", async () => {
    const selected = account("selected");
    const acquireTokenSilent = vi.fn(() =>
      Promise.resolve({
        accessToken: "centre-success-access-token",
        idToken: "must-not-be-used",
      } as AuthenticationResult),
    );
    const instance = instanceWith({
      getActiveAccount: vi.fn(() => selected),
      acquireTokenSilent,
    });
    renderAuthentication(instance, [selected]);

    await expect(authentication().getAccessToken()).resolves.toBe(
      "centre-success-access-token",
    );
    expect(acquireTokenSilent).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      account: selected,
    });
  });

  test("coalesces concurrent interactive renewal redirects", async () => {
    const selected = account("selected");
    const redirect = Promise.withResolvers<void>();
    const acquireTokenSilent = vi.fn(() =>
      Promise.reject(
        new InteractionRequiredAuthError(
          "interaction_required",
          "synthetic-correlation",
        ),
      ),
    );
    const acquireTokenRedirect = vi.fn(() => redirect.promise);
    const instance = instanceWith({
      getActiveAccount: vi.fn(() => selected),
      acquireTokenSilent,
      acquireTokenRedirect,
    });
    renderAuthentication(instance, [selected]);

    const first = authentication()
      .getAccessToken()
      .catch((error: unknown) => error);
    await waitFor(() => expect(acquireTokenRedirect).toHaveBeenCalledOnce());
    const second = authentication()
      .getAccessToken()
      .catch((error: unknown) => error);
    await waitFor(() => expect(acquireTokenSilent).toHaveBeenCalledTimes(2));

    redirect.resolve();

    await expect(first).resolves.toBeInstanceOf(
      AuthenticationFlowTransitionError,
    );
    await expect(second).resolves.toBeInstanceOf(
      AuthenticationFlowTransitionError,
    );
    expect(acquireTokenRedirect).toHaveBeenCalledOnce();
    expect(acquireTokenRedirect).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      account: selected,
    });
  });

  test("does not redirect for non-interaction token failures", async () => {
    const selected = account("selected");
    const tokenFailure = new Error("synthetic token failure");
    const acquireTokenSilent = vi.fn(() => Promise.reject(tokenFailure));
    const acquireTokenRedirect = vi.fn(() => Promise.resolve());
    const instance = instanceWith({
      getActiveAccount: vi.fn(() => selected),
      acquireTokenSilent,
      acquireTokenRedirect,
    });
    renderAuthentication(instance, [selected]);

    await expect(authentication().getAccessToken()).rejects.toBe(
      tokenFailure,
    );
    expect(acquireTokenRedirect).not.toHaveBeenCalled();
  });

  test("starts no token or redirect work while MSAL is busy", async () => {
    const selected = account("selected");
    const acquireTokenSilent = vi.fn();
    const acquireTokenRedirect = vi.fn();
    const instance = instanceWith({
      getActiveAccount: vi.fn(() => selected),
      acquireTokenSilent,
      acquireTokenRedirect,
    });
    renderAuthentication(instance, [selected], InteractionStatus.AcquireToken);

    await expect(authentication().getAccessToken()).rejects.toBeInstanceOf(
      AuthenticationFlowTransitionError,
    );
    expect(acquireTokenSilent).not.toHaveBeenCalled();
    expect(acquireTokenRedirect).not.toHaveBeenCalled();
  });
});
