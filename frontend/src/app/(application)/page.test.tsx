import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { APIError, ErrCode } from "@/lib/client.generated";

const authMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(() => Promise.resolve("synthetic-api-token")),
  hook: vi.fn(),
  signIn: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  state: { kind: "signed-in", accountKey: "synthetic-account" } as {
    kind: string;
    accountKey?: string;
  },
  transitionError: new Error("synthetic redirect transition"),
}));

const clientMocks = vi.hoisted(() => {
  const me = vi.fn();
  const getDailySuccess = vi.fn();
  return {
    client: { foundation: { me, getDailySuccess } },
    me,
    getDailySuccess,
  };
});

vi.mock("@/lib/centre-success-authentication", () => ({
  isAuthenticationFlowTransitionError: (error: unknown) =>
    error === authMocks.transitionError,
  useCentreSuccessAuthentication: authMocks.hook,
}));

vi.mock("@/lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import Page from "./page";

function authenticationState(kind: string, accountKey?: string) {
  authMocks.state = { kind, ...(accountKey ? { accountKey } : {}) };
}

beforeEach(() => {
  authenticationState("signed-in", "synthetic-account");
  authMocks.hook.mockImplementation(() => ({
    state: authMocks.state,
    signIn: authMocks.signIn,
    signOut: authMocks.signOut,
    getAccessToken: authMocks.getAccessToken,
  }));
  clientMocks.getDailySuccess.mockResolvedValue({
    cacheControl: "private, no-store",
    asOf: "2026-08-12T00:00:00.000Z",
    status: "ready",
    activePerspective: { kind: "centre", label: "Synthetic Centre", centreId: "centre" },
    availablePerspectives: [{ kind: "centre", label: "Synthetic Centre", centreId: "centre" }],
    businessDates: [], sections: [], attentionCentres: [], verificationItems: [],
    aggregateCounts: { coverage: "complete", active: 0, urgent: 0, dueToday: 0, waiting: 0, distinctCentres: 0 },
    positiveContext: { completedTodayCount: 0, recentTitles: [] },
    sourceHealth: [], authorisationHealth: { status: "available" }, workspaceLinks: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Centre Success authentication shell", () => {
  test("shows an accessible session-loading state before MSAL is ready", () => {
    authenticationState("loading");

    render(<Page />);

    expect(screen.getByRole("main")).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 1, name: "Centre Success" }),
    ).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain(
      "Checking your secure session",
    );
    expect(clientMocks.me).not.toHaveBeenCalled();
  });

  test.each([
    ["signed-out", "Sign in"],
    ["account-selection-required", "Choose account"],
  ])("starts the central sign-in flow for %s", (kind, buttonName) => {
    authenticationState(kind);

    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(authMocks.signIn).toHaveBeenCalledOnce();
    expect(clientMocks.me).not.toHaveBeenCalled();
  });

  test("renders Daily Success after safe provisioned identity resolution", async () => {
    clientMocks.me.mockResolvedValue({
      provisioningStatus: "provisioned",
      principal: {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Synthetic Centre Director",
      },
      activeOrganisation: {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Synthetic Bright Steps",
      },
    });

    render(<Page />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Good morning, Synthetic Centre Director",
      }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "On track" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(authMocks.signOut).toHaveBeenCalledOnce();
  });

  test("shows the safe not-provisioned state without business data", async () => {
    clientMocks.me.mockResolvedValue({
      provisioningStatus: "not_provisioned",
    });

    render(<Page />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Account not provisioned",
      }),
    ).toBeDefined();
    expect(screen.queryByText("Synthetic Bright Steps")).toBeNull();
  });

  test("fails closed when a successful me response omits provisioning context", async () => {
    clientMocks.me.mockResolvedValue({
      principal: {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Synthetic Centre Director",
      },
      activeOrganisation: {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Synthetic Bright Steps",
      },
    });

    render(<Page />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Centre Success is temporarily unavailable",
      }),
    ).toBeDefined();
  });

  test.each([
    new APIError(403, {
      code: ErrCode.PermissionDenied,
      message: "generic access denial",
    }),
    new APIError(401, {
      code: ErrCode.Unauthenticated,
      message: "generic authentication denial",
    }),
  ])("maps protected API denials to an access-denied state", async (error) => {
    clientMocks.me.mockRejectedValue(error);

    render(<Page />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Access denied" }),
    ).toBeDefined();
  });

  test("keeps an interactive token transition in the loading state", async () => {
    clientMocks.me.mockRejectedValue(authMocks.transitionError);

    render(<Page />);

    await waitFor(() => expect(clientMocks.me).toHaveBeenCalledOnce());
    expect(screen.getByRole("status").textContent).toContain(
      "Checking your Centre Success access",
    );
  });

  test("offers a retry after an unavailable API response", async () => {
    clientMocks.me
      .mockRejectedValueOnce(new Error("synthetic internal network details"))
      .mockResolvedValueOnce({
        provisioningStatus: "provisioned",
        principal: {
          id: "00000000-0000-4000-8000-000000000001",
          displayName: "Synthetic Centre Director",
        },
        activeOrganisation: {
          id: "00000000-0000-4000-8000-000000000010",
          name: "Synthetic Bright Steps",
        },
      });

    render(<Page />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Good morning, Synthetic Centre Director",
      }),
    ).toBeDefined();
    expect(clientMocks.me).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("synthetic internal network details")).toBeNull();
  });
});
