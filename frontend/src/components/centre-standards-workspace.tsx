"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Notice,
  PageHeader,
  StatusBadge,
} from "./design-system";
import { AppShell } from "./app-shell";
import { SyntheticNotice } from "./centre-standards-check";
import {
  backendNotAvailableGateway,
  timelinessLabel,
  timelinessTone,
  type CentreStandardsGateway,
  type StandardsCheckSummary,
  type StandardsWorkspace,
} from "./centre-standards-contract";

/**
 * The Centre Standards landing surface.
 *
 * It answers one question — "what do I need to complete?" — and nothing else.
 * Only open checks appear: completed history is deliberately absent in 4A,
 * because an Educator's task list should shrink as they work, not grow.
 *
 * The unknown-is-not-zero rule established in Quality applies here too, and
 * matters more: "no checks due" and "we could not check" look identical to a
 * reader but mean opposite things when someone is deciding whether to walk the
 * playground.
 */

export function StandardsCheckCard({ check }: Readonly<{ check: StandardsCheckSummary }>) {
  const canComplete = check.authority.canComplete;
  return (
    <li className="standards-card" data-timeliness={check.timeliness}>
      <div className="standards-card__head">
        <h3 className="standards-card__title">{check.standardName}</h3>
        <StatusBadge tone={timelinessTone(check.timeliness)}>
          {timelinessLabel(check)}
        </StatusBadge>
      </div>
      <p className="standards-card__meta">
        {check.centreName} · {check.questionCount} question
        {check.questionCount === 1 ? "" : "s"}
      </p>
      <Link
        className={`button ${canComplete ? "button--accent" : "button--secondary"}`}
        href={`/standards/checks/${check.occurrenceId}`}
      >
        {canComplete ? "Start check" : "View check"}
        <span className="visually-hidden"> — {check.standardName}</span>
      </Link>
    </li>
  );
}

export function CentreStandardsWorkspaceView({
  response,
}: Readonly<{ response: StandardsWorkspace }>) {
  if (response.status === "unsupported") {
    return (
      <>
        <PageHeader
          eyebrow="Centre Standards"
          title="Centre Standards"
          summary="Scheduled operational checks for the centres you work in."
        />
        <EmptyState
          title="No checks are assigned to you"
          message="Your account is connected, but no centre currently gives you scheduled checks. Technical administration alone does not grant this."
        />
      </>
    );
  }

  const checks = response.openChecks;
  const overdue = (checks ?? []).filter((check) => check.timeliness === "OVERDUE").length;

  return (
    <>
      <PageHeader
        eyebrow="Centre Standards"
        title={
          overdue === 0
            ? "Your checks"
            : overdue === 1
              ? "One check is overdue"
              : `${overdue} checks are overdue`
        }
        summary="Everything open for the centres you work in. Completed checks leave this list."
      />

      {response.status === "partial" ? (
        <Notice title="Some check information couldn't be checked.">
          {response.warning ??
            "This list may be incomplete. A check missing from it has not been confirmed as done."}
        </Notice>
      ) : null}

      {checks === undefined ? (
        // The source was never established, so no claim may be made either way.
        <ErrorState
          title="Your checks couldn't be loaded"
          message="Nothing has been assumed. This does not mean there is nothing due — please try again shortly."
        />
      ) : checks.length === 0 ? (
        <EmptyState
          title="Nothing due right now"
          message="You're up to date. Checks appear here when they open for your centre."
          mark="✓"
        />
      ) : (
        <>
          <SyntheticNotice
            notice={
              checks.some((check) => check.synthetic)
                ? "Synthetic staging check for Centre Success testing. This is not a Bright Steps policy, regulatory requirement or operational standard."
                : undefined
            }
          />
          <ul className="standards-list" role="list">
            {checks.map((check) => (
              <StandardsCheckCard check={check} key={check.occurrenceId} />
            ))}
          </ul>
        </>
      )}
    </>
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
            ? "Some check information couldn't be checked."
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
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [response, state]);

  let content;
  if (state === "loading") {
    content = <LoadingSkeleton label="Checking your checks." rows={3} />;
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
