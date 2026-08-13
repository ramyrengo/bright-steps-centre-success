import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "ds-test" },
    signOut: authMocks.signOut,
  }),
}));

const navigationMocks = vi.hoisted(() => ({
  getAuthorisedNavigationEndpoint: vi.fn(),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => ({
    foundation: {
      getAuthorisedNavigationEndpoint: navigationMocks.getAuthorisedNavigationEndpoint,
    },
  }),
}));

import { AppShell } from "./app-shell";
import {
  DataList,
  DataListRow,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Metric,
  MetricRow,
  StatusBadge,
  Trend,
  formatScore,
} from "./design-system";
import { StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

function respondWithNavigation(links: readonly { label: string; route: string }[]) {
  navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
    cacheControl: "private, no-store",
    links,
  });
}

/** Every route the product can render, as an attacker would supply them. */
const INJECTED_ROUTES = [
  { label: "People & Access", route: "/admin/people" },
  { label: "Quality & Performance", route: "/quality" },
  { label: "Compliance oversight", route: "/compliance" },
];

beforeEach(() => {
  window.sessionStorage.clear();
  navigationMocks.getAuthorisedNavigationEndpoint.mockReset();
  respondWithNavigation([]);
});
afterEach(cleanup);

describe("application shell navigation", () => {
  test("renders only backend-authorised destinations, plus Daily Success", async () => {
    respondWithNavigation([
      { label: "Quality & Performance", route: "/quality" },
      { label: "Compliance oversight", route: "/compliance" },
    ]);
    render(<AppShell active="/compliance"><p>content</p></AppShell>);

    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    await screen.findByRole("link", { name: "Compliance oversight" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Daily Success",
      "Quality & Performance",
      "Compliance oversight",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Compliance oversight" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  test("gives a technical administrator no business navigation", async () => {
    respondWithNavigation([]);
    render(<AppShell><p>content</p></AppShell>);

    const nav = await screen.findByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "Daily Success" })).toBeDefined();
    expect(within(nav).queryByRole("link", { name: /Compliance|Quality|People/u })).toBeNull();
  });

  test("hides navigation entirely on a focused single-task screen", () => {
    render(<AppShell links={[]}><p>content</p></AppShell>);

    expect(screen.queryByRole("navigation", { name: "Centre Success workspaces" })).toBeNull();
    // A focused screen states its own navigation, so it must not even ask.
    expect(navigationMocks.getAuthorisedNavigationEndpoint).not.toHaveBeenCalled();
  });

  test("browser storage cannot introduce a destination the backend did not return", async () => {
    // A syntactically valid, same-origin, real product route — exactly what a
    // tampered storage entry would contain. Storage is not an authority.
    window.sessionStorage.setItem(
      "centre-success.workspace-links",
      JSON.stringify(INJECTED_ROUTES),
    );
    respondWithNavigation([]);
    render(<AppShell><p>content</p></AppShell>);

    const nav = await screen.findByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Daily Success",
    ]);
    expect(within(nav).queryByRole("link", { name: "People & Access" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Quality & Performance" })).toBeNull();
  });

  test("an injected quality route cannot appear for a principal the backend denies", async () => {
    window.sessionStorage.setItem(
      "centre-success.workspace-links",
      JSON.stringify([{ label: "Quality & Performance", route: "/quality" }]),
    );
    // A System Administrator holds no business capability, so the backend
    // returns nothing and denial must survive whatever the browser holds.
    respondWithNavigation([]);
    render(<AppShell active="/quality"><p>content</p></AppShell>);

    const nav = await screen.findByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).queryByRole("link", { name: "Quality & Performance" })).toBeNull();
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
  });

  test("falls back to Daily Success when navigation is denied or unavailable", async () => {
    window.sessionStorage.setItem(
      "centre-success.workspace-links",
      JSON.stringify(INJECTED_ROUTES),
    );
    navigationMocks.getAuthorisedNavigationEndpoint.mockRejectedValue(new Error("denied"));
    render(<AppShell><p>content</p></AppShell>);

    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Daily Success",
    ]);
  });

  test("does not duplicate Daily Success when the backend also returns it", async () => {
    respondWithNavigation([
      { label: "Daily Success", route: "/" },
      { label: "Quality & Performance", route: "/quality" },
    ]);
    render(<AppShell><p>content</p></AppShell>);

    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    await screen.findByRole("link", { name: "Quality & Performance" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Daily Success",
      "Quality & Performance",
    ]);
  });

  test("exposes a skip link that targets the main region", () => {
    render(<AppShell><p>content</p></AppShell>);
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe(
      "#centre-success-main",
    );
    expect(document.getElementById("centre-success-main")).not.toBeNull();
  });
});

