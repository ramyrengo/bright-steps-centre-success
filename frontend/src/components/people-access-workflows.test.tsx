import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  state: { kind: "signed-in", accountKey: "synthetic-account" } as { kind: string; accountKey?: string },
  signIn: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("synthetic-access-token")),
}));
const clientMocks = vi.hoisted(() => ({
  foundation: {
    getAuthorisedNavigationEndpoint: vi.fn(() => Promise.resolve({ cacheControl: "private, no-store", links: [] })),
    listPeople: vi.fn(),
    getPeopleOptions: vi.fn(),
    createInvitation: vi.fn(),
    getInvitation: vi.fn(),
    sendInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    cancelInvitationEndpoint: vi.fn(),
    approveInvitation: vi.fn(),
    getPerson: vi.fn(),
    getPersonAccess: vi.fn(),
    getPersonHistory: vi.fn(),
    addPersonAssignment: vi.fn(),
    replacePersonAssignmentScope: vi.fn(),
    removePersonAssignment: vi.fn(),
    suspendPerson: vi.fn(),
    reactivatePerson: vi.fn(),
    revokePerson: vi.fn(),
    acceptInvitation: vi.fn(),
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

import { APIError, ErrCode } from "../lib/client.generated";
import {
  InvitationAcceptanceWorkspace,
  InvitationReviewWorkspace,
  InvitePersonWorkspace,
  PeopleAccessWorkspace,
  PersonAccessWorkspace,
  PersonHistoryWorkspace,
  PersonWorkspace,
  peopleAccessFailureMessage,
} from "./people-access-workspaces";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000101";
const INVITATION_ID = "00000000-0000-4000-8000-000000000201";
const UNIT_ID = "00000000-0000-4000-8000-000000000302";
const CENTRES = [
  ["00000000-0000-4000-8000-000000000301", "Synthetic North Centre"],
  ["00000000-0000-4000-8000-000000000303", "Synthetic South Centre"],
  ["00000000-0000-4000-8000-000000000304", "Synthetic East Centre"],
  ["00000000-0000-4000-8000-000000000305", "Synthetic West Centre"],
  ["00000000-0000-4000-8000-000000000306", "Synthetic Central Centre"],
] as const;
const CENTRE_ID = CENTRES[0][0];

function areaManagerPerson(centreIds: string[] = [CENTRE_ID], lockVersion = 2) {
  return {
    principalId: PRINCIPAL_ID,
    displayName: "Synthetic Area Manager",
    status: "active" as const,
    microsoftIdentity: "connected" as const,
    lockVersion,
    assignments: [{
      id: "00000000-0000-4000-8000-000000000401",
      roleKey: "area_manager",
      roleName: "Area Manager",
      scopes: centreIds.map((centreId) => ({ scopeType: "centre" as const, centreId })),
    }],
  };
}

function safeBackendError(
  reason: string,
  code: ErrCode = ErrCode.FailedPrecondition,
  status = 409,
): APIError {
  return new APIError(status, { code, message: "internal detail must not be shown", details: { reason } });
}

const PERSON = areaManagerPerson();

const INVITATION = {
  id: INVITATION_ID,
  organisationName: "Synthetic Bright Steps Organisation",
  intendedEmail: "candidate@brightsteps.example",
  displayName: "Synthetic Candidate",
  status: "DRAFT" as const,
  privilegeClass: "PRIVILEGED" as const,
  packageVersion: 2,
  requestedByName: "Synthetic System Administrator",
  requestReason: "Provide reviewed regional and centre responsibilities",
  expiresAt: null,
  lockVersion: 1,
  assignments: [{
    roleKey: "area_manager",
    roleName: "Area Manager",
    roleVersion: 1,
    privilegeClass: "REVIEW" as const,
    effectiveFrom: "2026-08-12T00:00:00.000Z",
    effectiveTo: null,
    scopes: [
      { scopeType: "centre" as const, centreId: CENTRES[0][0], displayName: CENTRES[0][1] },
      { scopeType: "centre" as const, centreId: CENTRES[1][0], displayName: CENTRES[1][1] },
    ],
  }, {
    roleKey: "centre_director",
    roleName: "Centre Director",
    roleVersion: 3,
    privilegeClass: "STANDARD" as const,
    effectiveFrom: "2026-08-20T00:00:00.000Z",
    effectiveTo: "2027-08-20T00:00:00.000Z",
    scopes: [{ scopeType: "centre" as const, centreId: CENTRES[2][0], displayName: CENTRES[2][1] }],
  }],
};

const OPTIONS = {
  roles: [
    { roleKey: "area_manager", name: "Area Manager", scopeMode: "multi_centre" as const, approval: "standard" as const },
    { roleKey: "centre_director", name: "Centre Director", scopeMode: "single_centre" as const, approval: "standard" as const },
    { roleKey: "system_administrator", name: "System Administrator", scopeMode: "organisation" as const, approval: "privileged" as const },
    { roleKey: "operations_leadership", name: "Operations Leadership", scopeMode: "flexible" as const, approval: "review" as const },
  ],
  centres: CENTRES.map(([id, name]) => ({ id, name })),
  organisationalUnits: [{ id: UNIT_ID, name: "Synthetic NSW", kind: "state" }],
};

beforeEach(() => {
  authMocks.state = { kind: "signed-in", accountKey: "synthetic-account" };
  routerMocks.push.mockReset();
  for (const mock of Object.values(clientMocks.foundation)) mock.mockReset();
});

afterEach(cleanup);

describe("Milestone 2C People & Access experience", () => {
  test("lists people and invitations while separating Microsoft identity from Centre Success access", async () => {
    clientMocks.foundation.listPeople.mockResolvedValue({ people: [PERSON], invitations: [INVITATION] });
    render(<PeopleAccessWorkspace />);
    expect(screen.getByRole("status").textContent).toContain("Loading People & Access");
    expect(await screen.findByRole("heading", { name: "Synthetic Area Manager" })).toBeDefined();
    expect(screen.getByText("Microsoft identity")).toBeDefined();
    expect(screen.getByText("Centre Success access")).toBeDefined();
    expect(screen.getByRole("link", { name: "Invite user" }).getAttribute("href")).toBe("/admin/people/invite");
    expect(screen.getByRole("link", { name: /^Review invitation/u }).getAttribute("href")).toContain(INVITATION_ID);
    expect(screen.queryByText(/oid|jwt|access token/i)).toBeNull();
  });

  test("shows a reviewed privileged invitation warning before creating a draft", async () => {
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.createInvitation.mockResolvedValue(INVITATION);
    render(<InvitePersonWorkspace />);
    fireEvent.change(await screen.findByLabelText("Canonical role"), { target: { value: "system_administrator" } });
    expect(screen.getByText("Privileged or review package")).toBeDefined();
    expect(screen.getByText(/different current System Administrator/i)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Employee name"), { target: { value: "Synthetic Candidate" } });
    fireEvent.change(screen.getByLabelText("Delivery and correlation email"), { target: { value: "candidate@brightsteps.example" } });
    fireEvent.change(screen.getByLabelText("Business reason"), { target: { value: "Synthetic invitation reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Review invitation draft" }));
    await waitFor(() => expect(clientMocks.foundation.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      assignments: [{ roleKey: "system_administrator", scopes: [{ scopeType: "organisation" }] }],
    })));
  });

  test("captures explicit organisational-unit scope for flexible reviewed roles", async () => {
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.createInvitation.mockResolvedValue(INVITATION);
    render(<InvitePersonWorkspace />);
    fireEvent.change(await screen.findByLabelText("Canonical role"), { target: { value: "operations_leadership" } });
    fireEvent.change(screen.getByLabelText("Scope type"), { target: { value: "organisational_unit" } });
    fireEvent.change(screen.getByLabelText("Organisational unit"), { target: { value: UNIT_ID } });
    fireEvent.change(screen.getByLabelText("Employee name"), { target: { value: "Synthetic Operations Candidate" } });
    fireEvent.change(screen.getByLabelText("Delivery and correlation email"), { target: { value: "operations@brightsteps.example" } });
    fireEvent.change(screen.getByLabelText("Business reason"), { target: { value: "Synthetic scoped operations invitation" } });
    fireEvent.click(screen.getByRole("button", { name: "Review invitation draft" }));
    await waitFor(() => expect(clientMocks.foundation.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      assignments: [{ roleKey: "operations_leadership", scopes: [{ scopeType: "organisational_unit", organisationalUnitId: UNIT_ID }] }],
    })));
  });

  test("shows the exact human-readable package before independent approval", async () => {
    const awaiting = { ...INVITATION, status: "AWAITING_PRIVILEGED_APPROVAL" as const, lockVersion: 3, expiresAt: "2026-08-14T12:00:00.000Z" };
    clientMocks.foundation.getInvitation.mockResolvedValue(awaiting);
    clientMocks.foundation.approveInvitation.mockResolvedValue({ ...awaiting, status: "ACTIVATED" });
    render(<InvitationReviewWorkspace invitationId={INVITATION_ID} />);
    expect(await screen.findByText("Verified, awaiting approval")).toBeDefined();
    expect(screen.getByText("Synthetic Bright Steps Organisation")).toBeDefined();
    expect(screen.getByText("Synthetic System Administrator")).toBeDefined();
    expect(screen.getByText(/Provide reviewed regional/i)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Area Manager · role version 1" })).toBeDefined();
    expect(screen.getByText("Centre · Synthetic North Centre")).toBeDefined();
    expect(screen.getByText("Centre · Synthetic South Centre")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Centre Director · role version 3" })).toBeDefined();
    expect(screen.getByText("Centre · Synthetic East Centre")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "Independent reviewed approval" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve exact package" }));
    await waitFor(() => expect(clientMocks.foundation.approveInvitation).toHaveBeenCalledWith(INVITATION_ID, {
      lockVersion: 3, reason: "Independent reviewed approval",
    }));
    expect(document.body.textContent).not.toMatch(/Bearer|JWT/i);
  });

  test("requires explicit confirmation and a cancellation-specific reason", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(INVITATION);
    clientMocks.foundation.cancelInvitationEndpoint.mockResolvedValue({ ...INVITATION, status: "CANCELLED", lockVersion: 2 });
    render(<InvitationReviewWorkspace invitationId={INVITATION_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invitation" }));
    expect(clientMocks.foundation.cancelInvitationEndpoint).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Cancel invitation?" });
    expect(within(dialog).getByText("Synthetic Candidate")).toBeDefined();
    expect(within(dialog).getByText(/code unusable/i)).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText("Cancellation reason"), { target: { value: "Invitation no longer required" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel invitation" }));
    await waitFor(() => expect(clientMocks.foundation.cancelInvitationEndpoint).toHaveBeenCalledWith(INVITATION_ID, {
      lockVersion: 1, reason: "Invitation no longer required",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cancel invitation?" })).toBeNull());
  });

  test("treats expiry as terminal and directs the administrator to create a new invitation", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue({ ...INVITATION, status: "EXPIRED" });
    render(<InvitationReviewWorkspace invitationId={INVITATION_ID} />);
    expect(await screen.findByText(/expired and cannot be resent/i)).toBeDefined();
    expect(screen.getByRole("link", { name: "Create new invitation" }).getAttribute("href")).toBe("/admin/people/invite");
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
  });

  test("shows person and append-only history without duplicate event rendering", async () => {
    clientMocks.foundation.getPerson.mockResolvedValue({ person: PERSON });
    render(<PersonWorkspace principalId={PRINCIPAL_ID} />);
    expect(await screen.findByRole("heading", { name: "Synthetic Area Manager" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Manage access" }).getAttribute("href")).toContain("/access");
    cleanup();

    clientMocks.foundation.getPersonHistory.mockResolvedValue({ events: [{
      id: "history-event", action: "role_assignment.granted", resourceType: "role_assignment",
      occurredAt: "2026-08-11T12:00:00.000Z", actorDisplayName: "Synthetic Administrator", reasonRecorded: true,
    }] });
    render(<PersonHistoryWorkspace principalId={PRINCIPAL_ID} />);
    // Was "role assignment.granted" — the raw audit code with its underscores
    // swapped, dot and all. Still exactly one occurrence: this test also guards
    // the history against rendering an event twice.
    expect(await screen.findAllByText("Role granted")).toHaveLength(1);
    expect(screen.getAllByText("A reason was recorded.")).toHaveLength(1);
  });

  test("does not suspend or revoke until an action-specific confirmation is completed", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.suspendPerson.mockResolvedValue({ principalId: PRINCIPAL_ID, status: "suspended", lockVersion: 3 });
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspend access" }));
    expect(clientMocks.foundation.suspendPerson).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "Suspend access?" });
    expect(within(dialog).getByText("Synthetic Area Manager")).toBeDefined();
    expect(within(dialog).getByText(/takes effect immediately/i)).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText("Suspension reason"), { target: { value: "Temporary access hold" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend access" }));
    await waitFor(() => expect(clientMocks.foundation.suspendPerson).toHaveBeenCalledWith(PRINCIPAL_ID, { reason: "Temporary access hold", lockVersion: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Suspend access?" })).toBeNull());
    cleanup();

    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.revokePerson.mockResolvedValue({ principalId: PRINCIPAL_ID, status: "revoked", lockVersion: 3 });
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke permanently" }));
    expect(clientMocks.foundation.revokePerson).not.toHaveBeenCalled();
    dialog = screen.getByRole("dialog", { name: "Revoke access permanently?" });
    expect(within(dialog).getByText(/Revocation is terminal/i)).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText("Revocation reason"), { target: { value: "Permanent access withdrawal" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke permanently" }));
    await waitFor(() => expect(clientMocks.foundation.revokePerson).toHaveBeenCalledWith(PRINCIPAL_ID, { reason: "Permanent access withdrawal", lockVersion: 2 }));
  });

  test("keeps suspend confirmation open and shows last-administrator failure inside it", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.suspendPerson.mockRejectedValue(safeBackendError("last_administrator"));
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspend access" }));
    let dialog = screen.getByRole("dialog", { name: "Suspend access?" });
    const reason = within(dialog).getByLabelText("Suspension reason") as HTMLTextAreaElement;
    fireEvent.change(reason, { target: { value: "Attempted final administrator suspension" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend access" }));

    dialog = await screen.findByRole("dialog", { name: "Suspend access?" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/retain at least one active System Administrator/i);
    expect(alert.textContent).not.toContain("internal detail");
    expect((within(dialog).getByLabelText("Suspension reason") as HTMLTextAreaElement).value).toBe("Attempted final administrator suspension");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Suspend access" }).hasAttribute("disabled")).toBe(false));
    expect(screen.getByText("Active")).toBeDefined();
  });

  test("keeps revoke confirmation open and shows stale-version guidance inside it", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.revokePerson.mockRejectedValue(safeBackendError("version_conflict", ErrCode.Aborted));
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke permanently" }));
    let dialog = screen.getByRole("dialog", { name: "Revoke access permanently?" });
    fireEvent.change(within(dialog).getByLabelText("Revocation reason"), { target: { value: "Reviewed revocation request" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke permanently" }));

    dialog = await screen.findByRole("dialog", { name: "Revoke access permanently?" });
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/changed while you were editing.*Refresh and review/i);
    expect((within(dialog).getByLabelText("Revocation reason") as HTMLTextAreaElement).value).toBe("Reviewed revocation request");
  });

  test("keeps cancellation open and shows permission denial inside it", async () => {
    clientMocks.foundation.getInvitation.mockResolvedValue(INVITATION);
    clientMocks.foundation.cancelInvitationEndpoint.mockRejectedValue(new APIError(403, {
      code: ErrCode.PermissionDenied,
      message: "sensitive permission detail",
    }));
    render(<InvitationReviewWorkspace invitationId={INVITATION_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel invitation" }));
    let dialog = screen.getByRole("dialog", { name: "Cancel invitation?" });
    fireEvent.change(within(dialog).getByLabelText("Cancellation reason"), { target: { value: "Reviewed cancellation request" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel invitation" }));

    dialog = await screen.findByRole("dialog", { name: "Cancel invitation?" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/current Centre Success access does not allow/i);
    expect(alert.textContent).not.toContain("sensitive permission detail");
    expect((within(dialog).getByLabelText("Cancellation reason") as HTMLTextAreaElement).value).toBe("Reviewed cancellation request");
  });

  test("shows independent-approval and unknown assignment failures inside the open dialog", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.removePersonAssignment.mockRejectedValue(safeBackendError("privileged_approval_required"));
    const view = render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "End assignment" }));
    let dialog = screen.getByRole("dialog", { name: "End assignment?" });
    fireEvent.change(within(dialog).getByLabelText("Assignment end reason"), { target: { value: "Reviewed assignment ending" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End assignment" }));
    dialog = await screen.findByRole("dialog", { name: "End assignment?" });
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/another authorised System Administrator/i);
    view.unmount();

    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.removePersonAssignment.mockRejectedValue(new Error("sensitive unknown failure"));
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "End assignment" }));
    dialog = screen.getByRole("dialog", { name: "End assignment?" });
    fireEvent.change(within(dialog).getByLabelText("Assignment end reason"), { target: { value: "Second reviewed ending" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End assignment" }));
    dialog = await screen.findByRole("dialog", { name: "End assignment?" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/could not be completed.*Refresh and try again/i);
    expect(alert.textContent).not.toContain("sensitive unknown failure");
  });

  test("edits an Area Manager portfolio from one to two centres and disables a no-op save", async () => {
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: PERSON });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.replacePersonAssignmentScope.mockResolvedValue({ person: areaManagerPerson([CENTRES[0][0], CENTRES[1][0]], 3) });
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit centre portfolio" }));
    const dialog = screen.getByRole("dialog", { name: "Edit centre portfolio" });
    expect((within(dialog).getByLabelText("Synthetic North Centre") as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Save full portfolio" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("Synthetic South Centre"));
    fireEvent.change(within(dialog).getByLabelText("Portfolio change reason"), { target: { value: "Expand regional portfolio" } });
    expect(within(dialog).getByText("Resulting portfolio")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save full portfolio" }));
    await waitFor(() => expect(clientMocks.foundation.replacePersonAssignmentScope).toHaveBeenCalledWith(PRINCIPAL_ID, PERSON.assignments[0].id, {
      principalLockVersion: 2,
      reason: "Expand regional portfolio",
      replacementScopes: [{ scopeType: "centre", centreId: CENTRES[0][0] }, { scopeType: "centre", centreId: CENTRES[1][0] }],
    }));
  });

  test("edits an Area Manager portfolio from five to four centres without dropping the remaining set", async () => {
    const fiveCentrePerson = areaManagerPerson(CENTRES.map(([id]) => id));
    clientMocks.foundation.getPersonAccess.mockResolvedValue({ person: fiveCentrePerson });
    clientMocks.foundation.getPeopleOptions.mockResolvedValue(OPTIONS);
    clientMocks.foundation.replacePersonAssignmentScope.mockResolvedValue({ person: areaManagerPerson(CENTRES.slice(0, 4).map(([id]) => id), 3) });
    render(<PersonAccessWorkspace principalId={PRINCIPAL_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit centre portfolio" }));
    const dialog = screen.getByRole("dialog", { name: "Edit centre portfolio" });
    fireEvent.click(within(dialog).getByLabelText("Synthetic Central Centre"));
    fireEvent.change(within(dialog).getByLabelText("Portfolio change reason"), { target: { value: "Remove one centre only" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save full portfolio" }));
    await waitFor(() => expect(clientMocks.foundation.replacePersonAssignmentScope).toHaveBeenCalledWith(PRINCIPAL_ID, fiveCentrePerson.assignments[0].id, expect.objectContaining({
      replacementScopes: CENTRES.slice(0, 4).map(([centreId]) => ({ scopeType: "centre", centreId })),
    })));
  });

  test("maps protected-administrator, stale-version and independent-approval errors to safe guidance", () => {
    expect(peopleAccessFailureMessage(new APIError(409, { code: ErrCode.FailedPrecondition, message: "denied", details: { reason: "last_administrator" } }))).toMatch(/retain at least one active System Administrator/i);
    expect(peopleAccessFailureMessage(new APIError(409, { code: ErrCode.Aborted, message: "conflict", details: { reason: "version_conflict" } }))).toMatch(/changed while you were editing/i);
    expect(peopleAccessFailureMessage(new APIError(403, { code: ErrCode.PermissionDenied, message: "denied", details: { reason: "independent_approval_required" } }))).toMatch(/another authorised System Administrator/i);
  });

  test("candidate signs in, submits the opaque code in the request body and sees safe outcomes", async () => {
    authMocks.state = { kind: "signed-out" };
    const view = render(<InvitationAcceptanceWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Bright Steps Microsoft" }));
    expect(authMocks.signIn).toHaveBeenCalledOnce();
    view.unmount();

    authMocks.state = { kind: "signed-in", accountKey: "candidate-account" };
    clientMocks.foundation.acceptInvitation.mockResolvedValue({ outcome: "awaiting_approval", invitationStatus: "AWAITING_PRIVILEGED_APPROVAL" });
    render(<InvitationAcceptanceWorkspace />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "opaque-body-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("heading", { name: "Awaiting independent approval" })).toBeDefined();
    expect(clientMocks.foundation.acceptInvitation).toHaveBeenCalledWith({ invitationToken: "opaque-body-code" });
    expect(document.body.textContent).not.toContain("opaque-body-code");
  });

  test("tells a candidate that an expired invitation needs a newly created invitation", async () => {
    clientMocks.foundation.acceptInvitation.mockRejectedValue({ details: { reason: "invitation_expired" } });
    render(<InvitationAcceptanceWorkspace />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "expired-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("heading", { name: "Invitation expired" })).toBeDefined();
    expect(screen.getByText(/create a new invitation/i)).toBeDefined();
    expect(screen.queryByText(/rotate and resend/i)).toBeNull();
  });

  test.each([
    ["invitation_expired", "Invitation expired"],
    ["invitation_cancelled", "Invitation unavailable"],
    ["identity_review_required", "Administrator review required"],
  ])("clears a spent code from the field (%s)", async (reason, heading) => {
    // Nothing the candidate does will make a spent code work. Leaving it in the
    // field invites a pointless resubmission and leaves a dead secret on screen
    // for whoever is standing behind them.
    clientMocks.foundation.acceptInvitation.mockRejectedValue({ details: { reason } });
    render(<InvitationAcceptanceWorkspace />);
    const field = screen.getByLabelText("Invitation code") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "spent-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    expect(await screen.findByRole("heading", { name: heading })).toBeDefined();
    expect((screen.getByLabelText("Invitation code") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("spent-code");
  });

  test("keeps a code the candidate is being asked to check", async () => {
    // The counterpart. This outcome tells the reader to check the code and try
    // again, which they cannot do if it has been taken away from them.
    clientMocks.foundation.acceptInvitation.mockRejectedValue({ details: { reason: "unknown_failure" } });
    render(<InvitationAcceptanceWorkspace />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "mistyped-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    expect(await screen.findByRole("heading", { name: "Invitation could not be verified" })).toBeDefined();
    expect((screen.getByLabelText("Invitation code") as HTMLInputElement).value).toBe("mistyped-code");
  });
});
