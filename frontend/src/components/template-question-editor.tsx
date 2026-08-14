"use client";

import { useCallback, useId } from "react";

import {
  QUESTION_TYPE_HINT,
  QUESTION_TYPE_LABEL,
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
    case "DATE":
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

          {question.type === "NUMBER" ? (
            <label className="builder-field">
              <span className="builder-field__label">Unit (optional)</span>
              <input
                type="text"
                value={question.unitLabel ?? ""}
                placeholder="e.g. children, degrees"
                onChange={(event) => {
                  // Cleared means cleared. Spreading `{}` for the empty case
                  // would leave the previous unit in place and silently label
                  // the answer with a unit the author had just deleted.
                  const unitLabel = event.target.value;
                  onChange({ ...question, unitLabel: unitLabel || undefined });
                }}
              />
            </label>
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
        {question.type === "NUMBER" && question.unitLabel ? ` (${question.unitLabel})` : ""}
        {" · "}
        {question.required ? "Must be answered" : "Optional"}
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
