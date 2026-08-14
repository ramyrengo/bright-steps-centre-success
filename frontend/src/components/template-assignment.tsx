"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog, LoadingSkeleton, Notice } from "./design-system";
import {
  RECURRENCE_LABEL,
  describeAssignment,
  dueTimeLabel,
  templatePreviewRoute,
  type AssignmentOptions,
  type AssignmentSelection,
  type PublishResult,
  type ScheduleSelection,
  type TemplateBuilderGateway,
} from "./template-builder-contract";

/**
 * Choosing where a published version runs, when it is due, and publishing it.
 *
 * Two rules from ADR-0020 shape this surface more than anything else:
 *
 * 1. The portfolio is resolved from current backend authority. The browser
 *    never sends a portfolio list, and the `PORTFOLIO` branch of
 *    `AssignmentSelection` has nowhere to put one. The copy says so plainly,
 *    because an Area Manager choosing "my whole portfolio" is entitled to know
 *    it means "whatever I am authorised for when I press publish", not
 *    "the seven centres I can see today".
 *
 * 2. Publishing is the moment a version becomes immutable. The confirmation
 *    states that in words before the button, not after it.
 *
 * Scheduling is daily only in this cycle. Daily is a strict subset of the
 * recurrences ADR-0020 authorises, and the surface says which one it is using
 * rather than presenting a picker with one option in it.
 */

const DEFAULT_DUE_TIME = "09:00";
const DEFAULT_OPENS_TIME = "06:00";

