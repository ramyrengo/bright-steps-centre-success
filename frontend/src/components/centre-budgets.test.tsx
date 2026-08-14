import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
const clientMocks = vi.hoisted(() => {
  const getCentreBudgetMonth = vi.fn();
  const getPortfolioBudgetMonth = vi.fn();
  const createCentreBudgetActual = vi.fn();
  const getAuthorisedNavigationEndpoint = vi.fn();
  return {
    getCentreBudgetMonth,
    getPortfolioBudgetMonth,
    createCentreBudgetActual,
    getAuthorisedNavigationEndpoint,
    client: {
      foundation: {
        getCentreBudgetMonth,
        getPortfolioBudgetMonth,
        createCentreBudgetActual,
        getAuthorisedNavigationEndpoint,
      },
    },
  };
});

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "budgets-test" },
    signOut: authMocks.signOut,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks.client,
}));

import { CentreBudgetMonth } from "./centre-budget-month";
import { PortfolioBudgetMonth } from "./portfolio-budget-month";

const MONTH = "2026-08";
const CENTRE_A = "00000000-0000-4000-8000-0000000000a1";
const CENTRE_B = "00000000-0000-4000-8000-0000000000b2";
const CENTRE_C = "00000000-0000-4000-8000-0000000000c3";
const CATEGORY_FOOD = "00000000-0000-4000-8000-00000000f001";
const CATEGORY_CLEANING = "00000000-0000-4000-8000-00000000c002";
const CATEGORY_RELIEF = "00000000-0000-4000-8000-00000000d003";
const CATEGORY_EXCURSIONS = "00000000-0000-4000-8000-00000000e004";

/**
 * Every internal value the API carries but no reader should ever see. The
 * final test asserts that not one of them reaches the document.
 */
const INTERNAL_TOKENS = [
  "FOOD_AND_CATERING",
  "CLEANING_AND_HYGIENE",
  "RELIEF_STAFFING",
  "EXCURSIONS",
  "AWAITING_ACTUAL",
  "BUDGET_AND_ACTUAL",
  "NOTHING_RECORDED",
  "ACTUAL_WITHOUT_BUDGET",
  "NOT_CONFIGURED",
  "NOT_APPLICABLE",
  "BANDED",
  "manual_entry",
  "finance_system_import",
  "AMBER_OVER_90",
  "AMBER_UNDER_10",
  "GOVERNED",
  "BUDGET_USED",
  "REMAINING_BUDGET",
  "percent_used",
  "remaining_amount",
  "overspend-severity-policy",
  "budget-line-food",
  "actual-cleaning-01",
] as const;

/**
 * A governing policy with two rules, which is the shape an approved policy
 * takes. Both are asked of every position and they are entitled to disagree, so
 * every fixture below states an outcome for both. The codes and labels are
 * synthetic and are not a Bright Steps threshold.
 */
const GOVERNING_POLICY = {
  state: "GOVERNED",
  policyKey: "overspend-severity-policy",
  policyVersion: 3,
  policyEffectiveFromMonth: "2026-07",
} as const;

const PERCENT_RULE = {
  ruleCode: "BUDGET_USED",
  ruleLabel: "Budget used",
  measure: "percent_used",
} as const;

const REMAINING_RULE = {
  ruleCode: "REMAINING_BUDGET",
  ruleLabel: "Remaining budget",
  measure: "remaining_amount",
} as const;

function banded(usedLabel: string, remainingLabel: string) {
  return {
    ...GOVERNING_POLICY,
    rules: [
      { ...PERCENT_RULE, state: "BANDED", bandCode: "AMBER_OVER_90", bandLabel: usedLabel },
      {
        ...REMAINING_RULE,
        state: "BANDED",
        bandCode: "AMBER_UNDER_10",
        bandLabel: remainingLabel,
      },
    ],
  };
}

