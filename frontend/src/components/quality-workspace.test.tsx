import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { APIError, ErrCode } from "../lib/client.generated";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
const clientMocks = vi.hoisted(() => {
  const getCentreQualityWorkspace = vi.fn();
  const getCentreQualityDetail = vi.fn();
  return {
    getCentreQualityWorkspace,
    getCentreQualityDetail,
    client: { foundation: { getCentreQualityWorkspace, getCentreQualityDetail } },
  };
});

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "quality-test" },
    signOut: authMocks.signOut,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import { QualityCentreDetail } from "./quality-centre-detail";
import { QualityWorkspace } from "./quality-workspace";

const CENTRE_A = "00000000-0000-4000-8000-0000000000a1";
const CENTRE_B = "00000000-0000-4000-8000-0000000000b2";
const CENTRE_C = "00000000-0000-4000-8000-0000000000c3";

function review(overrides: Record<string, unknown> = {}) {
  return {
    auditRunId: "run-1",
    reviewPeriodStart: "2026-04-01",
    quarterLabel: "Q2 2026",
    finalisedAt: "2026-04-20T02:00:00.000Z",
    templateVersionId: "template-1",
    overallScore: 91,
    performanceBandLabel: "Strong",
    coveragePercent: 100,
    criticalFindingCount: 0,
    highFindingCount: 1,
    actionCount: 2,
    positivePracticeCount: 3,
    acknowledged: true,
    ...overrides,
  };
}

function actions(overrides: Record<string, unknown> = {}) {
  return {
    total: 0,
    critical: 0,
    overdue: 0,
    dueSoon: 0,
    awaitingVerification: 0,
    returned: 0,
    yourAction: 0,
    centreAction: 0,
    waiting: 0,
    ...overrides,
  };
}

function centre(overrides: Record<string, unknown> = {}) {
  return {
    centreId: CENTRE_A,
    centreName: "Zephyr Quality Centre",
    timezone: "Australia/Sydney",
    localDate: "2026-08-12",
    focus: "NEEDS_SUPPORT",
    focusReason: "A critical corrective action is still open",
    latestReview: review(),
    comparison: {
      available: true,
      comparable: true,
      trend: "IMPROVED",
      previous: review({ auditRunId: "run-0", quarterLabel: "Q1 2026", overallScore: 84 }),
      scoreDelta: 7,
      criticalDelta: -2,
    },
    actions: actions({ total: 2, critical: 1, yourAction: 1 }),
    uncoveredCriticalFindings: 0,
    strengthsCount: 3,
    completedLast30Days: 4,
    cta: { label: "Open centre quality", route: `/quality/centres/${CENTRE_A}` },
    ...overrides,
  };
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-12T02:00:00.000Z",
    status: "ready",
    activeView: { kind: "centre", label: "Zephyr Quality Centre", centreId: CENTRE_A, centreName: "Zephyr Quality Centre" },
    availableViews: [
      { kind: "centre", label: "Zephyr Quality Centre", centreId: CENTRE_A, centreName: "Zephyr Quality Centre" },
    ],
    organisationTimezone: "Australia/Sydney",
    centres: [centre()],
    focusGroups: [],
    summary: { coverage: "complete", centreCount: 1 },
    sourceHealth: [
      { source: "quarterly_reviews", status: "available" },
      { source: "corrective_actions", status: "available" },
    ],
    authorisationHealth: { status: "available" },
    ...overrides,
  };
}

