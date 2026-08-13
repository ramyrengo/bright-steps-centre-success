import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
const navigationMocks = vi.hoisted(() => ({ getAuthorisedNavigationEndpoint: vi.fn() }));
vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "standards-test" },
    signOut: authMocks.signOut,
  }),
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
  CentreStandardsCheck,
  CentreStandardsCheckView,
  StandardsCheckCompletion,
  StandardsCheckReadOnly,
} from "./centre-standards-check";
import {
  CentreStandardsWorkspaceView,
  CentreStandardsWorkspace,
} from "./centre-standards-workspace";
import type {
  CentreStandardsGateway,
  CheckIdentity,
  CheckQuestion,
  CheckRecordedResponse,
  CompleteCheckResult,
  OpenCheckSummary,
  StandardsCheckDetail,
  StandardsWorkspace,
} from "./centre-standards-contract";

/**
 * Typed fixtures only. The wording is deliberately unmistakable test
 * scaffolding rather than plausible childcare content, which is the point:
 * a realistic-sounding question is the one someone would act on as policy.
 */
const OCCURRENCE = "b6f2b0c4-1a4e-4a5c-9f3d-0c2f1d5a7e01";
const SYNTHETIC_NOTICE =
  "Synthetic staging check for Centre Success testing. This is not a Bright Steps policy, regulatory requirement or operational standard.";

const IDENTITY: CheckIdentity = {
  occurrenceId: OCCURRENCE,
  standardName: "Centre Standards Pilot — Staging",
  centreName: "Ashgrove Quality Centre",
  businessDate: "2026-08-13",
  questionCount: 3,
};

const QUESTIONS: CheckQuestion[] = [1, 2, 3].map((n) => ({
  questionId: `q${n}`,
  wording: `Test question ${n} — select the recorded outcome`,
  ...(n === 1 ? { instructions: "Test instruction for staging only." } : {}),
  options: [
    { value: "OPT_RECORDED", label: "No issue to report" },
    { value: "OPT_ACTION", label: "Report an issue" },
  ],
}));

function openCheck(
  overrides: { timeliness?: "DUE" | "OVERDUE"; canComplete?: boolean } = {},
): OpenCheckSummary {
  return {
    ...IDENTITY,
    synthetic: true,
    syntheticNotice: SYNTHETIC_NOTICE,
    state: "OPEN",
    timeliness: overrides.timeliness ?? "DUE",
    dueLocalTime: "9:00am",
    canComplete: overrides.canComplete ?? true,
  };
}

function openDetail(
  overrides: { canComplete?: boolean; questions?: CheckQuestion[] } = {},
): StandardsCheckDetail {
  return {
    ...openCheck({ canComplete: overrides.canComplete }),
    questions: overrides.questions ?? QUESTIONS,
  };
}

function completedDetail(
  overrides: {
    timeliness?: "COMPLETED_ON_TIME" | "COMPLETED_LATE";
    completedLocalTime?: string;
    responses?: CheckRecordedResponse[];
  } = {},
): StandardsCheckDetail {
  return {
    ...IDENTITY,
    synthetic: true,
    syntheticNotice: SYNTHETIC_NOTICE,
    state: "COMPLETED",
    timeliness: overrides.timeliness ?? "COMPLETED_ON_TIME",
    dueLocalTime: "9:00am",
    completedLocalTime: overrides.completedLocalTime ?? "7:42am",
    questions: QUESTIONS,
    ...(overrides.responses ? { responses: overrides.responses } : {}),
  };
}

/** Workflow vocabulary the Educator experience must never contain. */
const FORBIDDEN_WORDS =
  /finding|corrective action|governed action|severity|verification|due days|remediation|template version/i;
/** Internal outcome tokens, which are uppercase and must never be rendered. */
const FORBIDDEN_TOKENS = /\bRECORDED\b|\bGOVERNED_ACTION\b|\bOPT_[A-Z_]+\b|due_days/;

function answerAll(
  labels: readonly string[] = ["No issue to report", "No issue to report", "No issue to report"],
) {
  for (const [index, label] of labels.entries()) {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(label, "u") }));
    if (index < labels.length - 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
  }
}

beforeEach(() => {
  authMocks.signOut.mockReset();
  authMocks.signOut.mockResolvedValue(undefined);
  navigationMocks.getAuthorisedNavigationEndpoint.mockReset();
  navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
    cacheControl: "private, no-store",
    links: [],
  });
});
afterEach(cleanup);

