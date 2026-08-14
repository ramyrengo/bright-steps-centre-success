"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import type { centre_budgets } from "../lib/client.generated";
import { ErrCode, isAPIError } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import {
  currentMonthKey,
  formatMonthLabel,
  formatMoney,
  formatPercent,
  isEnterableAmount,
  isMonthKey,
  isNegativeAmount,
  shiftMonth,
} from "../lib/budget-values";
import { AppShell } from "./app-shell";
import {
  Breadcrumb,
  Dialog,
  DisabledReason,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Metric,
  MetricRow,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
  type Tone,
} from "./design-system";

/**
 * Centre Budgets — one centre, one month.
 *
 * Every surface in this module obeys one rule: unknown is not zero. The API
 * omits a field it does not know rather than defaulting it, and nothing here
 * fills that gap in. A category with no actual recorded says so in words; it
 * never shows a figure, a remaining balance, a percentage, or a state that
 * reads as settled.
 */

type MonthResponse = centre_budgets.CentreBudgetMonthResponse;
type Position = centre_budgets.CentreBudgetCategoryPosition;
type Summary = centre_budgets.CentreBudgetMonthSummary;
type Threshold = centre_budgets.BudgetThresholdOutcome;

/**
 * The wording used wherever the API told us nothing. It is deliberately not a
 * dash and not a zero: a reader skimming a column has to be able to tell a
 * missing figure from a recorded one at a glance.
 */
export const NOT_RECORDED = "Not recorded";
export const NOT_AVAILABLE = "Not available";

/* ------------------------------------------------------------------ *
 * Shared presentation
 * ------------------------------------------------------------------ */

/**
 * Renders a figure, or the plain-language stand-in for one that does not
 * exist. `unknown` figures are styled as prose rather than as numerals, so the
 * column never reads as if it holds a value.
 */
export function Figure({
  children,
  unknown = false,
}: Readonly<{ children: ReactNode; unknown?: boolean }>) {
  return (
    <span className="budget-figure" data-unknown={unknown ? "true" : undefined}>
      {children}
    </span>
  );
}

export interface StateView {
  tone: Tone;
  label: string;
  detail: string;
}

/**
 * Describes a category's position in the reader's language.
 *
 * `AWAITING_ACTUAL` is the state the whole module exists to protect. It is
 * never positive and never green: an approved budget with no actual against it
 * is an open question, not a centre that has spent nothing.
 */
export function positionStateView(position: Position): StateView {
  switch (position.state) {
    case "NOTHING_RECORDED":
      return {
        tone: "neutral",
        label: "Nothing recorded",
        detail: "No approved budget and no actual have been recorded for this category.",
      };
    case "AWAITING_ACTUAL":
      return {
        tone: "warning",
        label: "Actual not recorded",
        detail:
          "This category has an approved budget, but no actual has been entered. That is not the same as nothing being spent.",
      };
    case "ACTUAL_WITHOUT_BUDGET":
      return {
        tone: "warning",
        label: "No approved budget",
        detail:
          "Spend has been recorded against a category with no approved budget, so there is nothing to measure it against.",
      };
    case "BUDGET_AND_ACTUAL":
      return position.remaining !== undefined && isNegativeAmount(position.remaining)
        ? {
            tone: "critical",
            label: "Over approved budget",
            detail: "The recorded actual is above the approved budget for this category.",
          }
        : {
            tone: "positive",
            label: "Within approved budget",
            detail: "Both an approved budget and an actual have been recorded.",
          };
    default: {
      const unreachable: never = position.state;
      return unreachable;
    }
  }
}

/** A threshold view, keyed by the rule that produced it. */
export interface ThresholdRuleView extends StateView {
  key: string;
}

/**
 * Describes the threshold position, one view per approved rule.
 *
 * A governing policy may hold more than one rule, and two rules are entitled to
 * disagree about the same category: a month can be inside its percentage limit
 * with almost nothing left. So every rule gets its own badge and its own
 * sentence, and none of them is collapsed into a single verdict the
 * organisation never approved.
 *
 * No band value is decided here. The badge carries the label the organisation
 * itself approved, and the tone is the same for every band, because grading one
 * band as more serious than another would be a judgement nobody asked for.
 * "No threshold set" is deliberately neutral rather than positive: it means
 * nobody has decided what good looks like yet, which is not the same as being
 * inside a limit.
 */
