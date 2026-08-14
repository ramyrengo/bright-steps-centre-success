"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { centre_budgets } from "../lib/client.generated";
import { ErrCode, isAPIError } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import {
  compareExactDecimals,
  formatMonthLabel,
  formatMoney,
  formatPercent,
  isNegativeAmount,
} from "../lib/budget-values";
import { AppShell } from "./app-shell";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Notice,
  PageHeader,
  StatusBadge,
  type Tone,
} from "./design-system";
import {
  CoverageCaveat,
  Figure,
  MonthStepper,
  NOT_AVAILABLE,
  initialMonth,
  rememberMonth,
  thresholdView,
} from "./centre-budget-month";

/**
 * Centre Budgets — the portfolio for one month.
 *
 * Centres are ordered by what needs attention, never alphabetically, because
 * the first screenful is what an Area Manager acts on. The ordering is derived
 * only from facts the API stated: a negative remaining balance, spend recorded
 * with no approved budget, and a month the API itself declared incomplete.
 *
 * Nothing here fills a gap. A centre the API could not read is not in the
 * payload at all, so the page says the portfolio is smaller than it looks
 * rather than presenting the survivors as the whole picture.
 */

type PortfolioResponse = centre_budgets.PortfolioBudgetMonthResponse;
type CentreCard = centre_budgets.PortfolioCentreBudgetCard;
type Summary = centre_budgets.CentreBudgetMonthSummary;

/**
 * Presentation-only grouping. These strings never carry a backend meaning and
 * never stand in for one; they exist so the page can order and label itself.
 */
type Focus = "over-budget" | "unbudgeted-spend" | "not-complete" | "fully-recorded";

interface FocusGroup {
  focus: Focus;
  tone: Tone;
  label: string;
  description: string;
  reason: string;
}

/**
 * Attention order. Confirmed overspend leads, because it is the only state the
 * figures prove outright. Unbudgeted spend follows: money recorded against a
 * category nobody approved a budget for cannot be measured at all. Incomplete
 * months come next — they are not reassuring, they are unanswered. Only a
 * centre whose month is wholly recorded and inside its budget comes last.
 */
const FOCUS_GROUPS: readonly FocusGroup[] = [
  {
    focus: "over-budget",
    tone: "critical",
    label: "Over approved budget",
    description: "Recorded spend for the month is above the approved budget.",
    reason: "Recorded spend is above this centre's approved budget for the month.",
  },
  {
    focus: "unbudgeted-spend",
    tone: "warning",
    label: "Spend with no approved budget",
    description:
      "Money recorded against categories that have no approved budget, so there is nothing to measure it against.",
    reason: "Spend has been recorded against a category with no approved budget.",
  },
  {
    focus: "not-complete",
    tone: "warning",
    label: "Not a complete picture",
    description:
      "Part of the month has not been recorded. These centres are not known to be on budget — they are unanswered.",
    reason: "Part of this month has not been recorded, so this centre's position is unknown.",
  },
  {
    focus: "fully-recorded",
    tone: "positive",
    label: "Fully recorded and within budget",
    description:
      "Every governed category has both an approved budget and a recorded actual, in one currency.",
    reason: "Every category has an approved budget and a recorded actual for the month.",
  },
];

/**
 * Places a centre in an attention group.
 *
 * A centre only reaches the reassuring group when the API stated complete
 * coverage *and* supplied a remaining balance. Anything short of that is an
 * open question, never an all-clear.
 */
export function centreFocus(summary: Summary): Focus {
  if (summary.totalRemaining !== undefined && isNegativeAmount(summary.totalRemaining)) {
    return "over-budget";
  }
  if (summary.actualWithoutBudgetCount > 0) return "unbudgeted-spend";
  if (summary.coverage === "complete" && summary.totalRemaining !== undefined) {
    return "fully-recorded";
  }
  return "not-complete";
}

function unrecordedCategories(summary: Summary): number {
  return summary.awaitingActualCount + summary.nothingRecordedCount;
}

