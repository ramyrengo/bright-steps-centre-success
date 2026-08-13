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

import {
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
  CompleteCheckResult,
  StandardsCheckDetail,
  StandardsCheckSummary,
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

function summary(overrides: Partial<StandardsCheckSummary> = {}): StandardsCheckSummary {
  return {
    occurrenceId: OCCURRENCE,
    standardName: "Centre Standards Pilot — Staging",
    synthetic: true,
    centreId: "3f7c1c02-9d1f-4f6b-8f2a-6a2c3d4e5f60",
    centreName: "Ashgrove Quality Centre",
    businessDate: "2026-08-13",
    dueLocalTime: "9:00am",
    timeliness: "DUE",
    questionCount: 3,
    authority: { canComplete: true, canRead: true },
    ...overrides,
  };
}

function detail(overrides: Partial<StandardsCheckDetail> = {}): StandardsCheckDetail {
  return {
    ...summary(),
    syntheticNotice: SYNTHETIC_NOTICE,
    questions: [
      {
        questionId: "q1",
        wording: "Test question 1 — select the recorded outcome",
        instructions: "Test instruction for staging only.",
        options: [
          { value: "OPT_RECORDED", label: "No issue to report" },
          { value: "OPT_ACTION", label: "Report an issue" },
        ],
      },
      {
        questionId: "q2",
        wording: "Test question 2 — select the recorded outcome",
        options: [
          { value: "OPT_RECORDED", label: "No issue to report" },
          { value: "OPT_ACTION", label: "Report an issue" },
        ],
      },
      {
        questionId: "q3",
        wording: "Test question 3 — select any outcome",
        options: [
          { value: "OPT_RECORDED", label: "No issue to report" },
          { value: "OPT_ACTION", label: "Report an issue" },
        ],
      },
    ],
    ...overrides,
  };
}

/** Workflow vocabulary the Educator experience must never contain. */
const FORBIDDEN_WORDS =
  /finding|corrective action|governed action|severity|verification|due days|remediation|template version/i;
/** Internal outcome tokens, which are uppercase and must never be rendered. */
const FORBIDDEN_TOKENS = /\bRECORDED\b|\bGOVERNED_ACTION\b|\bOPT_[A-Z_]+\b|due_days/;

function answerAll(labels: readonly string[] = ["No issue to report", "No issue to report", "No issue to report"]) {
  for (const [index, label] of labels.entries()) {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(label, "u") }));
    if (index < labels.length - 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
  }
}

beforeEach(() => {
  navigationMocks.getAuthorisedNavigationEndpoint.mockReset();
  navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
    cacheControl: "private, no-store",
    links: [],
  });
});
afterEach(cleanup);

