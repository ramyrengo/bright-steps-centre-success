import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { APIError, ErrCode } from "../lib/client.generated";

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve()),
}));
const clientMocks = vi.hoisted(() => {
  const getDailySuccess = vi.fn();
  return {
    getDailySuccess,
    client: { foundation: { getDailySuccess, getAuthorisedNavigationEndpoint: vi.fn(() => Promise.resolve({ cacheControl: "private, no-store", links: [] })) } },
  };
});

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "daily-test" },
    signOut: authMocks.signOut,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import { DailySuccessHome } from "./daily-success-home";

const CENTRE = "00000000-0000-4000-8000-000000000101";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "corrective_action:action-1",
    sourceType: "corrective_action",
    sourceId: "action-1",
    centreId: CENTRE,
    centreName: "Synthetic North Centre",
    headline: "Critical safety follow-up",
    summary: "Corrective action remains active",
    attentionBand: "URGENT",
    responsibility: "YOU_NEED_TO_ACT",
    whyShown: { code: "CRITICAL_RISK", label: "Critical risk needs attention" },
    due: { at: "2026-08-12T03:00:00.000Z", timezone: "Australia/Sydney", localDate: "2026-08-12", bucket: "TODAY", daysFromToday: 0 },
    riskLevel: "CRITICAL",
    cta: { label: "Continue action", route: "/centre/actions/action-1" },
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-12T01:00:00.000Z",
    status: "ready",
    activePerspective: { kind: "centre", label: "Synthetic North Centre", centreId: CENTRE, centreName: "Synthetic North Centre" },
    availablePerspectives: [{ kind: "centre", label: "Synthetic North Centre", centreId: CENTRE, centreName: "Synthetic North Centre" }],
    businessDates: [{ scope: "centre", id: CENTRE, timezone: "Australia/Sydney", date: "2026-08-12" }],
    sections: [
      { key: "DO_FIRST", label: "DO FIRST", items: [item()] },
      { key: "TODAY", label: "TODAY", items: [] },
      { key: "NEXT", label: "NEXT", items: [] },
      { key: "WAITING", label: "WAITING", items: [] },
      { key: "ON_TRACK", label: "ON TRACK", items: [] },
    ],
    attentionCentres: [], verificationItems: [],
    aggregateCounts: { coverage: "complete", active: 1, urgent: 1, dueToday: 1, waiting: 0, distinctCentres: 1 },
    positiveContext: { completedTodayCount: 1, recentTitles: ["Completed synthetic check"] },
    sourceHealth: [
      { source: "corrective_actions", status: "available" },
      { source: "quarterly_reviews", status: "available" },
      { source: "people_access", status: "not_applicable" },
    ],
    authorisationHealth: { status: "available" },
    workspaceLinks: [{ label: "Centre actions", route: "/centre" }],
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  clientMocks.getDailySuccess.mockReset();
  authMocks.signOut.mockClear();
});
afterEach(cleanup);

