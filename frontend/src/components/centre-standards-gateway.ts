import type { centre_standards } from "@/lib/client.generated";

import {
  CentreStandardsUnavailableError,
  type CentreStandardsGateway,
  type CheckAnswerOption,
  type CheckIdentity,
  type CheckOrigin,
  type CheckQuestion,
  type CheckRecordedResponse,
  type CompleteCheckResult,
  type OpenCheckSummary,
  type StandardsCheckDetail,
  type StandardsWorkspace,
} from "./centre-standards-contract";

/**
 * Adapts the generated Encore client onto the Centre Standards presentation
 * contract.
 *
 * The two shapes were designed independently and do not agree. The backend
 * emits one wide record per concern with optional fields; the contract uses
 * small discriminated unions so that states which must never occur cannot be
 * represented. Something has to reconcile them, and doing it here keeps the
 * narrowing in one reviewable place instead of spreading `?.` through every
 * component that renders a check.
 *
 * Where the backend is silent, the direction of the mistake decides what
 * happens:
 *
 * - **Throw where silence would overstate.** A workspace that claims to be
 *   `ready` but carries no `openChecks` would render as an empty list, and an
 *   Educator reads an empty list as "nothing is due". Pilot content arriving
 *   without its approved notice would read as real. Neither may be shown, so
 *   both reject and the surface states plainly that nothing has been assumed.
 * - **Degrade where silence would understate.** A missing `canComplete` costs
 *   the reader a button they may have been entitled to. That is a smaller harm
 *   than fabricating authority, so it resolves to `false` rather than failing.
 *
 * Rejections use `CentreStandardsUnavailableError` because that is what the
 * screens already treat as "could not be loaded". A malformed payload is not
 * meaningfully different from an unreachable one from where the reader sits.
 */

/** The slice of the generated service client this adapter uses. */
export interface CentreStandardsApi {
  getStandardsWorkspace(): Promise<centre_standards.StandardsWorkspaceResponse>;
  getStandardsCheck(
    occurrenceId: string,
  ): Promise<centre_standards.StandardsCheckDetailResponse>;
  completeStandardsOccurrence(
    occurrenceId: string,
    params: centre_standards.CompleteStandardsCheckRequest,
  ): Promise<centre_standards.CompleteStandardsCheckResponse>;
}

function reject(reason: string): never {
  throw new CentreStandardsUnavailableError(reason);
}

/** Treats whitespace as absence: a blank notice is no notice. */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function identityOf(
  source: Readonly<{
    occurrenceId: string;
    standardName: string;
    centreName: string;
    businessDate: string;
    questionCount: number;
  }>,
): CheckIdentity {
  return {
    occurrenceId: source.occurrenceId,
    standardName: source.standardName,
    centreName: source.centreName,
    businessDate: source.businessDate,
    questionCount: source.questionCount,
  };
}

/**
 * Pilot content and its notice travel together or not at all. The contract
 * makes a synthetic standard without its notice unrepresentable, and this is
 * the boundary where that becomes true of real data.
 */
function originOf(
  source: Readonly<{ synthetic: boolean; syntheticNotice?: string }>,
): CheckOrigin {
  if (!source.synthetic) return { synthetic: false };
  const syntheticNotice = text(source.syntheticNotice);
  if (!syntheticNotice) {
    reject("A staging standard arrived without its required notice.");
  }
  return { synthetic: true, syntheticNotice };
}

function optionOf(option: centre_standards.StandardsAnswerOption): CheckAnswerOption {
  const description = text(option.description);
  return {
    value: option.value,
    label: option.label,
    ...(description ? { description } : {}),
  };
}

function questionOf(question: centre_standards.StandardsQuestion): CheckQuestion {
  const instructions = text(question.instructions);
  return {
    questionId: question.questionId,
    wording: question.wording,
    ...(instructions ? { instructions } : {}),
    options: question.options.map(optionOf),
  };
}

function recordedOf(
  response: centre_standards.StandardsRecordedResponse,
): CheckRecordedResponse {
  return {
    questionId: response.questionId,
    wording: response.wording,
    answerLabel: response.answerLabel,
  };
}