describe("Centre Standards landing", () => {
  function workspace(overrides: Partial<StandardsWorkspace> = {}): StandardsWorkspace {
    return {
      status: "ready",
      asOf: "2026-08-13T02:00:00.000Z",
      openChecks: [summary()],
      ...overrides,
    };
  }

  test("shows an open due check with its time and a clear way in", () => {
    render(<CentreStandardsWorkspaceView response={workspace()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Your checks" })).toBeDefined();
    const item = screen.getByRole("heading", { level: 3, name: "Centre Standards Pilot — Staging" }).closest("li");
    expect(within(item as HTMLElement).getByText("Due by 9:00am")).toBeDefined();
    expect(
      within(item as HTMLElement).getByRole("link", { name: /Start check/u }).getAttribute("href"),
    ).toBe(`/standards/checks/${OCCURRENCE}`);
  });

  test("leads with overdue work rather than burying it", () => {
    render(
      <CentreStandardsWorkspaceView
        response={workspace({ openChecks: [summary({ timeliness: "OVERDUE" })] })}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "One check is overdue" })).toBeDefined();
    expect(screen.getByText("Overdue")).toBeDefined();
    // "Missed" reads as terminal; the check can still be completed.
    expect(document.body.textContent).not.toMatch(/missed/iu);
  });

  test("states a real all-clear only when the list was actually established", () => {
    render(<CentreStandardsWorkspaceView response={workspace({ openChecks: [] })} />);
    expect(screen.getByText("Nothing due right now")).toBeDefined();
  });

  test("never turns an unestablished list into nothing due", () => {
    render(
      <CentreStandardsWorkspaceView
        response={workspace({ status: "partial", openChecks: undefined, warning: undefined })}
      />,
    );
    expect(screen.queryByText("Nothing due right now")).toBeNull();
    expect(screen.getByText("Your checks couldn't be loaded")).toBeDefined();
    expect(document.body.textContent).toMatch(/does not mean there is nothing due/iu);
  });

  test("warns without claiming completeness when the list is partial", () => {
    render(
      <CentreStandardsWorkspaceView
        response={workspace({ status: "partial", openChecks: [summary()] })}
      />,
    );
    expect(document.body.textContent).toMatch(/couldn't be checked/iu);
    expect(document.body.textContent).toMatch(/has not been confirmed as done/iu);
  });

  test("gives an unauthorised principal no checks and no business claim", () => {
    render(
      <CentreStandardsWorkspaceView
        response={{ status: "unsupported", asOf: "2026-08-13T02:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("No checks are assigned to you")).toBeDefined();
    expect(document.body.textContent).toMatch(/Technical administration alone/u);
    expect(screen.queryByText("Nothing due right now")).toBeNull();
  });

  test("carries the synthetic marker on the list itself", () => {
    render(<CentreStandardsWorkspaceView response={workspace()} />);
    expect(screen.getByText(SYNTHETIC_NOTICE)).toBeDefined();
  });

  test("offers a reader a view rather than a start control", () => {
    render(
      <CentreStandardsWorkspaceView
        response={workspace({
          openChecks: [summary({ authority: { canComplete: false, canRead: true } })],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /View check/u })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Start check/u })).toBeNull();
  });

  test("keeps completed history out of the task list", () => {
    // A completed occurrence is simply not an open check, so the contract has
    // nowhere to put it. This asserts the landing never renders one.
    render(<CentreStandardsWorkspaceView response={workspace({ openChecks: [] })} />);
    // No completed record is rendered; the summary line may still explain that
    // completed checks leave the list, which is guidance rather than a record.
    expect(document.querySelectorAll(".standards-card")).toHaveLength(0);
    expect(screen.queryByText(/^Completed /u)).toBeNull();
    expect(document.body.textContent).toMatch(/Completed checks leave this list/u);
  });
});

describe("Centre Standards completion", () => {
  test("moves one question at a time with clear progress", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);

    expect(screen.getByText("Question 1 of 3")).toBeDefined();
    expect(screen.getByRole("group", { name: /Test question 1/u })).toBeDefined();
    expect(screen.queryByRole("group", { name: /Test question 2/u })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Question 2 of 3")).toBeDefined();
    expect(screen.getByRole("group", { name: /Test question 2/u })).toBeDefined();
  });

  test("cannot advance or submit before the question is answered", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
  });

  test("records the selected answer accessibly and keeps it when stepping back", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    const chosen = screen.getByRole("radio", { name: /Report an issue/u });
    fireEvent.click(chosen);
    expect((chosen as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      (screen.getByRole("radio", { name: /Report an issue/u }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("submits once even when the control is tapped repeatedly", async () => {
    const submit = vi.fn(() => new Promise<CompleteCheckResult>(() => {}));
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();

    const button = screen.getByRole("button", { name: "Submit check" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" }).hasAttribute("disabled")).toBe(true);
  });

  test("sends every answer, keyed by question, exactly once", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(submit).toHaveBeenCalledWith([
      { questionId: "q1", value: "OPT_RECORDED" },
      { questionId: "q2", value: "OPT_RECORDED" },
      { questionId: "q3", value: "OPT_RECORDED" },
    ]);
  });

  test("keeps every answer on screen after a recoverable failure", async () => {
    const submit = vi
      .fn<() => Promise<CompleteCheckResult>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        outcome: "COMPLETED",
        completedLocalTime: "7:44am",
        issueRaised: false,
      });
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByText("That didn't send");
    // The form is still mounted, still on the last question, still answered.
    expect(screen.getByRole("group", { name: /Test question 3/u })).toBeDefined();
    expect(
      (screen.getByRole("radio", { name: /No issue to report/u }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(document.body.textContent).toMatch(/Your answers are still here/u);
    expect(document.body.textContent).toMatch(/Nothing has been recorded yet/u);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  test("warns before unsaved answers would be discarded", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
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
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));
    await screen.findByRole("heading", { level: 1, name: "Check complete" });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("lands on a real completion screen, not a toast", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:42am",
        issueRaised: false,
      }),
    );
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(screen.getByText("Thanks — your check is complete.")).toBeDefined();
    expect(screen.queryByRole("group", { name: /Test question/u })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to your checks" })).toBeDefined();
  });

  test("says an issue was raised without naming any workflow record", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "COMPLETED",
        completedLocalTime: "7:45am",
        issueRaised: true,
      }),
    );
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll(["Report an issue", "No issue to report", "No issue to report"]);
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Check complete" });
    expect(
      screen.getByText("Thanks — your check is complete. One issue has been raised for follow-up."),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(FORBIDDEN_WORDS);
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TOKENS);
    // Notifications do not exist in 4A, so nothing may promise one.
    expect(document.body.textContent).not.toMatch(/notified|notification/iu);
  });

  test("treats a lost response the requester already committed as success", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "ALREADY_COMPLETED",
        completedLocalTime: "7:42am",
        completedByRequester: true,
      }),
    );
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Already submitted" });
    expect(
      screen.getByText("Already submitted — you completed this check at 7:42am."),
    ).toBeDefined();
    // It must not read as a failure.
    expect(document.body.textContent).not.toMatch(/didn't send|error|failed/iu);
  });

  test("does not claim a retry was accepted when someone else completed it", async () => {
    const submit = vi.fn(() =>
      Promise.resolve<CompleteCheckResult>({
        outcome: "ALREADY_COMPLETED",
        completedLocalTime: "8:05am",
        completedByRequester: false,
      }),
    );
    render(<StandardsCheckCompletion check={detail()} submit={submit} />);
    answerAll();
    fireEvent.click(screen.getByRole("button", { name: "Submit check" }));

    await screen.findByRole("heading", { level: 1, name: "Already completed" });
    expect(screen.getByText("This check has already been completed.")).toBeDefined();
    expect(document.body.textContent).toMatch(/were not submitted/u);
  });

  test("shows the synthetic marker beside the questions, not only on a landing screen", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    expect(screen.getByText(SYNTHETIC_NOTICE)).toBeDefined();
    expect(screen.getByText("Staging test content")).toBeDefined();
  });

  test("exposes no workflow, severity or identifier language to the Educator", () => {
    const { container } = render(
      <StandardsCheckCompletion check={detail()} submit={vi.fn()} />,
    );
    expect(document.body.textContent).not.toMatch(FORBIDDEN_WORDS);
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TOKENS);
    // Opaque identifiers are route plumbing and must never be displayed.
    expect(container.textContent).not.toContain(OCCURRENCE);
    expect(container.textContent).not.toContain("OPT_RECORDED");
    expect(container.textContent).not.toContain("q1");
  });
});

