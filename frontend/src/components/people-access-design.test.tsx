import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Presentation and accessibility regressions for the People & Access alignment.
 * Invitation lifecycle behaviour is covered by people-access-workflows.test.tsx
 * and is deliberately not duplicated here.
 */

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve()),
  signIn: vi.fn(() => Promise.resolve()),
}));
const clientMocks = vi.hoisted(() => {
  const foundation = {
    listPeople: vi.fn(),
    getPerson: vi.fn(),
    getPersonAccess: vi.fn(),
    getPeopleOptions: vi.fn(),
    getPersonHistory: vi.fn(),
    getInvitation: vi.fn(),
    suspendPerson: vi.fn(),
    removePersonAssignment: vi.fn(),
    replacePersonAssignmentScope: vi.fn(),
    getAuthorisedNavigationEndpoint: vi.fn(),
  };
  return { foundation, client: { foundation } };
});

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "pa-design" },
    signOut: authMocks.signOut,
    signIn: authMocks.signIn,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import {
  InvitationReviewWorkspace,
  PeopleAccessWorkspace,
  PersonAccessWorkspace,
  PersonHistoryWorkspace,
} from "./people-access-workspaces";

const PRINCIPAL = "00000000-0000-4000-8000-0000000000f1";
const ASSIGNMENT = "00000000-0000-4000-8000-0000000000f2";
const INVITATION = "00000000-0000-4000-8000-0000000000f3";
const CENTRE_A = "00000000-0000-4000-8000-0000000000c1";
const CENTRE_B = "00000000-0000-4000-8000-0000000000c2";

const OPTIONS = {
  roles: [
    { roleKey: "area_manager", name: "Area Manager", scopeMode: "multi_centre", approval: "standard" },
    { roleKey: "centre_director", name: "Centre Director", scopeMode: "single_centre", approval: "standard" },
  ],
  centres: [
    { id: CENTRE_A, name: "Synthetic North Centre" },
    { id: CENTRE_B, name: "Synthetic South Centre" },
  ],
  organisationalUnits: [],
};