describe("Centre Standards landing", () => {
  const ready = (checks: OpenCheckSummary[] = [openCheck()]): StandardsWorkspace => ({
    status: "ready",
    openChecks: checks,
  });

  test("shows an open due check with its time and a clear way in", () => {
    render(<CentreStandardsWorkspaceView response={ready()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Your checks" })).toBeDefined();
    const item = screen
      .getByRole("heading", { level: 3, name: "Centre Standards Pilot — Staging" })
      .closest("li");
    expect(within(item as HTMLElement).getByText("Due by 9:00am")).toBeDefined();
    expect(within(item as HTMLElement).getByText("Ashgrove Quality Centre")).toBeDefined();
    expect(
      within(item as HTMLElement).getByRole("link", { name: /Start check/u }).getAttribute("href"),
    ).toBe(`/standards/checks/${OCCURRENCE}`);
  });

  test("leads with overdue work rather than burying it", () => {
    render(
      <CentreStandardsWorkspaceView response={ready([openCheck({ timeliness: "OVERDUE" })])} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "One check is overdue" })).toBeDefined();
    expect(screen.getByText("Overdue")).toBeDefined();
    // "Missed" reads as terminal; the check can still be completed.
    expect(document.body.textContent).not.toMatch(/missed/iu);
  });

  test("renders the business date as a person would say it", () => {
    render(<CentreStandardsWorkspaceView response={ready()} />);
    expect(document.body.textContent).not.toContain("2026-08-13");
    expect(document.body.textContent).toMatch(/13 Aug/u);
  });

  test("states an all-clear only when coverage is complete and the list is empty", () => {
    render(<CentreStandardsWorkspaceView response={ready([])} />);
    expect(screen.getByText("Nothing due right now")).toBeDefined();
    expect(screen.getByText(/You're up to date/u)).toBeDefined();
  });

  test("never renders an all-clear when coverage is partial and nothing was confirmed", () => {
    render(
      <CentreStandardsWorkspaceView
        response={{ status: "partial", openChecks: [], warning: "One centre did not respond." }}
      />,
    );
    // The exact regression: partial + empty must not read as up to date.
    expect(screen.queryByText("Nothing due right now")).toBeNull();
    expect(screen.queryByText(/You're up to date/u)).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Some check information couldn't be confirmed",
      }),
    ).toBeDefined();
    expect(screen.getByText("We couldn't confirm your checks")).toBeDefined();
    expect(document.body.textContent).toMatch(/does not mean there is nothing due/iu);
  });

  test("shows known checks beneath the warning when coverage is partial", () => {
    render(
      <CentreStandardsWorkspaceView
        response={{
          status: "partial",
          openChecks: [openCheck({ timeliness: "OVERDUE" })],
          warning: "One centre did not respond.",
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "One check is overdue" })).toBeDefined();
    expect(screen.getByText("One centre did not respond.")).toBeDefined();
    expect(screen.getByRole("link", { name: /Start check/u })).toBeDefined();
    expect(screen.queryByText("Nothing due right now")).toBeNull();
  });

  test("gives an unauthorised principal no checks and no business claim", () => {
    render(<CentreStandardsWorkspaceView response={{ status: "unsupported" }} />);
    expect(screen.getByText("No checks are assigned to you")).toBeDefined();
    expect(document.body.textContent).toMatch(/Technical administration alone/u);
    expect(screen.queryByText("Nothing due right now")).toBeNull();
  });

  test("carries the synthetic marker on the list itself", () => {
    render(<CentreStandardsWorkspaceView response={ready()} />);
    expect(screen.getByText(SYNTHETIC_NOTICE)).toBeDefined();
  });

  test("offers a reader a view rather than a start control", () => {
    render(<CentreStandardsWorkspaceView response={ready([openCheck({ canComplete: false })])} />);
    expect(screen.getByRole("link", { name: /View check/u })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Start check/u })).toBeNull();
  });

  test("keeps completed history out of the task list", () => {
    render(<CentreStandardsWorkspaceView response={ready([])} />);
    expect(document.querySelectorAll(".standards-card")).toHaveLength(0);
    expect(screen.queryByText(/^Completed /u)).toBeNull();
  });
});

