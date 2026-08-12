import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APIError, ErrCode } from "../lib/client.generated";

const clientMocks = vi.hoisted(() => {
  const getDailySuccess = vi.fn();
  return { getDailySuccess, client: { foundation: { getDailySuccess } } };
});

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "accessibility-test" },
    signOut: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import { DailySuccessHome } from "./daily-success-home";

const CENTRE_ID = "00000000-0000-4000-8000-000000000101";

function response(overrides: Record<string, unknown> = {}) {
  const priority = {
    id: "corrective_action:00000000-0000-4000-8000-000000000301",
    sourceType: "corrective_action",
    sourceId: "00000000-0000-4000-8000-000000000301",
    centreId: CENTRE_ID,
    centreName: "Synthetic Centre",
    headline: "Critical safety follow-up",
    summary: "Corrective action remains active",
    attentionBand: "URGENT",
    responsibility: "YOU_NEED_TO_ACT",
    whyShown: { code: "CRITICAL_RISK", label: "Critical risk needs attention" },
    due: { at: "2026-08-12T03:00:00.000Z", timezone: "Australia/Sydney", localDate: "2026-08-12", bucket: "TODAY", daysFromToday: 0 },
    riskLevel: "CRITICAL",
    cta: { label: "Continue action", route: "/centre/actions/00000000-0000-4000-8000-000000000301" },
  };
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-12T01:00:00.000Z",
    status: "ready",
    activePerspective: { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID },
    availablePerspectives: [{ kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID }],
    businessDates: [{ scope: "centre", id: CENTRE_ID, timezone: "Australia/Sydney", date: "2026-08-12" }],
    sections: [
      { key: "DO_FIRST", label: "DO FIRST", items: [priority] },
      { key: "TODAY", label: "TODAY", items: [] },
      { key: "NEXT", label: "NEXT", items: [] },
      { key: "WAITING", label: "WAITING", items: [] },
      { key: "ON_TRACK", label: "ON TRACK", items: [] },
    ],
    attentionCentres: [],
    verificationItems: [],
    aggregateCounts: { coverage: "complete", active: 1, urgent: 1, dueToday: 1, waiting: 0, distinctCentres: 1 },
    positiveContext: { completedTodayCount: 0, recentTitles: [] },
    sourceHealth: [{ source: "corrective_actions", status: "available" }],
    authorisationHealth: { status: "available" },
    workspaceLinks: [{ label: "Centre actions", route: "/centre" }],
    ...overrides,
  };
}

beforeEach(() => {
  clientMocks.getDailySuccess.mockReset();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("rendered Daily Success accessibility", () => {
  test("announces loading and ready transitions and renders native priority list semantics", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    clientMocks.getDailySuccess.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<DailySuccessHome displayName="Synthetic Director" />);
    expect(screen.getByRole("status").textContent).toContain("Checking today's authorised priorities");
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");

    resolve(response());
    const pageHeading = await screen.findByRole("heading", { level: 1, name: "Good morning, Synthetic Director" });
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Daily Success priorities are ready"));
    const section = screen.getByRole("heading", { name: "DO FIRST" }).closest("section")!;
    const list = within(section).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("CRITICAL")).toBeDefined();
    expect(within(list).getByText("You need to act")).toBeDefined();
    expect(within(list).getByRole("link", { name: "Continue action" }).getAttribute("href"))
      .toBe("/centre/actions/00000000-0000-4000-8000-000000000301");
  });

  test("announces a partial safety-data warning as an alert and never renders On track", async () => {
    clientMocks.getDailySuccess.mockResolvedValue(response({
      status: "partial",
      warning: "Some priorities could not be checked.",
      sections: [
        { key: "DO_FIRST", label: "DO FIRST", items: [] },
        { key: "TODAY", label: "TODAY", items: [] },
        { key: "NEXT", label: "NEXT", items: [] },
        { key: "WAITING", label: "WAITING", items: [] },
        { key: "ON_TRACK", label: "ON TRACK", items: [] },
      ],
      aggregateCounts: { coverage: "partial" },
      positiveContext: undefined,
      sourceHealth: [{ source: "corrective_actions", status: "unavailable" }],
    }));
    render(<DailySuccessHome displayName="Synthetic Area Manager" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Some priorities could not be checked");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("partially available"));
    expect(screen.getByRole("heading", { name: "Priorities partially available" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "On track" })).toBeNull();
  });

  test("keeps one meaningful page heading in unsupported and denied states", async () => {
    clientMocks.getDailySuccess.mockResolvedValueOnce(response({
      status: "unsupported",
      activePerspective: undefined,
      availablePerspectives: [],
      sections: [],
      positiveContext: undefined,
      workspaceLinks: [],
    }));
    const unsupported = render(<DailySuccessHome displayName="Unsupported User" />);
    expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "No Daily Success perspective available" })));
    unsupported.unmount();

    clientMocks.getDailySuccess.mockRejectedValueOnce(new APIError(403, {
      code: ErrCode.PermissionDenied,
      message: "denied",
    }));
    render(<DailySuccessHome displayName="Denied User" />);
    expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Daily Success unavailable" })));
  });
});
