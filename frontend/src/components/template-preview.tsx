"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { AppShell } from "./app-shell";
import {
  AnswerControl,
  CheckProgress,
  EntryControl,
  ErrorState,
  MultiAnswerControl,
  Notice,
  PageHeader,
} from "./design-system";
import {
  DEFAULT_DUE_TIME,
  QUESTION_TYPE_LABEL,
  TEMPLATE_ROOT,
  countQuestions,
  dueTimeLabel,
  templateRoute,
  versionContent,
  type DraftQuestion,
  type TemplateBuilderGateway,
  type TemplateWorkspace,
} from "./template-builder-contract";
import { useTemplateBuilderGateway } from "./template-builder-gateway";

/**
 * The phone preview.
 *
 * ADR-0020 is explicit about what this is and is not: a pre-publication
 * representation of the operational form that "does not itself publish a
 * version, assign a centre, create an occurrence, record a completion, or
 * confer authority". Everything here follows from that sentence.
 *
 * In particular the preview calls no completion command and reaches no
 * occurrence. Its finish screen says nothing was recorded, in those words,
 * because a preview that ended on the same green tick as a real completion
 * would be telling an Area Manager something untrue about a centre. The real
 * completion experience — including its `ALREADY_COMPLETED` handling — is the
 * shipped Centre Standards surface in `centre-standards-check.tsx`, running
 * against a real occurrence. Reproducing that state here would mean rendering
 * an operational outcome for a check that does not exist.
 *
 * What it *does* faithfully reproduce is the shape of the educator experience:
 * one question per screen, the same 56px targets, the same written progress
 * count, the same due-time line derived from the schedule.
 */

/** A phone-sized viewport, so the preview is the real width and not a metaphor. */
export function PhoneFrame({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="phone-frame">
      {/* The frame is decoration; the screen inside is a real region so a
          screen-reader user lands in the preview rather than in a picture of
          one. */}
      <div className="phone-frame__device" aria-hidden="true" />
      <section className="phone-frame__screen" aria-label={label}>
        {children}
      </section>
    </div>
  );
}