function openSummaryOf(
  summary: centre_standards.OpenStandardsCheckSummary,
): OpenCheckSummary {
  return {
    ...identityOf(summary),
    ...originOf(summary),
    state: "OPEN",
    timeliness: summary.timeliness,
    dueLocalTime: summary.dueLocalTime,
    canComplete: summary.canComplete,
  };
}

export function toStandardsWorkspace(
  response: centre_standards.StandardsWorkspaceResponse,
): StandardsWorkspace {
  // `unsupported` carries no open-work field in the contract at all, so any
  // checks that came with it are dropped rather than shown: the request never
  // established the source, and a list here would imply that it had.
  if (response.status === "unsupported") return { status: "unsupported" };

  const { openChecks } = response;
  if (!openChecks) {
    reject("Centre Standards reported checks were available but returned none.");
  }
  const mapped = openChecks.map(openSummaryOf);

  if (response.status === "partial") {
    // Partial coverage without its warning would render as a complete list.
    const warning = text(response.warning);
    if (!warning) {
      reject("Centre Standards reported partial coverage without explaining it.");
    }
    return { status: "partial", openChecks: mapped, warning };
  }

  return { status: "ready", openChecks: mapped };
}

export function toStandardsCheckDetail(
  response: centre_standards.StandardsCheckDetailResponse,
): StandardsCheckDetail {
  const base = {
    ...identityOf(response),
    ...originOf(response),
    questions: response.questions.map(questionOf),
  };

  if (response.state === "OPEN") {
    if (response.timeliness !== "DUE" && response.timeliness !== "OVERDUE") {
      reject("An open check arrived with a completed timeliness.");
    }
    return {
      ...base,
      state: "OPEN",
      timeliness: response.timeliness,
      dueLocalTime: response.dueLocalTime,
      // Fails closed: an unstated authority is not an authority.
      canComplete: response.canComplete === true,
    };
  }

  if (
    response.timeliness !== "COMPLETED_ON_TIME" &&
    response.timeliness !== "COMPLETED_LATE"
  ) {
    reject("A completed check arrived with an open timeliness.");
  }
  const completedLocalTime = text(response.completedLocalTime);
  if (!completedLocalTime) {
    reject("A completed check arrived without its completion time.");
  }
  const responses = response.responses?.map(recordedOf);
  return {
    ...base,
    state: "COMPLETED",
    timeliness: response.timeliness,
    dueLocalTime: response.dueLocalTime,
    completedLocalTime,
    ...(responses ? { responses } : {}),
  };
}

export function toCompleteCheckResult(
  response: centre_standards.CompleteStandardsCheckResponse,
): CompleteCheckResult {
  // Rejecting here is safe despite the write having succeeded: completion is
  // idempotent, so a retry returns ALREADY_COMPLETED rather than a second
  // completion. Showing "Completed" with no time would be worse.
  const completedLocalTime = text(response.completedLocalTime);
  if (!completedLocalTime) {
    reject("The check was completed but no completion time was returned.");
  }

  if (response.outcome === "ALREADY_COMPLETED") {
    return {
      outcome: "ALREADY_COMPLETED",
      completedLocalTime,
      completedByRequester: response.completedByRequester === true,
    };
  }
  return {
    outcome: "COMPLETED",
    completedLocalTime,
    issueRaised: response.issueRaised === true,
  };
}

/** Binds the three operations onto a service client. */
export function createCentreStandardsGateway(
  api: CentreStandardsApi,
): CentreStandardsGateway {
  return {
    loadWorkspace: () => api.getStandardsWorkspace().then(toStandardsWorkspace),
    loadCheck: (occurrenceId) =>
      api.getStandardsCheck(occurrenceId).then(toStandardsCheckDetail),
    completeCheck: ({ occurrenceId, answers }) =>
      api
        .completeStandardsOccurrence(occurrenceId, {
          answers: answers.map((answer) => ({
            questionId: answer.questionId,
            value: answer.value,
          })),
        })
        .then(toCompleteCheckResult),
  };
}