describe("Centre Standards completion", () => {
  test("moves one question at a time with clear progress", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    expect(screen.getByText("Question 1 of 3")).toBeDefined();
    expect(screen.getByRole("group", { name: /Test question 1/u })).toBeDefined();
    expect(screen.queryByRole("group", { name: /Test question 2/u })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Question 2 of 3")).toBeDefined();
  });

  test("keeps the standard name as context rather than the loudest thing present", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Centre Standards Pilot — Staging");
    expect(heading.className).toContain("check-header__title");
    expect(screen.getByRole("group", { name: /Test question 1/u })).toBeDefined();
  });

  test("cannot advance or submit before the question is answered", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
  });

  test("keeps a selected answer when stepping back", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Report an issue/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      (screen.getByRole("radio", { name: /Report an issue/u }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("submits once when several native clicks land in the same render batch", () => {
    const submit = vi.fn(() => new Promise<CompleteCheckResult>(() => {}));
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();

    const button = screen.getByRole("button", { name: "Submit check" });
    // Real DOM clicks dispatched back to back, before React can re-render and
    // set `disabled`. Only a synchronous lock stops the second and third.
    button.click();
    button.click();
    button.click();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  test("does not reopen the submission path after a completed result", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test("sends every answer, keyed by question, exactly once", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(submit).toHaveBeenCalledWith([
      { questionId: "q1", value: "OPT_RECORDED" },
      { questionId: "q2", value: "OPT_RECORDED" },
      { questionId: "q3", value: "OPT_RECORDED" },
    ]);
  });

  test("never claims the submission definitely failed", async () => {
    const submit = vi
      .fn<() => Promise<CompleteCheckResult>>()
      .mockRejectedValueOnce(new Error("network"));
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByText("We couldn't confirm your check");
    expect(document.body.textContent).toMatch(/couldn't confirm whether your check was recorded/u);
    expect(document.body.textContent).toMatch(/safe to try again/u);
    // A timeout may have committed server-side, so this claim must be gone.
    expect(document.body.textContent).not.toMatch(/nothing has been recorded/iu);
  });

  test("keeps answers after an ambiguous failure and succeeds on retry", async () => {
    const submit = vi
      .fn<() => Promise<CompleteCheckResult>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        outcome: "ALREADY_COMPLETED",
        completedLocalTime: "7:42am",
        completedByRequester: true,
      });
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByText("We couldn't confirm your check");
    expect(screen.getByRole("group", { name: /Test question 3/u })).toBeDefined();
    expect(
      (screen.getByRole("radio", { name: /No issue to report/u }) as HTMLInputElement).checked,
    ).toBe(true);

    // The first request had in fact committed. Retry must land on success.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Already submitted" });
    expect(
      screen.getByText("Already submitted — you completed this check at 7:42am."),
    ).toBeDefined();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  test("warns before a real page unload would discard answers", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  test("stops warning once the check is complete", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("lands on a real completion screen and moves focus to it", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "Check complete" });
    // The form it replaced is gone, so focus must land somewhere meaningful.
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole("group", { name: /Test question/u })).toBeNull();
  });

  test("moves focus to the heading for an already-completed result too", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "ALREADY_COMPLETED",
        completedLocalTime: "8:05am",
        completedByRequester: false,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "Already completed" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.body.textContent).toMatch(/were not submitted/u);
  });

  test("says an issue was raised without naming any workflow record", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:45am",
        issueRaised: true,
      }),
    );
    render(<StandardsCheckCompletion check={openDetail()} submit={submit} />);
    answerAll(["Report an issue", "No issue to report", "No issue to report"]);
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(
      screen.getByText("Thanks — your check is complete. One issue has been raised for follow-up."),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(FORBIDDEN_WORDS);
    expect(document.body.textContent).not.toMatch(/notified|notification/iu);
  });

  test("shows the synthetic marker beside the questions", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    expect(screen.getByText(SYNTHETIC_NOTICE)).toBeDefined();
    expect(screen.getByText("Staging test content")).toBeDefined();
  });

  test("exposes no workflow, severity or identifier language to the Educator", () => {
    const { container } = render(
      <StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />,
    );
    expect(document.body.textContent).not.toMatch(FORBIDDEN_WORDS);
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TOKENS);
    expect(container.textContent).not.toContain(OCCURRENCE);
    expect(container.textContent).not.toContain("OPT_RECORDED");
  });
});

