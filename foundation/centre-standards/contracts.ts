import type { Header } from "encore.dev/api";
import type { OperationalTimeliness } from "./types";

export interface OpenStandardsCheckSummary {
  occurrenceId: string;
  standardName: string;
  synthetic: boolean;
  syntheticNotice?: string;
  centreName: string;
  businessDate: string;
  dueLocalTime: string;
  timeliness: "DUE" | "OVERDUE";
  questionCount: number;
  state: "OPEN";
  canComplete: boolean;
}

interface StandardsWorkspaceBase {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
}

export interface StandardsWorkspaceResponse extends StandardsWorkspaceBase {
  status: "ready" | "partial" | "unsupported";
  openChecks?: OpenStandardsCheckSummary[];
  warning?: string;
}

export interface StandardsAnswerOption {
  /** Opaque permitted outcome value, passed back untouched by the browser. */
  value: string;
  label: string;
  description?: string;
}

export interface StandardsQuestion {
  questionId: string;
  wording: string;
  instructions?: string;
  options: StandardsAnswerOption[];
}

export interface StandardsRecordedResponse {
  questionId: string;
  wording: string;
  answerLabel: string;
}

export interface StandardsCheckDetailResponse {
  cacheControl: Header<"Cache-Control">;
  occurrenceId: string;
  standardName: string;
  synthetic: boolean;
  syntheticNotice?: string;
  centreName: string;
  businessDate: string;
  dueLocalTime: string;
  timeliness: OperationalTimeliness;
  state: "OPEN" | "COMPLETED";
  completedLocalTime?: string;
  questionCount: number;
  canComplete?: boolean;
  questions: StandardsQuestion[];
  responses?: StandardsRecordedResponse[];
}

export interface StandardsOccurrenceRequest {
  occurrenceId: string;
}

export interface CompleteStandardsCheckRequest extends StandardsOccurrenceRequest {
  answers: Array<{ questionId: string; value: string }>;
}

export interface CompleteStandardsCheckResponse {
  outcome: "COMPLETED" | "ALREADY_COMPLETED";
  completedAt: string;
  completedLocalTime: string;
  issueRaised?: boolean;
  completedByRequester?: boolean;
}

/**
 * Seeds the synthetic Centre Standards pilot into an environment permitted to
 * hold it. Restricted to local development and the exact `staging`
 * environment, and to `system.configure`.
 */
export interface SeedSyntheticStandardsPilotRequest {
  centreId: string;
  /** `YYYY-MM-DD`. Defaults to today, so the pilot opens straight away. */
  effectiveFrom?: string;
  /** Deploy it active so occurrences generate. Defaults to true. */
  activate?: boolean;
}

export interface SeedSyntheticStandardsPilotResponse {
  templateId: string;
  versionId: string;
  deploymentId: string;
  scheduleRevisionId: string;
  questionCount: number;
  effectiveFrom: string;
  activated: boolean;
}