/** A policy is in force and neither rule has anything to measure. */
function unjudgeable() {
  const reason =
    "Both an approved budget and a recorded actual are needed before this can be judged.";
  return {
    ...GOVERNING_POLICY,
    rules: [
      { ...PERCENT_RULE, state: "NOT_APPLICABLE", reason },
      { ...REMAINING_RULE, state: "NOT_APPLICABLE", reason },
    ],
  };
}

/** A category with an approved budget and no actual. The state this exists for. */
function awaitingActual() {
  return {
    categoryId: CATEGORY_FOOD,
    categoryCode: "FOOD_AND_CATERING",
    categoryName: "Food and catering",
    categoryStatus: "active",
    sortOrder: 1,
    state: "AWAITING_ACTUAL",
    approvedBudget: {
      budgetLineId: "budget-line-food",
      // Deliberately free of a "0.00" substring, so the assertion that this
      // row shows no zero is testing the actual column and nothing else.
      amount: "4275.50",
      currency: "AUD",
      sourceKind: "manual_entry",
      recordedAt: "2026-07-28T02:00:00.000Z",
    },
    threshold: unjudgeable(),
  };
}

/** A deliberate, recorded zero. Somebody stated that nothing was spent. */
function recordedZero() {
  return {
    categoryId: CATEGORY_CLEANING,
    categoryCode: "CLEANING_AND_HYGIENE",
    categoryName: "Cleaning and hygiene",
    categoryStatus: "active",
    sortOrder: 2,
    state: "BUDGET_AND_ACTUAL",
    approvedBudget: {
      budgetLineId: "budget-line-cleaning",
      amount: "900.00",
      currency: "AUD",
      sourceKind: "manual_entry",
      recordedAt: "2026-07-28T02:00:00.000Z",
    },
    actual: {
      actualId: "actual-cleaning-01",
      amount: "0.00",
      currency: "AUD",
      sourceKind: "manual_entry",
      enteredAt: "2026-08-03T02:00:00.000Z",
      enteredByPrincipalId: CENTRE_A,
      confirmed: true,
      confirmedAt: "2026-08-03T02:05:00.000Z",
    },
    remaining: "900.00",
    percentUsed: "0.00",
    threshold: banded(
      "Comfortably inside the approved limit",
      "All of the approved budget remaining",
    ),
  };
}

function overBudget() {
  return {
    categoryId: CATEGORY_RELIEF,
    categoryCode: "RELIEF_STAFFING",
    categoryName: "Relief staffing",
    categoryStatus: "active",
    sortOrder: 3,
    state: "BUDGET_AND_ACTUAL",
    approvedBudget: {
      budgetLineId: "budget-line-relief",
      amount: "10000.00",
      currency: "AUD",
      sourceKind: "manual_entry",
      recordedAt: "2026-07-28T02:00:00.000Z",
    },
    actual: {
      actualId: "actual-relief-01",
      amount: "12500.00",
      currency: "AUD",
      sourceKind: "manual_entry",
      enteredAt: "2026-08-06T02:00:00.000Z",
      confirmed: false,
    },
    remaining: "-2500.00",
    percentUsed: "125.00",
    threshold: banded("Above the approved limit", "Nothing of the approved budget remaining"),
  };
}

function nothingRecorded() {
  return {
    categoryId: CATEGORY_EXCURSIONS,
    categoryCode: "EXCURSIONS",
    categoryName: "Excursions and incursions",
    categoryStatus: "active",
    sortOrder: 4,
    state: "NOTHING_RECORDED",
    threshold: unjudgeable(),
  };
}