describe("workflow shell adapter", () => {
  test("renders exactly one page heading with its eyebrow and summary", () => {
    render(
      <WorkflowShell eyebrow="Area Manager" title="Quarterly centre reviews" summary="Prepare and verify.">
        <p>body</p>
      </WorkflowShell>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Quarterly centre reviews" })).toBeDefined();
    expect(screen.getByText("Area Manager")).toBeDefined();
    expect(screen.getByText("Prepare and verify.")).toBeDefined();
  });

  test("passes an explicit empty link list through as no navigation", () => {
    render(
      <WorkflowShell eyebrow="Centre Director" title="Quarterly review" summary="Focused." workspaceLinks={[]}>
        <p>body</p>
      </WorkflowShell>,
    );
    expect(screen.queryByRole("navigation", { name: "Centre Success workspaces" })).toBeNull();
  });
});

describe("state primitives", () => {
  test("loading announces politely and marks itself busy", () => {
    render(<WorkflowState kind="loading" title="Loading assigned centres" message="Checking your portfolio…" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading assigned centres");
  });

  test("empty explains absence and is not a zero", () => {
    render(<EmptyState title="No finalised internal review yet" message="History begins at the first finalised review." />);
    expect(screen.getByRole("heading", { name: "No finalised internal review yet" })).toBeDefined();
    expect(screen.queryByText("0")).toBeNull();
  });

  test("error is an alert, offers retry and never implies an all-clear", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Could not be checked" message="No result has been assumed." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(document.body.textContent).not.toMatch(/all clear|on track|everything is fine/iu);
  });

  test("loading skeleton hides its decorative bars from assistive technology", () => {
    render(<LoadingSkeleton label="Checking centre quality." rows={4} />);
    expect(document.querySelector(".skeleton")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Checking centre quality.");
  });
});

describe("status, severity and trend never rely on colour alone", () => {
  test.each([
    ["positive", "Steady"],
    ["warning", "Keep an eye on"],
    ["critical", "Needs support"],
    ["informational", "Internal review"],
    ["neutral", "No review yet"],
  ] as const)("badge tone %s still carries its written label", (tone, label) => {
    render(<StatusBadge tone={tone}>{label}</StatusBadge>);
    const badge = document.querySelector(".status-pill");
    expect(badge?.getAttribute("data-tone")).toBe(tone);
    expect(badge?.textContent).toContain(label);
  });

  test("legacy StatusPill still renders through the shared badge", () => {
    render(<StatusPill tone="critical">CRITICAL</StatusPill>);
    expect(document.querySelector('.status-pill[data-tone="critical"]')?.textContent).toContain("CRITICAL");
  });

  test.each([
    ["IMPROVED", "Improved"],
    ["DECLINED", "Declined"],
    ["STEADY", "Steady"],
    ["NOT_COMPARABLE", "Not comparable"],
  ] as const)("trend %s speaks its direction", (direction, spoken) => {
    render(<Trend direction={direction}>+7 vs Q1 2026</Trend>);
    const trend = document.querySelector(".trend");
    expect(trend?.getAttribute("data-direction")).toBe(direction);
    expect(trend?.textContent).toContain(spoken);
  });
});

describe("metrics and responsive lists", () => {
  test("renders a metric as a term and value pair, with an unavailable marker", () => {
    render(
      <MetricRow>
        <Metric label="Critical open" value={2} emphasis />
        <Metric label="Overall score" value="Not recorded" unavailable />
      </MetricRow>,
    );
    expect(screen.getByText("Critical open").nextSibling?.textContent).toBe("2");
    expect(document.querySelector(".metric--emphasis")).not.toBeNull();
    expect(document.querySelector('[data-unavailable="true"]')?.textContent).toBe("Not recorded");
  });

  test("formats a score without inventing one", () => {
    expect(formatScore(91)).toBe("91");
    expect(formatScore(90.5)).toBe("90.5");
    expect(formatScore(undefined)).toBe("Not recorded");
  });

  test("data rows keep list semantics and can name their record as a heading", () => {
    render(
      <DataList label="Follow-ups">
        <DataListRow
          title="Replace the damaged gate latch"
          headingLevel={3}
          severity="critical"
          badge={<StatusBadge tone="critical">CRITICAL</StatusBadge>}
          facts={[{ term: "Due", value: "12 Aug 2026" }]}
          action={<button type="button">Continue action</button>}
        />
      </DataList>,
    );
    const list = screen.getByRole("list", { name: "Follow-ups" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("heading", { level: 3, name: "Replace the damaged gate latch" })).toBeDefined();
    expect(within(list).getByText("Due").nextSibling?.textContent).toBe("12 Aug 2026");
    expect(document.querySelector('.data-list__row[data-severity="critical"]')).not.toBeNull();
  });
});