function portfolio() {
  const needsSupport = centre();
  const awaiting = centre({
    centreId: CENTRE_C,
    centreName: "Belmore Quality Centre",
    focus: "AWAITING_FIRST_REVIEW",
    focusReason: "No finalised internal review has been recorded for this centre yet",
    latestReview: undefined,
    comparison: { available: false, comparable: false, trend: "NOT_COMPARABLE" },
    actions: actions(),
    strengthsCount: 0,
    completedLast30Days: 0,
    cta: { label: "Open centre quality", route: `/quality/centres/${CENTRE_C}` },
  });
  const steady = centre({
    centreId: CENTRE_B,
    centreName: "Ashgrove Quality Centre",
    focus: "STEADY",
    focusReason: "No open corrective actions after the Q2 2026 internal review",
    latestReview: review({ auditRunId: "run-2", overallScore: 96 }),
    comparison: {
      available: false,
      comparable: false,
      trend: "NOT_COMPARABLE",
      note: "No earlier finalised review is available for this centre.",
    },
    actions: actions(),
    completedLast30Days: 0,
    cta: { label: "Open centre quality", route: `/quality/centres/${CENTRE_B}` },
  });
  return workspace({
    activeView: { kind: "portfolio", label: "Area Manager portfolio" },
    availableViews: [{ kind: "portfolio", label: "Area Manager portfolio" }],
    centres: [needsSupport, awaiting, steady],
    focusGroups: [
      { focus: "NEEDS_SUPPORT", label: "Needs support now", description: "Critical or overdue work where a centre is likely to need help.", centreIds: [CENTRE_A] },
      { focus: "AWAITING_FIRST_REVIEW", label: "Awaiting first review", description: "No finalised internal review has been recorded yet.", centreIds: [CENTRE_C] },
      { focus: "STEADY", label: "Steady", description: "No open corrective actions after the most recent internal review.", centreIds: [CENTRE_B] },
    ],
    summary: {
      coverage: "complete",
      centreCount: 3,
      needsSupportCount: 1,
      monitorCount: 0,
      steadyCount: 1,
      awaitingFirstReviewCount: 1,
      openCriticalCount: 1,
      overdueCount: 0,
      awaitingVerificationCount: 1,
    },
  });
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-12T02:00:00.000Z",
    status: "ready",
    centre: centre(),
    openActions: [
      {
        correctiveActionId: "action-critical",
        title: "Replace the damaged outdoor gate latch",
        severity: "CRITICAL",
        status: "IN_PROGRESS",
        statusLabel: "In progress",
        responsibility: "YOU_NEED_TO_ACT",
        dueAt: "2026-08-20T02:00:00.000Z",
        dueLocalDate: "2026-08-20",
        dueBucket: "DUE_SOON",
        daysFromToday: 8,
        independentVerificationRequired: false,
        cta: { label: "Continue action", route: "/centre/actions/action-critical" },
      },
      {
        correctiveActionId: "action-waiting",
        title: "Update the nappy-change record sheet",
        severity: "HIGH",
        status: "VERIFICATION_REQUIRED",
        statusLabel: "Waiting for verification",
        responsibility: "WAITING_ON_SOMEONE_ELSE",
        dueAt: "2026-08-25T02:00:00.000Z",
        dueLocalDate: "2026-08-25",
        dueBucket: "LATER",
        daysFromToday: 13,
        independentVerificationRequired: true,
        cta: { label: "Review action", route: "/centre/actions/action-waiting" },
      },
    ],
    completedActions: [
      {
        correctiveActionId: "action-closed",
        title: "Refresh the emergency evacuation diagram",
        severity: "MEDIUM",
        closedAt: "2026-08-05T02:00:00.000Z",
        closedLocalDate: "2026-08-05",
        cta: { label: "Review action", route: "/centre/actions/action-closed" },
      },
    ],
    strengths: [
      {
        positiveObservationId: "positive-1",
        description: "Educators consistently model calm transitions.",
        quarterLabel: "Q2 2026",
      },
    ],
    uncoveredFindings: [],
    reviewHistory: [review(), review({ auditRunId: "run-0", quarterLabel: "Q1 2026", overallScore: 84 })],
    canAcknowledgeReview: false,
    sourceHealth: [
      { source: "quarterly_reviews", status: "available" },
      { source: "corrective_actions", status: "available" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  clientMocks.getCentreQualityWorkspace.mockReset();
  clientMocks.getCentreQualityDetail.mockReset();
});
afterEach(cleanup);

describe("Quality & Performance workspace", () => {
  test("shows a Centre Director where their centre stands and what needs them", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" })).toBeDefined();
    expect(screen.getByText("A critical corrective action is still open")).toBeDefined();
    expect(screen.getByText("Needs you")).toBeDefined();
    expect(document.querySelector(".quality-review-line__quarter")?.textContent)
      .toContain("Q2 2026 internal review");
    expect(screen.getByText("Bright Steps internal review")).toBeDefined();
  });

  test("shows a comparable previous quarter as a labelled trend, not colour alone", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    const trends = document.querySelectorAll('[data-direction="IMPROVED"]');
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0].textContent).toContain("Improved");
    expect(trends[0].textContent).toContain("+7 vs Q1 2026");
  });

  test("groups an Area Manager portfolio by support needed and never ranks centres", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    expect(screen.getByRole("heading", { name: /Needs support now/u })).toBeDefined();
    expect(screen.getByRole("heading", { name: /Awaiting first review/u })).toBeDefined();
    expect(screen.getByRole("heading", { name: /Steady/u })).toBeDefined();
    expect(screen.getByText("One centre could use your support this week")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/\brank|league|\bbest\b|\bworst\b/iu);
  });

  test("says a centre has no review yet instead of showing a zero score", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    const card = screen.getByText("Belmore Quality Centre").closest("li");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getAllByText(/No finalised internal review has been recorded/u).length)
      .toBeGreaterThan(0);
    expect(within(card as HTMLElement).queryByText("0%")).toBeNull();
    expect(within(card as HTMLElement).getByText("No review yet")).toBeDefined();
  });

  test("says there is no previous quarter rather than implying a flat trend", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    const card = screen.getByText("Ashgrove Quality Centre").closest("li");
    expect(within(card as HTMLElement).getByText("No previous quarter to compare")).toBeDefined();
    expect((card as HTMLElement).querySelector('[data-direction="STEADY"]')).toBeNull();
  });

  test("offers no quality view to a principal without a business grant", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(
      workspace({ status: "unsupported", activeView: undefined, availableViews: [], centres: [] }),
    );
    render(<QualityWorkspace />);

    expect(await screen.findByText("No quality view is assigned to you")).toBeDefined();
    expect(screen.getByText(/Technical administration alone does not grant this view/u)).toBeDefined();
  });

  test("lets a multi-view principal choose, and remembers the choice for the session", async () => {
    const selection = workspace({
      status: "selection_required",
      activeView: undefined,
      availableViews: [
        { kind: "portfolio", label: "Area Manager portfolio" },
        { kind: "organisation", label: "Organisation quality oversight" },
      ],
      centres: [],
    });
    clientMocks.getCentreQualityWorkspace.mockResolvedValueOnce(selection).mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: /Area Manager portfolio/u }));
    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    expect(window.sessionStorage.getItem("centre-success.quality-view")).toBe("portfolio:");
    expect(clientMocks.getCentreQualityWorkspace).toHaveBeenLastCalledWith({ view: "portfolio" });
  });

  test("never assumes an all-clear when the request fails", async () => {
    clientMocks.getCentreQualityWorkspace.mockRejectedValue(new Error("network"));
    render(<QualityWorkspace />);

    expect(await screen.findByText("Centre quality could not be checked")).toBeDefined();
    expect(screen.getByText(/Nothing here should be read as an all-clear/u)).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  test("shows a denied state rather than an empty portfolio when access is refused", async () => {
    clientMocks.getCentreQualityWorkspace.mockRejectedValue(
      new APIError(403, { code: ErrCode.PermissionDenied, message: "denied", details: null }),
    );
    render(<QualityWorkspace />);

    expect(await screen.findByText("Centre quality is unavailable")).toBeDefined();
  });

  test("announces loading and keeps a partial result honest", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(
      workspace({
        status: "partial",
        warning: "Some quality facts could not be checked.",
        authorisationHealth: { status: "partial", warning: "Some centres could not be authorised safely and are not shown." },
      }),
    );
    render(<QualityWorkspace />);

    await waitFor(() =>
      expect(screen.getAllByText(/Some quality facts could not be checked/u).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/could not be authorised safely/u)).toBeDefined();
  });

  test("renders a skeleton with an accessible busy announcement while loading", () => {
    clientMocks.getCentreQualityWorkspace.mockReturnValue(new Promise(() => {}));
    render(<QualityWorkspace />);

    const status = screen.getAllByRole("status").find((node) => node.getAttribute("aria-busy") === "true");
    expect(status).toBeDefined();
    expect(status?.textContent).toContain("Checking centre quality.");
  });

  test("renders role-aware navigation from backend-authorised links only", async () => {
    window.sessionStorage.setItem(
      "centre-success.workspace-links",
      JSON.stringify([
        { label: "Quality & Performance", route: "/quality" },
        { label: "Centre actions", route: "/centre" },
      ]),
    );
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).getByRole("link", { name: "Daily Success" })).toBeDefined();
    expect(within(nav).getByRole("link", { name: "Quality & Performance" })).toBeDefined();
    expect(within(nav).queryByRole("link", { name: "People & Access" })).toBeNull();
    expect(
      within(nav).getByRole("link", { name: "Quality & Performance" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  test("ignores tampered navigation entries in browser storage", async () => {
    window.sessionStorage.setItem(
      "centre-success.workspace-links",
      JSON.stringify([{ label: "Evil", route: "https://example.test" }, { label: "Bad" }]),
    );
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).queryByRole("link", { name: "Evil" })).toBeNull();
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
  });
});