/** The first day the check runs, defaulting to today in the author's own date. */
function todayLocalDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** The centre picker. One centre and several centres are the same control. */
export function CentrePicker({
  options,
  selected,
  onChange,
}: Readonly<{
  options: AssignmentOptions;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}>) {
  if (options.centres.length === 0) {
    return (
      <p className="assignment-picker__empty">
        No centre is available for you to assign to right now.
      </p>
    );
  }

  return (
    <ul className="centre-checklist" role="list">
      {options.centres.map((centre) => {
        const checked = selected.includes(centre.centreId);
        return (
          <li key={centre.centreId}>
            <label className="centre-checklist__item">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((id) => id !== centre.centreId)
                      : [...selected, centre.centreId],
                  )
                }
              />
              <span className="centre-checklist__body">
                <span className="centre-checklist__name">{centre.centreName}</span>
                <span className="centre-checklist__zone">{centre.timeZoneLabel}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

type PublishPhase =
  | { kind: "configuring" }
  | { kind: "publishing" }
  | { kind: "failed" }
  | { kind: "refused"; reason: string }
  | {
      kind: "published";
      versionId: string;
      title: string;
      message: string;
      detail?: string;
    };

export function PublishDialog({
  gateway,
  lockVersion,
  templateId,
  questionCount,
  onDismiss,
  onPublished,
}: Readonly<{
  gateway: TemplateBuilderGateway;
  /** Concurrency token from the loaded draft. Publishing is keyed on the
   *  template and this token, never on a version that does not exist yet. */
  lockVersion: number;
  templateId: string;
  questionCount: number;
  onDismiss: () => void;
  onPublished: (versionId: string) => void;
}>) {
  const [options, setOptions] = useState<AssignmentOptions>();
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [scope, setScope] = useState<AssignmentSelection["scope"]>("CENTRES");
  const [centreIds, setCentreIds] = useState<string[]>([]);
  const [dueTime, setDueTime] = useState(DEFAULT_DUE_TIME);
  const [phase, setPhase] = useState<PublishPhase>({ kind: "configuring" });

  // A synchronous lock. Publishing is the one irreversible action here, and two
  // clicks dispatched in the same batch would both see the pre-render state.
  const inFlight = useRef(false);

  useEffect(() => {
    let current = true;
    void gateway.loadAssignmentOptions().then(
      (value) => {
        if (!current) return;
        setOptions(value);
        setOptionsState("ready");
      },
      () => {
        if (!current) return;
        setOptionsState("error");
      },
    );
    return () => {
      current = false;
    };
  }, [gateway]);

  const selection: AssignmentSelection =
    scope === "PORTFOLIO" ? { scope: "PORTFOLIO" } : { scope: "CENTRES", centreIds };

  const ready =
    optionsState === "ready" &&
    (scope === "PORTFOLIO" ? Boolean(options?.portfolioAvailable) : centreIds.length > 0) &&
    /^\d{2}:\d{2}$/.test(dueTime);

  const publish = useCallback(() => {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setPhase({ kind: "publishing" });

    // Times are wall-clock and applied in each centre's own zone by the
    // backend, which stays authoritative for what they mean.
    const schedule: ScheduleSelection = {
      recurrence: "DAILY",
      opensLocalTime: DEFAULT_OPENS_TIME,
      dueLocalTime: dueTime,
      effectiveFrom: todayLocalDate(),
    };

    void gateway.publishVersion({ templateId, lockVersion, assignment: selection, schedule }).then(
      (result: PublishResult) => {
        if (result.outcome === "PUBLISHED") {
          // Deliberately not released: a published version is immutable and the
          // publish path must not reopen.
          setPhase({
            kind: "published",
            versionId: result.versionId,
            title: "Published",
            message: `${result.versionLabel} is live and can no longer be changed.`,
            detail: `${result.assignment.description} · ${result.schedule.dueLocalTime} ${result.schedule.timeZoneNote}`,
          });
          return;
        }
        if (result.outcome === "ALREADY_PUBLISHED") {
          setPhase({
            kind: "published",
            versionId: result.versionId,
            title: "Already published",
            // Who published it decides the sentence. Someone whose own publish
            // committed and lost its response needs to hear that their press
            // worked and that nothing was duplicated. Someone who has just been
            // beaten to it needs to hear that what is live is not theirs, and
            // "it was not published twice" would be a reassurance about a
            // publish they never made.
            message: result.publishedByRequester
              ? `You published ${result.versionLabel} at ${result.publishedLocalTime}. It was not published twice.`
              : `${result.versionLabel} was already published at ${result.publishedLocalTime}.`,
            // Said to both, because it is true for both. Publishing and
            // assigning are two commands, and a publish that lost its response
            // never reached the second — so the version is live with nothing
            // set. Told only that their own publish worked, an Area Manager
            // would leave believing a daily check is running at the centres on
            // this screen when none was ever assigned.
            detail: "The settings on this screen were not applied.",
          });
          return;
        }
        // A refusal is a decision, not an outage. The backend's wording is
        // shown as it was given.
        inFlight.current = false;
        setPhase({ kind: "refused", reason: result.reason });
      },
      () => {
        // The request may have committed and lost its response, so the copy
        // must not claim nothing was published. Retrying is safe: a second
        // publish returns ALREADY_PUBLISHED.
        inFlight.current = false;
        setPhase({ kind: "failed" });
      },
    );
  }, [dueTime, gateway, lockVersion, ready, selection, templateId]);

  if (phase.kind === "published") {
    return (
      <Dialog
        eyebrow="Publish"
        title={phase.title}
        onDismiss={() => onPublished(phase.versionId)}
        footer={
          <button
            className="button button--accent"
            type="button"
            data-autofocus
            onClick={() => onPublished(phase.versionId)}
          >
            View published version
          </button>
        }
      >
        <p>{phase.message}</p>
        {phase.detail ? <p className="publish-summary__detail">{phase.detail}</p> : null}
        <p className="publish-summary__detail">
          It stays in version history permanently. To change anything, start a new draft.
        </p>
      </Dialog>
    );
  }

  const publishing = phase.kind === "publishing";

  return (
    <Dialog
      eyebrow="Publish"
      title="Where and when should this run?"
      onDismiss={onDismiss}
      footer={
        <>
          <button
            className="button button--secondary"
            type="button"
            onClick={onDismiss}
            disabled={publishing}
          >
            Cancel
          </button>
          <button
            className="button button--accent"
            type="button"
            onClick={publish}
            disabled={!ready || publishing}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </>
      }
    >
      {optionsState === "loading" ? (
        <LoadingSkeleton label="Checking which centres you can assign to." rows={2} />
      ) : optionsState === "error" || !options ? (
        <div className="workflow-dialog__error" role="alert">
          <strong>We couldn&apos;t check which centres you can assign to</strong>
          <p>
            Nothing has been published. This does not mean you have no centres — please close
            this and try again shortly.
          </p>
        </div>
      ) : (
        <>
          {options.warning ? (
            <Notice title="Some centres couldn't be confirmed.">{options.warning}</Notice>
          ) : null}

          <fieldset className="assignment-picker">
            <legend>Which centres</legend>
            <label className="assignment-picker__option">
              <input
                type="radio"
                name="assignment-scope"
                checked={scope === "CENTRES"}
                onChange={() => setScope("CENTRES")}
              />
              <span>
                <span className="assignment-picker__label">Choose centres</span>
                <span className="assignment-picker__hint">
                  Pick one or several from the centres you look after.
                </span>
              </span>
            </label>

            {scope === "CENTRES" ? (
              <CentrePicker options={options} selected={centreIds} onChange={setCentreIds} />
            ) : null}

            <label className="assignment-picker__option">
              <input
                type="radio"
                name="assignment-scope"
                checked={scope === "PORTFOLIO"}
                disabled={!options.portfolioAvailable}
                onChange={() => setScope("PORTFOLIO")}
              />
              <span>
                <span className="assignment-picker__label">My whole portfolio</span>
                <span className="assignment-picker__hint">
                  {options.portfolioAvailable
                    ? // Never a count the browser worked out. Where the backend
                      // did not resolve one, absence is stated rather than a 0
                      // that would claim an empty portfolio.
                      options.portfolioCentreCount === undefined
                      ? "Worked out from what you are authorised for at the moment you publish."
                      : `Worked out at the moment you publish — ${options.portfolioCentreCount} centre${
                          options.portfolioCentreCount === 1 ? "" : "s"
                        } right now.`
                    : "Not available to you right now."}
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="schedule-picker">
            <legend>When it is due</legend>
            <p className="schedule-picker__recurrence">
              {RECURRENCE_LABEL.DAILY}. Other schedules are not part of this release.
            </p>
            <label className="builder-field">
              <span className="builder-field__label">Due by</span>
              <input
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
              />
            </label>
            <p className="schedule-picker__zone">
              {dueTimeLabel(dueTime)} in each centre&apos;s own local time.
            </p>
          </fieldset>

          <div className="publish-summary">
            <h3>What you are about to publish</h3>
            <dl>
              <div>
                <dt>Questions</dt>
                <dd>
                  {questionCount} question{questionCount === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Centres</dt>
                <dd>{describeAssignment(selection, options)}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>
                  {RECURRENCE_LABEL.DAILY.toLowerCase()} by {dueTimeLabel(dueTime)}
                </dd>
              </div>
            </dl>
            <p className="publish-summary__detail">
              Once published, this version cannot be changed. To change it later you start a new
              draft, and this version stays in history exactly as it is.
            </p>
            <p className="publish-summary__detail">
              <Link href={templatePreviewRoute(templateId)}>Preview it on a phone first</Link> if
              you have not already.
            </p>
          </div>

          {phase.kind === "refused" ? (
            <div className="workflow-dialog__error" role="alert">
              <strong>This wasn&apos;t published</strong>
              <p>{phase.reason}</p>
            </div>
          ) : null}

          {phase.kind === "failed" ? (
            <div className="workflow-dialog__error" role="alert">
              <strong>We couldn&apos;t confirm the publish</strong>
              <p>
                We couldn&apos;t confirm whether this was published. Your settings are still here;
                it&apos;s safe to try again, and it will not publish twice.
              </p>
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