function monthResponse(overrides: Record<string, unknown> = {}) {
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-14T02:00:00.000Z",
    month: MONTH,
    centreId: CENTRE_A,
    centreName: "Willowbank Early Learning",
    status: "partial",
    categories: [awaitingActual(), recordedZero(), overBudget(), nothingRecorded()],
    summary: {
      coverage: "partial",
      categoryCount: 4,
      budgetedCategoryCount: 3,
      recordedActualCount: 2,
      awaitingActualCount: 1,
      actualWithoutBudgetCount: 0,
      nothingRecordedCount: 1,
      currency: "AUD",
    },
    canEnterActual: true,
    thresholdPolicyConfigured: true,
    warning: "Some categories have no actual recorded yet, so this month is not a complete picture.",
    ...overrides,
  };
}

function completeMonthResponse() {
  return monthResponse({
    status: "ready",
    categories: [recordedZero(), overBudget()],
    summary: {
      coverage: "complete",
      categoryCount: 2,
      budgetedCategoryCount: 2,
      recordedActualCount: 2,
      awaitingActualCount: 0,
      actualWithoutBudgetCount: 0,
      nothingRecordedCount: 0,
      currency: "AUD",
      totalApprovedBudget: "10900.00",
      totalRecordedActual: "12500.00",
      totalRemaining: "-1600.00",
      totalPercentUsed: "114.68",
    },
    warning: undefined,
  });
}

function centreSummary(overrides: Record<string, unknown> = {}) {
  return {
    coverage: "complete",
    categoryCount: 4,
    budgetedCategoryCount: 4,
    recordedActualCount: 4,
    awaitingActualCount: 0,
    actualWithoutBudgetCount: 0,
    nothingRecordedCount: 0,
    currency: "AUD",
    totalApprovedBudget: "15000.00",
    totalRecordedActual: "13500.00",
    totalRemaining: "1500.00",
    totalPercentUsed: "90.00",
    ...overrides,
  };
}

/**
 * Attention order and alphabetical order deliberately disagree here, so a page
 * that fell back to sorting by name would fail the ordering assertion.
 */
function portfolioResponse(overrides: Record<string, unknown> = {}) {
  return {
    cacheControl: "private, no-store",
    asOf: "2026-08-14T02:00:00.000Z",
    month: MONTH,
    status: "partial",
    centres: [
      {
        centreId: CENTRE_C,
        centreName: "Ashgrove Early Learning",
        summary: centreSummary(),
      },
      {
        centreId: CENTRE_B,
        centreName: "Marlow Street Early Learning",
        summary: centreSummary({
          coverage: "partial",
          recordedActualCount: 1,
          budgetedCategoryCount: 3,
          awaitingActualCount: 2,
          nothingRecordedCount: 1,
          totalApprovedBudget: undefined,
          totalRecordedActual: undefined,
          totalRemaining: undefined,
          totalPercentUsed: undefined,
        }),
      },
      {
        centreId: CENTRE_A,
        centreName: "Willowbank Early Learning",
        summary: centreSummary({
          totalApprovedBudget: "15000.00",
          totalRecordedActual: "16250.00",
          totalRemaining: "-1250.00",
          totalPercentUsed: "108.33",
        }),
      },
    ],
    coverage: "partial",
    visibleCentreCount: 3,
    completeCentreCount: 2,
    incompleteCentreCount: 1,
    thresholdPolicyConfigured: false,
    warning: "Some centres are still missing actuals for this month.",
    ...overrides,
  };
}

async function rowFor(name: RegExp): Promise<HTMLElement> {
  const header = await screen.findByRole("rowheader", { name });
  const row = header.closest("tr");
  if (!row) throw new Error("row not found");
  return row;
}

beforeEach(() => {
  authMocks.signOut.mockReset();
  clientMocks.getCentreBudgetMonth.mockReset();
  clientMocks.getPortfolioBudgetMonth.mockReset();
  clientMocks.createCentreBudgetActual.mockReset();
  clientMocks.getAuthorisedNavigationEndpoint.mockReset();
  clientMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({
    cacheControl: "private, no-store",
    links: [],
  });
  // Pin the month so the assertions do not depend on the day the suite runs.
  window.history.replaceState(null, "", `/budgets?month=${MONTH}`);
});