describe("Quality & Performance centre detail", () => {
  test("splits open work by who has to move next", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(detail());
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    expect(screen.getByRole("heading", { name: "Needs you" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Waiting on someone else" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Needs the centre" })).toBeNull();

    const waiting = screen.getByText("Update the nappy-change record sheet").closest("li");
    // The state is written both as a badge and as a labelled fact.
    expect(within(waiting as HTMLElement).getAllByText("Waiting for verification")).toHaveLength(2);
  });

  test("shows completed work, strengths and internal review history", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(detail());
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    expect(screen.getByText("Refresh the emergency evacuation diagram")).toBeDefined();
    expect(screen.getByText("Closed 2026-08-05")).toBeDefined();
    expect(screen.getByText("Educators consistently model calm transitions.")).toBeDefined();
    expect(screen.getByText("Q1 2026")).toBeDefined();
    expect(screen.getByText(/not a regulatory rating/u)).toBeDefined();
  });

  test("surfaces critical findings that have no active corrective action", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(
      detail({
        uncoveredFindings: [
          { findingId: "finding-1", headline: "Sleep-check records incomplete", severity: "CRITICAL", quarterLabel: "Q2 2026" },
        ],
      }),
    );
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    expect(
      await screen.findByRole("heading", { name: "Critical findings without an active action" }),
    ).toBeDefined();
    expect(screen.getByText("Sleep-check records incomplete")).toBeDefined();
  });

  test("uses an empty state, not a zero, when a centre has no open work", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(
      detail({
        openActions: [],
        completedActions: [],
        strengths: [],
        reviewHistory: [],
        centre: centre({ focus: "AWAITING_FIRST_REVIEW", latestReview: undefined, actions: actions() }),
      }),
    );
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    expect(screen.getByText("No open corrective actions")).toBeDefined();
    expect(screen.getByText("No positive practice recorded yet")).toBeDefined();
    expect(screen.getByText("No finalised internal review yet")).toBeDefined();
    expect(screen.getByText("Nothing closed in the last 30 days")).toBeDefined();
  });

  test("offers acknowledgement only when the source workflow allows it", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(detail({ canAcknowledgeReview: true }));
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    const link = await screen.findByRole("link", { name: /Review and acknowledge Q2 2026/u });
    expect(link.getAttribute("href")).toBe("/centre/reviews/run-1");
  });

  test("denies an unauthorised centre without leaking whether it exists", async () => {
    clientMocks.getCentreQualityDetail.mockRejectedValue(
      new APIError(403, { code: ErrCode.PermissionDenied, message: "denied", details: null }),
    );
    render(<QualityCentreDetail centreId={CENTRE_B} />);

    expect(await screen.findByText("This centre is not available to you")).toBeDefined();
    expect(document.body.textContent).not.toContain(CENTRE_B);
  });

  test("provides breadcrumb navigation back to the workspace", async () => {
    clientMocks.getCentreQualityDetail.mockResolvedValue(detail());
    render(<QualityCentreDetail centreId={CENTRE_A} />);

    const breadcrumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Quality & Performance" }).getAttribute("href")).toBe("/quality");
    expect(within(breadcrumb).getByRole("link", { name: "Daily Success" }).getAttribute("href")).toBe("/");
  });
});