describe("Centre Standards step navigation", () => {
  test("carries focus to the question that replaced the last one", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    // Arriving on the screen must not yank focus past the heading that says
    // which check this is.
    expect(screen.getByRole("group", { name: /Test question 1/u })).not.toBe(
      document.activeElement,
    );

    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // The step controls keep their position, so without this a screen-reader
    // user is left on "Next" with no signal the question beneath it changed.
    expect(document.activeElement).toBe(screen.getByRole("group", { name: /Test question 2/u }));
  });

  test("carries focus back with the reader when they step back", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(document.activeElement).toBe(screen.getByRole("group", { name: /Test question 1/u }));
  });

  test("leaves the question group out of the tab order", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // A programmatic target only. A positive tabindex would put a silent extra
    // stop in front of every question.
    expect(
      screen.getByRole("group", { name: /Test question 2/u }).getAttribute("tabindex"),
    ).toBe("-1");
  });

  test("never counts the question in hand as answered", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    const steps = () =>
      [...document.querySelectorAll(".check-progress__step")].map((node) =>
        node.getAttribute("data-state"),
      );
    expect(steps()).toEqual(["current", "todo", "todo"]);

    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(steps()).toEqual(["done", "current", "todo"]);
  });

  test("offers a way out of a check with nothing to answer", () => {
    render(<StandardsCheckCompletion check={openDetail({ questions: [] })} submit={vi.fn()} />);
    // Previously this rendered a header, "Question 1 of 0" and no control at
    // all — a dead end the reader could do nothing about.
    expect(screen.getByText("This check can't be completed")).toBeDefined();
    expect(document.body.textContent).toMatch(/no questions to answer/u);
    expect(document.body.textContent).not.toMatch(/Question 1 of 0/u);
    expect(screen.getByRole("link", { name: "Back to your checks" }).getAttribute("href")).toBe(
      "/standards",
    );
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
  });
});

describe("Centre Standards check container", () => {
  function gateway(
    check: StandardsCheckDetail | Promise<StandardsCheckDetail>,
  ): CentreStandardsGateway {
    return {
      loadWorkspace: () => Promise.reject(new Error("unused")),
      loadCheck: () => Promise.resolve(check),
      completeCheck: () => Promise.reject(new Error("unused")),
    };
  }

  test("keeps the completion screen free of competing navigation", async () => {
    navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
      cacheControl: "private, no-store",
      links: [{ label: "Centre Standards", route: "/standards" }],
    });
    render(<CentreStandardsCheck occurrenceId={OCCURRENCE} gateway={gateway(openDetail())} />);

    await screen.findByRole("group", { name: /Test question 1/u });
    expect(screen.queryByRole("navigation", { name: "Centre Success workspaces" })).toBeNull();
    // The chrome-free treatment is the reason not to spend a request on it.
    expect(navigationMocks.getAuthorisedNavigationEndpoint).not.toHaveBeenCalled();
  });

  test("gives a reader navigation rather than stranding them", async () => {
    navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
      cacheControl: "private, no-store",
      links: [{ label: "Centre Standards", route: "/standards" }],
    });
    render(
      <CentreStandardsCheck occurrenceId={OCCURRENCE} gateway={gateway(completedDetail())} />,
    );

    await screen.findByText("The recorded answers are not available to you.");
    const nav = await screen.findByRole("navigation", { name: "Centre Success workspaces" });
    // The bar starts on its Daily Success baseline, so wait for the
    // capability-derived link rather than racing the request.
    await within(nav).findByRole("link", { name: "Centre Standards" });
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
  });

  test("moves focus onto the check once it has opened", async () => {
    render(<CentreStandardsCheck occurrenceId={OCCURRENCE} gateway={gateway(openDetail())} />);
    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  test("announces what opened for assistive technology", async () => {
    render(<CentreStandardsCheck occurrenceId={OCCURRENCE} gateway={gateway(openDetail())} />);
    await waitFor(() => {
      const spoken = screen.getAllByRole("status").map((node) => node.textContent);
      expect(spoken.join(" ")).toContain("Your check is ready to complete.");
    });
  });

  test("says nothing was recorded when the check cannot be opened", async () => {
    render(
      <CentreStandardsCheck
        occurrenceId={OCCURRENCE}
        gateway={{
          loadWorkspace: () => Promise.reject(new Error("unused")),
          loadCheck: () => Promise.reject(new Error("offline")),
          completeCheck: () => Promise.reject(new Error("unused")),
        }}
      />,
    );
    await screen.findByText("This check couldn't be opened");
    // Nothing was sent, so this screen may state that plainly — unlike a
    // failed submission, which may have committed.
    expect(document.body.textContent).toMatch(/Nothing has been recorded/u);
  });

  test("keeps navigation in place across a retry from the error screen", async () => {
    render(
      <CentreStandardsCheck
        occurrenceId={OCCURRENCE}
        gateway={{
          loadWorkspace: () => Promise.reject(new Error("unused")),
          loadCheck: () => Promise.reject(new Error("offline")),
          completeCheck: () => Promise.reject(new Error("unused")),
        }}
      />,
    );
    await screen.findByText("This check couldn't be opened");
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // Retry passes back through loading. Deriving the frame each render would
    // pull the bar out from under the reader mid-retry.
    expect(screen.getByRole("navigation", { name: "Centre Success workspaces" })).toBe(nav);
    await screen.findByText("This check couldn't be opened");
    expect(screen.getByRole("navigation", { name: "Centre Success workspaces" })).toBeDefined();
  });
});