afterEach(cleanup);

describe("a centre-month never reads a missing figure as zero", () => {
  test("a category with no actual says so, and shows no amount at all", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const row = await rowFor(/Food and catering/u);
    expect(within(row).getByText("Not recorded")).toBeTruthy();
    // The one assertion this whole module exists for.
    expect(row.textContent).not.toMatch(/0\.00|\b0\b/u);
    expect(row.textContent).toContain("Actual not recorded");
    // An approved budget with no actual is neither a remaining balance nor a
    // percentage, so neither is stated.
    expect(within(row).getAllByText("Not available").length).toBe(2);
  });

  test("a category with nothing recorded at all makes no claim either way", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const row = await rowFor(/Excursions and incursions/u);
    expect(within(row).getByText("No approved budget")).toBeTruthy();
    expect(within(row).getByText("Not recorded")).toBeTruthy();
    expect(row.textContent).not.toMatch(/\$|0\.00/u);
    expect(row.textContent).not.toMatch(/within|on budget|all clear/iu);
  });

  test("a recorded zero is shown as a figure, and is distinguishable from absent", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const recorded = await rowFor(/Cleaning and hygiene/u);
    const absent = await rowFor(/Food and catering/u);

    // A real zero keeps both its decimals and its currency: a round-trip
    // through a JavaScript number would render it as "0".
    expect(within(recorded).getByText("AUD 0.00")).toBeTruthy();
    expect(within(recorded).getByText("Confirmed by the centre")).toBeTruthy();
    expect(within(recorded).queryByText("Not recorded")).toBeNull();
    expect(within(absent).queryByText("AUD 0.00")).toBeNull();
    expect(within(absent).getByText("Not recorded")).toBeTruthy();

    // And the two are marked as different states, not just different numbers.
    expect(recorded.getAttribute("data-state")).not.toBe(absent.getAttribute("data-state"));
  });

  test("overspend is stated from the recorded figures, in words as well as colour", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const row = await rowFor(/Relief staffing/u);
    expect(within(row).getByText("AUD -2,500.00")).toBeTruthy();
    expect(within(row).getByText("125.00%")).toBeTruthy();
    expect(row.textContent).toContain("Over approved budget");
    expect(within(row).getByText("Recorded, not yet confirmed")).toBeTruthy();
  });
});