describe("Quality & Performance accessibility", () => {
  test("uses one page heading, ordered sections and native list semantics", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThan(0);
    expect(within(lists[0]).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  test("moves focus to the page heading once a result is ready", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    const heading = await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  test("offers a skip link to the main content region", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(workspace());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Zephyr Quality Centre" });
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip.getAttribute("href")).toBe("#centre-success-main");
    expect(document.getElementById("centre-success-main")).not.toBeNull();
  });

  test("states every focus and severity in words, never by colour alone", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    for (const badge of Array.from(document.querySelectorAll(".status-pill"))) {
      expect(badge.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    const badgeText = Array.from(document.querySelectorAll(".status-pill")).map(
      (badge) => badge.textContent?.trim(),
    );
    expect(badgeText).toContain("Needs support");
    expect(badgeText).toContain("Steady");
    expect(badgeText).toContain("No review yet");
  });

  test("keeps every interactive control keyboard reachable", async () => {
    clientMocks.getCentreQualityWorkspace.mockResolvedValue(portfolio());
    render(<QualityWorkspace />);

    await screen.findByRole("heading", { level: 1, name: "Centre quality across your portfolio" });
    for (const control of [...screen.getAllByRole("link"), ...screen.getAllByRole("button")]) {
      expect(control.getAttribute("tabindex")).not.toBe("-1");
      expect(control.hasAttribute("disabled")).toBe(false);
    }
  });
});
