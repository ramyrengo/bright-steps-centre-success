"use client";

import { useCallback, useId } from "react";

import {
  QUESTION_TYPE_HINT,
  QUESTION_TYPE_LABEL,
  calendarDateLabel,
  isChoiceQuestion,
  type DraftChoice,
  type DraftQuestion,
  type QuestionType,
} from "./template-builder-contract";

/**
 * Editing one question, and the ordering control every ordered list here uses.
 *
 * Ordering is done with Move up / Move down buttons rather than drag and drop.
 * That is a deliberate accessibility decision, not a shortcut: a drag surface
 * needs a parallel keyboard mechanism, a live region and pointer-cancel
 * handling before it is usable at all, and an Area Manager reordering a
 * fifteen-question form on a phone is better served by a target they can hit
 * than by a gesture they have to hold.
 */

export const QUESTION_TYPES: readonly QuestionType[] = [
  "YES_NO",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "TEXT",
  "NUMBER",
  "TIME",
  "DATE",
];

/**
 * The same question with a different answer type.
 *
 * Each branch builds a whole question rather than a shape to be merged, so the
 * result is a concrete member of the union at every return: there is no point
 * at which a half-built question with the wrong fields for its type exists.
 *
 * Switching between the two choice types keeps the options the author already
 * wrote — only how many may be picked has changed.
 */
export function questionWithType(question: DraftQuestion, type: QuestionType): DraftQuestion {
  const base: {
    questionId: string;
    wording: string;
    required: boolean;
    guidance?: string;
  } = {
    questionId: question.questionId,
    wording: question.wording,
    required: question.required,
    guidance: question.guidance,
  };
  switch (type) {
    case "YES_NO":
      return { ...base, type: "YES_NO" };
    case "TIME":
      return { ...base, type: "TIME" };
    case "DATE":
      // Bounds are not carried over from another type. Nothing else in the
      // union holds a calendar date, so there is nothing to preserve, and
      // inventing one would put a bound on the question the author never set.
      return { ...base, type: "DATE" };
    case "TEXT":
      return { ...base, type: "TEXT", multiline: false };
    case "NUMBER":
      return { ...base, type: "NUMBER" };
    case "SINGLE_SELECT":
      return {
        ...base,
        type: "SINGLE_SELECT",
        choices: isChoiceQuestion(question) ? question.choices : [newChoice(), newChoice()],
      };
    case "MULTI_SELECT":
      return {
        ...base,
        type: "MULTI_SELECT",
        choices: isChoiceQuestion(question) ? question.choices : [newChoice(), newChoice()],
      };
  }
}

/** The same choice question with different options. */
function withChoices(question: DraftQuestion, choices: DraftChoice[]): DraftQuestion {
  if (question.type === "SINGLE_SELECT") return { ...question, choices };
  if (question.type === "MULTI_SELECT") return { ...question, choices };
  return question;
}

/**
 * The same date question with different bounds.
 *
 * Rebuilt rather than spread over the old question: a cleared bound has to
 * disappear, and `{ ...question, ...(next ? { earliest: next } : {}) }` would
 * leave the old value standing whenever the author emptied the field.
 */
function withDateBounds(
  question: DraftQuestion,
  bounds: { earliest?: string; latest?: string },
): DraftQuestion {
  if (question.type !== "DATE") return question;
  return {
    questionId: question.questionId,
    wording: question.wording,
    required: question.required,
    ...(question.guidance ? { guidance: question.guidance } : {}),
    type: "DATE",
    ...(bounds.earliest ? { earliest: bounds.earliest } : {}),
    ...(bounds.latest ? { latest: bounds.latest } : {}),
  };
}

let choiceCounter = 0;
export function newChoice(): DraftChoice {
  choiceCounter += 1;
  return { choiceId: `choice-${choiceCounter}`, label: "" };
}

let questionCounter = 0;
export function newQuestion(): DraftQuestion {
  questionCounter += 1;
  return {
    questionId: `question-${questionCounter}`,
    wording: "",
    required: true,
    type: "YES_NO",
  };
}

let sectionCounter = 0;
export function newSectionId(): string {
  sectionCounter += 1;
  return `section-${sectionCounter}`;
}

/**
 * Move up / move down for one item in an ordered list.
 *
 * `label` names what is being moved, so a screen reader hears "Move question 2
 * up" rather than six identical "Move up" buttons.
 */
