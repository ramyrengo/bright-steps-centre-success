import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  ActionOriginLine,
  DailyOccurrenceCard,
  actionOriginLabel,
  occurrenceCta,
} from "./centre-standards-integration";
import type { ActionOrigin } from "./centre-standards-integration";

afterEach(cleanup);

const OCCURRENCE = "b6f2b0c4-1a4e-4a5c-9f3d-0c2f1d5a7e01";

describe("Daily Success occurrence card", () => {
  const base = {
    standardName: "Centre Standards Pilot — Staging",
    dueLocalTime: "9:00am",
    cta: occurrenceCta({ occurrenceId: OCCURRENCE, canComplete: true }),
  };

  test("states why it is shown and who needs to act", () => {
    render(
      <DailyOccurrenceCard
        {...base}
        centreName="Ashgrove Quality Centre"
        whyShown="CHECK_DUE_TODAY"
        responsibility="YOUR_CENTRE_NEEDS_TO_ACT"
      />,
    );
    expect(screen.getByText("Due today")).toBeDefined();
    expect(screen.getByText("Your centre needs to act")).toBeDefined();
    expect(screen.getByText(/Ashgrove Quality Centre · Due by 9:00am/u)).toBeDefined();
  });

  test("marks an overdue occurrence in words and past tense", () => {
    render(
      <DailyOccurrenceCard
        {...base}
        whyShown="CHECK_OVERDUE"
        responsibility="YOUR_CENTRE_NEEDS_TO_ACT"
      />,
    );
    const badge = document.querySelector(".status-pill");
    expect(badge?.textContent?.trim()).toBe("Overdue");
    expect(badge?.getAttribute("data-tone")).toBe("critical");
    expect(screen.getByText("Was due by 9:00am")).toBeDefined();
  });

  test("omits the centre on a single-centre perspective", () => {
    render(
      <DailyOccurrenceCard
        {...base}
        whyShown="CHECK_DUE_TODAY"
        responsibility="YOU_NEED_TO_ACT"
      />,
    );
    expect(screen.getByText("Due by 9:00am")).toBeDefined();
    expect(screen.queryByText(/·/u)).toBeNull();
  });

  test("sends a completer and a reader to the same reauthorising route", () => {
    const completer = occurrenceCta({ occurrenceId: OCCURRENCE, canComplete: true });
    const reader = occurrenceCta({ occurrenceId: OCCURRENCE, canComplete: false });
    // One destination that resolves by capability, so a reader is never routed
    // to a completion-only surface and onto a denial.
    expect(completer.route).toBe(`/standards/checks/${OCCURRENCE}`);
    expect(reader.route).toBe(completer.route);
    expect(completer.label).toBe("Start check");
    expect(reader.label).toBe("View check");
  });

  test("names the check in the accessible link name", () => {
    render(
      <DailyOccurrenceCard
        {...base}
        whyShown="CHECK_DUE_TODAY"
        responsibility="YOU_NEED_TO_ACT"
      />,
    );
    expect(
      screen.getByRole("link", { name: /Start check — Centre Standards Pilot/u }),
    ).toBeDefined();
  });
});

describe("corrective-action origin", () => {
  const audit: ActionOrigin = {
    source: "QUARTERLY_AUDIT",
    quarterLabel: "Q2 2026",
    route: "/centre/reviews/run-1",
  };
  const check: ActionOrigin = {
    source: "OPERATIONAL_CHECK",
    standardName: "Centre Standards Pilot — Staging",
    businessDate: "2026-08-13",
    synthetic: true,
    route: `/standards/checks/${OCCURRENCE}`,
  };

  test("labels a quarterly origin without exposing the enum", () => {
    render(<ActionOriginLine origin={audit} />);
    expect(screen.getByText("Quarterly review")).toBeDefined();
    expect(screen.getByText("From the Q2 2026 quarterly review")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/QUARTERLY_AUDIT|OPERATIONAL_CHECK/u);
  });

  test("labels an operational origin as a Centre Standard", () => {
    render(<ActionOriginLine origin={check} />);
    expect(screen.getByText("Centre Standard")).toBeDefined();
    expect(
      screen.getByText(/From the Centre Standards Pilot — Staging check on .*13 Aug/u),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(/QUARTERLY_AUDIT|OPERATIONAL_CHECK/u);
    expect(document.body.textContent).not.toContain("2026-08-13");
  });

  test("carries the synthetic marker onto the action it created", () => {
    render(<ActionOriginLine origin={check} />);
    expect(screen.getByText("Staging test content")).toBeDefined();
  });

  test("shows no acknowledgement state for an operational origin", () => {
    render(<ActionOriginLine origin={check} />);
    // Acknowledgement is audit-only; it has nowhere to live on this branch.
    expect(document.body.textContent).not.toMatch(/acknowledg/iu);
  });

  test("surfaces an unacknowledged quarterly review only on the audit branch", () => {
    render(<ActionOriginLine origin={{ ...audit, acknowledged: false }} />);
    expect(screen.getByText("Review not yet acknowledged")).toBeDefined();
  });

  test("links only where the reader is authorised for the source", () => {
    const { container } = render(
      <ActionOriginLine origin={{ source: "QUARTERLY_AUDIT", quarterLabel: "Q1 2026" }} />,
    );
    expect(within(container).queryByRole("link")).toBeNull();
    expect(screen.getByText("From the Q1 2026 quarterly review")).toBeDefined();
  });

  test("exposes a stable label helper for list surfaces", () => {
    expect(actionOriginLabel(audit)).toBe("Quarterly review");
    expect(actionOriginLabel(check)).toBe("Centre Standard");
  });
});
