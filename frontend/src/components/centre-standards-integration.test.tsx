import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  ActionOriginLine,
  DailyOccurrenceCard,
  DailyOccurrenceList,
  actionOriginLabel,
  occurrenceCta,
  projectDailyOccurrences,
} from "./centre-standards-integration";
import type { ActionOrigin } from "./centre-standards-integration";
import type { StandardsCheckSummary } from "./centre-standards-contract";

afterEach(cleanup);

const OCCURRENCE = "b6f2b0c4-1a4e-4a5c-9f3d-0c2f1d5a7e01";
const SECOND_OCCURRENCE = "3a1c9d70-6b2e-4f18-8a55-2d9e7c4b1f02";
const SYNTHETIC_NOTICE =
  "Synthetic staging check for Centre Success testing. This is not a Bright Steps policy, regulatory requirement or operational standard.";

/** Typed fixtures only; the wording is unmistakable test scaffolding. */
const IDENTITY = {
  standardName: "Centre Standards Pilot — Staging",
  centreName: "Ashgrove Quality Centre",
  businessDate: "2026-08-13",
  questionCount: 3,
} as const;

function openSummary(
  overrides: {
    occurrenceId?: string;
    timeliness?: "DUE" | "OVERDUE";
    canComplete?: boolean;
    synthetic?: boolean;
  } = {},
): StandardsCheckSummary {
  const open = {
    ...IDENTITY,
    occurrenceId: overrides.occurrenceId ?? OCCURRENCE,
    state: "OPEN",
    timeliness: overrides.timeliness ?? "DUE",
    dueLocalTime: "9:00am",
    canComplete: overrides.canComplete ?? true,
  } as const;
  return overrides.synthetic
    ? { ...open, synthetic: true, syntheticNotice: SYNTHETIC_NOTICE }
    : { ...open, synthetic: false };
}

function completedSummary(
  overrides: { occurrenceId?: string } = {},
): StandardsCheckSummary {
  return {
    occurrenceId: overrides.occurrenceId ?? SECOND_OCCURRENCE,
    standardName: "Centre Standards Pilot — Staging",
    centreName: "Ashgrove Quality Centre",
    businessDate: "2026-08-13",
    questionCount: 3,
    synthetic: false,
    state: "COMPLETED",
    timeliness: "COMPLETED_ON_TIME",
    dueLocalTime: "9:00am",
    completedLocalTime: "7:42am",
  };
}

const CENTRE_VIEW = {
  responsibility: "YOUR_CENTRE_NEEDS_TO_ACT" as const,
  includeCentreName: false,
};
const PORTFOLIO_VIEW = {
  responsibility: "YOUR_CENTRE_NEEDS_TO_ACT" as const,
  includeCentreName: true,
};

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

describe("Daily Success occurrence projection", () => {
  test("keeps a completed occurrence out of the list entirely", () => {
    const projected = projectDailyOccurrences(
      [openSummary(), completedSummary()],
      CENTRE_VIEW,
    );
    expect(projected).toHaveLength(1);
    expect(projected[0].cta.route).toBe(`/standards/checks/${OCCURRENCE}`);

    render(<DailyOccurrenceList occurrences={projected} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // A completed check is not active work, and any issue it raised travels
    // through the corrective-action source instead — never a second card.
    expect(document.body.textContent).not.toMatch(/Completed|7:42am/u);
  });

  test("renders nothing at all once every occurrence is completed", () => {
    const projected = projectDailyOccurrences([completedSummary()], CENTRE_VIEW);
    expect(projected).toEqual([]);

    const { container } = render(<DailyOccurrenceList occurrences={projected} />);
    // Daily Success owns the all-clear across every source; a quiet Centre
    // Standards list must not speak for the whole day.
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("carries overdue timeliness into why the card is shown", () => {
    const [card] = projectDailyOccurrences(
      [openSummary({ timeliness: "OVERDUE" })],
      CENTRE_VIEW,
    );
    expect(card.whyShown).toBe("CHECK_OVERDUE");
    expect(card.dueLocalTime).toBe("9:00am");
  });

  test("names the centre only where the perspective spans more than one", () => {
    const [centre] = projectDailyOccurrences([openSummary()], CENTRE_VIEW);
    const [portfolio] = projectDailyOccurrences([openSummary()], PORTFOLIO_VIEW);
    expect(centre.centreName).toBeUndefined();
    expect(portfolio.centreName).toBe("Ashgrove Quality Centre");
  });

  test("gives a reader a view label without changing the destination", () => {
    const [card] = projectDailyOccurrences(
      [openSummary({ canComplete: false })],
      CENTRE_VIEW,
    );
    expect(card.cta.label).toBe("View check");
    expect(card.cta.route).toBe(`/standards/checks/${OCCURRENCE}`);
  });

  test("carries the staging marker onto a real Daily Success list", () => {
    const projected = projectDailyOccurrences(
      [openSummary({ synthetic: true })],
      CENTRE_VIEW,
    );
    render(<DailyOccurrenceList occurrences={projected} />);
    // The reader of the card is the person who has to know it is pilot
    // content, so the marker travels with the work rather than staying on the
    // screen where it was created.
    expect(screen.getByText("Staging test content")).toBeDefined();
  });

  test("leaves a real occurrence unmarked", () => {
    render(
      <DailyOccurrenceList
        occurrences={projectDailyOccurrences([openSummary()], CENTRE_VIEW)}
      />,
    );
    expect(screen.queryByText("Staging test content")).toBeNull();
  });

  test("exposes no identifier, option value or workflow vocabulary", () => {
    render(
      <DailyOccurrenceList
        occurrences={projectDailyOccurrences(
          [openSummary({ synthetic: true, timeliness: "OVERDUE" })],
          PORTFOLIO_VIEW,
        )}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(OCCURRENCE);
    expect(text).not.toMatch(/CHECK_OVERDUE|YOUR_CENTRE_NEEDS_TO_ACT|OPEN|COMPLETED/u);
    expect(text).not.toMatch(/finding|corrective action|severity|verification|remediation/iu);
  });

  test("keeps each card distinct when a centre has more than one check", () => {
    const projected = projectDailyOccurrences(
      [
        openSummary(),
        openSummary({ occurrenceId: SECOND_OCCURRENCE, timeliness: "OVERDUE" }),
      ],
      PORTFOLIO_VIEW,
    );
    render(<DailyOccurrenceList occurrences={projected} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Start check/u })).toHaveLength(2);
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
