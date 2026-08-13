"use client";

import Link from "next/link";

import { StatusBadge } from "./design-system";
import { businessDateLabel } from "./centre-standards-contract";

/**
 * Presentation for the two places Centre Standards appears inside surfaces it
 * does not own: a Daily Success occurrence card, and the origin line on a
 * corrective action.
 *
 * Everything here takes explicit typed props and holds no state. No Daily
 * Success business logic is touched and no action contract is changed — these
 * are the components those surfaces will render once Codex exposes the fields,
 * built now so the wiring is a prop mapping rather than a design exercise.
 */

/* ------------------------------------------------------------------ *
 * Daily Success occurrence card
 * ------------------------------------------------------------------ */

/** Daily Success requires every card to say why it is present. */
export type OccurrenceWhyShown = "CHECK_DUE_TODAY" | "CHECK_OVERDUE";

export type OccurrenceResponsibility =
  | "YOU_NEED_TO_ACT"
  | "YOUR_CENTRE_NEEDS_TO_ACT";

export interface DailyOccurrenceCta {
  label: string;
  route: string;
}

/**
 * Resolves the card's call to action from backend-supplied authority.
 *
 * Both authorities lead to the same occurrence route, which resolves the
 * surface server-side from current capability. That is deliberate: routing a
 * reader to a completion-only destination would land them on a denial, which
 * ADR-0018 forbids. Only the label differs, so the reader knows what they are
 * about to get.
 */
export function occurrenceCta(input: {
  occurrenceId: string;
  canComplete: boolean;
}): DailyOccurrenceCta {
  return {
    label: input.canComplete ? "Start check" : "View check",
    route: `/standards/checks/${input.occurrenceId}`,
  };
}

export interface DailyOccurrenceCardProps {
  standardName: string;
  /** Present on portfolio and oversight perspectives, absent on a centre view. */
  centreName?: string;
  whyShown: OccurrenceWhyShown;
  responsibility: OccurrenceResponsibility;
  /** Presentation-ready centre-local time, e.g. "9:00am". */
  dueLocalTime: string;
  cta: DailyOccurrenceCta;
}

const WHY_SHOWN_LABEL: Record<OccurrenceWhyShown, string> = {
  CHECK_DUE_TODAY: "Due today",
  CHECK_OVERDUE: "Overdue",
};

const RESPONSIBILITY_LABEL: Record<OccurrenceResponsibility, string> = {
  YOU_NEED_TO_ACT: "You need to act",
  YOUR_CENTRE_NEEDS_TO_ACT: "Your centre needs to act",
};

/**
 * One open occurrence as a Daily Success card.
 *
 * Only open occurrences reach this component. A completed check is no longer
 * active work, and any issue it raised travels through the existing
 * corrective-action source instead — so the same underlying problem is never
 * two cards at once.
 */
export function DailyOccurrenceCard({
  standardName,
  centreName,
  whyShown,
  responsibility,
  dueLocalTime,
  cta,
}: Readonly<DailyOccurrenceCardProps>) {
  const overdue = whyShown === "CHECK_OVERDUE";
  return (
    <article className="daily-occurrence" data-why={whyShown}>
      <div className="daily-occurrence__head">
        <StatusBadge tone={overdue ? "critical" : "neutral"}>
          {WHY_SHOWN_LABEL[whyShown]}
        </StatusBadge>
        <span className="daily-occurrence__responsibility">
          {RESPONSIBILITY_LABEL[responsibility]}
        </span>
      </div>
      <h3 className="daily-occurrence__title">{standardName}</h3>
      <p className="daily-occurrence__meta">
        {centreName ? `${centreName} · ` : ""}
        {overdue ? `Was due by ${dueLocalTime}` : `Due by ${dueLocalTime}`}
      </p>
      <Link className="button button--secondary" href={cta.route}>
        {cta.label}
        <span className="visually-hidden"> — {standardName}</span>
      </Link>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Corrective-action origin
 * ------------------------------------------------------------------ */

/**
 * Where a corrective action came from, as a discriminated union.
 *
 * The audit branch is the only one carrying audit properties. An operational
 * action has no acknowledgement, no audit identifier and no audit status, and
 * this shape gives those fields nowhere to live rather than emitting them as
 * meaningless `null` or `false`.
 *
 * Internal source-family enum names never reach the reader: the labels are
 * "Quarterly review" and "Centre Standard".
 */
export type ActionOrigin =
  | {
      source: "QUARTERLY_AUDIT";
      /** e.g. "Q2 2026" — already formatted by the review module. */
      quarterLabel: string;
      /** Present only where the reader is authorised to open the review. */
      route?: string;
      acknowledged?: boolean;
    }
  | {
      source: "OPERATIONAL_CHECK";
      standardName: string;
      /** Centre-local business date of the check, `YYYY-MM-DD`. */
      businessDate: string;
      synthetic: boolean;
      /** Present only where the reader is authorised to open the occurrence. */
      route?: string;
    };

export function actionOriginLabel(origin: ActionOrigin): string {
  return origin.source === "QUARTERLY_AUDIT" ? "Quarterly review" : "Centre Standard";
}

function originDetail(origin: ActionOrigin): string {
  return origin.source === "QUARTERLY_AUDIT"
    ? `From the ${origin.quarterLabel} quarterly review`
    : `From the ${origin.standardName} check on ${businessDateLabel(origin.businessDate)}`;
}

/**
 * The origin line on a corrective action. It states where the work came from
 * without assuming every action came from a quarterly review, and links only
 * where the reader is authorised for the source.
 */
export function ActionOriginLine({ origin }: Readonly<{ origin: ActionOrigin }>) {
  const detail = originDetail(origin);
  return (
    <p className="action-origin">
      <StatusBadge tone="informational">{actionOriginLabel(origin)}</StatusBadge>
      {origin.route ? (
        <Link href={origin.route}>{detail}</Link>
      ) : (
        <span>{detail}</span>
      )}
      {origin.source === "OPERATIONAL_CHECK" && origin.synthetic ? (
        <span className="action-origin__synthetic">Staging test content</span>
      ) : null}
      {origin.source === "QUARTERLY_AUDIT" && origin.acknowledged === false ? (
        <span className="action-origin__note">Review not yet acknowledged</span>
      ) : null}
    </p>
  );
}