describe("a partly recorded month withholds its totals", () => {
  test("no total is stated over a gap, and the gap is named", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    await screen.findByText("This month is not a complete picture.");
    const glance = screen.getByRole("region", { name: "This month at a glance" });
    // Four totals, every one of them withheld rather than summed.
    expect(within(glance).getAllByText("Not available").length).toBe(4);
    expect(within(glance).getByText(/2 of 4 categories have an actual recorded/u)).toBeTruthy();
    expect(glance.textContent).not.toMatch(/on budget|all clear|nothing outstanding/iu);
  });

  test("a fully recorded month is allowed to state its totals", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(completeMonthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const glance = await screen.findByRole("region", { name: "This month at a glance" });
    expect(within(glance).getByText("AUD 10,900.00")).toBeTruthy();
    expect(within(glance).getByText("AUD -1,600.00")).toBeTruthy();
    expect(within(glance).getByText("114.68%")).toBeTruthy();
    expect(within(glance).queryByText("Not available")).toBeNull();
    expect(screen.queryByText("This month is not a complete picture.")).toBeNull();
  });

  /**
   * A policy may hold more than one approved rule, and two rules can reach
   * different conclusions about the same category. Both have to reach the page,
   * each saying which rule it came from, because dropping either would present a
   * single verdict the organisation never approved.
   */
  test("shows every approved rule, including two that disagree", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(
      monthResponse({
        categories: [
          {
            ...recordedZero(),
            threshold: banded(
              "85% to 100% of the approved budget used",
              "10% or more of the approved budget remaining",
            ),
          },
        ],
      }),
    );
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const row = await rowFor(/Cleaning and hygiene/u);
    expect(within(row).getByText("85% to 100% of the approved budget used")).toBeTruthy();
    expect(within(row).getByText("10% or more of the approved budget remaining")).toBeTruthy();
    expect(within(row).getByText(/^Budget used, judged against/u)).toBeTruthy();
    expect(within(row).getByText(/^Remaining budget, judged against/u)).toBeTruthy();
  });

  test("names the rule that could not judge a category, for every rule", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    const row = await rowFor(/Food and catering/u);
    const badges = within(row).getAllByText("Cannot be judged");
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge.getAttribute("data-tone")).toBe("neutral");
      expect(badge.getAttribute("data-tone")).not.toBe("positive");
    }
    expect(within(row).getByText(/^Budget used\./u)).toBeTruthy();
    expect(within(row).getByText(/^Remaining budget\./u)).toBeTruthy();
  });

  test("an unset threshold is never dressed up as being inside one", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(
      monthResponse({
        thresholdPolicyConfigured: false,
        categories: [
          { ...awaitingActual(), threshold: { state: "NOT_CONFIGURED", rules: [] } },
          { ...nothingRecorded(), threshold: { state: "NOT_CONFIGURED", rules: [] } },
        ],
        summary: {
          coverage: "partial",
          categoryCount: 2,
          budgetedCategoryCount: 1,
          recordedActualCount: 0,
          awaitingActualCount: 1,
          actualWithoutBudgetCount: 0,
          nothingRecordedCount: 1,
          currency: "AUD",
        },
      }),
    );
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    await screen.findByText("No approved spending threshold covers this month.");
    const row = await rowFor(/Food and catering/u);
    const badge = within(row).getByText("No threshold set");
    expect(badge.getAttribute("data-tone")).toBe("neutral");
    expect(badge.getAttribute("data-tone")).not.toBe("positive");
  });

  test("no categories at all is an honest empty state, not an all-clear", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(
      monthResponse({
        categories: [],
        summary: {
          coverage: "partial",
          categoryCount: 0,
          budgetedCategoryCount: 0,
          recordedActualCount: 0,
          awaitingActualCount: 0,
          actualWithoutBudgetCount: 0,
          nothingRecordedCount: 0,
        },
      }),
    );
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    await screen.findByText("No reporting categories are set up yet");
    expect(screen.getByText(/that is not the same as this centre having nothing/iu)).toBeTruthy();
  });
});