describe("Centre Standards in-app leave protection", () => {
  function renderInShell(check = openDetail()) {
    return render(
      <AppShell links={[]}>
        <StandardsCheckCompletion check={check} submit={vi.fn()} />
      </AppShell>,
    );
  }

  test("does not interrupt navigation while nothing is unsaved", () => {
    renderInShell();
    fireEvent.click(screen.getByRole("link", { name: /Bright Steps/u }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("asks before the brand link discards unsaved answers", async () => {
    renderInShell();
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("link", { name: /Bright Steps/u }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Leave this check?")).toBeDefined();
    expect(within(dialog).getByRole("link", { name: "Leave anyway" })).toBeDefined();
  });

  test("cancelling keeps the reader on the check with every answer intact", async () => {
    renderInShell();
    fireEvent.click(screen.getByRole("radio", { name: /Report an issue/u }));
    fireEvent.click(screen.getByRole("link", { name: /Bright Steps/u }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay on this check" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (screen.getByRole("radio", { name: /Report an issue/u }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("confirming offers a real link to the held destination", async () => {
    renderInShell();
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("link", { name: /Bright Steps/u }));

    const dialog = await screen.findByRole("dialog");
    // The browser performs the navigation; the shell only held it long enough
    // to ask, so there is no router to couple to or to mock.
    expect(
      within(dialog).getByRole("link", { name: "Leave anyway" }).getAttribute("href"),
    ).toBe("/");
  });

  test("guards sign out as well as navigation", async () => {
    renderInShell();
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    const dialog = await screen.findByRole("dialog");
    expect(authMocks.signOut).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Leave anyway" }));
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledTimes(1));
  });

  test("stops guarding once the check is complete", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(
      <AppShell links={[]}>
        <StandardsCheckCompletion check={openDetail()} submit={submit} />
      </AppShell>,
    );
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Centre Standards read-only occurrence", () => {
  test("shows a reader the check without any completion control", () => {
    render(
      <CentreStandardsCheckView check={openDetail({ canComplete: false })} submit={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.body.textContent).toMatch(/not set up to complete it/u);
    expect(screen.getByText("Due by 9:00am")).toBeDefined();
    expect(screen.getByText("Not completed yet")).toBeDefined();
    expect(document.body.textContent).toMatch(/has 3 questions and has not been answered/u);
  });

  test("shows a completed occurrence as an ordered read-only record", () => {
    render(
      <CentreStandardsCheckView
        check={completedDetail({
          responses: [
            {
              questionId: "q1",
              wording: "Test question 1 — select the recorded outcome",
              answerLabel: "No issue to report",
            },
            {
              questionId: "q2",
              wording: "Test question 2 — select the recorded outcome",
              answerLabel: "Report an issue",
            },
          ],
        })}
        submit={vi.fn()}
      />,
    );
    expect(screen.getByText("Completed 7:42am")).toBeDefined();
    expect(screen.getByText("What was recorded")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.body.textContent).toMatch(/cannot be changed/u);
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("states lateness about the check, never about a named person", () => {
    render(
      <StandardsCheckReadOnly
        check={completedDetail({ timeliness: "COMPLETED_LATE", completedLocalTime: "9:18am" })}
      />,
    );
    expect(screen.getByText("Completed late · 9:18am")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/by [A-Z][a-z]+ [A-Z][a-z]+/u);
    expect(document.body.textContent).not.toMatch(/%/u);
  });

  test("says answers are unavailable rather than showing an empty record", () => {
    render(<StandardsCheckReadOnly check={completedDetail()} />);
    expect(screen.getByText("The recorded answers are not available to you.")).toBeDefined();
    expect(screen.queryByText("What was recorded")).toBeNull();
  });

  test("offers a way back to the task list", () => {
    render(<StandardsCheckReadOnly check={completedDetail()} />);
    expect(screen.getByRole("link", { name: "Back to checks" }).getAttribute("href")).toBe(
      "/standards",
    );
  });
});

describe("Centre Standards workspace container", () => {
  function gateway(workspace: StandardsWorkspace): CentreStandardsGateway {
    return {
      loadWorkspace: () => Promise.resolve(workspace),
      loadCheck: () => Promise.reject(new Error("unused")),
      completeCheck: () => Promise.reject(new Error("unused")),
    };
  }

  test("renders inside the shared shell with backend-derived navigation", async () => {
    navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
      cacheControl: "private, no-store",
      links: [{ label: "Centre Standards", route: "/standards" }],
    });
    render(
      <CentreStandardsWorkspace gateway={gateway({ status: "ready", openChecks: [openCheck()] })} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Your checks" });
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    await within(nav).findByRole("link", { name: "Centre Standards" });
    expect(
      within(nav).getByRole("link", { name: "Centre Standards" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  test("reserves the shape of the coming cards while loading", () => {
    render(
      <CentreStandardsWorkspace
        gateway={{
          loadWorkspace: () => new Promise(() => {}),
          loadCheck: () => Promise.reject(new Error("unused")),
          completeCheck: () => Promise.reject(new Error("unused")),
        }}
      />,
    );
    const status = screen
      .getAllByRole("status")
      .find((n) => n.getAttribute("aria-busy") === "true");
    expect(status).toBeDefined();
    expect(document.querySelectorAll(".standards-card--skeleton").length).toBeGreaterThan(0);
  });

  test("never reports nothing due when the request fails", async () => {
    render(
      <CentreStandardsWorkspace
        gateway={{
          loadWorkspace: () => Promise.reject(new Error("offline")),
          loadCheck: () => Promise.reject(new Error("unused")),
          completeCheck: () => Promise.reject(new Error("unused")),
        }}
      />,
    );
    await screen.findByText("Your checks couldn't be loaded");
    expect(screen.queryByText("Nothing due right now")).toBeNull();
    expect(document.body.textContent).toMatch(/does not mean there is nothing due/iu);
  });

  test("announces its state politely for assistive technology", async () => {
    render(<CentreStandardsWorkspace gateway={gateway({ status: "ready", openChecks: [] })} />);
    await waitFor(() => {
      const status = screen.getAllByRole("status").map((node) => node.textContent);
      expect(status.join(" ")).toContain("Your checks are ready.");
    });
  });
});

describe("Centre Standards accessibility critical path", () => {
  test("uses one page heading and real form grouping", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const group = screen.getByRole("group", { name: /Test question 1/u });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  test("keeps every control keyboard reachable", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    for (const control of [...screen.getAllByRole("radio"), ...screen.getAllByRole("button")]) {
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  test("states progress in words rather than by the bar alone", () => {
    render(<StandardsCheckCompletion check={openDetail()} submit={vi.fn()} />);
    expect(screen.getByText("Question 1 of 3")).toBeDefined();
    expect(document.querySelector(".check-progress__track")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("gives every state a written label, never colour alone", () => {
    render(
      <CentreStandardsWorkspaceView
        response={{ status: "ready", openChecks: [openCheck({ timeliness: "OVERDUE" })] }}
      />,
    );
    const badge = document.querySelector(".status-pill");
    expect(badge?.textContent?.trim()).toBe("Overdue");
    expect(badge?.getAttribute("data-tone")).toBe("critical");
  });
});