/**
 * Orders centres inside a group by how much of it needs looking at.
 *
 * The only decimal comparison in this module lives here, and it never produces
 * a figure that reaches the screen: `compareExactDecimals` walks the digits of
 * the two strings, so ranking by budget used stays exact without either value
 * becoming a JavaScript number.
 */
export function rankCentres(focus: Focus, centres: readonly CentreCard[]): CentreCard[] {
  const byName = (left: CentreCard, right: CentreCard) =>
    left.centreName.localeCompare(right.centreName);

  return [...centres].sort((left, right) => {
    if (focus === "over-budget") {
      const a = left.summary.totalPercentUsed;
      const b = right.summary.totalPercentUsed;
      if (a !== undefined && b !== undefined) {
        const order = compareExactDecimals(b, a);
        if (order !== 0) return order;
      } else if (a !== b) {
        return a === undefined ? 1 : -1;
      }
    }
    if (focus === "unbudgeted-spend") {
      const order =
        right.summary.actualWithoutBudgetCount - left.summary.actualWithoutBudgetCount;
      if (order !== 0) return order;
    }
    if (focus === "not-complete") {
      const order = unrecordedCategories(right.summary) - unrecordedCategories(left.summary);
      if (order !== 0) return order;
    }
    return byName(left, right);
  });
}