describe("Centre Standards read-only occurrence", () => {
  test("shows a reader the check without any completion control", () => {
    render(
      <CentreStandardsCheckView
        check={detail({ authority: { canComplete: false, canRead: true } })}
        submit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.body.textContent).toMatch(/not set up to complete it/u);
    expect(screen.getByText("Due by 9:00am")).toBeDefined();
  });

  test("shows a completed occurrence as a read-only record, never an error", () => {
    render(
      <CentreStandardsCheckView
        check={detail({
          timeliness: "COMPLETED_ON_TIME",
          completedLocalTime: "7:42am",
          responses: [
            { questionId: "q1", wording: "Test question 1 — select the recorded outcome", answerLabel: "No issue to report" },
          ],
        })}
        submit={vi.fn()}
      />,
    );
    expect(screen.getByText("Completed 7:42am")).toBeDefined();
    expect(screen.getByText("What was recorded")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Submit check" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toMatch(/cannot be changed/u);
  });

  test("states lateness about the check, never about a named person", () => {
    render(
      <StandardsCheckReadOnly
        check={detail({ timeliness: "COMPLETED_LATE", completedLocalTime: "9:18am" })}
      />,
    );
    expect(screen.getByText("Completed late · 9:18am")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/by [A-Z][a-z]+ [A-Z][a-z]+/u);
    expect(document.body.textContent).not.toMatch(/%/u);
  });

  test("says answers are unavailable rather than showing an empty record", () => {
    render(
      <StandardsCheckReadOnly
        check={detail({
          timeliness: "COMPLETED_ON_TIME",
          completedLocalTime: "7:42am",
          responses: undefined,
        })}
      />,
    );
    expect(screen.getByText("The recorded answers are not available to you.")).toBeDefined();
    expect(screen.queryByText("What was recorded")).toBeNull();
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
      <CentreStandardsWorkspace
        gateway={gateway({ status: "ready", asOf: "2026-08-13T02:00:00.000Z", openChecks: [summary()] })}
      />,
    );

    await screen.findByRole("heading", { level: 1, name: "Your checks" });
    const nav = screen.getByRole("navigation", { name: "Centre Success workspaces" });
    await within(nav).findByRole("link", { name: "Centre Standards" });
    expect(
      within(nav).getByRole("link", { name: "Centre Standards" }).getAttribute("aria-current"),
    ).toBe("page");
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
    render(
      <CentreStandardsWorkspace
        gateway={gateway({ status: "ready", asOf: "2026-08-13T02:00:00.000Z", openChecks: [] })}
      />,
    );
    await waitFor(() => {
      const status = screen.getAllByRole("status").map((node) => node.textContent);
      expect(status.join(" ")).toContain("Your checks are ready.");
    });
  });
});

describe("Centre Standards accessibility critical path", () => {
  test("uses one page heading and real form grouping", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Native radios inside a fieldset: keyboard and screen-reader behaviour
    // come from the platform rather than being re-implemented.
    const group = screen.getByRole("group", { name: /Test question 1/u });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });

  test("keeps every control keyboard reachable and never disabled without reason", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /No issue to report/u }));
    for (const control of [...screen.getAllByRole("radio"), ...screen.getAllByRole("button")]) {
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(false);
  });

  test("states progress in words rather than by the bar alone", () => {
    render(<StandardsCheckCompletion check={detail()} submit={vi.fn()} />);
    expect(screen.getByText("Question 1 of 3")).toBeDefined();
    expect(document.querySelector(".check-progress__track")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("gives every state a written label, never colour alone", () => {
    render(<CentreStandardsWorkspaceView response={{ status: "ready", asOf: "x", openChecks: [summary({ timeliness: "OVERDUE" })] }} />);
    const badge = document.querySelector(".status-pill");
    expect(badge?.textContent?.trim()).toBe("Overdue");
    expect(badge?.getAttribute("data-tone")).toBe("critical");
  });
});
