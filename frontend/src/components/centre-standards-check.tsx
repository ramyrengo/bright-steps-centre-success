"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AnswerControl,
  CheckProgress,
  CompletionState,
  ErrorState,
  LoadingSkeleton,
  Notice,
  StatusBadge,
} from "./design-system";
import { useBlockLeaveWhen } from "./app-shell";
import {
  backendNotAvailableGateway,
  businessDateLabel,
  timelinessLabel,
  timelinessTone,
  type CentreStandardsGateway,
  type CheckAnswer,
  type CompleteCheckResult,
  type StandardsCheckDetail,
  type StandardsCheckSummary,
} from "./centre-standards-contract";

/**
 * Centre Standards check surfaces.
 *
 * The completion experience is the only screen in Centre Success used standing
 * up, one-handed, outdoors and in a hurry. It shows one question at a time,
 * carries no navigation chrome, and keeps every answer in React memory until a
 * single submit. Nothing is written to browser storage: unfinished answers are
 * ephemeral by design, so the experience guards the ways out rather than
 * quietly persisting business content.
 */

/**
 * The synthetic marker. It sits with the content rather than only on a landing
 * screen, because an Educator arriving from a deep link would otherwise never
 * see it. The wording comes from the backend so it cannot drift from what was
 * approved.
 */
export function SyntheticNotice({ notice }: Readonly<{ notice?: string }>) {
  if (!notice) return null;
  return (
    <p className="synthetic-notice">
      <span className="synthetic-notice__label">Staging test content</span>
      <span>{notice}</span>
    </p>
  );
}

/**
 * A compact header for the check screens.
 *
 * The standard name is context, not the task. Rendering it at page-display size
 * made it 95px of the first screenful while the actual question sat at 20px
 * below it, which inverts what an Educator needs to see first. The heading
 * stays a real `h1` for structure and is simply not the loudest thing present.
 */
function CheckHeader({ check }: Readonly<{ check: StandardsCheckSummary }>) {
  return (
    <header className="check-header">
      <p className="check-header__eyebrow">Centre Standards</p>
      <h1 className="check-header__title" data-page-focus tabIndex={-1}>
        {check.standardName}
      </h1>
      <div className="check-header__meta">
        <StatusBadge tone={timelinessTone(check.timeliness)}>
          {timelinessLabel(check)}
        </StatusBadge>
        <span>
          {check.centreName} · {businessDateLabel(check.businessDate)}
        </span>
      </div>
    </header>
  );
}

type CompletionPhase =
  | { kind: "answering" }
  | { kind: "submitting" }
  | { kind: "error" }
  | { kind: "completed"; issueRaised: boolean; completedLocalTime: string }
  | { kind: "already"; completedLocalTime: string; completedByRequester: boolean };

/**
 * One question at a time, then one submit.
 *
 * `submit` is injected so the flow can be exercised against every outcome —
 * including a committed-but-lost response — without a backend.
 */