describe("recording an actual", () => {
  async function openEntry() {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);
    const button = await screen.findByRole("button", {
      name: /Record actual for Food and catering/u,
    });
    fireEvent.click(button);
    return screen.findByLabelText(/Amount spent this month/u);
  }

  test("sends the figure exactly as typed, as a string, in the recorded currency", async () => {
    clientMocks.createCentreBudgetActual.mockResolvedValue({
      cacheControl: "private, no-store",
      asOf: "2026-08-14T02:10:00.000Z",
      month: MONTH,
      centreId: CENTRE_A,
      position: recordedZero(),
    });
    const input = await openEntry();

    fireEvent.change(input, { target: { value: "1234.05" } });
    fireEvent.click(screen.getByLabelText(/I confirm this figure is correct/u));
    fireEvent.click(screen.getByRole("button", { name: "Save and confirm" }));

    await waitFor(() => expect(clientMocks.createCentreBudgetActual).toHaveBeenCalledTimes(1));
    expect(clientMocks.createCentreBudgetActual).toHaveBeenCalledWith(MONTH, CENTRE_A, {
      categoryId: CATEGORY_FOOD,
      amount: "1234.05",
      currency: "AUD",
      confirmed: true,
    });
    // The month is re-read rather than patched, so coverage and every total
    // stay the backend's to decide.
    await waitFor(() => expect(clientMocks.getCentreBudgetMonth).toHaveBeenCalledTimes(2));
  });

  test("a deliberate zero is a valid entry", async () => {
    clientMocks.createCentreBudgetActual.mockResolvedValue({
      cacheControl: "private, no-store",
      asOf: "2026-08-14T02:10:00.000Z",
      month: MONTH,
      centreId: CENTRE_A,
      position: recordedZero(),
    });
    const input = await openEntry();

    fireEvent.change(input, { target: { value: "0.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this figure" }));

    await waitFor(() => expect(clientMocks.createCentreBudgetActual).toHaveBeenCalledTimes(1));
    expect(clientMocks.createCentreBudgetActual.mock.calls[0][2].amount).toBe("0.00");
  });

  test("an empty entry is refused rather than becoming a zero", async () => {
    await openEntry();

    fireEvent.click(screen.getByRole("button", { name: "Save this figure" }));

    expect(clientMocks.createCentreBudgetActual).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Enter an amount with up to two decimal places",
    );
    expect(screen.getByText(/leaving this empty records nothing at all/iu)).toBeTruthy();
  });

  test("entry is refused when no currency has ever been recorded here", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(
      monthResponse({
        categories: [nothingRecorded()],
        summary: {
          coverage: "partial",
          categoryCount: 1,
          budgetedCategoryCount: 0,
          recordedActualCount: 0,
          awaitingActualCount: 0,
          actualWithoutBudgetCount: 0,
          nothingRecordedCount: 1,
        },
      }),
    );
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Record actual for Excursions and incursions/u }),
    );
    const save = await screen.findByRole("button", { name: "Save this figure" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/No currency has been recorded against this centre/iu)).toBeTruthy();
  });

  test("a reader without entry rights sees no entry control", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse({ canEnterActual: false }));
    render(<CentreBudgetMonth centreId={CENTRE_A} />);

    await screen.findByText("Food and catering");
    expect(screen.queryByRole("button", { name: /Record actual/u })).toBeNull();
    expect(screen.getByText(/but not record against it/iu)).toBeTruthy();
  });
});

