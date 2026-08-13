"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Bright Steps Centre Success design-system primitives.
 *
 * These are the shared building blocks for every Centre Success module. They
 * exist so a page is composed rather than styled from scratch, and so status,
 * severity and empty states read the same way everywhere.
 *
 * Severity is never carried by colour alone: each tone also renders a mark and
 * a written label.
 */

export type Tone = "neutral" | "positive" | "warning" | "critical" | "informational";

export function PageHeader({
  eyebrow,
  title,
  summary,
  meta,
  actions,
}: Readonly<{
  eyebrow?: string;
  title: string;
  summary?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <header className="page-header">
      {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
      <h1 data-page-focus tabIndex={-1}>{title}</h1>
      {summary ? <p className="page-header__summary">{summary}</p> : null}
      {meta ? <div className="page-header__meta">{meta}</div> : null}
      {actions ? <div className="card__footer">{actions}</div> : null}
    </header>
  );
}

export function Breadcrumb({
  trail,
}: Readonly<{ trail: readonly { label: string; href?: string }[] }>) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {trail.map((step, index) => (
          <li key={`${step.label}-${index}`}>
            {step.href ? (
              <Link href={step.href}>{step.label}</Link>
            ) : (
              <span aria-current="page">{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Section({
  title,
  description,
  count,
  headingLevel = 2,
  children,
}: Readonly<{
  title: string;
  description?: string;
  count?: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
}>) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section__header">
        <div>
          <Heading id={headingId}>{title}</Heading>
          {description ? <p>{description}</p> : null}
        </div>
        {count ? <span className="section__count">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A status badge. `label` is the accessible, written state; the mark supplied
 * by CSS is decoration on top of it, so the state never depends on colour.
 */
export function StatusBadge({
  tone = "neutral",
  children,
}: Readonly<{ tone?: Tone; children: ReactNode }>) {
  return <span className="status-pill" data-tone={tone}>{children}</span>;
}

export function Metric({
  label,
  value,
  note,
  emphasis = false,
  unavailable = false,
}: Readonly<{
  label: string;
  value: ReactNode;
  note?: string;
  emphasis?: boolean;
  unavailable?: boolean;
}>) {
  return (
    <div className={`metric${emphasis ? " metric--emphasis" : ""}`}>
      <dt className="metric__label">{label}</dt>
      <dd className="metric__value" data-unavailable={unavailable ? "true" : undefined}>
        {value}
      </dd>
      {note ? <p className="metric__note">{note}</p> : null}
    </div>
  );
}

export function MetricRow({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className="metric-row">{children}</dl>;
}

/**
 * Trend indicator. The direction word is always rendered for assistive
 * technology; the arrow is decorative.
 */
export function Trend({
  direction,
  children,
}: Readonly<{
  direction: "IMPROVED" | "DECLINED" | "STEADY" | "NOT_COMPARABLE";
  children: ReactNode;
}>) {
  const spoken = {
    IMPROVED: "Improved",
    DECLINED: "Declined",
    STEADY: "Steady",
    NOT_COMPARABLE: "Not comparable",
  }[direction];
  return (
    <span className="trend" data-direction={direction}>
      <span className="visually-hidden">{spoken}. </span>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  message,
  mark = "—",
  action,
}: Readonly<{ title: string; message: string; mark?: string; action?: ReactNode }>) {
  const titleId = useId();
  return (
    <section className="state-panel state-panel--empty" aria-labelledby={titleId}>
      <span className="state-panel__mark" aria-hidden="true">{mark}</span>
      <h2 id={titleId}>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: Readonly<{ title: string; message: string; onRetry?: () => void }>) {
  const titleId = useId();
  return (
    <section className="state-panel state-panel--error" aria-labelledby={titleId} role="alert">
      <h2 id={titleId} data-page-focus tabIndex={-1}>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

/** A calm loading placeholder that reserves the shape of the content to come. */
export function LoadingSkeleton({
  label,
  rows = 3,
}: Readonly<{ label: string; rows?: number }>) {
  return (
    <div className="state-panel" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton" aria-hidden="true">
        <span className="skeleton__bar skeleton__bar--title" />
        {Array.from({ length: rows }, (_, index) => (
          <span
            key={index}
            className={`skeleton__bar${index % 3 === 2 ? " skeleton__bar--short" : " skeleton__bar--wide"}`}
          />
        ))}
      </div>
    </div>
  );
}

export function Notice({
  title,
  children,
}: Readonly<{ title: string; children?: ReactNode }>) {
  return (
    <p className="notice" role="status">
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </p>
  );
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (next: T) => void;
}>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A responsive record list. It is a real list on narrow screens and an aligned
 * grid on wide ones, so dense information never becomes an unreadable table.
 */
export function DataList({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return <ul className="data-list" aria-label={label} role="list">{children}</ul>;
}

export function DataListRow({
  title,
  severity = "neutral",
  badge,
  facts,
  action,
  headingLevel,
}: Readonly<{
  title: string;
  severity?: "critical" | "warning" | "neutral";
  badge?: ReactNode;
  facts: readonly { term: string; value: string }[];
  action?: ReactNode;
  /** Render the title as a real heading when the row names a record. */
  headingLevel?: 3 | 4;
}>) {
  const Title = headingLevel === 3 ? "h3" : headingLevel === 4 ? "h4" : "p";
  return (
    <li className="data-list__row" data-severity={severity}>
      <div className="data-list__primary">
        {badge}
        <Title className="data-list__title">{title}</Title>
      </div>
      <dl className="data-list__facts">
        {facts.map((fact) => (
          <div key={fact.term}>
            <dt>{fact.term}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {action}
    </li>
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * A modal dialog with a real focus trap.
 *
 * Focus enters the dialog on open, cycles inside it while it is open, Escape
 * dismisses it, and focus returns to the control that opened it. This closes
 * the Milestone 3A follow-up that recorded dialogs as not focus-trapping.
 *
 * Mark the element that should receive initial focus with `data-autofocus`;
 * otherwise the first focusable element is used.
 */
export function Dialog({
  eyebrow,
  title,
  onDismiss,
  children,
  footer,
}: Readonly<{
  eyebrow?: string;
  title: string;
  onDismiss: () => void;
  children: ReactNode;
  footer: ReactNode;
}>) {
  const titleId = useId();
  const surface = useRef<HTMLElement>(null);

  // Move focus in on open and hand it back to the opening control on close.
  useEffect(() => {
    const node = surface.current;
    const opener = document.activeElement as HTMLElement | null;
    const first = node?.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? first)?.focus();
    return () => opener?.focus?.();
  }, []);

  // Trap Tab inside the dialog and let Escape dismiss it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const node = surface.current;
      const items = Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  return (
    <div className="workflow-dialog-backdrop">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="workflow-dialog workflow-stack"
        ref={surface}
        role="dialog"
      >
        <div>
          {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
        {children}
        <div className="people-actions">{footer}</div>
      </section>
    </div>
  );
}

/** A short reason explaining why a control is unavailable, tied to it by id. */
/**
 * A single assessed answer, rendered as a set of large targets.
 *
 * Built on native radios so keyboard operation, arrow-key movement, the
 * accessible selected state and forced-colors support all come from the
 * platform rather than being re-implemented. The visible target is the label,
 * which is what makes a 56px one-handed control possible without abandoning
 * real form semantics.
 *
 * It is deliberately not a form framework: it renders permitted options for
 * one question and reports the chosen opaque value.
 */
export function AnswerControl({
  legend,
  name,
  options,
  value,
  onChange,
  disabled = false,
  instructions,
  takeFocus = false,
}: Readonly<{
  legend: string;
  name: string;
  options: readonly { value: string; label: string; description?: string }[];
  value: string | undefined;
  onChange: (next: string) => void;
  disabled?: boolean;
  instructions?: string;
  /**
   * Moves focus to the group when it mounts.
   *
   * A one-question-at-a-time flow replaces the question in place while the
   * step controls keep their position, so a screen-reader or keyboard user is
   * left focused on a "Next" button with no signal that the question beneath
   * it changed. Focusing the group makes the platform read the new question
   * and its options, which is what a sighted reader gets for free.
   *
   * It is off for the first question so arriving on the screen does not yank
   * focus past the heading that says which check this is.
   */
  takeFocus?: boolean;
}>) {
  const instructionsId = useId();
  const group = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (takeFocus) group.current?.focus();
  }, [takeFocus]);

  return (
    <fieldset
      className="answer-control"
      ref={group}
      // Only a programmatic target: it must never become a Tab stop, which
      // would put an extra silent stop in front of every question.
      {...(takeFocus ? { tabIndex: -1 } : {})}
      {...(instructions ? { "aria-describedby": instructionsId } : {})}
    >
      <legend className="answer-control__legend">{legend}</legend>
      {instructions ? (
        <p className="answer-control__instructions" id={instructionsId}>
          {instructions}
        </p>
      ) : null}
      <div className="answer-control__options">
        {options.map((option) => (
          <label className="answer-option" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="answer-option__mark" aria-hidden="true" />
            <span className="answer-option__body">
              <span className="answer-option__label">{option.label}</span>
              {option.description ? (
                <span className="answer-option__description">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Position within a check. The written count is the accessible source of truth. */
export function CheckProgress({
  current,
  total,
}: Readonly<{ current: number; total: number }>) {
  return (
    <div className="check-progress">
      <p className="check-progress__text">
        Question {current} of {total}
      </p>
      <div className="check-progress__track" aria-hidden="true">
        {/* The question in hand is "current", never "done". Filling it as done
            told the reader they had answered one more question than they had,
            which on the last step reads as a finished check. */}
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className="check-progress__step"
            data-state={
              index < current - 1 ? "done" : index === current - 1 ? "current" : "todo"
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The screen a completed check lands on. Completion is a destination, never a
 * toast: an educator who looked away must still be able to tell it worked.
 */
export function CompletionState({
  title,
  message,
  detail,
  action,
}: Readonly<{
  title: string;
  message: string;
  detail?: string;
  action?: ReactNode;
}>) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // Completion replaces the form, so focus must be moved deliberately rather
  // than left on a control that no longer exists. Without this, a keyboard or
  // screen-reader user is dropped at the top of the document with no idea the
  // check succeeded.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="completion-state" aria-labelledby={titleId} role="status">
      <span className="completion-state__mark" aria-hidden="true">✓</span>
      <h1 id={titleId} ref={heading} data-page-focus tabIndex={-1}>{title}</h1>
      <p className="completion-state__message">{message}</p>
      {detail ? <p className="completion-state__detail">{detail}</p> : null}
      {action ? <div className="completion-state__action">{action}</div> : null}
    </section>
  );
}

export function DisabledReason({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return <p className="metric__note" id={id}>{children}</p>;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(new Date(value));
}

export function formatScore(value: number | undefined): string {
  return value === undefined ? "Not recorded" : value.toFixed(1).replace(/\.0$/u, "");
}