describe("Milestone 3A Daily Success home", () => {
  test("renders loading then the Centre Director priority with why, when, responsibility, and one CTA", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    clientMocks.getDailySuccess.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<DailySuccessHome displayName="Synthetic Centre Director" />);
    expect(screen.getByRole("status").textContent).toContain("Checking today's authorised priorities");
    resolve(response());
    expect(await screen.findByRole("heading", { name: "Good morning, Synthetic Centre Director" })).toBeDefined();
    expect(screen.getByText(/as at 11:00 am/i)).toBeDefined();
    const card = screen.getByRole("heading", { name: "Critical safety follow-up" }).closest("li")!;
    expect(within(card).getByText("CRITICAL")).toBeDefined();
    expect(within(card).getByText("You need to act")).toBeDefined();
    expect(within(card).getByText("Critical risk needs attention")).toBeDefined();
    expect(within(card).getByText("Due today")).toBeDefined();
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/centre/actions/action-1");
  });

  test("marks staging pilot work on the card a Director actually reads", async () => {
    // A synthetic Centre Standard carries a notice on its own screen. Daily
    // Success is where it is first read, so the marker has to arrive here too —
    // otherwise pilot content sits in a real list looking like real work.
    clientMocks.getDailySuccess.mockResolvedValue(response({
      sections: [
        { key: "DO_FIRST", label: "DO FIRST", items: [item()] },
        {
          key: "TODAY",
          label: "TODAY",
          items: [item({
            id: "operational_check:occurrence-1",
            sourceType: "operational_check",
            sourceId: "occurrence-1",
            headline: "Centre Standards Pilot — Staging",
            summary: "A Centre Standard check is due today",
            attentionBand: "TODAY",
            riskLevel: "STANDARD",
            whyShown: { code: "CHECK_DUE_TODAY", label: "Centre Standard check is due today" },
            synthetic: true,
            cta: { label: "Complete check", route: "/standards/checks/occurrence-1" },
          })],
        },
        { key: "NEXT", label: "NEXT", items: [] },
        { key: "WAITING", label: "WAITING", items: [] },
        { key: "ON_TRACK", label: "ON TRACK", items: [] },
      ],
    }));
    render(<DailySuccessHome displayName="Synthetic Centre Director" />);

    const pilot = (await screen.findByRole("heading", { name: "Centre Standards Pilot — Staging" })).closest("li")!;
    expect(within(pilot).getByText("Staging test content")).toBeDefined();

    // The marker is carried, not painted on every card. Real work in the same
    // response stays unmarked, or the marker means nothing.
    const real = screen.getByRole("heading", { name: "Critical safety follow-up" }).closest("li")!;
    expect(within(real).queryByText("Staging test content")).toBeNull();
  });

  test("supports portfolio centre prioritisation and a two-column-ready semantic list", async () => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      activePerspective: { kind: "portfolio", label: "Area Manager portfolio" },
      availablePerspectives: [{ kind: "portfolio", label: "Area Manager portfolio" }],
      attentionCentres: [{
        centreId: CENTRE, centreName: "Synthetic North Centre", attentionBand: "URGENT",
        headline: "Critical safety follow-up", criticalCount: 1, overdueCount: 0,
        dueTodayCount: 1, totalActiveCount: 1, coverage: "complete",
        cta: { label: "Open Area Manager workspace", route: "/area-manager" },
      }],
      positiveContext: { completedTodayCount: 0, recentTitles: [], onTrackCentreCount: 4 },
    }));
    render(<DailySuccessHome displayName="Synthetic Area Manager" />);
    expect(await screen.findByRole("heading", { name: "Centres needing attention" })).toBeDefined();
    expect(screen.getByText("1 critical · 0 overdue · 1 due today")).toBeDefined();
    expect(screen.getByText("4 centres on track")).toBeDefined();
  });

  test("renders the Area Manager verification queue in risk order with controlled source CTAs", async () => {
    const criticalVerification = item({
      id: "corrective_action:critical-verification",
      sourceId: "00000000-0000-4000-8000-000000000401",
      headline: "Verify critical remediation",
      verification: { required: true, eligible: true },
      cta: { label: "Verify action", route: "/area-manager/verification/00000000-0000-4000-8000-000000000401" },
    });
    const highVerification = item({
      id: "corrective_action:high-verification",
      sourceId: "00000000-0000-4000-8000-000000000402",
      headline: "Verify high remediation",
      riskLevel: "HIGH",
      attentionBand: "TODAY",
      verification: { required: true, eligible: true },
      cta: { label: "Verify action", route: "/area-manager/verification/00000000-0000-4000-8000-000000000402" },
    });
    clientMocks.getDailySuccess.mockResolvedValue(response({
      activePerspective: { kind: "portfolio", label: "Area Manager portfolio" },
      availablePerspectives: [{ kind: "portfolio", label: "Area Manager portfolio" }],
      verificationItems: [criticalVerification, highVerification],
    }));
    render(<DailySuccessHome displayName="Synthetic Area Manager" />);
    const section = (await screen.findByRole("heading", { name: "VERIFY TODAY" })).closest("section")!;
    const cards = within(section).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Verify critical remediation")).toBeDefined();
    expect(within(cards[0]).getByText("CRITICAL")).toBeDefined();
    expect(within(cards[0]).getByText("Synthetic North Centre")).toBeDefined();
    expect(within(cards[0]).getByText("Critical risk needs attention")).toBeDefined();
    expect(within(cards[0]).getByRole("link", { name: "Verify action" }).getAttribute("href"))
      .toBe("/area-manager/verification/00000000-0000-4000-8000-000000000401");
    expect(within(cards[1]).getByText("Verify high remediation")).toBeDefined();
  });

  test("does not clutter an Area Manager response with an empty verification queue", async () => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      activePerspective: { kind: "portfolio", label: "Area Manager portfolio" },
      availablePerspectives: [{ kind: "portfolio", label: "Area Manager portfolio" }],
      verificationItems: [],
    }));
    render(<DailySuccessHome displayName="Synthetic Area Manager" />);
    expect(await screen.findByRole("heading", { name: "Portfolio priorities" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "VERIFY TODAY" })).toBeNull();
  });

  test.each([
    ["compliance", "Synthetic Compliance Manager", "Compliance exceptions", "Compliance exceptions"],
    ["administration", "Synthetic System Administrator", "People & Access administration", "People & Access attention"],
  ])("renders the %s perspective without inferred navigation", async (kind, displayName, label, summaryHeading) => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      activePerspective: { kind, label },
      availablePerspectives: [{ kind, label }],
      workspaceLinks: kind === "administration"
        ? [{ label: "People & Access", route: "/admin/people" }]
        : [{ label: "Compliance oversight", route: "/compliance" }],
    }));
    render(<DailySuccessHome displayName={displayName} />);
    expect(await screen.findByRole("heading", { name: summaryHeading })).toBeDefined();
    const navigation = screen.getByRole("navigation", { name: "Authorised Centre Success workspaces" });
    expect(within(navigation).getAllByRole("link")).toHaveLength(1);
  });

  test("keeps multiple-perspective selection in session presentation state and re-requests authority", async () => {
    clientMocks.getDailySuccess
      .mockResolvedValueOnce(response({
        status: "selection_required",
        activePerspective: undefined,
        availablePerspectives: [
          { kind: "centre", label: "Synthetic North Centre", centreId: CENTRE },
          { kind: "portfolio", label: "Area Manager portfolio" },
        ],
        sections: [], positiveContext: undefined,
      }))
      .mockResolvedValueOnce(response());
    render(<DailySuccessHome displayName="Synthetic Multi-role User" />);
    fireEvent.click(await screen.findByRole("button", { name: "Synthetic North Centre" }));
    await waitFor(() => expect(clientMocks.getDailySuccess).toHaveBeenLastCalledWith({ perspective: "centre", centreId: CENTRE }));
    expect(window.sessionStorage.getItem("centre-success.daily-perspective")).toBe(`centre:${CENTRE}`);
  });

  test("recovers from a revoked selected perspective by showing currently available choices", async () => {
    window.sessionStorage.setItem("centre-success.daily-perspective", `centre:${CENTRE}`);
    clientMocks.getDailySuccess
      .mockResolvedValueOnce(response({
        status: "selection_required",
        activePerspective: undefined,
        availablePerspectives: [
          { kind: "centre", label: "Synthetic North Centre", centreId: CENTRE },
          { kind: "portfolio", label: "Area Manager portfolio" },
        ],
        sections: [],
        positiveContext: undefined,
      }))
      .mockRejectedValueOnce(new APIError(403, { code: ErrCode.PermissionDenied, message: "revoked" }))
      .mockResolvedValueOnce(response({
        status: "selection_required",
        activePerspective: undefined,
        availablePerspectives: [
          { kind: "portfolio", label: "Area Manager portfolio" },
          { kind: "compliance", label: "Compliance exceptions" },
        ],
        sections: [],
        positiveContext: undefined,
      }));
    render(<DailySuccessHome displayName="Synthetic Multi-role User" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Choose your Daily Success view" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Area Manager portfolio" })).toBeDefined();
    expect(window.sessionStorage.getItem("centre-success.daily-perspective")).toBeNull();
    expect(clientMocks.getDailySuccess).toHaveBeenNthCalledWith(1, {});
    expect(clientMocks.getDailySuccess).toHaveBeenNthCalledWith(2, { perspective: "centre", centreId: CENTRE });
    expect(clientMocks.getDailySuccess).toHaveBeenNthCalledWith(3, {});
  });

  test("renders safe unsupported, partial, denied, and retryable failure states", async () => {
    clientMocks.getDailySuccess.mockResolvedValueOnce(response({
      status: "unsupported", activePerspective: undefined, availablePerspectives: [], sections: [],
      positiveContext: undefined, workspaceLinks: [],
    }));
    const view = render(<DailySuccessHome displayName="Synthetic Unsupported User" />);
    expect(await screen.findByRole("heading", { name: "No Daily Success perspective available" })).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
    view.unmount();

    clientMocks.getDailySuccess.mockResolvedValueOnce(response({
      status: "partial",
      warning: "Some priorities could not be checked.",
      positiveContext: undefined,
      sections: [
        { key: "DO_FIRST", label: "DO FIRST", items: [] },
        { key: "TODAY", label: "TODAY", items: [] },
        { key: "NEXT", label: "NEXT", items: [] },
        { key: "WAITING", label: "WAITING", items: [] },
        { key: "ON_TRACK", label: "ON TRACK", items: [] },
      ],
    }));
    render(<DailySuccessHome displayName="Synthetic Partial User" />);
    expect(await screen.findByText("Some priorities could not be checked.")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Priorities partially available" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "On track" })).toBeNull();
    expect(screen.queryByText(/centres on track/i)).toBeNull();
    cleanup();

    clientMocks.getDailySuccess.mockRejectedValueOnce(new APIError(403, { code: ErrCode.PermissionDenied, message: "denied" }));
    render(<DailySuccessHome displayName="Synthetic Denied User" />);
    expect(await screen.findByRole("heading", { name: "Daily Success unavailable" })).toBeDefined();
    cleanup();

    clientMocks.getDailySuccess
      .mockRejectedValueOnce(new Error("internal detail"))
      .mockResolvedValueOnce(response());
    render(<DailySuccessHome displayName="Synthetic Retry User" />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Good morning, Synthetic Retry User" })).toBeDefined();
    expect(screen.queryByText("internal detail")).toBeNull();
  });

  test("renders partial portfolio centre coverage without fabricated zero counts", async () => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      status: "partial",
      warning: "Some priorities could not be checked.",
      activePerspective: { kind: "portfolio", label: "Area Manager portfolio" },
      availablePerspectives: [{ kind: "portfolio", label: "Area Manager portfolio" }],
      attentionCentres: [{
        centreId: CENTRE,
        centreName: "Synthetic North Centre",
        attentionBand: "UPCOMING",
        headline: "Continue quarterly review",
        coverage: "partial",
        cta: { label: "Open Area Manager workspace", route: "/area-manager" },
      }],
      aggregateCounts: { coverage: "partial" },
      positiveContext: { completedTodayCount: 0, recentTitles: [] },
    }));
    render(<DailySuccessHome displayName="Synthetic Area Manager" />);
    expect(await screen.findByText("Critical, overdue and due-today counts: not fully checked")).toBeDefined();
    expect(screen.queryByText("0 critical · 0 overdue · 0 due today")).toBeNull();
    expect(screen.queryByText(/centres on track/i)).toBeNull();
  });

  test("renders an honest empty/on-track state only from a complete response", async () => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      sections: [
        { key: "DO_FIRST", label: "DO FIRST", items: [] },
        { key: "TODAY", label: "TODAY", items: [] },
        { key: "NEXT", label: "NEXT", items: [] },
        { key: "WAITING", label: "WAITING", items: [] },
        { key: "ON_TRACK", label: "ON TRACK", items: [] },
      ],
      aggregateCounts: { coverage: "complete", active: 0, urgent: 0, dueToday: 0, waiting: 0, distinctCentres: 0 },
      positiveContext: { completedTodayCount: 0, recentTitles: [] },
    }));
    render(<DailySuccessHome displayName="Synthetic Centre Director" />);
    expect(await screen.findByRole("heading", { name: "On track" })).toBeDefined();
    expect(screen.getByText("No active priorities need attention in this view right now.")).toBeDefined();
  });
});