function person(overrides: Record<string, unknown> = {}) {
  return {
    principalId: PRINCIPAL,
    displayName: "Synthetic Area Manager",
    status: "active",
    microsoftIdentity: "connected",
    lockVersion: 3,
    assignments: [
      {
        id: ASSIGNMENT,
        roleKey: "area_manager",
        roleName: "Area Manager",
        scopes: [
          { scopeType: "centre", centreId: CENTRE_A },
          { scopeType: "centre", centreId: CENTRE_B },
        ],
      },
    ],
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION,
    displayName: "Synthetic Candidate",
    intendedEmail: "candidate@brightsteps.example",
    status: "AWAITING_PRIVILEGED_APPROVAL",
    privilegeClass: "PRIVILEGED",
    organisationName: "Synthetic Bright Steps Organisation",
    requestedByName: "Synthetic System Administrator",
    requestReason: "Provide reviewed regional oversight.",
    packageVersion: 1,
    lockVersion: 2,
    expiresAt: "2026-08-15T00:00:00.000Z",
    assignments: [
      {
        roleKey: "area_manager",
        roleName: "Area Manager",
        roleVersion: 1,
        privilegeClass: "PRIVILEGED",
        effectiveFrom: "2026-08-12T00:00:00.000Z",
        effectiveTo: null,
        scopes: [{ scopeType: "centre", centreId: CENTRE_A, displayName: "Synthetic North Centre" }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  for (const mock of Object.values(clientMocks.foundation)) mock.mockReset();
  clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
  // The shell asks the backend for navigation on every page; default to the
  // safe empty answer so only tests that care about links opt into them.
  clientMocks.foundation.getAuthorisedNavigationEndpoint.mockResolvedValue({
    cacheControl: "private, no-store",
    links: [],
  });
});
afterEach(cleanup);

describe("People & Access list presentation", () => {
  beforeEach(() => {
    clientMocks.foundation.listPeople.mockResolvedValue({
      people: [person(), person({ principalId: "p2", displayName: "Synthetic Suspended Person", status: "suspended", microsoftIdentity: "not_connected", assignments: [] })],
      invitations: [invitation(), invitation({ id: "i2", displayName: "Synthetic Standard Candidate", status: "SENT", privilegeClass: "STANDARD" })],
    });
  });

  test("renders people and invitations as named list records, not raw cards", async () => {
    render(<PeopleAccessWorkspace />);

    const people = await screen.findByRole("list", { name: "People" });
    expect(within(people).getAllByRole("listitem")).toHaveLength(2);
    expect(within(people).getByRole("heading", { level: 3, name: "Synthetic Area Manager" })).toBeDefined();

    const invitations = screen.getByRole("list", { name: "Invitations" });
    expect(within(invitations).getAllByRole("listitem")).toHaveLength(2);
    expect(within(invitations).getByRole("heading", { level: 3, name: "Synthetic Candidate" })).toBeDefined();
  });

  test("summarises only counts it can derive from authorised records", async () => {
    render(<PeopleAccessWorkspace />);

    await screen.findByRole("list", { name: "People" });
    expect(screen.getByText("People listed").nextSibling?.textContent).toBe("2");
    expect(screen.getByText("Active access").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Awaiting approval").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Open invitations").nextSibling?.textContent).toBe("2");
  });

  test("states every person and invitation state in words", async () => {
    render(<PeopleAccessWorkspace />);

    await screen.findByRole("list", { name: "People" });
    const badges = Array.from(document.querySelectorAll(".status-pill")).map((node) => node.textContent?.trim());
    expect(badges).toContain("Active");
    expect(badges).toContain("Suspended");
    expect(badges).toContain("Awaiting privileged approval");
    expect(badges).toContain("Sent");
  });

  test("separates Microsoft identity from Centre Success access for each person", async () => {
    render(<PeopleAccessWorkspace />);

    const people = await screen.findByRole("list", { name: "People" });
    const rows = within(people).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Microsoft identity").nextSibling?.textContent).toBe("Connected");
    expect(within(rows[1]).getByText("Microsoft identity").nextSibling?.textContent).toBe("Not connected");
    expect(within(rows[1]).getByText("Centre Success access").nextSibling?.textContent).toBe("0 active assignments");
  });

  test("exposes no token, digest, object identifier or encrypted delivery state", async () => {
    render(<PeopleAccessWorkspace />);
    await screen.findByRole("list", { name: "People" });
    expect(document.body.textContent).not.toMatch(
      /token|digest|\boid\b|\btid\b|ciphertext|encrypted|principalId|uuid/iu,
    );
    expect(document.body.textContent).not.toContain(PRINCIPAL);
    expect(document.body.textContent).not.toContain(CENTRE_A);
  });

  test("keeps administration navigation capability-derived", async () => {
    clientMocks.foundation.getAuthorisedNavigationEndpoint.mockResolvedValue({
      cacheControl: "private, no-store",
      links: [{ label: "People & Access", route: "/admin/people" }],
    });
    render(<PeopleAccessWorkspace />);

    await screen.findByRole("list", { name: "People" });
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Daily Success",
      "People & Access",
    ]);
    expect(within(nav).queryByRole("link", { name: /Quality|Compliance|Area Manager/u })).toBeNull();
  });

  test("shows an honest empty state when a search matches nothing", async () => {
    render(<PeopleAccessWorkspace />);
    await screen.findByRole("list", { name: "People" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz-no-match" } });
    expect(screen.getByRole("heading", { name: "No people found" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "No invitations found" })).toBeDefined();
  });

  test("surfaces a retryable error rather than an empty organisation", async () => {
    clientMocks.foundation.listPeople.mockRejectedValue(new Error("network"));
    render(<PeopleAccessWorkspace />);

    expect(await screen.findByRole("heading", { name: "People & Access unavailable" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});

describe("privileged access presentation", () => {
  test("never shows a privileged invitation as active before independent approval", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(invitation());
    render(<InvitationReviewWorkspace invitationId={INVITATION} />);

    expect(await screen.findByText("Verified, awaiting approval")).toBeDefined();
    expect(screen.getByText("No active access")).toBeDefined();
    expect(screen.getByText(/different current System Administrator/iu)).toBeDefined();
    const badges = Array.from(document.querySelectorAll(".status-pill")).map((node) => node.textContent?.trim());
    expect(badges).toContain("Awaiting privileged approval");
    expect(badges).not.toContain("Active");
  });

  test("explains why approval is unavailable until a reason is recorded", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(invitation());
    render(<InvitationReviewWorkspace invitationId={INVITATION} />);

    const approve = await screen.findByRole("button", { name: "Approve exact package" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    const hintId = approve.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId as string)?.textContent).toMatch(/approval reason/iu);

    fireEvent.change(screen.getByRole("textbox", { name: /Approval reason/u }), {
      target: { value: "Reviewed and approved." },
    });
    expect(screen.getByRole("button", { name: "Approve exact package" }).hasAttribute("disabled")).toBe(false);
  });

  test("states the rotate-and-resend implication before the control is used", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(invitation({ status: "SENT", privilegeClass: "STANDARD" }));
    render(<InvitationReviewWorkspace invitationId={INVITATION} />);

    expect(await screen.findByRole("button", { name: "Rotate and resend" })).toBeDefined();
    expect(screen.getByText(/invalidates the previous one/iu)).toBeDefined();
  });

  test("shows the named centre portfolio, never a raw identifier", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(invitation());
    render(<InvitationReviewWorkspace invitationId={INVITATION} />);

    expect(await screen.findByText("Centre · Synthetic North Centre")).toBeDefined();
    expect(document.body.textContent).not.toContain(CENTRE_A);
  });
});

describe("multi-centre portfolio presentation", () => {
  beforeEach(() => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: person() });
  });

  test("names every authorised centre instead of showing identifiers", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    const assignments = await screen.findByRole("list", { name: "Active assignments" });
    const row = within(assignments).getAllByRole("listitem")[0];
    expect(within(row).getByRole("heading", { level: 3, name: "Area Manager" })).toBeDefined();
    expect(within(row).getByText("Authorised for").nextSibling?.textContent).toBe(
      "Centre · Synthetic North Centre, Centre · Synthetic South Centre",
    );
    expect(within(row).getByText("Centres").nextSibling?.textContent).toBe("2 centres");
    expect(document.body.textContent).not.toContain(CENTRE_A);
  });

  test("explains that an unchanged portfolio has nothing to save", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit centre portfolio" }));
    const dialog = screen.getByRole("dialog", { name: "Edit centre portfolio" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Portfolio change reason/u }), {
      target: { value: "Reviewed portfolio." },
    });
    expect(within(dialog).getByText(/unchanged, so there is nothing to save/iu)).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Save full portfolio" }).hasAttribute("disabled")).toBe(true);
  });

  test("shows an empty state when a person holds no assignments", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: person({ assignments: [] }) });
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    expect(await screen.findByRole("heading", { name: "No active assignments" })).toBeDefined();
  });
});

