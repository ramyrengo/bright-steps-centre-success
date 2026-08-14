import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  state: { kind: "signed-in", accountKey: "synthetic-account" } as {
    kind: string;
    accountKey?: string;
  },
  signIn: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("synthetic-access-token")),
}));
const clientMocks = vi.hoisted(() => ({
  foundation: {
    getAuthorisedNavigationEndpoint: vi.fn(() =>
      Promise.resolve({ cacheControl: "private, no-store", links: [] }),
    ),
    getPersonEffectiveAccess: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));
vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: authMocks.state,
    signIn: authMocks.signIn,
    signOut: authMocks.signOut,
    getAccessToken: authMocks.getAccessToken,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks,
}));

import type { people_access } from "../lib/client.generated";
import { PersonEffectiveAccessWorkspace } from "./people-access-workspaces";

const PRINCIPAL_ID = "6f1d2c3b-4a59-4d6e-8b7c-0a1b2c3d4e5f";
const CENTRE_A = "11111111-1111-4111-8111-111111111111";
const CENTRE_B = "22222222-2222-4222-8222-222222222222";

/**
 * Fixtures are concrete members of the generated union rather than casts, so a
 * fixture cannot describe a report the backend is unable to produce.
 */
function evaluated(
  capabilities: people_access.EffectiveCapabilityAccess[],
  unevaluatedCentres: people_access.UnevaluatedCentre[] = [],
): people_access.EffectiveAccessResponse {
  return {
    report: {
      evaluated: true,
      principalId: PRINCIPAL_ID,
      evaluatedAt: "2026-08-11T12:00:00.000Z",
      capabilities,
      unevaluatedCentres,
    },
  };
}

function heldAtCentreA(capability: string): people_access.EffectiveCapabilityAccess {
  return {
    capability: capability as people_access.EffectiveCapabilityAccess["capability"],
    organisation: { allowed: false, reason: "scope_mismatch" },
    centres: [
      {
        centreId: CENTRE_A,
        centreName: "Beresfield",
        decision: { allowed: true, assignmentId: "assignment-1", roleKey: "centre_director" },
      },
      {
        centreId: CENTRE_B,
        centreName: "Calala",
        decision: { allowed: false, reason: "scope_mismatch" },
      },
    ],
  };
}

function notHeld(capability: string): people_access.EffectiveCapabilityAccess {
  return {
    capability: capability as people_access.EffectiveCapabilityAccess["capability"],
    organisation: { allowed: false, reason: "capability_missing" },
    centres: [
      {
        centreId: CENTRE_A,
        centreName: "Beresfield",
        decision: { allowed: false, reason: "capability_missing" },
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("effective access diagnostic", () => {
  test("shows where a held capability applies and which role granted it", async () => {
    clientMocks.foundation.getPersonEffectiveAccess.mockResolvedValue(
      evaluated([heldAtCentreA("budget.position.read")]),
    );

    render(<PersonEffectiveAccessWorkspace principalId={PRINCIPAL_ID} />);

    await waitFor(() => expect(screen.getByText("budget.position.read")).toBeTruthy());
    expect(screen.getByText("Beresfield")).toBeTruthy();
    expect(screen.getByText("centre_director")).toBeTruthy();
  });

  test("distinguishes a missing capability from a scope mismatch in words", async () => {
    clientMocks.foundation.getPersonEffectiveAccess.mockResolvedValue(
      evaluated([heldAtCentreA("centre.read"), notHeld("principal.manage")]),
    );

    render(<PersonEffectiveAccessWorkspace principalId={PRINCIPAL_ID} />);

    await waitFor(() => expect(screen.getByText("principal.manage")).toBeTruthy());
    // The two refusals send an administrator to different fixes, so they must
    // never be rendered with the same sentence.
    expect(screen.getByText("No active assignment carries this capability.")).toBeTruthy();
    expect(
      screen.getByText("An assignment carries this capability, but not here."),
    ).toBeTruthy();
  });

  test("a blocked report is never rendered as an empty list of capabilities", async () => {
    clientMocks.foundation.getPersonEffectiveAccess.mockResolvedValue({
      report: {
        evaluated: false,
        principalId: PRINCIPAL_ID,
        evaluatedAt: "2026-08-11T12:00:00.000Z",
        blockedBy: "principal_inactive",
      },
    } satisfies people_access.EffectiveAccessResponse);

    render(<PersonEffectiveAccessWorkspace principalId={PRINCIPAL_ID} />);

    await waitFor(() =>
      expect(screen.getByText("No access could be evaluated")).toBeTruthy(),
    );
    expect(screen.getByText(/account is not active/)).toBeTruthy();
    // "Held" and "Not held" would both read as evaluated conclusions.
    expect(screen.queryByText("Held")).toBeNull();
    expect(screen.queryByText("Not held")).toBeNull();
  });

  test("names centres it could not check and refuses to call them refused", async () => {
    clientMocks.foundation.getPersonEffectiveAccess.mockResolvedValue(
      evaluated(
        [heldAtCentreA("centre.read")],
        [{ centreId: CENTRE_B, centreName: "Calala", reason: "hierarchy_cycle" }],
      ),
    );

    render(<PersonEffectiveAccessWorkspace principalId={PRINCIPAL_ID} />);

    await waitFor(() =>
      expect(screen.getByText("Some centres could not be checked")).toBeTruthy(),
    );
    expect(screen.getByText(/unknown, not as refused/)).toBeTruthy();
  });

  test("an evaluated report granting nothing says so as a decision", async () => {
    clientMocks.foundation.getPersonEffectiveAccess.mockResolvedValue(
      evaluated([notHeld("principal.manage")]),
    );

    render(<PersonEffectiveAccessWorkspace principalId={PRINCIPAL_ID} />);

    await waitFor(() =>
      expect(screen.getByText("No capability is currently granted")).toBeTruthy(),
    );
    expect(screen.getByText(/decision, not a missing record/)).toBeTruthy();
  });
});
