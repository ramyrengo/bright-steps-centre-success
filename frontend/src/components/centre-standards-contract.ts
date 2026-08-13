/**
 * The minimum frontend-facing interface Centre Standards 4A needs.
 *
 * This file is a UX-lane placeholder, not a backend contract. It describes the
 * smallest shape the completion experience requires, expressed in presentation
 * terms, so the components can be built and tested before the backend exists.
 * It deliberately guesses no database field: everything here is either an
 * opaque identifier the UI passes back untouched, or a value the backend must
 * render safe for an Educator to read.
 *
 * The shapes are small discriminated unions rather than one wide optional
 * record, so the states that must never occur are unrepresentable:
 *
 * - a `COMPLETED` occurrence cannot carry completion authority;
 * - an `OPEN` occurrence cannot carry recorded responses;
 * - a synthetic standard cannot omit its notice;
 * - `unsupported` cannot carry an open-work assertion at all.
 *
 * Absence is never zero. `openChecks` is present only where the source was
 * actually established, and an empty array under `partial` coverage still may
 * not be rendered as an all-clear.
 */

/** Identity shared by every occurrence shape. */
export interface CheckIdentity {
  /** Opaque route identifier. Passed back untouched, never displayed. */
  occurrenceId: string;
  /** Safe display name, e.g. "Centre Standards Pilot — Staging". */
  standardName: string;
  centreName: string;
  /** Centre-local business date, `YYYY-MM-DD`. */
  businessDate: string;
  questionCount: number;
}

/**
 * Staging pilot content must carry its approved notice, so the two travel
 * together. The wording comes from the backend and is never composed in the
 * browser, which is what stops the disclaimer drifting from what was approved.
 */
export type CheckOrigin =
  | { synthetic: true; syntheticNotice: string }
  | { synthetic: false };

/**
 * `canComplete` exists only while an occurrence is open, so a completed check
 * cannot claim completion authority. There is no `canRead`: an occurrence the
 * viewer may not read is not returned at all.
 */
export interface OpenCheckState {
  state: "OPEN";
  timeliness: "DUE" | "OVERDUE";
  /** Presentation-ready centre-local time, e.g. "9:00am". */
  dueLocalTime: string;
  canComplete: boolean;
}

export interface CompletedCheckState {
  state: "COMPLETED";
  timeliness: "COMPLETED_ON_TIME" | "COMPLETED_LATE";
  dueLocalTime: string;
  completedLocalTime: string;
}

export type CheckTimeliness =
  | OpenCheckState["timeliness"]
  | CompletedCheckState["timeliness"];

/** An open occurrence as the landing list shows it. */
export type OpenCheckSummary = CheckIdentity & CheckOrigin & OpenCheckState;

export type StandardsCheckSummary =
  | OpenCheckSummary
  | (CheckIdentity & CheckOrigin & CompletedCheckState);

/** One permitted answer. `value` is opaque; only `label` is ever shown. */
export interface CheckAnswerOption {
  value: string;
  label: string;
  description?: string;
}

export interface CheckQuestion {
  questionId: string;
  wording: string;
  instructions?: string;
  options: CheckAnswerOption[];
}

export interface CheckRecordedResponse {
  questionId: string;
  wording: string;
  answerLabel: string;
}

/** Recorded responses exist only on a completed occurrence, and only where the
 *  viewer is authorised to read them. */
export type StandardsCheckDetail =
  | (CheckIdentity & CheckOrigin & OpenCheckState & { questions: CheckQuestion[] })
  | (CheckIdentity &
      CheckOrigin &
      CompletedCheckState & {
        questions: CheckQuestion[];
        responses?: CheckRecordedResponse[];
      });

export interface CheckAnswer {
  questionId: string;
  value: string;
}

/**
 * The result of the atomic completion command.
 *
 * `ALREADY_COMPLETED` is a success-shaped outcome, not an error. The most
 * likely real-world failure is a committed submission whose response was lost
 * in transit; telling that Educator they failed would be wrong.
 */
export type CompleteCheckResult =
  | {
      outcome: "COMPLETED";
      completedLocalTime: string;
      /** True when the approved outcome configuration raised follow-up work.
       *  The UI states that an issue was raised and nothing more. */
      issueRaised: boolean;
    }
  | {
      outcome: "ALREADY_COMPLETED";
      completedLocalTime: string;
      completedByRequester: boolean;
    };

/**
 * `unsupported` carries no open-work field at all, so it cannot assert
 * anything about work the request never looked for. `partial` always carries a
 * warning, and its `openChecks` are the checks that *were* established — never
 * evidence that no others exist.
 */
export type StandardsWorkspace =
  | { status: "ready"; openChecks: OpenCheckSummary[] }
  | { status: "partial"; openChecks: OpenCheckSummary[]; warning: string }
  | { status: "unsupported" };

/** The three operations the 4A experience needs. */
export interface CentreStandardsGateway {
  loadWorkspace(): Promise<StandardsWorkspace>;
  loadCheck(occurrenceId: string): Promise<StandardsCheckDetail>;
  completeCheck(input: {
    occurrenceId: string;
    answers: readonly CheckAnswer[];
  }): Promise<CompleteCheckResult>;
}

/** Distinguishes a recoverable submission failure from a refusal. */
export class CentreStandardsUnavailableError extends Error {
  constructor(message = "Centre Standards is temporarily unavailable") {
    super(message);
    this.name = "CentreStandardsUnavailableError";
  }
}

/**
 * The default gateway until the backend lane lands. It refuses honestly rather
 * than inventing data, so the routes are wired and reviewable without any
 * fabricated Centre Standards record existing anywhere.
 */
export const backendNotAvailableGateway: CentreStandardsGateway = {
  loadWorkspace: () => Promise.reject(new CentreStandardsUnavailableError()),
  loadCheck: () => Promise.reject(new CentreStandardsUnavailableError()),
  completeCheck: () => Promise.reject(new CentreStandardsUnavailableError()),
};

/** Presentation-ready timeliness wording, shared by every Centre Standards surface. */
export function timelinessLabel(check: StandardsCheckSummary): string {
  switch (check.timeliness) {
    case "DUE":
      return `Due by ${check.dueLocalTime}`;
    case "OVERDUE":
      return "Overdue";
    case "COMPLETED_ON_TIME":
      return `Completed ${check.completedLocalTime}`;
    case "COMPLETED_LATE":
      return `Completed late · ${check.completedLocalTime}`;
  }
}

export function timelinessTone(
  timeliness: CheckTimeliness,
): "neutral" | "warning" | "critical" | "positive" {
  switch (timeliness) {
    case "DUE":
      return "neutral";
    case "OVERDUE":
      return "critical";
    case "COMPLETED_ON_TIME":
      return "positive";
    case "COMPLETED_LATE":
      return "warning";
  }
}

/** Renders the stored business date as a person would say it. */
export function businessDateLabel(businessDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) return businessDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
