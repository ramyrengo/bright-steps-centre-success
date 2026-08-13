/**
 * The minimum frontend-facing interface Centre Standards 4A needs.
 *
 * This file is a UX-lane placeholder, not a backend contract. It describes the
 * smallest shape the completion experience requires, expressed in
 * presentation terms, so the components can be built and tested before the
 * backend exists. It deliberately guesses no database field: everything here
 * is either an opaque identifier the UI passes back untouched, or a value the
 * backend must render safe for an Educator to read.
 *
 * When Codex publishes the real endpoints, the generated client replaces these
 * types and `CentreStandardsGateway` gains one adapter. Nothing else changes.
 *
 * Two rules are encoded in the shapes below rather than left to convention:
 *
 * 1. Absence is never zero. A list is optional, and is present only when the
 *    source was actually established. `openChecks: []` means "checked, none
 *    due"; `openChecks: undefined` means "not established".
 * 2. Nothing an Educator must not see has a place to live. There is no field
 *    for severity, due days, remediation, verification, finding or
 *    corrective-action terminology, or template/version identifiers.
 */

/** Derived by the backend from pinned facts and one trusted request time. */
export type CheckTimeliness =
  | "DUE"
  | "OVERDUE"
  | "COMPLETED_ON_TIME"
  | "COMPLETED_LATE";

/**
 * What this principal may do with this occurrence, decided by the backend from
 * capability and scope. The UI never infers authority from a role name and
 * never shows a control it has not been granted.
 */
export interface CheckAuthority {
  canComplete: boolean;
  canRead: boolean;
}

export interface StandardsCheckSummary {
  /** Opaque route identifier. Passed back untouched, never displayed. */
  occurrenceId: string;
  /** Safe display name of the standard, e.g. "Centre Standards Pilot — Staging". */
  standardName: string;
  /** True for staging pilot content, which must carry the synthetic notice. */
  synthetic: boolean;
  centreId: string;
  centreName: string;
  /** Centre-local business date the occurrence belongs to. */
  businessDate: string;
  /** Presentation-ready centre-local due time, e.g. "9:00am". */
  dueLocalTime: string;
  timeliness: CheckTimeliness;
  /** Presentation-ready centre-local completion time, e.g. "7:42am". */
  completedLocalTime?: string;
  questionCount: number;
  authority: CheckAuthority;
}

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

export interface StandardsCheckDetail extends StandardsCheckSummary {
  /** Exact approved synthetic wording. Supplied by the backend, never composed
   *  in the browser, so the disclaimer cannot drift from what was approved. */
  syntheticNotice?: string;
  questions: CheckQuestion[];
  /** Present only when completed and the viewer is authorised to read answers. */
  responses?: CheckRecordedResponse[];
}

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

export type StandardsWorkspaceStatus = "ready" | "partial" | "unsupported";

export interface StandardsWorkspace {
  status: StandardsWorkspaceStatus;
  asOf: string;
  /** Open occurrences only. Absent when the source was not established, so an
   *  unavailable source can never render as "nothing due". */
  openChecks?: StandardsCheckSummary[];
  /** Names what could not be checked. Present only when something could not. */
  warning?: string;
}

/**
 * The three operations the 4A experience needs. Implemented against the
 * generated Encore client once the endpoints exist.
 */
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
      return `Completed ${check.completedLocalTime ?? ""}`.trim();
    case "COMPLETED_LATE":
      return `Completed late · ${check.completedLocalTime ?? ""}`.trim();
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