function CentreBudgetCard({
  centre,
  group,
  month,
}: Readonly<{ centre: CentreCard; group: FocusGroup; month: string }>) {
  const { summary } = centre;
  const currency = summary.currency;
  const threshold = summary.threshold ? thresholdView(summary.threshold) : undefined;
  // Only the gaps that exist are listed. A run of zeroes on a card that has
  // already said the month is fully recorded is noise, and the counts that do
  // appear are the ones an Area Manager can act on.
  const gaps = [
    { term: "Awaiting an actual", value: summary.awaitingActualCount },
    { term: "Recorded without a budget", value: summary.actualWithoutBudgetCount },
    { term: "Nothing recorded", value: summary.nothingRecordedCount },
  ].filter((gap) => gap.value > 0);
  const money = (value: string | undefined) =>
    value === undefined ? (
      <Figure unknown>{NOT_AVAILABLE}</Figure>
    ) : (
      <Figure>{formatMoney(value, currency)}</Figure>
    );

  return (
    <li className="budget-centre-card" data-focus={group.focus}>
      <div className="budget-centre-card__head">
        <h4>{centre.centreName}</h4>
        <StatusBadge tone={group.tone}>{group.label}</StatusBadge>
      </div>
      <p className="budget-centre-card__reason">{group.reason}</p>

      <dl className="budget-centre-card__figures">
        <div>
          <dt>Approved budget</dt>
          <dd>{money(summary.totalApprovedBudget)}</dd>
        </div>
        <div>
          <dt>Recorded actual</dt>
          <dd>{money(summary.totalRecordedActual)}</dd>
        </div>
        <div data-attention={group.focus === "over-budget" ? "true" : undefined}>
          <dt>Remaining</dt>
          <dd>{money(summary.totalRemaining)}</dd>
        </div>
        <div>
          <dt>Budget used</dt>
          <dd>
            {summary.totalPercentUsed === undefined ? (
              <Figure unknown>{NOT_AVAILABLE}</Figure>
            ) : (
              <Figure>{formatPercent(summary.totalPercentUsed)}</Figure>
            )}
          </dd>
        </div>
      </dl>

      {threshold ? (
        <p className="budget-summary-threshold">
          <StatusBadge tone={threshold.tone}>{threshold.label}</StatusBadge>
        </p>
      ) : null}

      {summary.coverage === "complete" ? null : (
        <CoverageCaveat>
          {` ${summary.recordedActualCount} of ${summary.categoryCount} categories have an actual recorded. Totals are withheld rather than summed over the ${unrecordedCategories(summary)} that are missing.`}
        </CoverageCaveat>
      )}

      {gaps.length > 0 ? (
        <dl className="budget-counts">
          {gaps.map((gap) => (
            <div data-attention="true" key={gap.term}>
              <dt>{gap.term}</dt>
              <dd>{gap.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <Link
        className="button button--secondary"
        href={`/budgets/centres/${centre.centreId}?month=${month}`}
      >
        Open this centre&apos;s month
        <span className="visually-hidden"> — {centre.centreName}</span>
      </Link>
    </li>
  );
}

/**
 * The headline follows coverage, never the numbers.
 *
 * Under partial coverage no all-clear may be stated, because a centre that
 * could not be read is missing from the payload entirely and a centre that is
 * half-entered is simply unanswered. Only complete coverage earns a settled
 * sentence.
 */
export function portfolioHeadline(response: PortfolioResponse, overBudget: number): string {
  if (response.coverage !== "complete") {
    return overBudget > 0
      ? `${overBudget} ${overBudget === 1 ? "centre is" : "centres are"} over budget, and some centre information is incomplete`
      : "Some centre budget information is incomplete";
  }
  if (overBudget === 0) return "Every centre's month is recorded and within its approved budget";
  return overBudget === 1
    ? "One centre is over its approved budget this month"
    : `${overBudget} centres are over their approved budget this month`;
}

export function PortfolioBudgetMonthView({
  response,
  month,
  busy,
  onChooseMonth,
}: Readonly<{
  response: PortfolioResponse;
  month: string;
  busy: boolean;
  onChooseMonth: (next: string) => void;
}>) {
  const centres = response.centres ?? [];
  const monthLabel = formatMonthLabel(response.month || month);
  const partial = response.coverage !== "complete";
  const grouped = FOCUS_GROUPS.map((group) => ({
    group,
    centres: rankCentres(
      group.focus,
      centres.filter((centre) => centreFocus(centre.summary) === group.focus),
    ),
  }));
  const overBudget =
    grouped.find((entry) => entry.group.focus === "over-budget")?.centres.length ?? 0;

  // Every included centre reported in full, yet coverage is still partial: the
  // only remaining explanation is a centre that was left out altogether.
  const centresMissing = partial && response.incompleteCentreCount === 0;

  return (
    <>
      <PageHeader
        eyebrow="Centre budgets"
        title="Budget position across your centres"
        summary="Where each centre stands against its approved budget this month, ordered by what needs attention first."
        meta={
          <>
            <span>{monthLabel}</span>
            <StatusBadge tone={partial ? "warning" : "positive"}>
              {partial ? "Partly recorded" : "Fully recorded"}
            </StatusBadge>
          </>
        }
        actions={<MonthStepper month={month} onChange={onChooseMonth} busy={busy} />}
      />

      {partial ? (
        <Notice title="This is not a complete portfolio view.">
          {response.warning ??
            "Some centre budget information could not be checked. Nothing missing is counted as zero."}
        </Notice>
      ) : null}

      {response.thresholdPolicyConfigured ? null : (
        <Notice title="No approved spending threshold covers this month.">
          No centre below is being measured against a threshold. That is not the same as every
          centre being inside one.
        </Notice>
      )}

      <section className="budget-hero" aria-labelledby="budget-hero-title">
        <h2 id="budget-hero-title">{portfolioHeadline(response, overBudget)}</h2>
        <p>
          {`Built from what each centre has actually recorded for ${monthLabel}. A centre with figures still outstanding is shown as incomplete, never as a centre that has spent nothing.`}
        </p>
        <dl className="budget-hero__figures">
          <div data-emphasis={overBudget > 0 ? "true" : undefined}>
            <dt>Over approved budget</dt>
            <dd>{overBudget}</dd>
          </div>
          <div>
            <dt>Centres you can see</dt>
            <dd>{response.visibleCentreCount ?? NOT_AVAILABLE}</dd>
          </div>
          <div>
            <dt>Fully recorded</dt>
            <dd>{response.completeCentreCount ?? NOT_AVAILABLE}</dd>
          </div>
          <div data-emphasis={(response.incompleteCentreCount ?? 0) > 0 ? "true" : undefined}>
            <dt>Still missing actuals</dt>
            <dd>{response.incompleteCentreCount ?? NOT_AVAILABLE}</dd>
          </div>
        </dl>
        {partial ? (
          <CoverageCaveat>
            {centresMissing
              ? " Some centres could not be checked and are not listed below at all. The counts above cover only the centres that could be read, so they are not an organisation total."
              : " The counts above cover only the centres that could be read for this month, so they are not an organisation total, and no figure is stated for a centre that has not finished recording."}
          </CoverageCaveat>
        ) : null}
      </section>

      {centres.length === 0 ? (
        <EmptyState
          title="No centre budget information could be read for this month"
          message="Nothing here means these centres are on budget. Centres appear as soon as your access lets their budget position be read."
        />
      ) : (
        grouped
          .filter((entry) => entry.centres.length > 0)
          .map((entry) => (
            <section
              aria-labelledby={`budget-group-${entry.group.focus}`}
              className="budget-group"
              key={entry.group.focus}
            >
              <div className="budget-group__header">
                <h3 id={`budget-group-${entry.group.focus}`}>
                  {entry.group.label}
                  <span className="section__count">
                    {entry.centres.length} centre{entry.centres.length === 1 ? "" : "s"}
                  </span>
                </h3>
                <p>{entry.group.description}</p>
              </div>
              <ul className="budget-centre-grid" role="list">
                {entry.centres.map((centre) => (
                  <CentreBudgetCard
                    centre={centre}
                    group={entry.group}
                    key={centre.centreId}
                    month={month}
                  />
                ))}
              </ul>
            </section>
          ))
      )}
    </>
  );
}

export function PortfolioBudgetMonth() {
  const client = useAuthenticatedCentreSuccessClient();
  const [month, setMonth] = useState(initialMonth);
  const [response, setResponse] = useState<PortfolioResponse>();
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("Checking budget position across your centres.");

  useEffect(() => {
    let current = true;
    void client.foundation.getPortfolioBudgetMonth(month).then(
      (value) => {
        if (!current) return;
        setResponse(value);
        setState("ready");
        setAnnouncement(
          value.status === "unsupported"
            ? "No budget view is currently assigned to you."
            : value.coverage === "complete"
              ? `Budget position for ${formatMonthLabel(value.month || month)} is ready.`
              : `Budget position for ${formatMonthLabel(value.month || month)} is incomplete. Nothing missing is counted as zero.`,
        );
      },
      (error: unknown) => {
        if (!current) return;
        const denied =
          isAPIError(error) &&
          [ErrCode.PermissionDenied, ErrCode.Unauthenticated].includes(error.code);
        setState(denied ? "denied" : "error");
        setAnnouncement(
          denied
            ? "Budget information is unavailable to you."
            : "Budget position could not be checked.",
        );
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, client, month]);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [response, state]);

  const chooseMonth = useCallback((next: string) => {
    setState("loading");
    setMonth(next);
    rememberMonth(next);
    setAnnouncement(`Checking ${formatMonthLabel(next)}.`);
  }, []);

  const retry = useCallback(() => {
    setState("loading");
    setAttempt((value) => value + 1);
  }, []);

  let content;
  if (state === "loading" && !response) {
    content = <LoadingSkeleton label="Checking budget position across your centres." rows={4} />;
  } else if (state === "denied") {
    content = (
      <ErrorState
        title="Budget information is unavailable"
        message="You do not currently hold an authorised view of any centre's budget position."
      />
    );
  } else if (state === "error" || !response) {
    content = (
      <ErrorState
        title="Budget position could not be checked"
        message="No figure has been assumed. Nothing here should be read as centres being on budget."
        onRetry={retry}
      />
    );
  } else if (response.status === "unsupported") {
    content = (
      <EmptyState
        title="No budget view is assigned to you"
        message="Your account is connected, but no centre's budget position is currently within your access. No budget source was checked, so nothing here says anything about how centres are tracking."
      />
    );
  } else {
    content = (
      <PortfolioBudgetMonthView
        busy={state === "loading"}
        month={month}
        onChooseMonth={chooseMonth}
        response={response}
      />
    );
  }

  return (
    <AppShell active="/budgets">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
    </AppShell>
  );
}