describe("the portfolio never presents partial coverage as an all-clear", () => {
  test("centres are ordered by attention, not by name", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(portfolioResponse());
    render(<PortfolioBudgetMonth />);

    await screen.findByText("Willowbank Early Learning");
    const names = screen.getAllByRole("heading", { level: 4 }).map((node) => node.textContent);
    expect(names).toEqual([
      "Willowbank Early Learning",
      "Marlow Street Early Learning",
      "Ashgrove Early Learning",
    ]);
  });

  test("the headline states the gap instead of an all-clear", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(
      portfolioResponse({
        centres: [
          {
            centreId: CENTRE_B,
            centreName: "Marlow Street Early Learning",
            summary: centreSummary({
              coverage: "partial",
              recordedActualCount: 1,
              awaitingActualCount: 3,
              totalApprovedBudget: undefined,
              totalRecordedActual: undefined,
              totalRemaining: undefined,
              totalPercentUsed: undefined,
            }),
          },
        ],
        visibleCentreCount: 1,
        completeCentreCount: 0,
        incompleteCentreCount: 1,
      }),
    );
    render(<PortfolioBudgetMonth />);

    const headline = await screen.findByRole("heading", { level: 2, name: /incomplete/iu });
    expect(headline.textContent).toBe("Some centre budget information is incomplete");
    // The settled sentence is reserved for complete coverage and must not appear.
    expect(document.body.textContent).not.toContain(
      "Every centre's month is recorded and within its approved budget",
    );
  });

  test("a centre still recording is shown as unknown, never as zero or compliant", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(portfolioResponse());
    render(<PortfolioBudgetMonth />);

    await screen.findByText("Marlow Street Early Learning");
    const card = screen.getByText("Marlow Street Early Learning").closest("li");
    if (!card) throw new Error("card not found");

    // Four withheld totals, none of them rendered as a figure.
    expect(within(card).getAllByText("Not available").length).toBe(4);
    expect(card.textContent).not.toMatch(/AUD 0\.00|0\.00%/u);
    expect(card.textContent).toContain("Not a complete picture");
    expect(card.textContent).toContain(
      "Part of this month has not been recorded, so this centre's position is unknown.",
    );
    expect(within(card).getByText(/1 of 4 categories have an actual recorded/u)).toBeTruthy();
  });

  test("centres left out of the payload entirely are declared, not silently dropped", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(
      portfolioResponse({
        centres: [
          {
            centreId: CENTRE_C,
            centreName: "Ashgrove Early Learning",
            summary: centreSummary(),
          },
        ],
        visibleCentreCount: 1,
        completeCentreCount: 1,
        // Every listed centre reported in full, yet coverage is still partial:
        // a centre was left out altogether.
        incompleteCentreCount: 0,
        warning: "Some centres could not be checked, so this is not a complete portfolio view.",
      }),
    );
    render(<PortfolioBudgetMonth />);

    await screen.findByText("This is not a complete portfolio view.");
    expect(
      screen.getByText(/Some centres could not be checked and are not listed below at all/iu),
    ).toBeTruthy();
    expect(screen.getByText(/not an organisation total/iu)).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: /Every centre/iu })).toBeNull();
  });

  test("complete coverage is what earns a settled headline", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(
      portfolioResponse({
        status: "ready",
        centres: [
          {
            centreId: CENTRE_C,
            centreName: "Ashgrove Early Learning",
            summary: centreSummary(),
          },
        ],
        coverage: "complete",
        visibleCentreCount: 1,
        completeCentreCount: 1,
        incompleteCentreCount: 0,
        thresholdPolicyConfigured: true,
        warning: undefined,
      }),
    );
    render(<PortfolioBudgetMonth />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Every centre's month is recorded and within its approved budget",
      }),
    ).toBeTruthy();
    expect(screen.getByText("AUD 1,500.00")).toBeTruthy();
  });

  test("no authorised centre is not the same as an empty portfolio", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue({
      cacheControl: "private, no-store",
      asOf: "2026-08-14T02:00:00.000Z",
      month: MONTH,
      status: "unsupported",
    });
    render(<PortfolioBudgetMonth />);

    await screen.findByText("No budget view is assigned to you");
    expect(screen.getByText(/No budget source was checked/iu)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0 centres|on budget/iu);
  });

  test("an outage never resolves to a reassuring figure", async () => {
    clientMocks.getPortfolioBudgetMonth.mockRejectedValue(new Error("network"));
    render(<PortfolioBudgetMonth />);

    await screen.findByText("Budget position could not be checked");
    expect(screen.getByText(/No figure has been assumed/iu)).toBeTruthy();
  });
});

describe("internal vocabulary stays out of the document", () => {
  test("the centre month exposes no code, band code, policy key or record id", async () => {
    clientMocks.getCentreBudgetMonth.mockResolvedValue(monthResponse());
    render(<CentreBudgetMonth centreId={CENTRE_A} />);
    await screen.findByText("Food and catering");

    for (const token of INTERNAL_TOKENS) {
      expect(document.body.innerHTML).not.toContain(token);
    }
    // Identifiers are routing details, so they never appear as reading matter.
    expect(document.body.textContent ?? "").not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    // Owner-approved labels are the only threshold wording that reaches the page.
    expect(screen.getByText("Above the approved limit")).toBeTruthy();
  });

  test("the portfolio exposes no internal vocabulary either", async () => {
    clientMocks.getPortfolioBudgetMonth.mockResolvedValue(portfolioResponse());
    render(<PortfolioBudgetMonth />);
    await screen.findByText("Willowbank Early Learning");

    for (const token of INTERNAL_TOKENS) {
      expect(document.body.innerHTML).not.toContain(token);
    }
    expect(document.body.textContent ?? "").not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
  });
});