describe("dialog focus management", () => {
  beforeEach(() => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: person() });
  });

  test("moves focus into the dialog when it opens", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    fireEvent.click(await screen.findByRole("button", { name: "End assignment" }));
    const dialog = screen.getByRole("dialog", { name: "End assignment?" });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    expect((document.activeElement as HTMLElement).tagName).toBe("TEXTAREA");
  });

  test("keeps Tab inside the dialog while it is open", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    fireEvent.click(await screen.findByRole("button", { name: "End assignment" }));
    const dialog = screen.getByRole("dialog", { name: "End assignment?" });
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),textarea,input,select"),
    );
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);

    focusables[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("dismisses on Escape and returns focus to the control that opened it", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    const opener = await screen.findByRole("button", { name: "End assignment" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "End assignment?" })).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End assignment?" })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "End assignment" })),
    );
  });

  test("labels a destructive confirmation clearly and blocks it without a reason", async () => {
    render(<PersonAccessWorkspace principalId={PRINCIPAL} />);

    fireEvent.click(await screen.findByRole("button", { name: "Revoke permanently" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke access permanently?" });
    expect(within(dialog).getByText(/Revocation is terminal/iu)).toBeDefined();

    const confirm = within(dialog).getByRole("button", { name: "Revoke permanently" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    const hintId = confirm.getAttribute("aria-describedby");
    expect(document.getElementById(hintId as string)?.textContent).toMatch(/reason is required/iu);
  });
});

describe("access history presentation", () => {
  test("renders append-only events with safe attribution only", async () => {
    clientMocks.foundation.getPersonHistory.mockResolvedValue({
      events: [
        {
          id: "e1",
          action: "assignment_added",
          occurredAt: "2026-08-10T00:00:00.000Z",
          actorDisplayName: "Synthetic System Administrator",
          reasonRecorded: true,
        },
      ],
    });
    render(<PersonHistoryWorkspace principalId={PRINCIPAL} />);

    // `assignment_added` carries no mapped label, so this also exercises the
    // fallback: readable, capitalised, and with no internal punctuation left.
    expect(await screen.findByText("Assignment added")).toBeDefined();
    expect(screen.getByText(/Synthetic System Administrator/u)).toBeDefined();
    expect(screen.getByText("A reason was recorded.")).toBeDefined();
    const timeline = document.querySelector(".timeline");
    expect(timeline?.textContent).not.toMatch(/\boid\b|token|digest/iu);
    expect(timeline?.textContent).not.toContain(PRINCIPAL);
  });

  test("uses an empty state when nothing has been recorded", async () => {
    clientMocks.foundation.getPersonHistory.mockResolvedValue({ events: [] });
    render(<PersonHistoryWorkspace principalId={PRINCIPAL} />);

    expect(await screen.findByRole("heading", { name: "No recorded access changes" })).toBeDefined();
  });
});