export function thresholdViews(threshold: Threshold): ThresholdRuleView[] {
  if (threshold.state === "NOT_CONFIGURED") {
    return [
      {
        key: "not-configured",
        tone: "neutral",
        label: "No threshold set",
        detail:
          "No approved spending threshold covers this month, so nothing here is being judged against one.",
      },
    ];
  }
  if (threshold.rules.length === 0) {
    return [
      {
        key: "no-rules",
        tone: "neutral",
        label: "Cannot be judged",
        detail:
          "The spending threshold covering this month sets out no rule to judge this against.",
      },
    ];
  }
  return threshold.rules.map((rule) =>
    rule.state === "BANDED"
      ? {
          key: rule.ruleCode,
          tone: "informational",
          label: rule.bandLabel ?? "Threshold band applies",
          detail: `${rule.ruleLabel}, judged against the spending threshold your organisation approved for this month.`,
        }
      : {
          key: rule.ruleCode,
          tone: "neutral",
          label: "Cannot be judged",
          detail: `${rule.ruleLabel}. ${
            rule.reason ?? "There is not enough recorded here to judge this against a threshold."
          }`,
        },
  );
}

/**
 * Steps between calendar months.
 *
 * Forward movement stops at the reader's current month, because a budget
 * position for a month that has not happened would be an empty page that looks
 * like a centre with nothing recorded.
 */
export function MonthStepper({
  month,
  onChange,
  busy,
}: Readonly<{ month: string; onChange: (next: string) => void; busy: boolean }>) {
  const labelId = useId();
  const latest = currentMonthKey();
  const atLatest = month >= latest;
  return (
    <div className="budget-month" role="group" aria-labelledby={labelId}>
      <span className="visually-hidden" id={labelId}>
        Choose a month
      </span>
      <button
        className="budget-month__step"
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        disabled={busy}
      >
        <span aria-hidden="true">‹</span>
        <span className="visually-hidden">Previous month</span>
      </button>
      <span aria-live="polite" className="budget-month__label">
        {formatMonthLabel(month)}
      </span>
      <button
        className="budget-month__step"
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={busy || atLatest}
      >
        <span aria-hidden="true">›</span>
        <span className="visually-hidden">Next month</span>
      </button>
    </div>
  );
}

/**
 * States that a month is only partly entered, in the same quiet register
 * Centre Quality uses for a source it could not read. It stands in for the
 * totals that are deliberately withheld, so the gap is never silent.
 */
export function CoverageCaveat({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="budget-coverage-note">
      <span className="budget-coverage-note__label">Information incomplete</span>
      {children}
    </p>
  );
}

/** The month key a surface should open on, honouring a shared link. */
export function initialMonth(): string {
  if (typeof window === "undefined") return currentMonthKey();
  const requested = new URLSearchParams(window.location.search).get("month");
  return requested && isMonthKey(requested) ? requested : currentMonthKey();
}

