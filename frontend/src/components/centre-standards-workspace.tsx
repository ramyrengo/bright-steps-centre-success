"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Notice, PageHeader, StatusBadge } from "./design-system";
import { AppShell } from "./app-shell";
import { SyntheticNotice } from "./centre-standards-check";
import {
  backendNotAvailableGateway,
  businessDateLabel,
  timelinessLabel,
  timelinessTone,
  type CentreStandardsGateway,
  type OpenCheckSummary,
  type StandardsWorkspace,
} from "./centre-standards-contract";

/**
 * The Centre Standards landing surface.
 *
 * It answers one question — "what do I need to complete?" — and nothing else.
 * Only open checks appear: completed history is deliberately absent in 4A,
 * because an Educator's task list should shrink as they work, not grow.
 *
 * The unknown-is-not-zero rule established in Quality applies here and matters
 * more: "nothing due" and "we could not check" look identical to a reader but
 * mean opposite things when someone is deciding whether to walk the playground.
 * Only `ready` may state an all-clear.
 */

export function StandardsCheckCard({ check }: Readonly<{ check: OpenCheckSummary }>) {
  return (
    <li className="standards-card" data-timeliness={check.timeliness}>
      {/* The centre leads, because in 4A every card carries the same standard
          name and the centre is what actually distinguishes one from another. */}
      <p className="standards-card__centre">{check.centreName}</p>
      <div className="standards-card__head">
        <h3 className="standards-card__title">{check.standardName}</h3>
        <StatusBadge tone={timelinessTone(check.timeliness)}>
          {timelinessLabel(check)}
        </StatusBadge>
      </div>
      <p className="standards-card__meta">
        {businessDateLabel(check.businessDate)} · {check.questionCount} question
        {check.questionCount === 1 ? "" : "s"}
      </p>
      <Link
        className={`button ${check.canComplete ? "button--accent" : "button--secondary"}`}
        href={`/standards/checks/${check.occurrenceId}`}
      >
        {check.canComplete ? "Start check" : "View check"}
        <span className="visually-hidden">
          {" "}
          — {check.standardName} at {check.centreName}
        </span>
      </Link>
    </li>
  );
}

function CheckList({ checks }: Readonly<{ checks: readonly OpenCheckSummary[] }>) {
  const synthetic = checks.find((check) => check.synthetic);
  return (
    <>
      <SyntheticNotice
        notice={synthetic?.synthetic ? synthetic.syntheticNotice : undefined}
      />
      <ul className="standards-list" role="list">
        {checks.map((check) => (
          <StandardsCheckCard check={check} key={check.occurrenceId} />
        ))}
      </ul>
    </>
  );
}

export function CentreStandardsWorkspaceView({
  response,
}: Readonly<{ response: StandardsWorkspace }>) {
  if (response.status === "unsupported") {
    return (
      <>
        {/* No eyebrow and no summary on this branch. The eyebrow exists to put
            a varying headline in context, and here the headline *is* the module
            name — repeating it stutters. The standing summary would also claim
            "the centres you work in" to a principal who works in none. */}
        <PageHeader title="Centre Standards" />
        <EmptyState
          title="No checks are assigned to you"
          message="Your account is connected, but no centre currently gives you scheduled checks. Technical administration alone does not grant this."
        />
      </>
    );
  }

  const partial = response.status === "partial";
  const checks = response.openChecks;
  const overdue = checks.filter((check) => check.timeliness === "OVERDUE").length;

  // Under partial coverage the heading follows what is known, never the count.
  // An empty list means "we could not confirm", not "you are up to date".
  const title = partial
    ? overdue > 0
      ? overdue === 1
        ? "One check is overdue"
        : `${overdue} checks are overdue`
      : "Some check information couldn't be confirmed"
    : overdue === 0
      ? "Your checks"
      : overdue === 1
        ? "One check is overdue"
        : `${overdue} checks are overdue`;

  return (
    <>
      <PageHeader
        eyebrow="Centre Standards"
        title={title}
        summary="Everything open for the centres you work in. Completed checks leave this list."
      />

      {partial ? (
        <Notice title="Some check information couldn't be confirmed.">
          {response.warning}
        </Notice>
      ) : null}

      {checks.length > 0 ? (
        <CheckList checks={checks} />
      ) : partial ? (
        // Never the affirmative empty state: nothing was established.
        <EmptyState
          title="We couldn't confirm your checks"
          message="No check could be confirmed for you right now. This does not mean there is nothing due — please try again shortly."
        />
      ) : (
        <EmptyState
          title="Nothing due right now"
          message="You're up to date. Checks appear here when they open for your centre."
          mark="✓"
        />
      )}
    </>
  );
}

/** Reserves the shape of the check cards rather than a generic bar stack. */
export function StandardsListSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Checking your checks.</span>
      <ul className="standards-list" aria-hidden="true">
        {[0, 1].map((index) => (
          <li className="standards-card standards-card--skeleton" key={index}>
            <span className="skeleton__bar skeleton__bar--short" />
            <span className="skeleton__bar skeleton__bar--title" />
            <span className="skeleton__bar skeleton__bar--wide" />
            <span className="check-skeleton__option" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CentreStandardsWorkspace({
  gateway = backendNotAvailableGateway,
}: Readonly<{ gateway?: CentreStandardsGateway }>) {
  const [response, setResponse] = useState<StandardsWorkspace>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("Checking your checks.");

  useEffect(() => {
    let current = true;
    void gateway.loadWorkspace().then(
      (value) => {
        if (!current) return;
        setResponse(value);
        setState("ready");
        setAnnouncement(
          value.status === "partial"
            ? "Some check information couldn't be confirmed."
            : "Your checks are ready.",
        );
      },
      () => {
        if (!current) return;
        setState("error");
        setAnnouncement("Your checks could not be loaded.");
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, gateway]);

  const retry = useCallback(() => {
    setState("loading");
    // Put the live region back to the loading wording. Left saying "could not
    // be loaded", a second identical failure changes no text and so announces
    // nothing: the reader presses Try again and hears silence.
    setAnnouncement("Checking your checks.");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [response, state]);

  let content;
  if (state === "loading") {
    content = <StandardsListSkeleton />;
  } else if (state === "error" || !response) {
    content = (
      <ErrorState
        title="Your checks couldn't be loaded"
        message="Nothing has been assumed. This does not mean there is nothing due."
        onRetry={retry}
      />
    );
  } else {
    content = <CentreStandardsWorkspaceView response={response} />;
  }

  return (
    <AppShell active="/standards">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
    </AppShell>
  );
}