export function StandardsCheckCompletion({
  check,
  submit,
}: Readonly<{
  check: StandardsCheckDetail;
  submit: (answers: readonly CheckAnswer[]) => Promise<CompleteCheckResult>;
}>) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<CompletionPhase>({ kind: "answering" });

  // A synchronous lock. `disabled` and `setPhase` both settle on the next
  // render, so two native clicks dispatched in one batch would each see the
  // stale state and submit. A ref changes on the first call.
  const inFlight = useRef(false);

  const total = check.questions.length;
  const question = check.questions[step];
  const answered = question ? answers[question.questionId] : undefined;
  const allAnswered = useMemo(
    () => check.questions.every((item) => answers[item.questionId] !== undefined),
    [answers, check.questions],
  );
  const dirty = Object.keys(answers).length > 0;
  const finished = phase.kind === "completed" || phase.kind === "already";

  // Guards the shell's own leave paths — the brand link and sign out — which
  // discard answers through client-side navigation without the browser ever
  // asking.
  useBlockLeaveWhen(dirty && !finished);

  // Covers a real page unload, which the in-app guard cannot see.
  useEffect(() => {
    if (!dirty || finished) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, finished]);

  const choose = useCallback((questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }, []);

  const onSubmit = useCallback(() => {
    if (inFlight.current || !allAnswered) return;
    inFlight.current = true;
    setPhase({ kind: "submitting" });
    void submit(
      check.questions.map((item) => ({
        questionId: item.questionId,
        value: answers[item.questionId]!,
      })),
    ).then(
      (result) => {
        // Both outcomes are terminal, so the lock is deliberately never
        // released: a completed check must not reopen the submission path.
        if (result.outcome === "COMPLETED") {
          setPhase({
            kind: "completed",
            issueRaised: result.issueRaised,
            completedLocalTime: result.completedLocalTime,
          });
          return;
        }
        setPhase({
          kind: "already",
          completedLocalTime: result.completedLocalTime,
          completedByRequester: result.completedByRequester,
        });
      },
      () => {
        // Recoverable: release the lock so retry works, and never unmount the
        // form or clear an answer.
        inFlight.current = false;
        setPhase({ kind: "error" });
      },
    );
  }, [allAnswered, answers, check.questions, submit]);

  if (phase.kind === "completed") {
    return (
      <CompletionState
        title="Check complete"
        message={
          phase.issueRaised
            ? "Thanks — your check is complete. One issue has been raised for follow-up."
            : "Thanks — your check is complete."
        }
        detail={`${check.standardName} · completed ${phase.completedLocalTime}`}
        action={
          <Link className="button button--secondary" href="/standards">
            Back to your checks
          </Link>
        }
      />
    );
  }

  if (phase.kind === "already") {
    return (
      <CompletionState
        title={phase.completedByRequester ? "Already submitted" : "Already completed"}
        message={
          phase.completedByRequester
            ? `Already submitted — you completed this check at ${phase.completedLocalTime}.`
            : "This check has already been completed."
        }
        detail={
          phase.completedByRequester
            ? undefined
            : `Completed at ${phase.completedLocalTime}. Your answers on this screen were not submitted.`
        }
        action={
          <Link className="button button--secondary" href="/standards">
            Back to your checks
          </Link>
        }
      />
    );
  }

  const submitting = phase.kind === "submitting";
  const last = step === total - 1;

  return (
    <div className="standards-check">
      <CheckHeader check={check} />
      <SyntheticNotice notice={check.synthetic ? check.syntheticNotice : undefined} />
      <CheckProgress current={step + 1} total={total} />

      {phase.kind === "error" ? (
        // A network or timeout failure may have reached the server, so the copy
        // must not claim the check definitely was not recorded.
        <ErrorState
          title="We couldn't confirm your check"
          message="We couldn't confirm whether your check was recorded. Your answers are still here; it's safe to try again."
          onRetry={onSubmit}
        />
      ) : null}

      {question ? (
        <div className="standards-check__question">
          <AnswerControl
            key={question.questionId}
            legend={question.wording}
            name={question.questionId}
            instructions={question.instructions}
            options={question.options}
            value={answered}
            onChange={(value) => choose(question.questionId, value)}
            disabled={submitting}
          />
          <div className="check-actions" data-has-back={step > 0 ? "true" : undefined}>
            {step > 0 ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setStep((value) => value - 1)}
                disabled={submitting}
              >
                Back
              </button>
            ) : null}
            {last ? (
              <button
                className="button button--accent check-actions__primary"
                type="button"
                onClick={onSubmit}
                disabled={submitting || !allAnswered}
              >
                {submitting ? "Sending…" : "Submit check"}
              </button>
            ) : (
              <button
                className="button button--accent check-actions__primary"
                type="button"
                onClick={() => setStep((value) => value + 1)}
                disabled={answered === undefined}
              >
                Next
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What a principal with read authority sees, and what a completed occurrence
 * shows when reopened. It offers no completion control: authority comes from
 * the backend, never from a role name, and a completed occurrence carries no
 * completion authority at all.
 */
export function StandardsCheckReadOnly({
  check,
  note,
}: Readonly<{ check: StandardsCheckDetail; note?: string }>) {
  const completed = check.state === "COMPLETED";
  const responses = check.state === "COMPLETED" ? check.responses : undefined;
  return (
    <div className="standards-check">
      <CheckHeader check={check} />
      <SyntheticNotice notice={check.synthetic ? check.syntheticNotice : undefined} />
      {note ? <Notice title={note} /> : null}

      {completed ? (
        responses && responses.length > 0 ? (
          <section className="check-record" aria-labelledby="standards-responses-title">
            <h2 id="standards-responses-title" className="check-record__title">
              What was recorded
            </h2>
            <ol className="standards-responses" role="list">
              {responses.map((response) => (
                <li key={response.questionId}>
                  <span className="standards-responses__question">{response.wording}</span>
                  <span className="standards-responses__answer">{response.answerLabel}</span>
                </li>
              ))}
            </ol>
            <p className="check-record__footnote">
              Recorded answers cannot be changed. A correction is a separate step.
            </p>
          </section>
        ) : (
          <Notice title="The recorded answers are not available to you." />
        )
      ) : (
        <section className="check-record" aria-labelledby="standards-pending-title">
          <h2 id="standards-pending-title" className="check-record__title">
            Not completed yet
          </h2>
          <p className="check-record__body">
            This check has {check.questionCount} question
            {check.questionCount === 1 ? "" : "s"} and has not been answered.
          </p>
        </section>
      )}

      <Link className="button button--secondary" href="/standards">
        Back to checks
      </Link>
    </div>
  );
}

/**
 * Chooses the surface from backend-supplied state and authority. A completed
 * occurrence is always read-only; an open one offers completion only to a
 * principal the backend says may complete it.
 */
export function CentreStandardsCheckView({
  check,
  submit,
}: Readonly<{
  check: StandardsCheckDetail;
  submit: (answers: readonly CheckAnswer[]) => Promise<CompleteCheckResult>;
}>) {
  if (check.state === "COMPLETED") return <StandardsCheckReadOnly check={check} />;
  if (!check.canComplete) {
    return (
      <StandardsCheckReadOnly
        check={check}
        note="You can see this check but are not set up to complete it."
      />
    );
  }
  return <StandardsCheckCompletion check={check} submit={submit} />;
}

export function CentreStandardsCheck({
  occurrenceId,
  gateway = backendNotAvailableGateway,
}: Readonly<{ occurrenceId: string; gateway?: CentreStandardsGateway }>) {
  const [check, setCheck] = useState<StandardsCheckDetail>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void gateway.loadCheck(occurrenceId).then(
      (value) => {
        if (!current) return;
        setCheck(value);
        setState("ready");
      },
      () => {
        if (!current) return;
        setState("error");
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, gateway, occurrenceId]);

  const submit = useCallback(
    (answers: readonly CheckAnswer[]) => gateway.completeCheck({ occurrenceId, answers }),
    [gateway, occurrenceId],
  );

  if (state === "loading") return <CheckSkeleton />;
  if (state === "error" || !check) {
    return (
      <ErrorState
        title="This check couldn't be opened"
        message="Nothing has been recorded. Please try again shortly."
        onRetry={() => {
          setState("loading");
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  return <CentreStandardsCheckView check={check} submit={submit} />;
}

/** Reserves the shape of the question that is coming, not a generic bar stack. */
export function CheckSkeleton() {
  return (
    <div className="standards-check" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Opening your check.</span>
      <div className="check-skeleton" aria-hidden="true">
        <span className="skeleton__bar skeleton__bar--short" />
        <span className="skeleton__bar skeleton__bar--title" />
        <span className="check-skeleton__progress" />
        <span className="skeleton__bar skeleton__bar--wide" />
        <span className="check-skeleton__option" />
        <span className="check-skeleton__option" />
      </div>
    </div>
  );
}

export { LoadingSkeleton };