/** Keeps the address bar in step so a month can be shared or reloaded. */
export function rememberMonth(month: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("month", month);
  window.history.replaceState(null, "", url.toString());
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

/**
 * The month's totals.
 *
 * Each is shown only when the API supplied it, which it does only when every
 * contributing category is known and shares one currency. A withheld total is
 * labelled as unavailable rather than summed over what happens to be there:
 * a partly entered month understates spend while looking authoritative.
 */
export function MonthTotals({ summary }: Readonly<{ summary: Summary }>) {
  const currency = summary.currency;
  const money = (value: string | undefined): ReactNode =>
    value === undefined ? (
      <Figure unknown>{NOT_AVAILABLE}</Figure>
    ) : (
      <Figure>{formatMoney(value, currency)}</Figure>
    );

  return (
    <MetricRow>
      <Metric
        label="Approved budget"
        value={money(summary.totalApprovedBudget)}
        unavailable={summary.totalApprovedBudget === undefined}
      />
      <Metric
        label="Recorded actual"
        value={money(summary.totalRecordedActual)}
        unavailable={summary.totalRecordedActual === undefined}
      />
      <Metric
        label="Remaining"
        value={money(summary.totalRemaining)}
        unavailable={summary.totalRemaining === undefined}
        emphasis={
          summary.totalRemaining !== undefined && isNegativeAmount(summary.totalRemaining)
        }
      />
      <Metric
        label="Budget used"
        value={
          summary.totalPercentUsed === undefined ? (
            <Figure unknown>{NOT_AVAILABLE}</Figure>
          ) : (
            <Figure>{formatPercent(summary.totalPercentUsed)}</Figure>
          )
        }
        unavailable={summary.totalPercentUsed === undefined}
      />
    </MetricRow>
  );
}

/* ------------------------------------------------------------------ *
 * Recording an actual
 * ------------------------------------------------------------------ */

/**
 * The currency to record against, taken only from figures this centre-month
 * already carries.
 *
 * No currency is assumed. The organisation's reporting currency is an open
 * owner decision, so where nothing recorded here states one, entry is refused
 * rather than a code being invented on the centre's behalf.
 */
export function currencyForEntry(
  response: MonthResponse,
  position: Position,
): string | undefined {
  if (position.approvedBudget) return position.approvedBudget.currency;
  if (position.actual) return position.actual.currency;
  if (response.summary.currency) return response.summary.currency;
  const observed = new Set<string>();
  for (const category of response.categories) {
    if (category.approvedBudget) observed.add(category.approvedBudget.currency);
    if (category.actual) observed.add(category.actual.currency);
  }
  return observed.size === 1 ? [...observed][0] : undefined;
}

function ActualEntryDialog({
  position,
  currency,
  onDismiss,
  onSubmit,
  submitting,
  error,
}: Readonly<{
  position: Position;
  currency: string | undefined;
  onDismiss: () => void;
  onSubmit: (entry: { amount: string; note: string; confirmed: boolean }) => void;
  submitting: boolean;
  error: string | undefined;
}>) {
  const amountId = useId();
  const amountHintId = useId();
  const noteId = useId();
  const confirmHintId = useId();
  const blockedId = useId();
  const errorId = useId();
  const [amount, setAmount] = useState(position.actual?.amount ?? "");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [touched, setTouched] = useState(false);

  const trimmed = amount.trim();
  const valid = isEnterableAmount(trimmed);
  const blocked = currency === undefined;
  const showAmountError = touched && !valid;

  return (
    <Dialog
      eyebrow={position.categoryName}
      title={position.actual ? "Update this month's actual" : "Record this month's actual"}
      onDismiss={onDismiss}
      footer={
        <>
          <button
            className="button button--accent budget-submit"
            type="button"
            disabled={submitting || blocked}
            aria-describedby={blocked ? blockedId : undefined}
            onClick={() => {
              setTouched(true);
              if (!valid || blocked) return;
              onSubmit({ amount: trimmed, note: note.trim(), confirmed });
            }}
          >
            {submitting ? "Saving…" : confirmed ? "Save and confirm" : "Save this figure"}
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={onDismiss}
            disabled={submitting}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="budget-entry">
        {position.actual ? (
          <p className="budget-entry__standing">
            Currently recorded: {formatMoney(position.actual.amount, position.actual.currency)}.
            Saving a new figure supersedes it and keeps the earlier one on the record.
          </p>
        ) : null}

        <label className="budget-entry__field" htmlFor={amountId}>
          <span className="budget-entry__label">
            Amount spent this month{currency ? ` (${currency})` : ""}
          </span>
          <input
            data-autofocus
            id={amountId}
            aria-describedby={showAmountError ? `${amountHintId} ${errorId}` : amountHintId}
            aria-invalid={showAmountError ? "true" : undefined}
            autoComplete="off"
            inputMode="decimal"
            value={amount}
            onBlur={() => setTouched(true)}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <p className="metric__note" id={amountHintId}>
          Enter the figure exactly, to two decimal places. If nothing was spent, enter 0.00 —
          leaving this empty records nothing at all, which is a different statement.
        </p>
        {showAmountError ? (
          <p className="workflow-dialog__error" id={errorId} role="alert">
            Enter an amount with up to two decimal places, for example 1250.00.
          </p>
        ) : null}

        <label className="budget-entry__field" htmlFor={noteId}>
          <span className="budget-entry__label">Note (optional)</span>
          <textarea
            id={noteId}
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <label className="budget-entry__check">
          <input
            checked={confirmed}
            type="checkbox"
            aria-describedby={confirmHintId}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I confirm this figure is correct</span>
        </label>
        <p className="metric__note" id={confirmHintId}>
          Confirming records that you stand behind the figure. It is not sent to anyone for
          approval, and no second person is required.
        </p>

        {blocked ? (
          <DisabledReason id={blockedId}>
            No currency has been recorded against this centre&apos;s month, so there is nothing to
            record this figure in. An approved budget for this category, or your
            organisation&apos;s reporting currency, has to come first.
          </DisabledReason>
        ) : null}

        {error ? (
          <p className="workflow-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The category table
 * ------------------------------------------------------------------ */

function CategoryRow({
  position,
  canEnterActual,
  onRecord,
}: Readonly<{
  position: Position;
  canEnterActual: boolean;
  onRecord: (position: Position) => void;
}>) {
  const state = positionStateView(position);
  const thresholds = thresholdViews(position.threshold);
  const budget = position.approvedBudget;
  const actual = position.actual;

  return (
    <tr data-state={state.tone}>
      <th scope="row">
        <span className="budget-row__head">
          <span className="budget-row__name">{position.categoryName}</span>
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          {position.categoryStatus === "inactive" ? (
            <span className="budget-row__note">No longer in use</span>
          ) : null}
          <span className="budget-row__note">{state.detail}</span>
        </span>
      </th>
      <td>
        {budget ? (
          <Figure>{formatMoney(budget.amount, budget.currency)}</Figure>
        ) : (
          <Figure unknown>No approved budget</Figure>
        )}
      </td>
      <td>
        {actual ? (
          <>
            <Figure>{formatMoney(actual.amount, actual.currency)}</Figure>
            <span className="budget-row__note">
              {actual.confirmed ? "Confirmed by the centre" : "Recorded, not yet confirmed"}
            </span>
          </>
        ) : (
          <Figure unknown>{NOT_RECORDED}</Figure>
        )}
      </td>
      <td>
        {position.remaining === undefined ? (
          <Figure unknown>{NOT_AVAILABLE}</Figure>
        ) : (
          <Figure>{formatMoney(position.remaining, budget?.currency)}</Figure>
        )}
      </td>
      <td>
        {position.percentUsed === undefined ? (
          <Figure unknown>{NOT_AVAILABLE}</Figure>
        ) : (
          <Figure>{formatPercent(position.percentUsed)}</Figure>
        )}
      </td>
      <td>
        <span className="budget-row__head">
          {thresholds.map((threshold) => (
            <span className="budget-row__head" key={threshold.key}>
              <StatusBadge tone={threshold.tone}>{threshold.label}</StatusBadge>
              <span className="budget-row__note">{threshold.detail}</span>
            </span>
          ))}
        </span>
      </td>
      {canEnterActual ? (
        <td>
          <button
            className="button button--secondary budget-row__action"
            type="button"
            onClick={() => onRecord(position)}
          >
            {actual ? "Update figure" : "Record actual"}
            <span className="visually-hidden"> for {position.categoryName}</span>
          </button>
        </td>
      ) : null}
    </tr>
  );
}

/* ------------------------------------------------------------------ *
 * The surface
 * ------------------------------------------------------------------ */

export function CentreBudgetMonthView({
  response,
  month,
  busy,
  onChooseMonth,
  onRecord,
}: Readonly<{
  response: MonthResponse;
  month: string;
  busy: boolean;
  onChooseMonth: (next: string) => void;
  onRecord: (position: Position) => void;
}>) {
  const { summary } = response;
  const monthLabel = formatMonthLabel(response.month || month);
  const partial = summary.coverage !== "complete";
  const summaryThresholds = summary.threshold ? thresholdViews(summary.threshold) : [];

  return (
    <>
      <Breadcrumb
        trail={[
          { label: "Daily Success", href: "/" },
          { label: "Centre budgets", href: `/budgets?month=${month}` },
          { label: response.centreName || "This centre" },
        ]}
      />
      <PageHeader
        eyebrow="Centre budgets"
        title={response.centreName || "This centre"}
        summary={`Approved budget, what has actually been recorded, and what is left for ${monthLabel}.`}
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
        <Notice title="This month is not a complete picture.">
          {response.warning ??
            "Some categories have no actual recorded yet. Nothing missing is counted as zero, and no total is stated over the gap."}
        </Notice>
      ) : null}

      {response.thresholdPolicyConfigured ? null : (
        <Notice title="No approved spending threshold covers this month.">
          Nothing below is measured against a threshold. That is not the same as every category
          being inside one.
        </Notice>
      )}

      <Section
        title="This month at a glance"
        description="Totals appear only where every category has both an approved budget and a recorded actual, in a single currency. Nothing is summed across a gap."
      >
        <div className="card">
          <MonthTotals summary={summary} />
          {summaryThresholds.map((summaryThreshold) => (
            <p className="budget-summary-threshold" key={summaryThreshold.key}>
              <StatusBadge tone={summaryThreshold.tone}>{summaryThreshold.label}</StatusBadge>
              <span className="metric__note">{summaryThreshold.detail}</span>
            </p>
          ))}
          {partial ? (
            <CoverageCaveat>
              {` ${summary.recordedActualCount} of ${summary.categoryCount} categories have an actual recorded for ${monthLabel}, so this month's totals are withheld rather than understated.`}
            </CoverageCaveat>
          ) : null}
          <dl className="budget-counts">
            <div>
              <dt>Categories</dt>
              <dd>{summary.categoryCount}</dd>
            </div>
            <div>
              <dt>With an approved budget</dt>
              <dd>{summary.budgetedCategoryCount}</dd>
            </div>
            <div>
              <dt>Actuals recorded</dt>
              <dd>{summary.recordedActualCount}</dd>
            </div>
            <div data-attention={summary.awaitingActualCount > 0 ? "true" : undefined}>
              <dt>Awaiting an actual</dt>
              <dd>{summary.awaitingActualCount}</dd>
            </div>
            <div data-attention={summary.actualWithoutBudgetCount > 0 ? "true" : undefined}>
              <dt>Recorded without a budget</dt>
              <dd>{summary.actualWithoutBudgetCount}</dd>
            </div>
            <div data-attention={summary.nothingRecordedCount > 0 ? "true" : undefined}>
              <dt>Nothing recorded</dt>
              <dd>{summary.nothingRecordedCount}</dd>
            </div>
          </dl>
        </div>
      </Section>

      <Section
        title="Every category"
        description="One row per governed category, including the ones nothing has been recorded against."
        count={`${response.categories.length} categor${response.categories.length === 1 ? "y" : "ies"}`}
      >
        {response.categories.length === 0 ? (
          <EmptyState
            title="No reporting categories are set up yet"
            message="Budget categories are decided by your organisation. Until they are, this month cannot be reported on — that is not the same as this centre having nothing to report."
          />
        ) : (
          <div
            className="budget-table-scroll"
            role="region"
            aria-label={`Budget position by category for ${monthLabel}`}
            tabIndex={0}
          >
            <table className="budget-table">
              <caption className="visually-hidden">
                {`Approved budget, recorded actual, remaining and threshold position for each category in ${monthLabel}. Categories with no actual recorded are shown as not recorded, never as zero.`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Approved budget</th>
                  <th scope="col">Recorded actual</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Budget used</th>
                  <th scope="col">Threshold</th>
                  {response.canEnterActual ? <th scope="col">Entry</th> : null}
                </tr>
              </thead>
              <tbody>
                {response.categories.map((position) => (
                  <CategoryRow
                    canEnterActual={response.canEnterActual}
                    key={position.categoryId}
                    onRecord={onRecord}
                    position={position}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {response.canEnterActual ? null : (
          <p className="metric__note">
            Your current access lets you read this centre&apos;s budget position but not record
            against it.
          </p>
        )}
      </Section>
    </>
  );
}

export function CentreBudgetMonth({ centreId }: Readonly<{ centreId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [month, setMonth] = useState(initialMonth);
  const [response, setResponse] = useState<MonthResponse>();
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("Checking this centre's budget position.");
  const [entry, setEntry] = useState<Position>();
  const [submitting, setSubmitting] = useState(false);
  const [entryError, setEntryError] = useState<string>();

  useEffect(() => {
    let current = true;
    void client.foundation.getCentreBudgetMonth(month, centreId).then(
      (value) => {
        if (!current) return;
        setResponse(value);
        setState("ready");
        setAnnouncement(
          value.summary.coverage === "complete"
            ? `Budget position for ${formatMonthLabel(value.month || month)} is ready.`
            : `Budget position for ${formatMonthLabel(value.month || month)} is only partly recorded. Nothing missing is counted as zero.`,
        );
      },
      (error: unknown) => {
        if (!current) return;
        const denied =
          isAPIError(error) &&
          [ErrCode.PermissionDenied, ErrCode.Unauthenticated, ErrCode.NotFound].includes(
            error.code,
          );
        setState(denied ? "denied" : "error");
        setAnnouncement(
          denied
            ? "This centre's budget position is not available to you."
            : "This centre's budget position could not be checked.",
        );
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, centreId, client, month]);

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

  const entryCurrency = useMemo(
    () => (response && entry ? currencyForEntry(response, entry) : undefined),
    [entry, response],
  );

  const submit = useCallback(
    (values: { amount: string; note: string; confirmed: boolean }) => {
      if (!entry || !entryCurrency) return;
      setSubmitting(true);
      setEntryError(undefined);
      // The amount goes over the wire exactly as it was typed. Nothing here
      // reformats it, rounds it, or lets it become a JavaScript number.
      void client.foundation
        .createCentreBudgetActual(month, centreId, {
          categoryId: entry.categoryId,
          amount: values.amount,
          currency: entryCurrency,
          ...(values.note ? { note: values.note } : {}),
          ...(values.confirmed ? { confirmed: true } : {}),
        })
        .then(
          (result) => {
            setSubmitting(false);
            setEntry(undefined);
            setAnnouncement(
              `${formatMoney(values.amount, entryCurrency)} recorded for ${entry.categoryName}${
                result.supersededActualId ? ", replacing the earlier figure" : ""
              }.`,
            );
            // Re-read the month rather than patching the page. Coverage and
            // every total are the backend's to decide; recomputing them here
            // would be the first step towards summing over a gap.
            setAttempt((value) => value + 1);
          },
          (error: unknown) => {
            setSubmitting(false);
            setEntryError(
              isAPIError(error) && error.code === ErrCode.InvalidArgument
                ? "That figure was not accepted. Enter an amount with up to two decimal places."
                : isAPIError(error) && error.code === ErrCode.PermissionDenied
                  ? "You are not currently able to record against this centre."
                  : "The figure could not be saved. Nothing has been recorded.",
            );
          },
        );
    },
    [centreId, client, entry, entryCurrency, month],
  );

  let content;
  if (state === "loading" && !response) {
    content = <LoadingSkeleton label="Checking this centre's budget position." rows={5} />;
  } else if (state === "denied") {
    content = (
      <ErrorState
        title="This centre's budget is not available to you"
        message="You do not currently have authorised access to this centre's budget position."
      />
    );
  } else if (state === "error" || !response) {
    content = (
      <ErrorState
        title="The budget position could not be checked"
        message="No figure has been assumed. Nothing here should be read as a centre that is on budget."
        onRetry={retry}
      />
    );
  } else {
    content = (
      <CentreBudgetMonthView
        busy={state === "loading"}
        month={month}
        onChooseMonth={chooseMonth}
        onRecord={(position) => {
          setEntryError(undefined);
          setEntry(position);
        }}
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
      {entry ? (
        <ActualEntryDialog
          currency={entryCurrency}
          error={entryError}
          onDismiss={() => setEntry(undefined)}
          onSubmit={submit}
          position={entry}
          submitting={submitting}
        />
      ) : null}
    </AppShell>
  );
}
