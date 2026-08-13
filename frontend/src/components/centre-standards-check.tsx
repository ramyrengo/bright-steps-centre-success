"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AnswerControl,
  CheckProgress,
  CompletionState,
  ErrorState,
  LoadingSkeleton,
  Notice,
  PageHeader,
  StatusBadge,
} from "./design-system";
import {
  backendNotAvailableGateway,
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
 * up, one-handed, outdoors and in a hurry. It therefore shows one question at a
 * time, carries no navigation chrome, and keeps every answer in React memory
 * until a single submit. Nothing is written to browser storage: unfinished
 * answers are ephemeral by design, so the experience warns before they would be
 * discarded rather than quietly persisting business content.
 */

/**
 * The synthetic marker. It sits with the content rather than only on a landing
 * screen, because an Educator arriving from a deep link would otherwise never
 * see it. The wording comes from the backend so it cannot drift from what was
 * approved.
 */
export function SyntheticNotice({
  notice,
}: Readonly<{ notice?: string }>) {
  if (!notice) return null;
  return (
    <p className="synthetic-notice">
      <span className="synthetic-notice__label">Staging test content</span>
      <span>{notice}</span>
    </p>
  );
}

function CheckIdentity({ check }: Readonly<{ check: StandardsCheckSummary }>) {
  return (
    <>
      <p className="standards-card__meta">
        {check.centreName} · {check.businessDate}
      </p>
      <StatusBadge tone={timelinessTone(check.timeliness)}>
        {timelinessLabel(check)}
      </StatusBadge>
    </>
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

  const total = check.questions.length;
  const question = check.questions[step];
  const answered = question ? answers[question.questionId] : undefined;
  const allAnswered = useMemo(
    () => check.questions.every((item) => answers[item.questionId] !== undefined),
    [answers, check.questions],
  );
  const dirty = Object.keys(answers).length > 0;
  const finished = phase.kind === "completed" || phase.kind === "already";

  // Answers live only in memory, so leaving would discard them. The browser
  // prompt is the only honest guard available without persisting business data.
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
    // Guard the in-flight case in state as well as in the disabled attribute,
    // so a double tap that beats React's render cannot submit twice.
    if (phase.kind === "submitting" || !allAnswered) return;
    setPhase({ kind: "submitting" });
    void submit(
      check.questions.map((item) => ({
        questionId: item.questionId,
        value: answers[item.questionId]!,
      })),
    ).then(
      (result) => {
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
      // A recoverable failure must never unmount the form or clear an answer.
      () => setPhase({ kind: "error" }),
    );
  }, [allAnswered, answers, check.questions, phase.kind, submit]);

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
      <PageHeader
        eyebrow="Centre Standards"
        title={check.standardName}
        meta={<CheckIdentity check={check} />}
      />
      <SyntheticNotice notice={check.syntheticNotice} />
      <CheckProgress current={step + 1} total={total} />

      {phase.kind === "error" ? (
        <ErrorState
          title="That didn't send"
          message="Your answers are still here. Nothing has been recorded yet — try again when you have a moment."
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
          <div className="check-actions">
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
 * the backend, never from a role name.
 */
export function StandardsCheckReadOnly({
  check,
  note,
}: Readonly<{ check: StandardsCheckDetail; note?: string }>) {
  const completed =
    check.timeliness === "COMPLETED_ON_TIME" || check.timeliness === "COMPLETED_LATE";
  return (
    <div className="standards-check">
      <PageHeader
        eyebrow="Centre Standards"
        title={check.standardName}
        summary={
          completed
            ? "This check is complete. It is shown here as a record and cannot be changed."
            : "This check has not been completed yet."
        }
        meta={<CheckIdentity check={check} />}
      />
      <SyntheticNotice notice={check.syntheticNotice} />
      {note ? <Notice title={note} /> : null}
      {check.responses && check.responses.length > 0 ? (
        <section aria-labelledby="standards-responses-title">
          <h2 id="standards-responses-title">What was recorded</h2>
          <ul className="standards-responses" role="list">
            {check.responses.map((response) => (
              <li key={response.questionId}>
                <span className="standards-responses__question">{response.wording}</span>
                <span className="standards-responses__answer">{response.answerLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : completed ? (
        <Notice title="The recorded answers are not available to you." />
      ) : null}
    </div>
  );
}

/**
 * Chooses the surface from backend-supplied authority and state. A completed
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
  const completed =
    check.timeliness === "COMPLETED_ON_TIME" || check.timeliness === "COMPLETED_LATE";
  if (completed) return <StandardsCheckReadOnly check={check} />;
  if (!check.authority.canComplete) {
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

  if (state === "loading") return <LoadingSkeleton label="Opening your check." rows={3} />;
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