export function OrderControls({
  label,
  position,
  total,
  onMove,
  disabled = false,
}: Readonly<{
  label: string;
  position: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  disabled?: boolean;
}>) {
  return (
    <div className="order-controls" role="group" aria-label={`Reorder ${label}`}>
      <button
        className="order-controls__button"
        type="button"
        onClick={() => onMove(-1)}
        disabled={disabled || position === 0}
      >
        <span aria-hidden="true">↑</span>
        <span className="visually-hidden">Move {label} up</span>
      </button>
      <span className="order-controls__position" aria-hidden="true">
        {position + 1}
      </span>
      <button
        className="order-controls__button"
        type="button"
        onClick={() => onMove(1)}
        disabled={disabled || position === total - 1}
      >
        <span aria-hidden="true">↓</span>
        <span className="visually-hidden">Move {label} down</span>
      </button>
    </div>
  );
}

/** The options on a choice question. */
function ChoiceEditor({
  choices,
  onChange,
  fieldPrefix,
}: Readonly<{
  choices: readonly DraftChoice[];
  onChange: (next: DraftChoice[]) => void;
  fieldPrefix: string;
}>) {
  const update = useCallback(
    (choiceId: string, label: string) => {
      onChange(
        choices.map((choice) => (choice.choiceId === choiceId ? { ...choice, label } : choice)),
      );
    },
    [choices, onChange],
  );

  return (
    <div className="builder-choices">
      <p className="builder-field__label" id={`${fieldPrefix}-choices`}>
        Options
      </p>
      <ul className="builder-choices__list" role="list" aria-labelledby={`${fieldPrefix}-choices`}>
        {choices.map((choice, index) => (
          <li className="builder-choice" key={choice.choiceId}>
            <label className="visually-hidden" htmlFor={`${fieldPrefix}-choice-${index}`}>
              Option {index + 1}
            </label>
            <input
              id={`${fieldPrefix}-choice-${index}`}
              type="text"
              value={choice.label}
              placeholder={`Option ${index + 1}`}
              onChange={(event) => update(choice.choiceId, event.target.value)}
            />
            <button
              className="builder-choice__remove"
              type="button"
              // Two options is the floor: a choice question with one option is
              // not a question. The control disappears rather than refusing,
              // so nothing offers an action it will not take.
              disabled={choices.length <= 2}
              onClick={() =>
                onChange(choices.filter((item) => item.choiceId !== choice.choiceId))
              }
            >
              <span aria-hidden="true">×</span>
              <span className="visually-hidden">
                Remove option {index + 1}
                {choice.label.trim() ? `, ${choice.label}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button button--secondary builder-choices__add"
        type="button"
        onClick={() => onChange([...choices, newChoice()])}
      >
        Add option
      </button>
    </div>
  );
}

/**
 * The optional window a date answer must fall inside.
 *
 * Both bounds are optional and independent — an author who only cares that the
 * date is not in the past sets the earliest and leaves the latest alone. Native
 * `date` inputs are used rather than a hand-built calendar so the platform's own
 * picker, keyboard handling and locale formatting are inherited; the value they
 * carry is `YYYY-MM-DD`, which is exactly what the backend stores.
 *
 * Clearing a field removes the bound rather than sending an empty string, so a
 * bound an author deleted is genuinely gone.
 */
function DateBoundsEditor({
  earliest,
  latest,
  onChange,
  fieldPrefix,
  questionName,
}: Readonly<{
  earliest?: string;
  latest?: string;
  onChange: (next: { earliest?: string; latest?: string }) => void;
  fieldPrefix: string;
  questionName: string;
}>) {
  return (
    <div className="builder-field-row">
      <label className="builder-field" htmlFor={`${fieldPrefix}-earliest`}>
        <span className="builder-field__label">
          Earliest date allowed (optional)
          <span className="visually-hidden"> — {questionName}</span>
        </span>
        <input
          id={`${fieldPrefix}-earliest`}
          type="date"
          value={earliest ?? ""}
          max={latest}
          onChange={(event) =>
            onChange({ earliest: event.target.value || undefined, latest })
          }
        />
      </label>
      <label className="builder-field" htmlFor={`${fieldPrefix}-latest`}>
        <span className="builder-field__label">
          Latest date allowed (optional)
          <span className="visually-hidden"> — {questionName}</span>
        </span>
        <input
          id={`${fieldPrefix}-latest`}
          type="date"
          value={latest ?? ""}
          min={earliest}
          onChange={(event) =>
            onChange({ earliest, latest: event.target.value || undefined })
          }
        />
      </label>
    </div>
  );
}

/**
 * One question in the draft editor.
 *
 * The type picker is a native `<select>`. It has six options, it is used once
 * per question, and on a phone the platform picker beats six radio targets
 * competing with the question wording for the same screen.
 */
export function QuestionEditor({
  question,
  position,
  total,
  sectionTitle,
  onChange,
  onMove,
  onRemove,
}: Readonly<{
  question: DraftQuestion;
  position: number;
  total: number;
  sectionTitle: string;
  onChange: (next: DraftQuestion) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}>) {
  const field = useId();
  const name = `Question ${position + 1}`;

  return (
    <li className="builder-question">
      <div className="builder-question__head">
        <OrderControls
          label={`${name} in ${sectionTitle || "this section"}`}
          position={position}
          total={total}
          onMove={onMove}
        />
        <div className="builder-question__body">
          <label className="builder-field">
            <span className="builder-field__label">{name}</span>
            <input
              type="text"
              value={question.wording}
              placeholder="What should the person answering be asked?"
              onChange={(event) => onChange({ ...question, wording: event.target.value })}
            />
          </label>

          <div className="builder-field-row">
            <label className="builder-field">
              <span className="builder-field__label">Answer type</span>
              <select
                value={question.type}
                onChange={(event) =>
                  onChange(questionWithType(question, event.target.value as QuestionType))
                }
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUESTION_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </label>

            {/* Required is a checkbox, not a two-state toggle: it is a single
                fact that is either true or false, and the platform checkbox
                announces it correctly without any help. */}
            <label className="builder-toggle">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(event) => onChange({ ...question, required: event.target.checked })}
              />
              <span>
                Must be answered
                <span className="visually-hidden"> — {name}</span>
              </span>
            </label>
          </div>

          <p className="builder-field__hint">{QUESTION_TYPE_HINT[question.type]}</p>

          {question.type === "TEXT" ? (
            <label className="builder-toggle">
              <input
                type="checkbox"
                checked={question.multiline}
                onChange={(event) =>
                  onChange({ ...question, type: "TEXT", multiline: event.target.checked })
                }
              />
              <span>
                Room for a longer answer
                <span className="visually-hidden"> — {name}</span>
              </span>
            </label>
          ) : null}

          {/* A number question carried a unit here. The backend stores no unit
              on a question, so the field was offering an author something that
              would vanish the next time they opened the draft. Where a unit
              matters it belongs in the guidance below, which is stored. */}

          {question.type === "DATE" ? (
            <DateBoundsEditor
              earliest={question.earliest}
              latest={question.latest}
              fieldPrefix={field}
              questionName={name}
              onChange={(bounds) => onChange(withDateBounds(question, bounds))}
            />
          ) : null}

          {isChoiceQuestion(question) ? (
            <ChoiceEditor
              choices={question.choices}
              fieldPrefix={field}
              onChange={(choices) => onChange(withChoices(question, choices))}
            />
          ) : null}

          <label className="builder-field">
            <span className="builder-field__label">Guidance (optional)</span>
            <input
              type="text"
              value={question.guidance ?? ""}
              placeholder="Anything the person answering needs to know"
              onChange={(event) =>
                onChange({ ...question, guidance: event.target.value || undefined })
              }
            />
          </label>

          <button className="builder-remove" type="button" onClick={onRemove}>
            Remove
            <span className="visually-hidden">
              {" "}
              {name}
              {question.wording.trim() ? `, ${question.wording}` : ""}
            </span>
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * The window a date answer must fall inside, in words.
 *
 * Absent when neither bound is set, and honest about a one-sided window rather
 * than inventing the other end. An unreadable bound yields no phrase at all, so
 * a malformed stored value never reaches a reader as "Invalid Date".
 */
export function dateBoundsLabel(question: DraftQuestion): string | undefined {
  if (question.type !== "DATE") return undefined;
  const from = question.earliest ? calendarDateLabel(question.earliest) : undefined;
  const to = question.latest ? calendarDateLabel(question.latest) : undefined;
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return undefined;
}

/** A question as a published, immutable version shows it. */
export function QuestionRecord({
  question,
  position,
}: Readonly<{ question: DraftQuestion; position: number }>) {
  return (
    <li className="question-record">
      <p className="question-record__wording">
        <span className="question-record__number" aria-hidden="true">
          {position + 1}.
        </span>
        {question.wording}
      </p>
      {question.guidance ? (
        <p className="question-record__guidance">{question.guidance}</p>
      ) : null}
      <p className="question-record__meta">
        {QUESTION_TYPE_LABEL[question.type]}
        {" · "}
        {question.required ? "Must be answered" : "Optional"}
        {/* A bound is part of what was published, so the permanent record
            states it. Omitted entirely when there is none, rather than shown
            as an open-ended range the author never set. */}
        {question.type === "DATE" && dateBoundsLabel(question) ? (
          <>
            {" · "}
            {dateBoundsLabel(question)}
          </>
        ) : null}
      </p>
      {isChoiceQuestion(question) ? (
        <ul className="question-record__choices" role="list">
          {question.choices.map((choice) => (
            <li key={choice.choiceId}>{choice.label}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