/** One question rendered the way the person answering will see it. */
export function PreviewQuestion({
  question,
  value,
  onChange,
  takeFocus,
}: Readonly<{
  question: DraftQuestion;
  value: string | string[] | undefined;
  onChange: (next: string | string[]) => void;
  takeFocus: boolean;
}>) {
  const legend = `${question.wording}${question.required ? "" : " (optional)"}`;
  const guidance = question.guidance;

  switch (question.type) {
    case "YES_NO":
      return (
        <AnswerControl
          legend={legend}
          name={question.questionId}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "SINGLE_SELECT":
      return (
        <AnswerControl
          legend={legend}
          name={question.questionId}
          options={question.choices.map((choice) => ({
            value: choice.choiceId,
            label: choice.label || "Option with no wording yet",
          }))}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "MULTI_SELECT":
      return (
        <MultiAnswerControl
          legend={legend}
          name={question.questionId}
          options={question.choices.map((choice) => ({
            value: choice.choiceId,
            label: choice.label || "Option with no wording yet",
          }))}
          values={Array.isArray(value) ? value : []}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "TEXT":
      return (
        <EntryControl
          label={legend}
          name={question.questionId}
          entry={question.multiline ? "paragraph" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "NUMBER":
      return (
        <EntryControl
          label={legend}
          name={question.questionId}
          entry="number"
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "TIME":
      return (
        <EntryControl
          label={legend}
          name={question.questionId}
          entry="time"
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
    case "DATE":
      // The bounds are handed to the native picker, so the preview refuses an
      // out-of-window date exactly where the author set the window. They are
      // plain `YYYY-MM-DD` values passed straight through — the control does
      // not interpret them as instants, so no timezone enters the preview.
      return (
        <EntryControl
          label={legend}
          name={question.questionId}
          entry="date"
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          takeFocus={takeFocus}
          {...(question.earliest ? { min: question.earliest } : {})}
          {...(question.latest ? { max: question.latest } : {})}
          {...(guidance ? { instructions: guidance } : {})}
        />
      );
  }
}

function answered(question: DraftQuestion, value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The one-question-at-a-time walkthrough.
 *
 * `dueLabel` is the due time derived from the schedule the draft will be
 * published with. It is stated as a preview of what the person answering would
 * see, never as a real deadline, because no occurrence exists.
 */
export function TemplatePreviewFlow({
  templateName,
  questions,
  dueLabel,
  onRestart,
}: Readonly<{
  templateName: string;
  questions: readonly DraftQuestion[];
  dueLabel?: string;
  onRestart?: () => void;
}>) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [stepped, setStepped] = useState(false);

  const total = questions.length;
  const question = questions[step];
  const value = question ? answers[question.questionId] : undefined;

  const restart = useCallback(() => {
    setAnswers({});
    setStep(0);
    setStepped(false);
    setFinished(false);
    onRestart?.();
  }, [onRestart]);

  if (total === 0) {
    return (
      <div className="phone-preview">
        <p className="phone-preview__eyebrow">Centre Standards</p>
        <h2 className="phone-preview__title">{templateName}</h2>
        <p className="phone-preview__empty">
          There are no questions to preview yet. Add one in the editor and it will appear here.
        </p>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="phone-preview phone-preview--finished">
        <span className="phone-preview__mark" aria-hidden="true">
          ✓
        </span>
        <h2 className="phone-preview__title">End of the preview</h2>
        <p className="phone-preview__message">
          This is where the person answering would finish. Nothing was recorded and no centre was
          contacted — this is a preview.
        </p>
        <button className="button button--secondary" type="button" onClick={restart}>
          Start the preview again
        </button>
      </div>
    );
  }

  const last = step === total - 1;
  const canAdvance = !question!.required || answered(question!, value);

  return (
    <div className="phone-preview">
      <header className="phone-preview__header">
        <p className="phone-preview__eyebrow">Centre Standards</p>
        <h2 className="phone-preview__title">{templateName}</h2>
        {dueLabel ? <p className="phone-preview__due">{dueLabel}</p> : null}
      </header>

      <CheckProgress current={step + 1} total={total} />

      <PreviewQuestion
        key={question!.questionId}
        question={question!}
        value={value}
        onChange={(next) =>
          setAnswers((current) => ({ ...current, [question!.questionId]: next }))
        }
        takeFocus={stepped}
      />

      <div className="check-actions" data-has-back={step > 0 ? "true" : undefined}>
        {step > 0 ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setStepped(true);
              setStep((current) => current - 1);
            }}
          >
            Back
          </button>
        ) : null}
        <button
          className="button button--accent check-actions__primary"
          type="button"
          disabled={!canAdvance}
          onClick={() => {
            if (last) {
              setFinished(true);
              return;
            }
            setStepped(true);
            setStep((current) => current + 1);
          }}
        >
          {last ? "Finish preview" : "Next"}
        </button>
      </div>
    </div>
  );
}

export function TemplatePreviewScreen({
  workspace,
}: Readonly<{ workspace: TemplateWorkspace }>) {
  const content = versionContent(workspace.version);
  const questions = useMemo(
    () => content.sections.flatMap((section) => section.questions),
    [content],
  );

  // A draft has no schedule yet, and this backend does not report the schedule
  // of a version that already has one. Either way the preview shows the default
  // the publish step opens on and says where the time came from, rather than
  // presenting a deadline it did not establish.
  const schedule =
    workspace.version.lifecycle === "DRAFT" ? undefined : workspace.version.schedule;
  const dueLabel = schedule
    ? `Due by ${schedule.dueLocalTime}`
    : `Due by ${dueTimeLabel(DEFAULT_DUE_TIME)}`;

  const types = [...new Set(questions.map((question) => question.type))];

  return (
    <>
      <PageHeader
        eyebrow="Preview"
        title={`${workspace.templateName} on a phone`}
        summary="This is what the person answering sees, one question at a time. Nothing here is recorded and no centre is contacted."
        meta={
          <>
            <span>{workspace.version.versionLabel}</span>
            <span>
              {countQuestions(content)} question{countQuestions(content) === 1 ? "" : "s"}
            </span>
            {types.length > 0 ? (
              <span>{types.map((type) => QUESTION_TYPE_LABEL[type]).join(", ")}</span>
            ) : null}
          </>
        }
        actions={
          <Link
            className="button button--secondary"
            href={templateRoute(workspace.templateId)}
          >
            Back to the template
          </Link>
        }
      />

      <Notice title="Preview only.">
        {schedule
          ? `The due time shown is this version's published schedule, ${schedule.timeZoneNote}.`
          : workspace.version.lifecycle === "DRAFT"
            ? "The due time shown is the default the publish step opens on. You choose the real one when you publish."
            : "The due time shown is the default the publish step opens on. This screen cannot confirm the time this version actually runs at."}
      </Notice>

      <PhoneFrame label={`Phone preview of ${workspace.templateName}`}>
        <TemplatePreviewFlow
          templateName={workspace.templateName}
          questions={questions}
          dueLabel={dueLabel}
        />
      </PhoneFrame>
    </>
  );
}

export function TemplatePreview({
  templateId,
  gateway,
}: Readonly<{ templateId: string; gateway?: TemplateBuilderGateway }>) {
  // The real transport unless a caller supplies one. The hook runs
  // unconditionally, as it must, and building a gateway touches no endpoint.
  const liveGateway = useTemplateBuilderGateway();
  const active = gateway ?? liveGateway;
  const [workspace, setWorkspace] = useState<TemplateWorkspace>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("Opening the preview.");

  useEffect(() => {
    let current = true;
    void active.loadTemplate(templateId).then(
      (value) => {
        if (!current) return;
        setWorkspace(value);
        setState("ready");
        setAnnouncement(`Preview of ${value.templateName} is ready.`);
      },
      () => {
        if (!current) return;
        setState("error");
        setAnnouncement("The preview could not be opened.");
      },
    );
    return () => {
      current = false;
    };
  }, [active, attempt, templateId]);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [state, workspace]);

  let content;
  if (state === "loading") {
    content = (
      <div className="phone-frame" role="status" aria-live="polite" aria-busy="true">
        <span className="visually-hidden">Opening the preview.</span>
        <div className="phone-frame__device" aria-hidden="true" />
        <div className="phone-frame__screen" aria-hidden="true">
          <span className="skeleton__bar skeleton__bar--short" />
          <span className="skeleton__bar skeleton__bar--title" />
          <span className="check-skeleton__option" />
          <span className="check-skeleton__option" />
        </div>
      </div>
    );
  } else if (state === "error" || !workspace) {
    content = (
      <ErrorState
        title="The preview couldn't be opened"
        message="Nothing has been changed and nothing has been published. Please try again shortly."
        onRetry={() => {
          setState("loading");
          setAnnouncement("Opening the preview.");
          setAttempt((value) => value + 1);
        }}
      />
    );
  } else {
    content = <TemplatePreviewScreen workspace={workspace} />;
  }

  return (
    <AppShell active={TEMPLATE_ROOT}>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
    </AppShell>
  );
}
